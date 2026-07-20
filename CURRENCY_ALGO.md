# Currency Algo — Full Working Spec

The currency-algo is a **paper-trading auto-strategy loop** (no broker orders). It watches the FX universe, scores setups the way you'd trade them by hand (ICT-style: structure → liquidity → zone → RR), shepherds each candidate through a state machine, and journals the result. Everything lives in Mongo `algo_trades`; the `/currency-algo` page is just a live view over that collection.

> Files: `lib/algo/engine.js` (loop), `lib/algo/setup.js` (setup scoring), `lib/algo/pairs.js` (candidate selection), `lib/algo/store.js` (Mongo + config), `app/api/algo/*` (HTTP), `components/algo/AlgoDashboard.jsx` (UI).

---

## 1. Two cadences, zero extra bridge load

| Loop | Cadence | Job |
|------|---------|-----|
| **Scanner** | every `scanMs` (default 3 min) | currency strength → candidate pairs → `findSetup()` → new `watching` docs |
| **Monitor** | piggybacks on the alert-engine's tick broadcast (~every 500 ms, throttled to 2 s) | walks the state machine per open trade |

The monitor **subscribes to `onTicks()`** — the tick stream the alert engine already produces. So the algo adds **no extra bridge/polling load**; it just reacts to ticks that already arrive. `g._tsAlgoSymbols` keeps the alert-engine's tick-union covering the algo's open symbols.

Config is cached on `globalThis._tsAlgoCfgCache` (refreshed every 30 s, and hot-patched on every `PATCH /api/algo/config`). The hot monitor path **never** reads Mongo for config.

---

## 2. Scanner → candidate selection (`pairs.js`)

### 2.1 Currency strength
The scanner pulls `getFrames(sym)` (M15 + H1) for every symbol in `TRADE_FX`, runs `computeSymbolBias` on each, then `aggregate(results)` → `currencyStrength = [{ ccy, score }]` (−100..+100, sorted desc). This is the same strength meter the dashboard shows.

### 2.2 Candidate selection — `buildCandidates()`
```
minStrong = 15   // |score| a currency must clear to count as strong or weak
minEdge   = 30   // strong.score − weak.score minimum divergence
maxPairs  = 4
```
1. Sort currencies by score.
2. `strongs` = top 3 with `score ≥ +15`; `weaks` = bottom 3 with `score ≤ −15`.
3. For each strong↔weak pair: map to a symbol via **convention order** `EUR > GBP > AUD > NZD > USD > CAD > CHF > JPY`.
   - Strong ranks earlier → it's the **base** → `BUY`.
   - Strong ranks later → pair is quoted inverted → `SELL`.
4. Skip if the resulting symbol isn't in `TRADEABLE_FX`, or edge `= strong − weak < minEdge`.
5. Rank by `edge` descending, take top `maxPairs`.

**One open candidate per symbol**: if a symbol already has a trade in `watching | approaching | confirmed | filled`, the scanner skips it.

---

## 3. The setup checklist (`setup.js`) — where it decides IF and WHERE

`findSetup(symbol, frames, dir, cfg)` is a **pure function** (no I/O, unit-testable). Given H4/H1/M15 frames and a direction, it returns `null` (no trade) or a scored candidate. Defaults: `minRR=2`, `minScore=60`, `maxZoneAgeBars=60`.

Hard gates (return `null` immediately if any fails):
- H4/H1/M15 all present; `H1.length ≥ 60`, `M15.length ≥ 80`
- **H1 structure aligned** with dir (or fresh displaced MSS) — *never* fades H1 structure
- A target pool exists in the direction of travel
- An unmitigated entry zone exists on our side
- `risk > 0` and `RR ≥ minRR`
- Final `score ≥ minScore`

### Check 1 — Structure alignment (H4 + H1)  → up to +35 / −10
```
stH4 = analyzeStructure(H4);  stH1 = analyzeStructure(H1)
freshMssH1 = last H1 event is MSS, dir==dir, displaced, age ≤ 30 bars
h4Aligned = stH4.dir == dir && !stH4.ranging
h1Aligned = stH1.dir == dir || freshMssH1      ← HARD GATE
```
- H1 aligned: **+20** (and the reason notes "fresh displaced MSS" if that's what fired).
- H4 aligned too: **+15**.
- H4 counter-trend ( fading): **−10**.

### Check 2 — Liquidity story / fuel (M15)  → +20
`liquidityMap(M15)` → look for a recent sweep **on the opposing side** (`side === −dir`, `age ≤ 40` bars).
- Buy → a sell-side (low) sweep = stop-hunt fuel that powered the move up.
- Sell → a buy-side (high) sweep = fuel for the move down.
- Found: **+20**. (Absent is *not* a hard gate — just no fuel bonus.)

### Check 3 — Target pool + trend room  → hard gate + RR score
`pool = (dir==1 ? liq.draws.above : liq.draws.below)[0]` — the nearest **untapped** opposing pool in the direction of travel. **No pool → no trade** (nothing to run toward).

### Check 4 — Entry zone (`pickZone`)  → +10/12, premium/discount ±12/−8
Pick the **freshest unmitigated FVG or OB on our side**, strictly beyond current price (it's a *pullback* zone — price must retrace into it). Considers both H1 and M15 zones, `state==="open"` (FVG) / `!tapped` (OB), `age ≤ maxZoneAgeBars`.
- Sort by distance to price (nearest wins); tie-break prefers **H1** (higher-TF zones are stronger).
- +12 for an FVG, +10 for an OB.

**Premium/discount of the H4 range** (last 90 H4 bars):
- `pos = (zoneMid − rangeLow) / (rangeHigh − rangeLow)`
- Buy wants the zone in **discount** (`pos ≤ 0.5`): **+12**. In premium (chasing): **−8**.
- Sell is the mirror (premium good, discount = chasing).

### Check 5 — SL placement  → +8 if widened to a strong level
- Conservatively take the **front edge** of the zone: `entry = dir==1 ? zone.top : zone.bottom`.
- Base SL: just beyond the zone, `0.25 × avgM15` past it.
- Look at `strongLevels(H1)`: the nearest strong low (buy) / high (sell) beyond the entry.
- **Only widen** to that strong level if it doesn't blow up risk (`≤ 1.8 × zone-stop distance`) and is actually wider. If it qualifies: SL moves behind the strong level, **+8**.

### Check 6 — TP placement  → +min(15, round(RR×4))
- TP **front-runs** the pool: `pool.price ∓ 0.15 × avgM15` (leave a little on the table).
- `risk = |entry − sl|`, `reward = |tp − entry|`, `rr = reward / risk`.
- **`rr < minRR` → no trade.** Otherwise `+min(15, round(rr×4))`.

### Check 7 — Exhaustion / freshness  → +8 / −12
`legTravel(H1, dir)` = fraction of the current H1 leg already travelled (last 40 bars; 0 = fresh, 1 = fully extended).
- `leg > 0.75` → late entry: **−12**.
- `leg < 0.45` → fresh leg: **+8**.

### Check 8 — Session bonus  → +5
`sessionOf(lastBar.time)`; London or NY → **+5** (killzone setups behave better).

**Final**: `score ≥ minScore (60)` or the setup is killed. The returned doc carries `entry{price,zoneTop,zoneBottom,kind,tf}`, `sl`, `tp`, `rr`, `score`, `reasons[]`, `pool{name,price}`, and `retraceType`.

### 3a. ICT composite confluence (`lib/algo/confluence.js`) — additive, configurable
Layered on top of the base checklist. Each is `{hit, score, note}` — raises the score, **never** hard-kills. Disable all with `cfg.confluence = false`; tune individual weights via the `*W` keys below.

- **FVG + inducement** — `fvgInducement`, weight `fvgInducementW` (default 10). An *inducement* is a minor pivot (short-term high for buy / low for sell) sitting **between** current price and the entry zone, still ungrabbed (price never closed through it since it formed, age 4–40 bars). The sequence the setup models: price grabs the inducement → taps the FVG → displaces our way. Hit presence boosts confidence the pullback is engineered, not drifting.
- **IFVG continuation** — `ifvgZone`, weight `ifvgW` (default 12). A gap that `fvgZones` flipped to `state==="inverted"` (price closed through its far side) now acting as **continuation** support/resistance. We use an inverted FVG whose *original* dir opposed us (so its inversion now sits on our continued path), still beyond price as a pullback zone. Lets us catch post-breakout continuation entries the base `pickZone` (open FVGs only) misses.
- **QML + OB + FVG** — `qmlObFvg`, weight `qmlObFvgW` (default 18, the heaviest). A recent `detectQML` reversal (sweep of a swing extreme then break of the neck, `age ≤ 30`, dir matches) whose reaction leg contains **both** an unmitigated OB **and** a fresh open FVG on the same side — triple confluence stacking the entry zone. Highest-conviction composite.

### 3b. Retracement taxonomy (`lib/algo/retracement.js`)
Classifies the current pullback from the impulse leg (last opposite-side extreme → last same-side extreme) into one of five **behavioral** types. **Depth bands follow ICT/OTE doctrine** (research-verified): `<62%` weak, `62–79%` the OTE continuation pocket (70.5% midpoint), `>79%` deep extension, body-close past 100% = reversal. `depth` ∈ [0,1] = fraction of the impulse leg retraced. **Depth alone is not enough** — the structural origin-break is the independent reversal signal. Disable with `cfg.retrace = false`.

| Type | Condition | Default score | Meaning |
|---|---|---|---|
| `liquidity-building` | `depth < 0.5` AND equal-high/low cluster coiling near price | `liqBuildW` +10 | shallow pullback building resting liquidity = continuation fuel |
| `ote` | `0.62 ≤ depth ≤ 0.79` (70.5% midpoint) | `oteW` +8 | institutional continuation pocket — the *good* with-trend entry |
| `deep` | `depth > 0.79`, origin not broken | `deepW` −4 | extended retrace near origin — caution, late |
| `weak` | `depth < 0.62` (premature) | `weakW` −3 | chasable depth — premature, bad R/R if entered here |
| `reversal` | price **broke the impulse leg's origin** (structure flipped) | `reversalW` −14 | caution — also a hard reject in `confirmCandidate` |

The `retraceType` is attached to the returned setup doc and surfaced as a confirm-time check (#4): a reversal-type retrace observed while waiting to fill rejects the candidate.

---

## 4. The state machine (`engine.js` monitor)

```
                 scan / findSetup
                       │
        ┌──────────────┴──────────────┐
        ▼ fat (dist > trackMult×zone)  ▼ near
 ┌──────────┐  price returns   ┌──────────┐  price within    ┌─────────────┐   confirm passes   ┌────────────┐  price enters   ┌────────┐
 │ TRACKING │ ──to approach──▶ │ WATCHING │ ───────────────▶ │ APPROACHING │ ──────────────────▶ │ CONFIRMED  │ ───────────────▶ │ FILLED │
 │          │  × zone-height   │          │  approachMult×   │ (runs       │                    │            │  zone (entry    │        │
 │ (72h TTL │                  │          │  zone-height     │  confirm)   │   confirm fails    │            │  edge)          │        │
 │  persists│                  └────┬─────┘                  └──────┬──────┘ ──────────────────▶ │            │                 └───┬────┘
 │  across  │                       │ TTL / through-SL            │ TTL        REJECTED (closed) │            │                     │
 │  scans)  │                       ▼                            ▼                          ▼            ▼                     │
 └────┬─────┘                  INVALIDATED                   EXPIRED                    INVALIDATED  ────────────────────── SL  │  TP
      │ through-SL / 72h                                                                                            ▼    ▼
      ▼                                                                                                     INVALIDATED LOST  WON
 INVALIDATED/EXPIRED
```

Per-tick, per-open-trade:

**Paper-fill pricing** (taker side):
- Entry: buy at `ask`, sell at `bid`.
- Exit: buy closes at `bid`, sell closes at `ask` (`exitPx`).

### TRACKING (fat setup — too far to fill now)
- A fresh setup whose distance-to-entry exceeds **`trackMult × zone-height`** (default 3×) goes to `tracking` instead of `watching`. It **persists across scans** even when the symbol later drops out of the strength meter's preferred set — it stays in the tracklist until the algo **fully rejects** it (invalidated / expired) or price returns to the approach range.
- **Invalidated** if price runs through to the SL side before it ever got close.
- **Promoted to `watching`** once price retraces to within `approachMult × zone-height` (the setup is now fillable).
- TTL is the longer **`trackHours`** (default 72h) vs the 12h pre-fill TTL.

### WATCHING
- `distToEntry = dir==1 ? px − entry : entry − px`.
- **Invalidated** if price already ran through the zone to the SL side (`px < sl` for buy / `px > sl` for sell): setup gone.
- **Approaching** when `distToEntry ≤ approachMult × zone-height` (default 1.5×). Then it fires `confirmCandidate()` **asynchronously** (monitor keeps flowing).

### APPROACHING (waiting on the async confirm)
No tick-driven transition here — it just waits for the confirm result (below).

### CONFIRMED
- **Filled** when price enters the zone (`px ≤ entry` for buy / `px ≥ entry` for sell), paper fill @ `px`. But **first** checks `maxConcurrent` — if already `≥ maxConcurrent` filled, it **expires** ("maxConcurrent reached at fill time") rather than filling.
- **Invalidated** if it ran through the zone to the SL side before filling.

### FILLED
- `exitPx` on the closing side.
- `hitSL` / `hitTP` checked against `sl` / `tp`.
- `resultR`:
  - SL hit → `−1` (always exactly −1R).
  - TP hit → `round(reward/risk, 2)` — the realized RR of the trade (can exceed 1; the planned `rr` is the target).
  - status `won`/`lost`, journal entry pushed.

### TTL (anything pre-fill)
If `now − createdAt > ttlHours (12h)` → **expired**.

---

## 5. Confirmation — the "second look" (`confirmCandidate`)

Runs async each time a candidate reaches **approaching**. Four checks. Outcomes:
- **All pass → `confirmed`.**
- **Soft fail** (strength dipped, transient opposing MSS, bias against) → **re-armed back to `watching`** with a cooldown (`reconfirmCooldownMin`, default 15 min) — a transient strength dip no longer kills an otherwise-valid setup. After `maxConfirmFails` (default 3) soft fails → terminal `rejected`.
- **Hard fail** (target pool swept, reversal-type retrace = structure flipped) → immediate terminal `rejected` — those are unrecoverable.

1. **Currency strength still aligned.** Re-derives strength from the live FX universe. `edgeNow = baseNow − quoteNow`. Pass if `edgeNow ≥ minEdge × 0.6` — allows some decay, but not a flip. *(Soft — re-armable.)*
2. **No fresh opposing M15 shift on the symbol itself.** `analyzeStructure(M15)`:
   - Fail if `lastEvent.type==="MSS"`, `dir === −dirN`, `displaced`, `age ≤ 12` bars → opposing displaced MSS just fired. *(Soft.)*
   - Fail if the **target pool was already swept** (`liq.sweeps` hits `t.pool.name` within 20 bars) → our fuel got used by someone else. *(Hard — terminal.)*
3. **Symbol's own bias not hard against us.** From the same strength run, the symbol's own `score`: pass unless `Math.sign(score) === −dirN && |score| ≥ 25`. *(Soft.)*
4. **Retracement type** (`lib/algo/retracement.js`). Fail if the pullback flipped to a **reversal-type** retrace (price broke the impulse leg's origin = structure turned against us while we waited). *(Hard — terminal.)* Other retrace types pass.

Result is written to `t.confirm.checks` and pushed to `events[]` as either `confirmed` or `rejected`. If the trade got invalidated/expired while the confirm was resolving, the conditional update (`status: "approaching"`) no-ops — no stale overwrite.

---

## 6. Invalidation & rejection — the full catalog

| State → outcome | Trigger | Where |
|---|---|---|
| tracking → **invalidated** | price through zone to SL side while tracking | monitor |
| tracking → **expired** | `trackHours` (72h) exceeded | monitor |
| tracking → watching | price returned to `approachMult × zone` (fillable) | monitor |
| watching → **invalidated** | price through zone to SL side before approaching | monitor |
| watching → **expired** | TTL exceeded | monitor |
| approaching → watching (re-armed) | **soft** confirm fail, under `maxConfirmFails`, with `reconfirmCooldownMin` cooldown | `queueConfirm` |
| approaching → **rejected** | **hard** confirm fail (pool swept / reversal retrace) OR `maxConfirmFails` soft fails | `queueConfirm` |
| approaching → **expired** | TTL exceeded while confirm pending | monitor |
| confirmed → **invalidated** | ran through zone to SL side before fill | monitor |
| confirmed → **expired** | TTL exceeded, OR `maxConcurrent` hit at fill time | monitor |
| filled → **lost** | SL hit (−1R) | monitor |
| filled → **won** | TP hit (+realized RR) | monitor |

Deliberate non-trades (the `null` returns in `findSetup`): no H1 alignment, no target pool, no entry zone, `rr < minRR`, `risk ≤ 0`, or `score < minScore`.

---

## 7. Store, config, stats (`store.js`)

`algo_trades` collection, indexes on `{status, symbol}` and `{createdAt:-1}`.

**Config** (`DEFAULT_CONFIG`, persisted in `settingsCol` under `_id:"algo_config"`, key-whitelisted on write):
```js
enabled: false,      // master switch — starts OFF, you arm it from the UI
minStrong: 15,       // currency |score| threshold
minEdge: 30,         // strong-weak divergence minimum
minScore: 60,        // setup confluence threshold
minRR: 2,            // minimum risk:reward
approachMult: 1.5,   // "approaching" within N × zone-height of entry
trackMult: 3,        // setup beyond N × zone-height → "tracking" (fat, persistent)
ttlHours: 12,        // watching/approaching/confirmed expire after this
trackHours: 72,     // tracking (fat) setups persist until fully rejected
maxConcurrent: 3,   // max simultaneous filled positions
maxConfirmFails: 3, // soft confirm fails allowed before terminal reject
reconfirmCooldownMin: 15, // cooldown after a soft confirm fail before re-approaching
scanMs: 180_000,     // scanner cadence (3 min)
telegram: true,
// ICT confluence + retracement (additive — see 3a/3b). All API-settable:
confluence: true, retrace: true,
fvgInducementW: 10, ifvgW: 12, qmlObFvgW: 18,
liqBuildW: 10, oteW: 8, weakW: -3, deepW: -4, reversalW: -14
```

**Stats**: closed = `won | lost`; reports `closed`, `wins`, `losses`, `winRate`, `totalR`, `avgR`, and `bySymbol` breakdown.

---

## 8. HTTP + UI

- `GET /api/algo` → `{ config, stats, trades(last 200), lastScan }` for the page.
- `POST /api/algo` `{action:"scan"}` → force a scan now (works even while disabled).
- `GET /api/algo/config`, `PATCH /api/algo/config` → read/update config; PATCH also hot-writes `_tsAlgoCfgCache`.
- Page `/currency-algo` renders `AlgoDashboard` — strength meter + config controls, a pipeline board (watching → approaching → confirmed → filled) with live tick distances via WS, then a closed-trade journal + stats strip.
- Every state transition broadcasts `{type:"algo_changed"}` over WS so the page live-reloads.
- Telegram alerts on: created, approaching, confirmed, filled, won, lost (gated by `cfg.telegram`).

---

## 9. Likely improvement levers (for when we iterate)

- ~~**Confirmation is one-shot.**~~ **Done:** soft confirm fails now re-arm back to `watching` with a cooldown (up to `maxConfirmFails`); hard fails (pool swept, structure flip) stay terminal.
- **No partial / no breakeven.** Filled trades are all-or-nothing SL/TP; no trail, no BE move.
- **TP is fixed at the pool front-run.** No scaling, no runner.
- **`minScore` is a flat 60.** Score weights (structure 35 vs zone 12 vs session 5…) are hand-tuned; the mix isn't learned from the journal.
- **Stats don't feed back.** `bySymbol` is computed but never used to weight future selections or prune weak symbols.
- **Leg-exhaustion / killzone are soft.** Only ±12/+8/+5 — easy to promote to hard gates if you want stricter timing.
- **No drawdown / exposure guard** beyond `maxConcurrent`. Could add a daily-R stop or a per-session cap.
- **`maxZoneAgeBars` (60)** and **TTL (12h)** are global; could be per-timeframe or per-session.
