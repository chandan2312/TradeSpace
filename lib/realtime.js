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
  const body = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(body);
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
