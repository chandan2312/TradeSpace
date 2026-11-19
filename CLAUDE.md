# CLAUDE.md — TradeSpace Autonomous Trading Enterprise

This file is automatically injected into every Claude session. It contains the complete architectural map, non-negotiable rules, ground-truth metrics, and backtesting blueprints so you do NOT need to explore the codebase or waste tokens reading dozens of files.

---

## 1. Ground Truth & Current Performance (NON-NEGOTIABLE)
TradeSpace runs a real-money institutional algorithmic trading engine with MT5 broker execution and a MongoDB trade journal.
- **Current Live Journal Record**: **14 Trades: 12 Wins, 1 Loss, 1 Breakeven**
- **Win Rate**: **92.3%**
- **Realized Net R**: **+17.18R** (+$$3,299.78 PnL)
- **Goal**: Expand from fulfilling 1 portfolio to **2–3 diversified Prop Firm portfolios** without lowering entry model quality or breaching daily/max drawdown limits.

---

## 2. Universal Rules (Instant Disqualification if Violated)
1. **Rule 1.1 — Deep-Thinking Protocol**: Root every issue to structural causes. Never guess or write naive toy scripts.
2. **Rule 1.6 — NPM Scripts**: **NEVER execute `npm run build` or `npm run dev` autonomously**. Hot-reload is active; the user manages dev servers.
3. **Rule 1.7 — Unified Timezone Protocol**:
   - **Data Layer (Storage, Ticks, Bars, Feeds)**: Strictly pure **UTC Epoch Instants** (`time` in seconds, `timestampSemantics: "UTC_INSTANT"`).
   - **Trading & Session Logic (Sessions, Killzones, Daily Boundaries)**: Strictly **Europe/Athens (`EET/EEST = UTC+2 in winter / UTC+3 in summer`)**. Midnight Europe/Athens aligns with 5:00 PM New York (global Forex/Futures close), preventing Sunday candle drift.
   - **STRICT PROHIBITIONS**: NEVER do `time % 86400` or call `date.getUTCHours()` for trading sessions. Always import from `lib/time.js`:
     `import { getEetTime, getTradingDayKey, sessionOf, isKillzone, toUtcSec } from "@/lib/time";`
4. **Zero Future Lookahead**: In all backtests and simulations, HTF bars (1H, 4H, D1) must be strictly closed prior to the current 15M bar. A 4H bar starting at timestamp `t` is only visible after `t + 14400 <= current15m.t + 900`.

---

## 3. Core Architecture & File Map

Do NOT crawl the file tree. Use this exact map:

| Subsystem | Primary Files | Key Functions & Responsibilities |
| :--- | :--- | :--- |
| **Market Brain & Bias Engine** | `lib/bias/engine.js`<br>`lib/bias/brain.js` | `computeSymbolBias`: Evaluates D1/H4/H1/M15 structure, Dealing Ranges (`lib/bias/ranges.js`), HTF Liquidity pools (`lib/bias/htfLiquidity.js`), and Gatekeepers.<br>**Equilibrium Filter**: If dealing range is in equilibrium (45%–55%), sets `action: "STAND_ASIDE"`.<br>**15M Gatekeeper** (`brain.js` lines 240–290): Controls `allowedToLong`/`allowedToShort`. Blocks entries (`WAIT_FOR_15M_PULLBACK`) until price retraces into OTE Golden Pocket (62%–79%) or equilibrium discount/premium. |
| **Institutional Primitives** | `lib/bias/institutional.js` | `confirmedFractals`: Confirmed swing fractals (no lookahead).<br>`displacementAt`: Body ratio $\ge 50\%$, ATR expansion $\ge 1.0$.<br>`detectPDArrays`: Causal tracking of FVGs, Order Blocks, and Inverted FVGs (`ifvgs`).<br>`detectLiquidityRaids`: Identifies true BSL/SSL sweeps. |
| **Intermarket SMT Divergence** | `lib/bias/context.js` | `smtDivergence`: Compares correlated benchmark pairs (EURUSD/GBPUSD/USDCHF, NAS100/SPX500/DJ30, XAUUSD/XAGUSD) for swing non-confirmation. |
| **Autonomous Scanner & Levels** | `lib/autonomous/scanner.js`<br>`lib/autonomous/levels.js` | `evaluateSymbol`: Main scanner orchestrator.<br>`computeMacroConfluenceBreakdown`: Dual-sided continuous scoring engine (`BREAKDOWN_WEIGHTS`: Positive confluences for DOL alignment, Discount/Premium, displacement, retracement grade, killzones, SMT, and HTF PDAs; Negative deductions for opposing friction walls, freight train velocity, stale age, runway exhaustion, and spread drag).<br>`selectOptimalEntryLevel`: Routes to `evaluateAllEntryModels`. |
| **Production Entry Models** | `lib/autonomous/models.js` | `ENTRY_MODEL_DEFINITIONS`:<br>- `ict_2022`: Sweep $\to$ displaced MSS $\to$ virgin FVG $\to$ CE limit.<br>- `turtle_soup`: Key external raid $\to$ rejection wick $\to$ reclaim within 2 bars.<br>- `breaker_block`: Failed opposing Order Block $\to$ displaced failure $\to$ breaker midline retest.<br>- `ote_continuation`: Aligned impulse $\to$ .618–.786 retracement with embedded FVG/OB.<br>- `silver_bullet`: London (10–11 EET) or NY (17–18 EET) displacement with unconsumed target.<br>- `judas_swing`: London Open (07:00–09:30 UTC) false raid of Asian Range / PDH / PDL with displaced reversal.<br>- `po3_daily_cycle`: Daily Open manipulation into discount/premium followed by displacement reclaim.<br>- `evaluateExecutionVetoes`: Enforces `MIN_RR >= 1.8R`, `DEAD_ZONE`, `OPPOSING_HTF_WALL`, `SPREAD_DRAG_EXCESSIVE`, and `BRAIN_NOT_PERMITTED`. |
| **Decision Engine** | `lib/autonomous/entryDecisionEngine.js` | `evaluateEntryModelDecisionEngine`: Zone perfection, dealing range depth, shallow trap warning, and resolves premier candidate among competing models. |
| **Stop Loss Engine (ASLE)** | `lib/autonomous/slEngine.js` | `calculateStructuralStopLoss`: Anchors stops to structural displacement origins with asset-specific noise floors (Forex min 10–12 pips; Gold min $1.50; Indices min 25 pts). |
| **Historical Data** | `quant_service/data/` | Multi-year 15M tick datasets (>130k–157k bars per file, 2021–2026): `eurusd_15m.json`, `gbpusd_15m.json`, `nas100_15m.json`, `spx500_15m.json`, `xauusd_15m.json`, `ger40_15m.json`, `dj30_15m.json`, `usdchf_15m.json`, `usdjpy_15m.json`. |
| **Trade Management Engine (`tradeProp` ONLY)** | `lib/autonomous/tpCascadingEngine.js`<br>`lib/autonomous/management.js` | **`tradeDefault` is completely removed. System runs exclusively on `tradeProp` (`managementLogic: "prop_firm_safe"`, `isPropFirm: true`)**:<br>1. **Strict 1.5R – 3.0R Safe Bracket**: Upward gradual structural cascading (`M5 -> M15 -> M30 -> H1 -> H2 -> H4 -> D1`) via `resolveDynamicPropFirmTarget`. Starts at M15 (Day) or M5 (Scalp). If a TF gives 1.5R–3.0R, locks it; if > 3.0R, capped at 3.0R.<br>2. **100% Full Position Execution**: No partial exit dilution (`fraction: 1.0` to `propTp`).<br>3. **Optimal Risk-Free Breakeven**: Stop Loss moves to Breakeven at optimal structural level between 1.0R and 1.5R (`calculateOptimalRiskFreeLevel`). |
| **System #3 Custom Models** | `lib/autonomous_custom_models/` | The modular backtest state machine architecture:<br>- `Model 1 - Liquidity Purge CHoCH Reversal` (Stages 0–4: Macro Anchor $\to$ Sweep $\to$ Displacement CHoCH $\to$ Inducement/Mitigation $\to$ Execution Trigger).<br>- `Model 2 - Optimal Trade Entry OTE` (Stages 0–4: Sweep & Origin Anchor $\to$ Displacement MSS $\to$ Retracement $\to$ Confluence/Mitigation $\to$ Execution Trigger).<br>- `correlatedTwinEngine.js`: In-memory multi-asset bar caching & SMT divergence.<br>- `macroBiasEngine.js`: Causal HTF trend filtering. |
| **Multi-Timeframe Arbiter** | `lib/autonomous_custom_models/multiTimeframeArbiter.js` | Multi-Timeframe Discovery across 5M, 15M, 1H, 4H.<br>- **Timeframe Quality Competition**: Weighting H4 (1.5x) > H1 (1.3x) > M15 (1.1x) > M5 (0.85x).<br>- **Dynamic Pyramiding & Scale-In**: Only adds +0.35R risk unit when primary trade reaches $\ge +1.0R$ (where SL is soft-reduced to -0.5R or BE). Never averages down. Capped at 1 scale-in. |
| **Key Backtest Scripts** | `scripts/` | - `audit_model2_production_master.mjs`: Master 7-asset audit (XAUUSD, XAGUSD, EURUSD, GBPUSD, USDJPY, USDCHF, BTCUSD).<br>- `test_strict_causal_no_htf_lookahead.mjs`: Strict causal verification proving zero HTF candle lookahead.<br>- `final_model2_production_audit.mjs`: Full production audit runner. |

---

## 4. Current Mission & Backtesting Space
The active focus is **unifying the Backtesting Space (`lib/autonomous_custom_models/` + `scripts/audit_model2_production_master.mjs`) with the Live Market Brain**:
1. Replaying historical bars through the 5-stage state machines with strict causality (no unclosed HTF bar peeking).
2. **`tradeProp` Mode Exclusively**:
   - `tradeDefault` has been completely eliminated.
   - All executions run on **`tradeProp`** (`managementLogic: "prop_firm_safe"`):
     * Strict **1.5R – 3.0R** safe target bracket via upward gradual cascading (`M5 -> M15 -> M30 -> H1 -> H2 -> H4 -> D1`).
     * **100% full position booking** (`fraction: 1.0` to `propTp`) with zero partial dilution.
     * **Optimal Risk-Free Breakeven**: Stop Loss moves to Breakeven at optimal structural level between 1.0R and 1.5R (`calculateOptimalRiskFreeLevel`).
     * Max hold timeout: 60 bars (15 hours on 15M).
3. Managing Multi-Timeframe Arbitration & Pyramiding (+0.35R Scale-In) via `MultiTimeframeArbiter`.
4. Benchmarking proposed models and tuning gatekeepers to safely expand trade volume across 2–3 Prop Firm portfolios without degrading the live 92.3% win-rate baseline.

---

## 5. Multi-Tier Agent & Model Routing Architecture

TradeSpace utilizes a 4-tier model hierarchy connected to the FreeModel gateway (`https://freemodel.in/v1`). Agents and subagents must be chosen dynamically according to task scope:

| Tier | Model | Subagent / File | Optimal Task Scope |
| :--- | :--- | :--- | :--- |
| **HARD** | `claude-opus-5-5` | `architect`<br>`.claude/agents/architect.md` | Deep mathematical modeling, multi-timeframe state machine design, bias engine architecture, and critical algorithmic refactoring. |
| **LONGER** | `claude-fable-5-1` | `auditor`<br>`.claude/agents/auditor.md` | Ingesting multi-year tick datasets (`quant_service/data/`), 1M-context backtest audits, log traces, and exhaustive cross-system reviews. |
| **MEDIUM** | `claude-sonnet-5-5` | `coder`<br>`.claude/agents/coder.md` | Daily feature development, Next.js UI components, indicator charts, API routes, and unit tests. |
| **SHORTER** | `claude-fable-5` | `quickfix`<br>`.claude/agents/quickfix.md` | Rapid bug fixes, single-function edits, executing standalone test scripts, syntax cleanup, and quick configs. |

### How to Dispatch:
- **Interactive Switch**: Use `/model` to switch model or `/agent <name>` inside a Claude Code session.
- **Direct CLI Execution**:
  ```powershell
  claude --agent architect   # Launches with claude-opus-5-5
  claude --agent auditor     # Launches with claude-fable-5-1
  claude --agent coder       # Launches with claude-sonnet-5-5
  claude --agent quickfix    # Launches with claude-fable-5
  ```
- **PowerShell Dispatcher**:
  ```powershell
  .\scripts\spawn_agent.ps1 -Tier Hard -Prompt "Refactor state machine logic"
  .\scripts\spawn_agent.ps1 -Tier Longer -Prompt "Audit all backtest logs"
  .\scripts\spawn_agent.ps1 -Tier Medium -Prompt "Build new PnL component"
  .\scripts\spawn_agent.ps1 -Tier Shorter -Prompt "Run and fix test_mt5.py"
  ```


