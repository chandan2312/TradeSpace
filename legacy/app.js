/* TradeSpace frontend — chart + watchlist + TradingView-style alerts */
const $ = (id) => document.getElementById(id);

let symbol = localStorage.getItem("ts_symbol") || "EURUSD";
let timeframe = localStorage.getItem("ts_tf") || "M5";
let alerts = [];
let watchlist = [];
const priceLines = new Map(); // alertId -> IPriceLine
const lastTick = new Map();   // symbol -> { bid, ask, prevBid }
let hoverPrice = null;
let lastBar = null;
let digits = 5;
let ws = null;

// ---------- chart ----------
const chart = LightweightCharts.createChart($("chart"), {
  layout: { background: { color: "#131722" }, textColor: "#d1d4dc" },
  grid: { vertLines: { color: "#1e222d" }, horzLines: { color: "#1e222d" } },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#2a2e39" },
  rightPriceScale: { borderColor: "#2a2e39" },
  autoSize: true,
});
const series = chart.addCandlestickSeries({
  upColor: "#26a69a", downColor: "#ef5350",
  wickUpColor: "#26a69a", wickDownColor: "#ef5350",
  borderVisible: false,
});

const tfSeconds = { M1: 60, M5: 300, M15: 900, H1: 3600 };
const fmt = (p, d = digits) => (p == null ? "—" : Number(p).toFixed(d));

// ---------- data loading ----------
async function loadChart() {
  setStatus(false, `loading ${symbol} ${timeframe}…`);
  $("sym-current").textContent = symbol;
  try {
    const res = await fetch(`/api/rates?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}&count=1000`);
    const data = await res.json();
    if (!data.ok || !data.bars?.length) {
      setStatus(false, data.message || data.error || `no data for ${symbol}`);
      return;
    }
    const bars = data.bars.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
    series.setData(bars);
    lastBar = bars[bars.length - 1];
    chart.timeScale().fitContent();
    document.title = `${symbol} ${timeframe} — TradeSpace`;
    const sample = String(bars[bars.length - 1].close);
    digits = sample.includes(".") ? Math.min(sample.split(".")[1].length, 8) : 2;
    setStatus(true, `${symbol} · ${timeframe} · live`);
    subscribe();
    renderAlertLines();
  } catch (err) {
    setStatus(false, `load failed: ${err.message}`);
  }
}

function setStatus(live, text) {
  $("status").classList.toggle("live", live);
  $("status-text").textContent = text;
}

// ---------- websocket live ticks ----------
function connectWS() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = subscribe;
  ws.onclose = () => setTimeout(connectWS, 2000);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "tick" && msg.symbol === symbol) onChartTick(msg);
    if (msg.type === "ticks") onBatchTicks(msg.ticks);
    if (msg.type === "alerts_changed") loadAlerts();
    if (msg.type === "alert_triggered") {
      loadAlerts();
      if (msg.alert.symbol === symbol) toast(`🔔 ${msg.alert.symbol} ${msg.alert.condition} ${msg.alert.price} triggered @ ${msg.alert.triggeredPrice}`);
    }
  };
}

function subscribe() {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "subscribe", symbol }));
}

function onChartTick(t) {
  const price = t.bid || t.ask;
  if (!price || !lastBar) return;
  $("price-badge").textContent = fmt(price);
  $("price-badge").style.color = price >= lastBar.close ? "#26a69a" : "#ef5350";
  const sec = tfSeconds[timeframe];
  const barTime = Math.floor((t.time / 1000) / sec) * sec;
  if (barTime > lastBar.time) {
    lastBar = { time: barTime, open: price, high: price, low: price, close: price };
  } else {
    lastBar = { ...lastBar, high: Math.max(lastBar.high, price), low: Math.min(lastBar.low, price), close: price };
  }
  series.update(lastBar);
}

function onBatchTicks(ticks) {
  for (const [sym, t] of Object.entries(ticks)) {
    const prev = lastTick.get(sym);
    lastTick.set(sym, { bid: t.bid, ask: t.ask, prevBid: prev?.bid ?? t.bid });
  }
  renderWatchlistPrices();
}

// ---------- watchlist ----------
async function loadWatchlist() {
  const res = await fetch("/api/watchlist");
  const data = await res.json();
  watchlist = data.watchlist || [];
  renderWatchlist();
}

function renderWatchlist() {
  const box = $("watchlist");
  if (!watchlist.length) {
    box.innerHTML = `<div class="empty">No symbols yet. Click ＋ to add.</div>`;
    return;
  }
  box.innerHTML = "";
  for (const s of watchlist) {
    const row = document.createElement("div");
    row.className = "watch-item" + (s === symbol ? " active" : "");
    row.dataset.symbol = s;
    row.innerHTML = `
      <span class="name"></span>
      <span class="bid">—</span>
      <span class="spread"></span>
      <button class="del" title="Remove">✕</button>`;
    row.querySelector(".name").textContent = s;
    row.onclick = (ev) => { if (!ev.target.classList.contains("del")) switchSymbol(s); };
    row.querySelector(".del").onclick = async (ev) => {
      ev.stopPropagation();
      await fetch(`/api/watchlist/${encodeURIComponent(s)}`, { method: "DELETE" });
      loadWatchlist();
    };
    box.appendChild(row);
  }
  renderWatchlistPrices();
}

function renderWatchlistPrices() {
  for (const row of $("watchlist").querySelectorAll(".watch-item")) {
    const s = row.dataset.symbol;
    const t = lastTick.get(s);
    const bidEl = row.querySelector(".bid");
    const spreadEl = row.querySelector(".spread");
    if (!t) { bidEl.textContent = "—"; spreadEl.textContent = ""; continue; }
    const d = symbolDigits(s, t.bid);
    bidEl.textContent = fmt(t.bid, d);
    bidEl.classList.toggle("price-up", t.bid > t.prevBid);
    bidEl.classList.toggle("price-down", t.bid < t.prevBid);
    if (t.bid && t.ask) {
      const spreadPips = ((t.ask - t.bid) * Math.pow(10, d)).toFixed(1);
      spreadEl.textContent = spreadPips;
    }
  }
}

function symbolDigits(sym, price) {
  if (sym === symbol) return digits;
  const s = String(price ?? "");
  return s.includes(".") ? Math.min(s.split(".")[1].length, 6) : 2;
}

async function addToWatchlist(sym) {
  await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: sym }),
  });
  loadWatchlist();
}

// ---------- symbol picker ----------
let pickerItems = [];
let pickerHl = 0;

$("sym-pick").onclick = () => openPicker(false);
$("wl-add").onclick = (ev) => { ev.stopPropagation(); openPicker(true); };

function openPicker(addMode) {
  $("picker-back").dataset.mode = addMode ? "add" : "switch";
  $("picker-back").style.display = "flex";
  $("picker-q").value = "";
  $("picker-q").focus();
  searchPicker("");
}
$("picker-back").addEventListener("click", (e) => { if (e.target === $("picker-back")) closePicker(); });
function closePicker() { $("picker-back").style.display = "none"; }

let searchTimer;
$("picker-q").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchPicker(e.target.value), 150);
});

async function searchPicker(q) {
  try {
    const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}&limit=100`);
    const data = await res.json();
    pickerItems = data.symbols || [];
    pickerHl = 0;
    renderPicker();
  } catch (err) {
    $("picker-list").innerHTML = "";
    $("picker-empty").textContent = `Error: ${err.message}`;
    $("picker-empty").style.display = "block";
  }
}

function renderPicker() {
  const list = $("picker-list");
  const empty = $("picker-empty");
  if (!pickerItems.length) {
    list.innerHTML = "";
    empty.textContent = "No matching symbols. Is the MT5 bridge reachable and Market Watch populated?";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = "";
  const mode = $("picker-back").dataset.mode;
  pickerItems.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "row" + (i === pickerHl ? " hl" : "");
    row.innerHTML = `
      <span class="n"></span>
      <span class="d"></span>
      <span class="p"></span>
      ${mode === "add" ? `<button class="add" title="Add to watchlist">＋ WL</button>` : ""}`;
    row.querySelector(".n").textContent = s.name;
    row.querySelector(".d").textContent = s.description || "";
    row.querySelector(".p").textContent = (s.path || "").split("\\").slice(-2, -1)[0] || "";
    row.onclick = () => pickSymbol(s.name);
    const addBtn = row.querySelector(".add");
    if (addBtn) addBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await addToWatchlist(s.name);
      toast(`Added ${s.name} to watchlist`);
    };
    list.appendChild(row);
  });
}

async function pickSymbol(name) {
  const mode = $("picker-back").dataset.mode;
  if (mode === "add") {
    await addToWatchlist(name);
    toast(`Added ${name} to watchlist`);
  } else {
    switchSymbol(name);
  }
  closePicker();
}

$("picker-q").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closePicker(); return; }
  if (e.key === "Enter" && pickerItems[pickerHl]) { pickSymbol(pickerItems[pickerHl].name); return; }
  if (e.key === "ArrowDown") { pickerHl = Math.min(pickerHl + 1, pickerItems.length - 1); renderPicker(); e.preventDefault(); }
  if (e.key === "ArrowUp") { pickerHl = Math.max(pickerHl - 1, 0); renderPicker(); e.preventDefault(); }
});

// ---------- alerts ----------
async function loadAlerts() {
  const res = await fetch("/api/alerts");
  const data = await res.json();
  alerts = data.alerts || [];
  renderAlertList();
  renderAlertLines();
}

function renderAlertLines() {
  for (const [, line] of priceLines) series.removePriceLine(line);
  priceLines.clear();
  for (const a of alerts) {
    if (a.symbol !== symbol || a.status !== "active") continue;
    const line = series.createPriceLine({
      price: a.price,
      color: "#ff9800",
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `🔔 ${a.condition}`,
    });
    priceLines.set(a._id, line);
  }
}

function renderAlertList() {
  const box = $("alert-list");
  if (!alerts.length) {
    box.innerHTML = `<div class="empty">No alerts yet.<br/>Hover the chart &amp; click “＋ Alert”,<br/>or right-click on the chart.</div>`;
    return;
  }
  box.innerHTML = "";
  for (const a of alerts) {
    const div = document.createElement("div");
    div.className = `alert-item ${a.status}`;
    div.innerHTML = `
      <div class="row1">
        <span class="sym"></span>
        <span class="cond"></span>
        <span class="price"></span>
      </div>
      <div class="row2">
        <span class="badge">${a.status === "active" ? "ACTIVE" : "TRIGGERED"}</span>
        <span class="note"></span>
        ${a.status === "triggered" ? `<button data-act="rearm">Re-arm</button>` : ""}
        <button data-act="del">✕</button>
      </div>`;
    div.querySelector(".sym").textContent = a.symbol;
    div.querySelector(".cond").textContent = a.condition;
    div.querySelector(".price").textContent = a.price;
    div.querySelector(".note").textContent = a.note || "";
    div.querySelector(".sym").style.cursor = "pointer";
    div.querySelector(".sym").onclick = () => { if (a.symbol !== symbol) switchSymbol(a.symbol); };
    div.querySelector('[data-act="del"]').onclick = async () => {
      await fetch(`/api/alerts/${a._id}`, { method: "DELETE" });
      loadAlerts();
    };
    const rearm = div.querySelector('[data-act="rearm"]');
    if (rearm) rearm.onclick = async () => {
      await fetch(`/api/alerts/${a._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      loadAlerts();
    };
    box.appendChild(div);
  }
}

// ---------- TradingView-style alert creation ----------
chart.subscribeCrosshairMove((param) => {
  const btn = $("add-alert-btn");
  if (!param.point || param.point.x < 0) { btn.style.display = "none"; hoverPrice = null; return; }
  const price = series.coordinateToPrice(param.point.y);
  if (price == null) { btn.style.display = "none"; hoverPrice = null; return; }
  hoverPrice = price;
  btn.style.display = "block";
  btn.style.top = `${param.point.y}px`;
  btn.textContent = `＋ ${fmt(price)}`;
});
$("chart-wrap").addEventListener("mouseleave", () => { $("add-alert-btn").style.display = "none"; });
$("add-alert-btn").addEventListener("click", () => { if (hoverPrice != null) openDialog(hoverPrice); });

$("chart-wrap").addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  const rect = $("chart-wrap").getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const price = series.coordinateToPrice(y);
  if (price == null) return;
  hoverPrice = price;
  $("ctx-price").textContent = fmt(price);
  const menu = $("ctx-menu");
  menu.style.display = "block";
  menu.style.left = `${Math.min(ev.clientX - rect.left, rect.width - 210)}px`;
  menu.style.top = `${Math.min(y, rect.height - 50)}px`;
});
document.addEventListener("click", () => { $("ctx-menu").style.display = "none"; });
$("ctx-add").addEventListener("click", () => { $("ctx-menu").style.display = "none"; openDialog(hoverPrice); });

// ---------- dialog ----------
function openDialog(price) {
  $("d-symbol").value = symbol;
  $("d-price").value = fmt(price);
  if (lastBar) $("d-cond").value = price > lastBar.close ? "above" : "below";
  $("d-note").value = "";
  $("dialog-back").style.display = "flex";
  $("d-price").focus();
}
$("d-cancel").onclick = () => { $("dialog-back").style.display = "none"; };
$("dialog-back").addEventListener("click", (e) => { if (e.target === $("dialog-back")) $("d-cancel").onclick(); });
$("d-save").onclick = async () => {
  const body = { symbol, price: Number($("d-price").value), condition: $("d-cond").value, note: $("d-note").value };
  if (!Number.isFinite(body.price)) return;
  const res = await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  $("dialog-back").style.display = "none";
  if (data.ok) { toast(`Alert set: ${symbol} ${body.condition} ${fmt(body.price)}`); loadAlerts(); }
  else toast(`Failed: ${data.error}`);
};

// ---------- symbol / timeframe controls ----------
function switchSymbol(s) {
  symbol = String(s).toUpperCase().trim();
  localStorage.setItem("ts_symbol", symbol);
  $("sym-current").textContent = symbol;
  for (const row of $("watchlist").querySelectorAll(".watch-item")) {
    row.classList.toggle("active", row.dataset.symbol === symbol);
  }
  loadChart();
}

$("tf-group").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tf]");
  if (!btn) return;
  timeframe = btn.dataset.tf;
  localStorage.setItem("ts_tf", timeframe);
  for (const b of $("tf-group").children) b.classList.toggle("active", b === btn);
  loadChart();
});

// ---------- toast ----------
let toastTimer;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, 4000);
}

// ---------- boot ----------
$("sym-current").textContent = symbol;
for (const b of $("tf-group").children) b.classList.toggle("active", b.dataset.tf === timeframe);
connectWS();
loadChart();
loadAlerts();
loadWatchlist();
