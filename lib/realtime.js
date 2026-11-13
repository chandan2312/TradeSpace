// WebSocket registry shared between the custom server (which owns the WSS) and
// the Next API routes (which broadcast on mutation). globalThis bridges them.
const g = globalThis;

export function setWss(wss) {
  g._tsWss = wss;
}

export function getWss() {
  return g._tsWss || null;
}

export function broadcast(obj) {
  const wss = g._tsWss;
  if (!wss) return;
  try {
    const body = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        try {
          client.send(body);
        } catch {
          // ignore dead/closing client socket
        }
      }
    }
  } catch (err) {
    console.warn("[broadcast error]", err?.message || err);
  }
}

export function broadcastTicks(tickBatch) {
  const wss = g._tsWss;
  if (!wss || !wss.clients || !Object.keys(tickBatch).length) return;

  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;

    const clientSymbols = client.symbols;
    const clientChart = client.chartSymbols;
    const singleSymbol = client.symbol;

    let payloadTicks = null;

    if (!clientSymbols && !clientChart && !singleSymbol) {
      // Universal client: receives full batch
      payloadTicks = tickBatch;
    } else {
      // Selective routing: only send ticks relevant to this client's active charts/watchlist
      const filtered = {};
      let hasAny = false;
      for (const [sym, tick] of Object.entries(tickBatch)) {
        const u = sym.toUpperCase();
        const canon = String(tick?.symbol || "").toUpperCase();
        const broker = String(tick?.brokerSymbol || "").toUpperCase();
        const matches = (set) => set && (set.has(u) || (canon && set.has(canon)) || (broker && set.has(broker)));
        if (
          matches(clientChart) ||
          matches(clientSymbols) ||
          (singleSymbol && (singleSymbol === u || singleSymbol === canon || singleSymbol === broker))
        ) {
          filtered[sym] = tick;
          hasAny = true;
        }
      }
      if (hasAny) {
        payloadTicks = filtered;
      }
    }

    if (payloadTicks) {
      try {
        client.send(JSON.stringify({ type: "ticks", ticks: payloadTicks }));
      } catch {}
    }
  }
}

export function subscribedSymbols() {
  const wss = g._tsWss;
  const out = new Set();
  if (wss) {
    for (const client of wss.clients) {
      if (client.symbol) out.add(client.symbol);
      if (client.symbols) client.symbols.forEach(s => out.add(s));
    }
  }
  return out;
}

export function activeChartSymbols() {
  const wss = g._tsWss;
  const out = new Set();
  if (wss) {
    for (const client of wss.clients) {
      if (client.chartSymbols && client.chartSymbols.size) {
        client.chartSymbols.forEach(s => out.add(String(s).toUpperCase()));
      } else if (client.symbol) {
        out.add(String(client.symbol).toUpperCase());
      }
    }
  }
  return out;
}
