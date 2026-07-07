# TradeSpace — Master Context

> Read this file first. It's the complete, self-contained context for any AI IDE or human joining this project.
> Chronological progress lives in `progress.md`.

---

## 1. Purpose

A lightweight web app that:

1. Connects to **MetaTrader 5** (running on a Windows RDP) for **live tick + candle data**.
2. Renders **TradingView-style candlestick charts** in the browser for any symbol the broker exposes.
3. Lets the user **create price alerts** on the chart the same way TradingView does — hover a price, click "＋ Alert", or right-click → "Add alert at X".
4. Persists alerts and watchlist in **MongoDB Atlas**.
5. When a live price meets an alert condition, sends a **Telegram notification** to the user's chat.

Non-goals (for now):
- Order execution / live trading (the underlying NEXUS bridge in `../NEXUS/python-engine/mt5_bridge/server.py` has this; **our stripped-down `mt5_server.py` deliberately does not** — alerts only).
- Backtesting, strategy building, indicators — TradingView-style visual alerts and Telegram, nothing more.
- Auth / multi-user. Single-user app.

---

## 2. Architecture

```
┌───────────────────┐        ┌──────────────────────┐        ┌────────────────────────┐
│  Browser          │◀──WS──▶│  Node/Express server │◀──HTTP▶│  Windows RDP           │
│  (public/*)       │  ticks │  server.js           │  bridge│  mt5_server.py         │
│                   │──REST─▶│                      │──HTTP─▶│  ↳ MetaTrader5 pkg     │
│  lightweight-     │  CRUD  │                      │        │  ↳ MT5 terminal        │
│  charts           │        │                      │        │  ↳ Broker              │
└───────────────────┘        └──────────┬───────────┘        └────────────────────────┘
                                        │
                                        │ HTTPS
                                        ▼
                             ┌──────────────────────┐
                             │ MongoDB Atlas        │
                             │  db: TradeSpace      │
                             │   ├─ alerts          │
                             │   └─ watchlist       │
                             └──────────────────────┘
                                        │
                                        │ (on trigger)
                                        ▼
                             ┌──────────────────────┐
                             │  Telegram Bot API    │
                             └──────────────────────┘
```

### Data flow

- **On page load**: browser fetches `/api/rates?symbol=EURUSD&tf=M5&count=1000` → Node → bridge → MT5 → back → chart renders 1000 candles.
- **Live updates**: browser opens WebSocket `/ws` and sends `{type:"subscribe", symbol:"EURUSD"}`. Node's poll loop hits the bridge `/ticks` every `ALERT_POLL_MS` (default 3s) for **{watchlist ∪ active-alert-symbols ∪ subscribed-chart-symbols}**, then broadcasts:
  - `{type:"ticks", ticks:{SYM:{bid,ask,time}, …}}` to every client (used by the watchlist sidebar)
  - `{type:"tick", symbol, bid, ask, time}` only to clients whose `subscribe` matches (used to update the current candle in the chart)
- **Alert engine**: same poll loop, per active alert `A`:
  - Compare current price against `A.price` given `A.condition ∈ {cross, above, below}`. For `cross`, needs a previous sample on the opposite side (kept in memory in `lastPrice` map).
  - When triggered: atomic Mongo update `{status:"active"} → {status:"triggered", triggeredAt, triggeredPrice}` (the filter includes `status:"active"` so it won't double-fire), Telegram send, WS `alert_triggered` broadcast so open browsers refresh and toast.

### Why polling instead of MT5 tick streaming?

Simpler. The `MetaTrader5` Python package is polling-based; there's no push callback. A 3s poll per symbol batch is enough for alerts (this isn't HFT). Configurable via `ALERT_POLL_MS`.

---

## 3. Repo layout

```
TradeSpace/
├── .env                       # secrets & config (see §5) — never commit
├── .env.example               # template for the above
├── package.json               # deps: next, react, mongodb, ws, dotenv, lightweight-charts
├── server.js                  # slim custom Next server: WS at /ws + alert poll loop
├── next.config.mjs / jsconfig.json
├── app/
│   ├── layout.js / page.js / globals.css
│   └── api/                   # all REST as Next Route Handlers
│       ├── health/ rates/ tick/ symbols/
│       ├── alerts/ + alerts/[id]/
│       └── watchlists/ + [id]/ + [id]/symbols/ + [id]/reorder/
├── components/                # Dashboard, ChartPanel, TopBar, Watchlist,
│                              # AlertsPanel, SymbolPalette, AlertDialog
├── lib/                       # mongo, bridge, alert-engine, realtime, telegram, http
├── legacy/                    # retired v1 static app (pre-Next) — not served
├── mt5_server.py              # goes on the Windows RDP, NOT run locally
├── master.md                  # ← this file
└── progress.md                # chronological log
```

The REST layer lives in Next Route Handlers; the custom `server.js` only owns
what the App Router can't: the `/ws` WebSocket endpoint and the alert poll
loop. Both sides share singletons (Mongo client, WSS handle, caches) via
`globalThis` (see `lib/*`).

The bigger project (`../NEXUS/`, `../QUANT/`, `../MYTHOS/`, …) is a separate ecosystem — TradeSpace is a **standalone lightweight tool** that only borrows the bridge concept from NEXUS.

---

## 4. Runtime

### 4.1 On the Windows RDP (data source)

**Prerequisites**
- MetaTrader 5 terminal installed, logged into a broker account, running (Market Watch populated with the symbols you want to chart).
- **Python 3.11 or 3.12** (the `MetaTrader5` PyPI package doesn't ship wheels for 3.14 yet — 3.13 usually works but 3.11/12 are safest).

**One-time setup**
```powershell
python -m pip install MetaTrader5
```

**Run** (in PowerShell, in the same user session as MT5):
```powershell
cd C:\path\to\mt5_server
set MT5_TOKEN=chandan-yashwant-chaudhari-2312
python mt5_server.py --host 0.0.0.0 --port 8765
```

**Firewall**
- Windows firewall (once, elevated PowerShell):
  ```powershell
  New-NetFirewallRule -DisplayName "MT5 Bridge 8765" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow
  ```
- Cloud (AWS/Azure/GCP) Security Group / NSG: allow **TCP 8765** inbound.

### 4.2 On the local box (app)

```bash
cd /home/cc/Downloads/TRADING/TradeSpace
npm install          # first time

npm run dev          # development (Next dev mode + HMR) -> http://localhost:3000

npm run build        # production: compile the Next app first…
npm start            # …then serve it -> http://localhost:3000
```

Requires Node 18.17+ (uses native `fetch`, `AbortSignal.timeout`, `import "dotenv/config"`).

---

## 5. `.env` schema

| Var | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | ✅ | Chat/channel ID (`-100…` for supergroups). Bot must be added to that chat. |
| `MONGODB_URI` | ✅ | Atlas connection string (SRV) |
| `MONGODB_DB` | ✅ | DB name (`Tradespace`) |
| `NEXUS_MT5_REMOTE_URL` | ✅ | Bridge URL — the RDP's **public IP** + port `8765`, e.g. `http://3.134.38.206:8765` |
| `NEXUS_MT5_REMOTE_TOKEN` | ✅ | Must match `MT5_TOKEN` env var set on the RDP before starting `mt5_server.py` |
| `PORT` | ⬜ | Node app port (default 3000) |
| `ALERT_POLL_MS` | ⬜ | Poll interval in ms (default 3000) |

Rest of the `.env` keys (`NEXUS_MT5_BOTTLE_NAME`, `NEXUS_MT5_BRIDGE_COMMAND`, …) are for the sibling NEXUS project. **TradeSpace ignores them.**

---

## 6. Bridge API — `mt5_server.py` on the RDP

All routes require `Authorization: Bearer <MT5_TOKEN>` (or `X-NEXUS-MT5-TOKEN`) unless `MT5_TOKEN` env is unset.

| Method | Path | Payload | Response |
|---|---|---|---|
| GET/POST | `/health` | – | `{ok, status, message, auth, capabilities}` |
| POST | `/tick` | `{"sym":"EURUSD"}` | `{ok, symbol, bid, ask, last, time_msc, digits, spread_points}` |
| POST | `/ticks` | `{"symbols":["EURUSD","XAUUSD"]}` | `{ok, ticks:{SYM:{…}}, ok_count, total}` |
| POST | `/rates` | `{"sym":"EURUSD","timeframe":"M5","count":500}` | `{ok, symbol, timeframe, count, bars:[{t,o,h,l,c,tick_volume}]}` |
| POST/GET | `/symbols` | `{"q":"eur","limit":100,"visible_only":false}` | `{ok, total, count, symbols:[{name,description,path,digits,visible,…}]}` |

**Symbol aliasing** — the bridge tries a bunch of common broker names before giving up (e.g. `US30` → `US30.cash`, `EURUSD` → `EURUSDm`). Full list in `SYMBOL_ALIASES` in `mt5_server.py`. If your broker uses a name not in that list, the frontend picker (`/symbols`) will still show the real broker name; just pick it.

**Timeframes**: `M1, M5, M15, M30, H1, H4, D1`.

---

## 7. Node API — `server.js`

All REST is implemented as Next Route Handlers under `app/api/`; only `/ws` lives in the custom server.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Aggregated health (bridge + mongo + telegram flag); each dependency reports independently |
| GET | `/api/rates?symbol=&tf=&count=` | Proxy to bridge `/rates` (15s in-memory cache) |
| GET | `/api/tick?symbol=` | Proxy to bridge `/tick` |
| GET | `/api/symbols?q=&limit=&refresh=` | Bridge `/symbols` with **5-min in-memory cache** |
| GET | `/api/alerts?symbol=` | List alerts (optionally filtered) |
| POST | `/api/alerts` | `{symbol, price, condition:"cross"\|"above"\|"below", note}` |
| PATCH | `/api/alerts/:id` | Edit price/condition/note, or re-arm (`{status:"active"}`) |
| DELETE | `/api/alerts/:id` | Delete |
| GET | `/api/watchlists` | `{ok, watchlists:[{_id, name, symbols:[…]}, …]}` |
| POST | `/api/watchlists` | `{name}` — create a named list |
| PATCH | `/api/watchlists/:id` | `{name}` — rename |
| DELETE | `/api/watchlists/:id` | Delete a list |
| POST | `/api/watchlists/:id/symbols` | `{symbol}` — add (idempotent `$addToSet`) |
| DELETE | `/api/watchlists/:id/symbols/:symbol` | Remove a symbol |
| POST | `/api/watchlists/:id/reorder` | `{symbols:[…]}` — persist drag-reorder |
| WS | `/ws` | Client sends `{type:"subscribe",symbol}`. Server pushes `ticks`, `alerts_changed`, `watchlists_changed`, `alert_triggered`. 30s ping/pong heartbeat reaps dead clients. |

---

## 8. Mongo collections

**`alerts`**
```
{ _id, symbol, price, condition, note, status: "active"|"triggered",
  createdAt, triggeredAt, triggeredPrice }
```
Index: `{symbol:1, status:1}`.

**`watchlists`** (multiple named lists; the legacy single `watchlist` collection is auto-migrated into a "Main" list on first boot)
```
{ _id, name, symbols: ["EURUSD", …], createdAt }
```

---

## 9. Frontend UX

React (Next App Router) SPA — components in `components/`.

- **TopBar**: brand, symbol palette button (Ctrl+K or `/`), timeframe chips (1m…1D), 🔔 quick-alert at market, live bid/ask, connection dot.
- **ChartPanel** (`lightweight-charts@4.2`): candlesticks + orange dashed price lines for active alerts on this symbol.
  - Hover → "＋ price" button follows the crosshair on the price axis; click opens the alert dialog prefilled.
  - Right-click → context menu: add alert at price / delete nearby alerts.
  - **Drag-to-move**: hover an alert line → grab the ⇅ handle on the axis and drag; PATCHes the new price on release.
  - Bars are cached per `symbol:tf` (and prefetched for the active watchlist) for instant switching.
- **Right sidebar**:
  - **Watchlist** — multiple named lists as tabs (create/rename via double-click/delete), live bid/ask/spread per symbol, drag-to-reorder rows, click to switch chart, hover ✕ to remove. `＋ Add` opens the palette in "add" mode.
  - **Alerts** — every alert (all symbols) with Active/Triggered/All filter, current symbol pinned on top. Jump / delete / re-arm.
- **Symbol palette modal** — keyboard-first search across the broker universe (arrow keys + Enter). Modes: **switch chart** or **add to watchlist**.
- **Toasts** for fired alerts and confirmations.

---

## 10. Key design decisions

| Decision | Why |
|---|---|
| Wrote a **new lean `mt5_server.py`** instead of reusing `NEXUS/python-engine/mt5_bridge/server.py` | NEXUS's bridge is 1600 lines and includes live trading. TradeSpace only needs read paths (health/tick/ticks/rates/symbols). Fewer moving parts, safer (no order routes = no risk of the app placing a trade), way easier to debug. |
| **Polling** the bridge every 3s instead of streaming | The MT5 Python API is inherently polling. 3s is fast enough for alerts and light on the RDP CPU. |
| **`ThreadingHTTPServer` + one shared `mt5.initialize()`** instead of NEXUS's per-request worker subprocess | NEXUS does cold-start-per-request for safety in a bigger system. Our workload is read-only and light; reusing the connection is 10–100× faster with no downside. |
| **Symbol universe fetched from broker** (via `/symbols`) instead of hard-coded | User needs to alert on anything the broker offers, not a curated list. Picker + Mongo watchlist covers this. |
| **In-memory 5-min cache** for `/api/symbols` | Broker symbol list is huge (1000+) and rarely changes; hitting MT5 on every keystroke would be wasteful. |
| **Alert engine polls, not chart-driven** | Alerts must fire even when the browser tab is closed. |
| **`cross` requires previous sample** | Prevents an alert placed above current price from firing instantly if `above` semantics were used. `above/below` = latch-on-touch; `cross` = strict crossing. |
| **Atomic Mongo update with status filter** to trigger | Guarantees no double-Telegram-message even under overlapping poll loops. |
| **No auth on the Node app** | Single-user, runs on `localhost:3000`. Bridge token protects the MT5 side, which is the actually-exposed surface. |

---

## 11. Failure modes & troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/health` returns `bridge unreachable` | RDP down, or Security Group / firewall blocking 8765 | Curl `http://<rdp-ip>:8765/health` from the local box; open port |
| Bridge returns `symbol-missing` for a symbol | Broker uses a name TradeSpace's `SYMBOL_ALIASES` doesn't know about, and Market Watch isn't populated | In MT5 terminal: right-click Market Watch → **Show All** (or add the specific symbol) |
| Bridge returns `not-connected` | MT5 terminal not running / not logged in on the same RDP user session | Log into MT5 first, then restart `mt5_server.py` |
| Alerts never fire | Broker Market Watch doesn't have that symbol subscribed (bridge ticks fail silently) | Same as above |
| `MongoServerError: bad auth` | `.env` `MONGODB_URI` password wrong / IP not whitelisted in Atlas | Whitelist `0.0.0.0/0` in Atlas Network Access (single-user, low risk) |
| Telegram send fails | Bot not in the chat, or `TELEGRAM_CHAT_ID` wrong | Add bot to chat; grab chat id via `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| Python 3.14 → `pip install MetaTrader5` fails | No wheel for 3.14 | Install Python 3.11 or 3.12 |

---

## 12. Reference — the sibling NEXUS bridge

`../NEXUS/python-engine/mt5_bridge/server.py` (1596 lines) is the full-fat bridge with order execution. The routes we borrowed and stripped down:

- `POST /tick`, `/ticks`, `/rates`, `GET /health` — same shape as ours.
- Auth header names, symbol alias approach, and rates fallback pattern (`copy_rates_from` → `copy_rates_from_pos`) are lifted from there.

If in the future TradeSpace ever needs to place trades, the cleanest path is to point `NEXUS_MT5_REMOTE_URL` at the NEXUS bridge instead — TradeSpace's Node code already speaks that dialect for the read routes.

---

## 13. Future work (not started)

- Slack / Discord / email transports alongside Telegram.
- Alert types: percent-change from now, RSI cross, candle close vs level.
- Draw tools (trendlines) with "alert on trendline touch".
- Multi-timeframe alert view / snapshot chart image attached to the Telegram message.
- Historical trigger log (`triggered` alerts already survive in Mongo; just needs a UI panel).
- Deploy the Node app somewhere so alerts fire without the local box running (would need a hosted MongoDB + tunnel to the RDP bridge; Atlas is already hosted, so only the Node side needs it).
