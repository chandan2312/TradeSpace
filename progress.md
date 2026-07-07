# TradeSpace — Progress Log

> Read `master.md` for architecture and the "what/why". This file is the chronological "what happened and where we are".
> Append new entries at the top. Keep it short — one entry per meaningful step.

---

## Status snapshot (2026-07-07)

**Backend + frontend code**: complete.
**MT5 bridge on Windows RDP**: running at `http://3.134.38.206:8765`.
**Bridge reachability from local box**: unverified in-session (permission classifier blocked `curl` during the session — user confirmed manually that the RDP is up).
**Node app started + end-to-end verified**: **not yet done**. Immediate next step: `npm install && npm start` in `/home/cc/Downloads/TRADING/TradeSpace`, open http://localhost:3000, place a test alert near market price, watch for Telegram.

### Open tasks
- [ ] Verify end-to-end: chart loads → tick stream flowing → create alert → Telegram fires → alert marked `triggered` in Mongo.
- [ ] (optional) Register `mt5_server.py` as a Windows service via NSSM so it survives RDP sign-outs.

---

## Log

### 2026-07-07 — Production-readiness pass (bug fixes + hardening)
- **Fixed** drag-to-move alert: price line now follows the pointer (`dragging.id` was compared against `a.id` instead of `a._id` in `ChartPanel`).
- **Fixed** WS reconnect re-subscribing to the symbol from first mount instead of the current chart (`Dashboard` now tracks it in a ref).
- **Fixed** stale-candle corruption when switching symbol/tf without cache: `lastBarRef` is now tagged with its `symbol:tf` key, so live ticks can't merge into the previous series (also prevented a lightweight-charts `update()` throw).
- **Fixed** AlertDialog prefilling price "0" (and defaulting to "below") when opened before the first tick.
- **Hardened API**: malformed Mongo ids now return 400 instead of an uncaught 500 (shared `oid()` in `lib/http.js`); `/api/health` reports bridge/mongo/telegram independently instead of 502-ing everything when the bridge is down.
- **Hardened server**: fail-fast on missing `MONGODB_URI`, WS ping/pong heartbeat (30s) reaps dead clients, SIGINT/SIGTERM graceful shutdown, bridge timeout 60s → 15s (30s for `/rates`) so a hung bridge can't stall the poll loop.
- **Cleanup**: retired the pre-Next v1 static app (`public/index.html`, `public/app.js`) into `legacy/` — it called endpoints that no longer exist. Added `.env.example` + `.gitignore`. Updated `master.md` (§3 layout, §4.2 run, §7 API, §8 collections, §9 UX) to match the Next.js architecture.

### 2026-07-07 — Handoff docs
- Created `master.md` (complete context) and `progress.md` (this file).
- Left task #4 (end-to-end verify) `in_progress` because it needs a working shell we haven't had this session.

### 2026-07-07 — Symbols endpoint + watchlist
- **Bridge**: added `POST /symbols` returning every broker symbol (name/desc/path/digits/base+quote currency/visible). Filterable by substring `q`, MT5 `group` pattern, `visible_only`, `limit`.
- **Node**: `GET /api/symbols?q=…&limit=…&refresh=1` with a 5-min in-memory cache. New `GET/POST/DELETE /api/watchlist` backed by a `watchlist` Mongo collection (unique index on `symbol`). Poll loop now also ticks the whole watchlist and broadcasts a `{type:"ticks"}` batch to every WS client.
- **Frontend**:
  - Header search input replaced with **🔍 EURUSD ▾** button that opens a modal picker (search + arrow keys + Enter). Two picker modes: "switch chart" (header button) or "add to watchlist" (`＋` in the watchlist header).
  - New Watchlist sidebar section (above Alerts) with live bid, tick-direction green/red, spread in pips, hover ✕ to remove. Click a row to switch the chart.
  - Alerts fire for any watchlist symbol whether or not it's the current chart.
- **Diagnostics addressed**: removed unused `time` import from `mt5_server.py`. Pylance's `MetaTrader5` import warning is expected on Linux — irrelevant, resolves fine on the RDP.

### 2026-07-07 — Windows-side setup guide
- Wrote the RDP setup playbook (install Python 3.11, `pip install MetaTrader5`, open TCP 8765 in Windows firewall + cloud Security Group, run `python mt5_server.py --host 0.0.0.0 --port 8765`).
- Called out Python 3.14 gotcha (no `MetaTrader5` wheel yet).
- User confirmed MT5 installed + logged into broker on the new RDP.

### 2026-07-07 — Lean MT5 bridge for the RDP
- Wrote `mt5_server.py` — a stripped-down MT5 HTTP bridge specifically for TradeSpace.
- Only read routes: `/health`, `/tick`, `/ticks`, `/rates`. **No order/position routes** — intentional (this app doesn't trade).
- Reuses one `mt5.initialize()` call across requests (much faster than the sibling NEXUS bridge which cold-starts per call).
- Bearer-token auth matches NEXUS's header names (`Authorization: Bearer`, `X-NEXUS-MT5-TOKEN`) so existing `.env` continues to work.
- CORS wide-open for browser debugging.

### 2026-07-07 — Frontend chart & alerts (v1)
- `public/index.html` + `public/app.js` — single-page app using `lightweight-charts@4.2`:
  - Symbol datalist input (later replaced by picker in the watchlist update).
  - Timeframe chips (1m/5m/15m/1h) with active-state persisted in `localStorage`.
  - **TradingView-style alert entry**: hover the chart → "＋ price" button follows the crosshair on the price axis → click opens the alert dialog prefilled with the price and a sensible default condition (`above` if hover above market, `below` if below).
  - **Right-click "Add alert at X"** context menu — mirrors TradingView.
  - Active alerts render as orange dashed price lines on the chart with axis labels.
  - Alerts sidebar with delete + re-arm.
  - WebSocket auto-reconnect; live tick updates the current candle in place and rolls new candles when the bar boundary is crossed.

### 2026-07-07 — Node backend (v1)
- `server.js` — Express + `ws` + `mongodb`:
  - Bridge proxy (`/api/rates`, `/api/tick`) forwarding auth + JSON payload the bridge expects.
  - Alerts CRUD backed by Mongo `alerts` collection.
  - Poll loop every 3s (configurable via `ALERT_POLL_MS`): batch-fetches `/ticks` for {active alerts ∪ subscribed chart symbols}, evaluates conditions, atomically flips `active→triggered` in Mongo, sends Telegram HTML message, broadcasts WS events.
  - `/ws` endpoint accepts `{type:"subscribe", symbol}` per client so each browser only receives ticks for its focused chart.
  - Health aggregation endpoint (`/api/health`) — bridge, Mongo, and Telegram-configured flag.

### 2026-07-07 — Scaffolding
- Created `package.json` (ES modules, deps: `express@4`, `mongodb@6`, `ws@8`, `dotenv@16`).
- Reused the user-provided `.env` verbatim — pulls Telegram creds, Mongo URI, MT5 bridge URL + token from it. Ignored the Bottles/Wine keys as instructed.

---

## Environment as of last update

- **Local dev box**: Linux 6.17, working dir `/home/cc/Downloads/TRADING/TradeSpace`. Node needs to be 18+.
- **RDP**: AWS `3.134.38.206` (us-east-2), Windows Server + MT5 terminal logged in. Bridge running under Python interpreter listening on `0.0.0.0:8765`.
- **MongoDB**: Atlas free tier at `mongodb+srv://…nru75lx.mongodb.net/TradeSpace`, DB name `Tradespace`.
- **Telegram**: bot `8469737918:…` posting to chat `-1002617432013`.

---

## How to resume in a fresh AI session

1. Read `master.md` in full — it's self-contained.
2. Skim the top ~30 lines of this file for state.
3. If the last log entry doesn't say "end-to-end verified", the first action is: run `npm install && npm start` locally, ensure the bridge is reachable (`curl http://<rdp-ip>:8765/health` with the bearer token), and drive a test alert through the UI.
