// TradeSpace — slim custom Next.js server.
// Only does what the App Router can't:
//   1) prepare Next
//   2) own the WebSocket server at /ws (live ticks + mutation broadcasts)
//   3) boot the alert poll loop
// All REST lives in app/api/* as Next Route Handlers and shares state with us
// via the globalThis singletons in lib/*.
import "dotenv/config";
import fs from "fs";
import http from "http";
import https from "https";
import next from "next";
import { WebSocketServer } from "ws";

import { getCols, mongo } from "./lib/mongo.js";
import { setWss } from "./lib/realtime.js";
import { startPollLoop } from "./lib/alert-engine.js";
import { startAlgoLoop } from "./lib/algo/engine.js";
import { startExecutorLoop } from "./lib/executor/engine.js";
import { startAutonomousLoop } from "./lib/autonomous/engine.js";

// Default to production unless explicitly started with NODE_ENV=development or dev script
const dev = process.env.NODE_ENV === "development";
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

  const nextApp = next({ dev, hostname: "0.0.0.0", port: PORT });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();
  const nextUpgrade = nextApp.getUpgradeHandler();

  const requestListener = async (req, res) => {
    try {
      const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const parsedUrl = {
        pathname: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams),
        search: parsed.search,
        href: parsed.href,
      };
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("[http error]", req.url, err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  };

  // HTTPS when cert.pem+key.pem exist (needed for PWA install / secure browser access), else HTTP.
  const useHttps = fs.existsSync("./cert.pem") && fs.existsSync("./key.pem");
  const server = useHttps
    ? https.createServer({ cert: fs.readFileSync("./cert.pem"), key: fs.readFileSync("./key.pem") }, requestListener)
    : http.createServer(requestListener);

  // ---- WebSocket: /ws -------------------------------------------------
  const wss = new WebSocketServer({ noServer: true });
  setWss(wss);

  wss.on("connection", (ws, req) => {
    ws.symbol = null;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("error", () => {}); // prevent unhandled socket error crashes
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "subscribe") {
          if (msg.symbol) ws.symbol = String(msg.symbol).toUpperCase();
          if (Array.isArray(msg.symbols)) ws.symbols = new Set(msg.symbols.map(s => String(s).toUpperCase()));
        } else if (msg.type === "ping") {
          ws.isAlive = true;
          try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
        }
      } catch { /* ignore bad frames */ }
    });
  });

  // Heartbeat: reap clients that vanished without a close frame.
  // Allow 2 missed cycles (60s) before terminating so mobile / background tabs are not killed prematurely.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { ws.terminate(); }
    }
  }, 30_000);

  // Route the HTTP upgrade: /ws -> our WSS, everything else (incl. Next HMR) -> Next.
  server.on("upgrade", (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      if (pathname === "/ws" || pathname === "/ws/" || pathname.startsWith("/ws?")) {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      } else {
        nextUpgrade(req, socket, head);
      }
    } catch {
      socket.destroy();
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
    const proto = useHttps ? "https" : "http";
    console.log("\n=======================================================");
    console.log("🚀 TradeSpace Enterprise is LIVE & LISTENING!");
    console.log(`📡 Protocol: ${proto.toUpperCase()} | Port: ${PORT} | Mode: ${dev ? "development" : "production"}`);
    console.log(`🌐 Dashboard:          ${proto}://localhost:${PORT}`);
    console.log(`🤖 Autonomous Cockpit: ${proto}://localhost:${PORT}/autonomous`);
    console.log("=======================================================\n");
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
