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

### 2026-07-08 — M1/M5 removed from the bias engine (user call: they added chaos)
- `data.js` SPEC back to 4 TFs (D1/H4/H1/M15) — less bridge load per symbol.
- Playbook is now **sweep → M15 displaced MSS** (`playbook.js` rewritten): sweep fresh ≤12 M15 bars, MSS ≤16 bars after it, `mssTf` always "M15", `mssAgeMin` = age×15. Volume grading unchanged.
- Engine: `intraday` IS frames.M15 (no M5 fallback chain), header/comments updated; route no-data check drops M5; panel badge title says M15; notify freshness window 20→45 min (≤3 M15 bars).
- Test scenario rebuilt on 900s bars (60 prior-day + 40 today), M1 frame deleted.

### 2026-07-08 — Bias v5: volume + volume profile (`lib/bias/volume.js`), RCA hardening
- **RCA headline: the engine was volume-blind** — the bridge sends `tick_volume` but data.js dropped it. Now ingested as `v` (fail-soft: no volume → engine behaves exactly like v4).
- **`volume.js`**: price-binned `volumeProfile` (POC, VAH/VAL 70% value area, HVN ≥1.3×mean, LVN ≤0.6×mean, max 3 each) over **smart ranges** — prior completed day (fixed reference), today (developing), and the current *dealing range* anchored at the last displaced MSS. Plus `volRatio` (bar vs 60-bar mean) and `relParticipation` (5/60 vol SMA).
- **8th lens "Volume"** (base 0.9; fitness rises with participation): acceptance above/below prior value (w5), rotation-to-POC magnet inside value (w4), developing-POC draw (w3), HVN shelf/ceiling within 2×avg (w4), LVN void on the path to the active liquidity draw (w3).
- **Volume now VETS existing signals**: sweeps ≥1.8× vol → ×1.25 "climactic" / ≤0.7× → ×0.75 thin; MSS structure drives ≥1.5× → ×1.15 / ≤0.6× → ×0.85; low-volume "broken & holding" → ×0.7 trap-risk (RCA #3); QML neck-break ≥1.5× → ×1.15. **Playbook setups** carry `volRatio` (max of confirming TFs): ≥1.8 upgrades grade to A, <0.6 downgrades to B — shown in the panel note + Telegram.
- **New dampener**: dead tape (participation <55% of normal) −15%.
- **Dedup (RCA #4)**: engine's `fvgStack()` deleted — gap imbalance now counted from zones.js `fvgZones()` open zones (single lifecycle source).
- Test extended: profile sanity (val≤poc≤vah), climactic sweep annotation, setup volume-vetting, 8-lens payload, and no-volume graceful degradation.

### 2026-07-08 — Group confirmation v2: per-currency FX bias + asymmetric index groups
- **FX rethought at the currency level.** A EURUSD short is confirmed when **EUR reads weak AND USD reads strong**, each currency scored across a fixed 14-pair basket (majors + EUR/GBP/JPY crosses + CADJPY/NZDJPY) — mean leg direction, directional only on a ≥50% majority. Correlated currency (EUR↔GBP, AUD↔NZD only) must not contradict. Legs use full bias scores when watched, else on-demand cached M15 structure reads (`getBars` now exported from data.js).
- **Indices per user spec**: US30 **standalone** (never gated, auto-confirms); NAS100→[US500, GER40]; US500→[NAS100, GER40]; GER40→[UK100, FR40, NAS100, US500]. Alias matching (NDX100/USTEC=NAS100, SPX500/SP500=US500, GER30/DE40/DAX=GER40, CAC40=FR40, FTSE=UK100) so broker naming differences don't break lookups.
- Basket/partner bars fetched lazily inside `confirmSetups` (only when a setup exists, parallel, fail-soft) — route prefetch reverted to SMT-only. confirmSetups is now async.

### 2026-07-08 — Group confirmation for setups (`lib/bias/group.js`)
- **A setup only fires when its group agrees.** Signed partner map per symbol (EURUSD → GBPUSD +, USDCHF −, USDJPY −; AUD↔NZD, USDCAD −; US30/NAS100/US500 mutual; GER40/UK100; XAU↔XAG; BTC↔ETH). Each partner read from its full bias score when on the watchlist (±10 dead zone), else fetched and read from M15 structure with the fresh-MSS override.
- **Rule**: confirmed = no partner actively contradicts AND ≥1 actively aligns. Neutral partners don't block; zero checkable partners → not blocked (fail-open).
- **Held setups**: `setup.group.confirmed=false` → phase demoted to reversal-watch, Telegram suppressed; an active contradiction also adds a "group not aligned" −20% dampener. `confirmSetups()` runs in the route BEFORE `aggregate()` so the dampener participates in final scoring.
- **Route** now prefetches group partners alongside SMT partners (cap 4→6 extra symbols). Telegram message gains a `group: GBPUSD ✓ · USDCHF ✓` line.
- **Panel**: held setups show a dimmed `⚡… ↑/↓` badge with the hold reason in the tooltip; expanded view (and fullscreen cards) get a "Group check" chip row — each partner green ✓ / red ✗ / muted –, tooltip shows correlation sign and read source.
- bias-v4-test.mjs extended: confirm / contradict / all-neutral / no-partners cases.

### 2026-07-08 — Bias v4: 7-lens ensemble + playbook setup detection
- **Lens set fanned out** from trend/reversal/flow to **7 concept lenses** (`lenses.js` LENSES registry, each with base weight + regime fitness): Structure 1.0 (ER-driven), Liquidity 1.0 (live pools in play), Reversal 1.1 (reversal-push freshness — playbook priority), FVG 0.8 (ER-driven), Order Blocks 0.85 (0.9 when price is at a zone), S/R 0.9 (inverse ER — ranges trust levels), Flow 0.7 (group corroboration). Vote/agreement/stability machinery unchanged; every drive retagged concept-true (sweeps/draws→liquidity, strong levels/PD/SR-flips→sr, FVG stack→fvg, etc).
- **New detectors** `lib/bias/zones.js`: order blocks (last opposite candle before a ≥1.2×avg displacement through a confirmed pivot; killed by close through the far side, `tapped` tracked) on H1+M15 — price at an unmitigated OB w≤8, fresh OB w5; headless FVG lifecycle (open→inverted→reclaimed) — fresh iFVG flip w≤7, nearest open gap in the pullback path w4.
- **Playbook signature** `lib/bias/playbook.js` (the user's exact trade): intraday pool swept (age ≤36 M5 bars) → **displaced MSS on M1 and/or M5 after the sweep** (event-stream scan, so continuation BOS after the MSS keeps it valid; any opposite event negates). Grade A when both TFs confirm or the pool is PDH/PDL/PWH/PWL/EQH/EQL. Fires the largest drive in the engine (w18, ×1.15 A), phase → **"setup"** (protected from the chop overwrite in `aggregate()`), `setup` object in the API payload. `structure.js` now also returns the full `events` array.
- **M1 frames** added to `data.js` (240 bars, 30s TTL) — consumed only by the playbook detector, not by standing structure.
- **Telegram** `lib/bias/notify.js`: one-time ⚡ ping (symbol, direction, pool, MSS TF+age, bias/confidence) when a setup is ≤20min fresh; deduped per symbol/dir/pool/day like the AMD auto-alerts; wired fail-soft into `/api/bias`. Only fires while a client is polling the panel (same limitation as AMD alerts).
- **Panel**: lens diagram renders dynamically from server labels (7 rows), ⚡ phase badge with setup detail tooltip (pool, ages, grade, direction arrow), per-factor lens tag chips.
- **Fullscreen popup**: ⛶ button in the panel header opens a 95vw/90vh modal — risk gauge + category chips + currency strength across the top, then every watchlist symbol as a card in an auto-fill grid with the FULL breakdown (lens vote, pillars, TF structure, factors, dampeners) always expanded. Esc / backdrop / ✕ closes; clicking a symbol jumps the chart and closes.
- **Not yet runtime-verified** — a Claude-side permission-classifier outage blocked ALL command execution this session (`node`, `npm run build`). A synthetic engine test was left at `bias-v4-test.mjs` (project root): run `node bias-v4-test.mjs && npm run build`, fix anything it flags, then delete it.

### 2026-07-08 — Bias v3: lens ensemble + stability stress-test (`lib/bias/lenses.js`)
- **Lens vote replaces the single weighted sum.** Every drive is tagged trend / reversal / flow; three lens scores are combined by a regime-weighted vote: trend fitness from the H1 efficiency ratio (expansion), reversal fitness from reversal-push freshness (post-sweep), flow fitness from how many group signals corroborate. Base lens weights 1.0/1.0/0.8.
- **Disagreement is output**: agreement % = share of fitness×magnitude mass pointing with the verdict; <70% = contested; contested + reversal lens ≥25 against trend → phase "reversal-watch". <60% agreement is also a −20% dampener.
- **Stability**: 200 seeded trials jittering every drive weight ±30%; % of trials where the bias sign survives. <60% → "fragile verdict" dampener (−15%). Deterministic PRNG (mulberry32) so numbers are reproducible.
- **Premium/discount re-added** (it was accidentally dropped in the v2 rewrite) as a reversal-lens drive, w≤9.
- Panel: expanded view now shows the lens vote diagram (three centered bars, fitness-scaled opacity, f-values) with agreement % and stability % in the header.

### 2026-07-08 — Reversal-anatomy detectors (`lib/bias/reversals.js`)
- **Sweep-rejection wick**: range ≥1.3×avg, wick ≥55% of range, body ≥22%, close in the far third; grade A when the wick actually ran a prior swing (checked vs pivots). D1 w10 / H4 w8 / M15 w7, feeds reversalPush + triggerSum.
- **V-reversal**: leg ≥2.2×avg into a pivot, ≥70% recovered within 10 bars; freshness measured from the recovery bar, grade A at ≥3.5×avg legs.
- **Grind → displacement**: 10-bar retracement drift with mean body <0.55×avg and no impulse inside, broken by a candle ≥1.5×avg whose body is ≥2.5× the grind's mean → continuation trigger.
- **Standing strong lows/highs**: every unviolated D1/H4 reversal extreme stays on the books ("hard to break") — nearest strong low below price is persistent bullish evidence (w5/w4 × proximity), nearest strong high above is bearish; killed only by a close through it.

### 2026-07-07 — Bias engine v2: pillars, dampeners, group thinking, beyond-candles
- **Drives vs dampeners**: evidence now has a "bad" ledger. Dampeners scale the final score multiplicatively and are listed with their penalty: structure chop (−35%), high-impact news ≤2h (−40%), post-news ≤1h (−25%), mixed evidence (−15%), extended >3×range from H1 20-bar mean (−15%), off-hours (−30%), counter-liquidity near (−15%).
- **Pillars** for the diagram: every drive tagged HTF / Intraday / Liquidity / Context; per-pillar −100..+100 sub-scores returned.
- **New detectors**: PWH/PWL (weekly liquidity draw + weekly stop hunts), FVG imbalance stack (net unfilled M15 gaps), A+ alignment bonus (HTF bias + fresh trigger agree), SMT divergence (M15 swing disagreement vs correlated partner — partners auto-fetched: EURUSD↔GBPUSD, AUD↔NZD, US30↔NAS100↔US500, XAU↔XAG, BTC↔ETH), risk sentiment (structure read of US500+BTCUSD proxies with per-symbol risk beta: indices/crypto +1, gold −1, XXXJPY +1).
- **Beyond candles**: `lib/bias/news.js` — ForexFactory free weekly calendar (high-impact, per-currency, 30min cache, fails soft). Symbol→currency mapping incl. DAX→EUR, FTSE→GBP etc.
- **Group pass in aggregate()**: category feedback (unchanged), NEW currency-strength consensus (each FX pair pulled toward its group-implied read, ±6; USD read spills inversely into metals ±5), dampeners applied last so group conviction is also scaled.
- **Panel diagrams**: risk-on/off semicircle gauge (SVG needle), currency-strength centered-bar grid, per-symbol pillar bar diagram in the expanded view, ⚠ news badge on rows, dampener list in orange with −% penalties.

### 2026-07-07 — Bias engine (narrative-based, anti-lag)
- **Core** `lib/bias/`: `structure.js` (per-TF swing sequence + BOS/MSS event stream, displacement-validated), `liquidity.js` (PDH/PDL, Asia/London/NY session H/Ls, EQH/EQL builds; each level classified untapped / swept / broken; QML detector = sweep→neck-break), `engine.js` (factor scoring), `data.js` (5-TF frames D1/H4/H1/M15/M5 with per-TF TTL cache 10m→1m).
- **Anti-lag principles** (the fix vs. the NEXUS engine): sweeps score AGAINST their direction; fresh displaced MSS overrides its TF's stale structure factor; untapped liquidity acts as a magnet (draw); premium/discount + streak exhaustion fade mature moves; all factors decay with age. Reversal override: fresh sweep/MSS/QML cluster against the HTF stack → phase "reversal-watch" and score blends toward the trigger.
- **Weights**: D1 14 / H4 18 / H1 13 / M15 8 (structure, MSS-boosted), sweeps 12×level-mult, breaks 7, draw 6, QML 11, premium-discount ≤9, exhaustion 6. Score −100..+100, dir at ±15, confidence = agreeing-weight × data completeness.
- **Categories**: fx/indices/metals/crypto/energy/stocks via symbol classification; category mean + alignment %, ±12% feedback into members (≥3 peers); FX **currency strength** meter derived from pair scores.
- **API**: `GET /api/bias?symbols=` (default: watchlist union, cap 16, 60s response cache, sequential per symbol).
- **UI**: `BiasPanel` below the Watchlist — session header, category chips, currency strength row, per-symbol rows (phase badge T/R/C, centered score bar, confidence, click → factor audit trail with weights), 90s auto-refresh, click symbol to jump chart.
- Note: NEXUS baseline couldn't be read this session (sandbox shell/agent outage) — weights are from the user's described model; reconcile with NEXUS when tools return.

### 2026-07-07 — AMD v2 + auto-alerts
- **Coil gate**: accumulation (00–06 broker time) must have low drift (≤0.55×range) and compression vs. the prior day's range, else the session draws nothing.
- **Contained judas sweep**: depth-bounded (>1.3×range = real breakout → void), re-entry close inside within ~5h, **displacement** required (strong opposing body ≤6 bars after re-entry). Bonus if the sweep also ran the prior day's high/low.
- **Score** (compression 30 / displacement 25 / depth shape 20 / re-entry speed 15 / PD sweep 10): <0.5 hidden; M marker carries ★ grade; pending distribution shows a dashed "D trigger" line at the opposite coil boundary (to current bar only).
- **Auto-alert**: fresh (≤12 bars since re-entry), strong (≥0.6) formations emit a suggestion; `runPatterns` now returns `{drawings, autoAlerts}`, ChartPanel forwards, Dashboard POSTs a real alert at the distribution trigger. Deduped per symbol/day/side via a `[AMD:SYM:day:H|L]` tag in the note (checked against existing alerts + session set), so it fires once across panes/TFs/reloads. Telegram then fires server-side even with the browser closed.

### 2026-07-07 — Trendline liquidity v2 (smart filtering)
- **Untapped pools only**: any wick through the *projected* line after the last touch = hunted → hidden. Price must also still be on the respecting side and within 6×avg-range of the line (stale pools hidden).
- **No projection**: segment drawn first→last touch only, no right extension.
- **Correct-side only**: ascending lines through swing lows (sell-stops below) and descending lines through swing highs (buy-stops above); slope-sign + min/max slope constraints.
- **Quality model**: candidates least-squares-refit through their touch set, then scored — touch count (30%), bounce strength after each touch (20%), touch precision (20%), spacing evenness (15%), lifespan (15%). Score ≥ 0.55 to display, ★/★★/★★★ grade in the label, max 2 per side, overlap-deduped.

### 2026-07-07 — Pattern detection indicators (v1)
- New **ƒx "Patterns" menu** in the TopBar — toggle each detector like an indicator; persisted in `localStorage (ts_indicators)`; applies to all panes.
- Framework: `lib/patterns/` — pure detectors `(bars, ctx) → drawings[]`; one canvas **series primitive** (`primitive.js`, zOrder "bottom") renders everything faintly *behind* the candles. Tolerances scale off avg candle range, so detectors adapt to any symbol/TF. Detection re-runs on data load and bar close (not every tick).
- Detectors:
  1. **dtb** — Double/Triple Top & Bottom: clusters of near-equal pivots with a real pullback between; only **unswept** levels drawn (dashed level + touch dots + `DT/TT/DB/TB ×n`).
  2. **tll** — Trendline Liquidity: lines through pivot pairs with **3+ touches**, no close-through between touches, deduped, max 2 per direction, extended right (`TL liq ×n`).
  3. **fvg** — FVG / iFVG: 3-candle gaps ≥ 0.35×avg range; wick-through = filled (hidden), **close**-through = inverted (`iFVG`, drawn from inversion until reclaimed).
  4. **amd** — Power of 3 (intraday): accumulation box 00–06 broker time (`A`), judas sweep beyond the range that closes back inside (`M` at the extreme), close beyond the opposite side (`D`). Last 2 sessions.
- Also fixed: symbol palette crash — `Dashboard` `onPick` called `setSymbol()` which no longer exists (renamed `changeSymbol` in the multi-pane refactor).
- **Not yet runtime-verified** — sandbox shell outage blocked `npm run build`/dev boot this session.

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
