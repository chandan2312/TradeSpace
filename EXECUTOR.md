# Executor — Full Working Spec

The Executor is the second algo in TradeSpace, independent of the currency algo. The **currency algo finds trades; the Executor executes trades YOU place**. You draw a Risk/Reward tool on any symbol's chart (entry / stop / target), right-click → **Send to Executor**, and it takes over: validates the full market context, auto-judges the surrounding ranges and levels, picks an entry style matched to context strength, executes (paper or live), and manages the position to close.

> Files: `lib/executor/engine.js` (state machine + monitor), `lib/executor/context.js` (validation stack), `lib/executor/modes.js` (entry modes), `lib/executor/store.js` (Mongo + config), `app/api/executor/*` (HTTP), `components/executor/ExecutorDashboard.jsx` + `/executor` (UI), `lib/draw/useDrawings.js` + `components/DrawingContextMenu.jsx` (chart arm flow).

---

## 1. Design decisions

- **Paper first, live toggle.** Every setup starts paper. Real MT5 orders require BOTH the per-setup `live` flag AND the global `liveEnabled` master switch (red toggle on the dashboard). Live path: bridge `POST /order` on fill, `POST /modify` for SL moves — the same proven path the currency algo uses.
- **Risk-% sizing.** `volume = (accountEquity × riskPct%) / (slDistance × contractValue)`, rounded to `lotStep`, clamped to `[lotSize, maxLot]`. If `accountEquity` is 0, falls back to fixed `lotSize`. Contract values are per-category heuristics (fx 100k, JPY-quoted 1k effective, XAU 100, XAG 5000, indices/crypto 1) — an approximation, refine per broker if needed.
- **Weak context escalates, never rejects.** Your setup is YOUR call. A weak context score doesn't cancel it — it raises the bar for entry (direct → candle → structural). Only **hard invalidation** kills a setup: structure flipped (opposing displaced MSS), reversal-type retrace (impulse origin broken), price through the SL side before entry, TTL, or your manual cancel.
- **All symbols.** Category-aware via `classifySymbol` (fx / metals / indices / crypto / energy). Checks that only make sense for fx (currency strength, correlation) are skipped elsewhere and their weight redistributed, so the 0–100 score stays comparable across categories.

---

## 2. Arming a setup (visual, from the chart)

1. Draw a **Risk/Reward tool** (rrtool) on any chart: entry, stop, target.
2. Right-click it → **Send to Executor**.
3. The setup arms with: `{symbol, tf, entry, sl: stop, tp: target, dir: target>entry ? buy : sell, drawingId}`.
4. Direction sanity is enforced (SL on losing side, TP on winning side) and one open executor trade per drawing (`drawingId` guard).

The `/executor` dashboard shows it immediately (WS push on `executor_changed`).

---

## 3. Context stack (`context.js` — `assessContext`)

Pure function → `{score 0..100, grade strong|ok|weak, checks[], snapshot}`. Weighted checks (weights are config keys `w*`, all PATCH-able):

| Check | Weight | Applies | What it measures |
|---|---|---|---|
| structure | 22 | all | H4 (0.35) / H1 (0.4) / M15 (0.25) `analyzeStructure` alignment with your direction; a fresh opposing displaced M15 MSS floors it at −0.6 |
| bias | 16 | all | the symbol's own `computeSymbolBias` score vs your dir (±60 = full) |
| strength | 16 | fx, metals | fx: currency edge (base − quote) from the full TRADEABLE_FX sweep (÷50 = full). Metals: USD score inverted (weak USD = bullish metal) |
| correlation | 10 | fx | base/quote siblings not moving hard against you |
| liquidity | 14 | all | untapped pool beyond your TP (+0.5) or any pool ahead (+0.2); opposing-side fuel sweep ≤40 bars (+0.4); TP pool already swept (−0.5) |
| confluence | 14 | all | `fvgInducement` (+0.4), `ifvgZone` (+0.4), `qmlObFvg` (+0.6) around YOUR zone |
| retracement | 8 | all | `classifyRetracement`: ote/liquidity-building +0.7, deep −0.3, weak −0.1, reversal −1 |

Score = weighted mean of applicable checks mapped from [−1,1] to 0–100. Non-applicable checks drop out of the denominator (weight redistribution).

The fx universe strength sweep is cached 60 s (`g._tsExecStrength`) so per-setup validation doesn't re-scan 13 pairs every pass.

### Auto-judge snapshot ("auto-adjustable mode")
Computed every validation pass and stored on the trade doc:
- **Dealing range**: swing hi/lo of the last 90 H4 bars (falls back to H1); your entry's position % and premium/discount label.
- **Zone match**: the nearest open FVG / unmitigated OB (M15 + H1) overlapping — or closest to — your entry.
- **SL guard**: the nearest `strongLevels` low (buy) / high (sell) beyond your SL.
- **Distances**: zone height, distance-to-entry in zone-heights.

If `autoAdjust` is on (default), the Executor may **widen** your SL behind the strong level (padded 0.25×ATR), bounded by `maxSlWidenMult` (1.5× your drawn risk) — never silently tightened, never after fill. Original entry/SL/TP are always preserved on the doc; every adjustment is an `events[]` entry.

---

## 4. Entry modes (`modes.js`)

Decided from the context score when the setup validates (price within `approachMult × zone-height`):

| Mode | Condition | Entry trigger |
|---|---|---|
| **direct** | score ≥ `directMin` (70) | fill the moment price taps your entry |
| **candle** | `confirmMin` (45) ≤ score < 70 | after the zone tap, wait for a **rejection candle** (close in-dir with ≥50% opposing wick) or an **engulfing** close in-dir on M15 |
| **structural** | score < 45 | after the zone tap, require a real structural signal: displaced M15 MSS in-dir (≤10 bars), a fresh in-dir FVG (≤8 bars), or a QML aligned with dir (≤20 bars) |

Hard invalidation (any mode, pre-fill): price through the SL side, opposing displaced M15 MSS (≤12 bars), reversal-type retracement, TTL `executorTtlHours` (48h), manual cancel.

---

## 5. State machine (`engine.js`)

```
            arm (from chart)
                  │
                  ▼
  ┌────────┐   within approachMult×zone   ┌────────────┐  context assessed  ┌────────────────┐
  │ ARMED  │ ───────────────────────────▶ │ VALIDATING │ ─────────────────▶ │ AWAITING_ENTRY │
  └───┬────┘                              └─────┬──────┘   mode decided     │  (mode badge)  │
      │ TTL                                     │ SL-side run-through       └──────┬─────────┘
      ▼                                         ▼                    zone tap + mode gate │
   EXPIRED                                INVALIDATED                                     ▼
                                                                                     ┌────────┐
      cancel (any pre-fill state) → CANCELLED                                        │ FILLED │
                                                                                     └───┬────┘
                                                          BE / trail moves → MANAGING ───┤
                                                                                    SL   │   TP
                                                                                     ▼   ▼
                                                                                   LOST  WON
```

- **Monitor** rides the alert-engine tick stream (`executorOnTicks` beside `algoOnTicks`, 2s throttle, `g._tsExecSymbols` keeps the tick union covering open setups). Zero extra bridge load.
- **Paper fills** at taker price (buy@ask / sell@bid); exits valued on the closing side.
- **Live fills** when `live && liveEnabled`: bridge `/order`; failures gracefully degrade to paper tracking with a Telegram warning.
- **Management**: breakeven at `beAtR` (1R default, 0=off); optional `trailMode: "structure"` trails behind the latest M15 swing (10-bar extreme). SL moves only ever tighten toward profit; live tickets get `/modify`.
- **Result**: SL hit → `resultR` = actual R at exit (can be ≥0 after BE); TP hit → won. Manual flatten of a filled position closes at 0R by default.
- Every transition: `events[]` append, WS `{type:"executor_changed"}`, Telegram 🎯.

---

## 6. Config (`store.js` DEFAULT_CONFIG, PATCH-able at `/api/executor/config`)

```js
liveEnabled: false,   // GLOBAL live master switch (red toggle)
telegram: true,
directMin: 70,        // score ≥ → direct entry
confirmMin: 45,       // score ≥ → candle entry (below → structural)
approachMult: 1.5,    // begin validating within N × zone-height
executorTtlHours: 48, // pre-fill TTL
riskPct: 1,           // % equity risked per trade (0 → fixed lot)
accountEquity: 0,     // for sizing; 0 → fixed lotSize
lotSize: 0.01, maxLot: 5, lotStep: 0.01,
beAtR: 1,             // breakeven trigger (0 = off)
trailMode: "off",     // "off" | "structure"
autoAdjust: true, maxSlWidenMult: 1.5,
wStructure: 22, wBias: 16, wStrength: 16, wCorrelation: 10,
wLiquidity: 14, wConfluence: 14, wRetracement: 8,
```

## 7. HTTP + UI

- `GET /api/executor` → `{config, stats, trades(last 200)}`.
- `POST /api/executor` `{action:"arm", setup}` | `{action:"cancel", id}` | `{action:"flatten", id}`.
- `GET/PATCH /api/executor/config` (PATCH hot-refreshes the engine's config cache).
- `/executor` page: pipeline board (Armed → Validating → Awaiting entry with mode badge → Filled/Managing), expandable context report per setup (all checks + auto-judge snapshot + last events + Cancel/Flatten), journal, stats strip, config panel with the red LIVE switch.

## 8. Verification

- `node lib/executor/selfcheck.mjs` — mode thresholds, candle-confirm (rejection + engulfing + negative), hard invalidation, `assessContext` on synthetic fx + indices frames (category gating), sizing formula. All pass.
- Manual e2e: dev server → draw rrtool → Send to Executor → watch `/executor`.

## 9. Improvement levers (deliberately not built yet)

- **M5 confirmation TF** — `getFrames` serves M15 as the finest TF; adding M5 to `lib/bias/data.js` SPEC would sharpen candle confirmation.
- **Partial TP / scale-out** — exits are all-or-nothing.
- **Per-broker contract specs** — sizing uses category heuristics; a symbol-info bridge endpoint would make it exact.
- **Re-validation cadence** — context is assessed once at validating; could refresh periodically while awaiting entry and adapt the mode.
- **Executor ↔ chart overlay** — show the armed setup's state (mode, score) directly on the drawing.
