// TradeSpace — slim custom Next.js server.
// Only does what the App Router can't:
//   1) prepare Next
//   2) own the WebSocket server at /ws (live ticks + mutation broadcasts)
//   3) boot the alert poll loop
// All REST lives in app/api/* as Next Route Handlers and shares state with us
// via the globalThis singletons in lib/*.
import "dotenv/config";
import http from "http";
import next from "next";
import { WebSocketServer } from "ws";

import { getCols, mongo } from "./lib/mongo.js";
import { setWss } from "./lib/realtime.js";
import { startPollLoop } from "./lib/alert-engine.js";
import { startAlgoLoop } from "./lib/algo/engine.js";
import { startExecutorLoop } from "./lib/executor/engine.js";
import { startAutonomousLoop } from "./lib/autonomous/engine.js";

const dev = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT || 3000);

function checkEnv() {
  if (!process.env.MONGODB_URI) {
    console.error("fatal: MONGODB_URI is not set — copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  if (!process.env.NEXUS_MT5_REMOTE_URL && !process.env.MT5_BRIDGE_URL) {
    console.warn("[env] no bridge URL set — falling back to http://127.0.0.1:8765");
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn("[env] Telegram not configured — alerts will trigger but no message will be sent.");
  }
}

async function main() {
  checkEnv();
  // Warm Mongo (creates indexes, seeds default watchlist) before serving traffic.
  await getCols();

  const nextApp = next({ dev });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();
  const nextUpgrade = nextApp.getUpgradeHandler();

  const server = http.createServer((req, res) => handle(req, res));

  // ---- WebSocket: /ws -------------------------------------------------
  const wss = new WebSocketServer({ noServer: true });
  setWss(wss);

  wss.on("connection", (ws) => {
    ws.symbol = null;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "subscribe") {
          if (msg.symbol) ws.symbol = String(msg.symbol).toUpperCase();
          if (Array.isArray(msg.symbols)) ws.symbols = new Set(msg.symbols.map(s => String(s).toUpperCase()));
        }
      } catch { /* ignore bad frames */ }
    });
  });

  // Heartbeat: reap clients that vanished without a close frame, so the poll
  // loop doesn't keep broadcasting to (and tracking symbols for) dead sockets.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  // Route the HTTP upgrade: /ws -> our WSS, everything else (incl. Next HMR) -> Next.
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      nextUpgrade(req, socket, head);
    }
  });

  // ---- Alert engine ---------------------------------------------------
  startPollLoop();

  // ---- Currency-algo paper-trade engine (monitor rides the tick stream) ---
  startAlgoLoop();

  // ---- Executor engine (executes user-placed setups; rides the tick stream) ---
  startExecutorLoop();

  // ---- Autonomous Brain Trader engine (scanner 3min; rides the tick stream) ---
  startAutonomousLoop();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[tradespace] http://0.0.0.0:${PORT}  (${dev ? "dev" : "prod"})`);
  });

  // ---- graceful shutdown ----------------------------------------------
  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[tradespace] ${sig} — shutting down`);
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    server.close();
    try { await mongo.close(); } catch { /* already closed */ }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
