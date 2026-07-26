# TradeSpace Quantitative Engine: Complete Python Migration Plan

**Document Status**: Official Engineering Roadmap  
**Target Architecture**: Hybrid Microservices (Next.js API/UI Gateway + Python Quant Microservice)  
**Scope**: Complete migration of Currency Strength, Scanner Engines, Telemetry System, Offline Backtesting, and Automated Execution Gating from Node.js/JavaScript to Python 3.11+.

---

## 1. Executive Summary & Architectural Motivation

### Why JavaScript is Unsuited for Deep Quantitative Systems
While JavaScript/Node.js excels at asynchronous I/O, WebSocket broadcasting, and serving interactive user interfaces, it presents critical bottlenecks for institutional quantitative engineering:
1. **Single-Threaded CPU Blocking**: Time-series loops, matrix multiplications (e.g., 28-pair currency strength matrices), and 80-bar rolling correlation calculations block the Node.js event loop, degrading real-time UI responsiveness and API throughput.
2. **Lack of Native Vectorization**: Node.js executes array operations iteratively ($O(N)$ CPU instructions). In quantitative backtesting—such as analyzing 662,232 scanner sweeps across 2 years of M15 candles—iterative execution takes tens of seconds, whereas vectorized SIMD instructions take milliseconds.
3. **Floating-Point & Numerical Limitations**: JavaScript relies exclusively on 64-bit IEEE 754 floats without native support for decimal precision, matrix linear algebra, or high-performance statistical distributions.
4. **Absence of Institutional Quant Libraries**: The global quantitative finance industry operates on Python. Essential capabilities—such as Monte Carlo expectation modeling, bootstrap confidence intervals, rolling Sharpe/Sortino/Calmar ratio optimization, and high-performance dataframe manipulation—lack robust, industry-grade equivalents in JavaScript.

### The Target Solution: Python Quant Microservice (`quant_service`)
To achieve institutional performance and analytical rigor without disrupting our modern React/Next.js frontend, we are adopting a **Hybrid Microservices Architecture**:
* **Next.js (Frontend & Lightweight Gateway)**: Retains responsibility for UI rendering (`components/`), charting (`lightweight-charts`), user authentication, WebSocket client streaming, and HTTP routing.
* **Python Quant Service (`quant_service/`)**: A dedicated, high-performance microservice powered by **FastAPI, Polars, NumPy, and SciPy**. It assumes 100% ownership of:
  * 28-Pair G8 Currency Strength Matrix computation & EMA/ATR smoothing.
  * Zero-Lag Liquidity Buildup structure recognition (`buildup.py`).
  * Telemetry Snapshot generation, forward return labeling ($r_{1h}, r_{4h}, r_{24h}$), and MFE/MAE path tracking.
  * Rolling 80-bar Correlation Matrix computation and SMT / Lead-Lag divergence detection.
  * Offline Expectancy Calibration (Stage 1) and Vectorized Portfolio Execution Backtesting (Stage 2).
  * Automated Execution Gating ($PF \ge 1.30$, portfolio risk rules, and order sizing).

---

## 2. Core Systems Designated for Migration

| System Component | Current JS Location | Target Python Location | Primary Quant Advantage |
|---|---|---|---|
| **28-Pair Scanner & Bias Engine** | `lib/bias/engine.js`<br>`lib/bias/buildup.js`<br>`lib/algo/pairs.js` | `quant_service/core/bias.py`<br>`quant_service/core/buildup.py`<br>`quant_service/core/pairs.py` | Vectorized matrix operations across all 28 crosses simultaneously using Polars/NumPy. Zero CPU event-loop blocking. |
| **Telemetry Snapshot Engine** | `lib/telemetry/core.js`<br>`lib/telemetry/engine.js`<br>`lib/telemetry/store.js` | `quant_service/telemetry/snapshot.py`<br>`quant_service/telemetry/engine.py`<br>`quant_service/telemetry/store.py` | Async Motor/Pymongo ingestion with high-speed memory mapping for 80-bar rolling correlation matrices. |
| **Forward Return Labeler** | `lib/telemetry/core.js` (`computeForwardMetrics`) | `quant_service/telemetry/labeler.py` | Vectorized timestamp matching ($O(1)$ search via Polars `join_asof`) for instantaneous MFE/MAE path labeling. |
| **Offline Expectancy Calibration (Stage 1)** | `lib/telemetry/replay.mjs`<br>`scripts/calibrate_expectancy.mjs` | `quant_service/backtest/calibrate.py`<br>`quant_service/backtest/replay.py` | 2-year G8 backtest execution time reduced from ~25 seconds in Node.js to **< 1.2 seconds** in Python. |
| **Portfolio Trade Simulation (Stage 2)** | *Not yet built in JS* | `quant_service/backtest/portfolio.py`<br>`quant_service/backtest/metrics.py` | Full institutional quant reporting: Sharpe, Sortino, Calmar, Max Drawdown duration/depth, Monte Carlo bootstrap intervals. |
| **Live Execution & Risk Gate** | `lib/telemetry/algo.js`<br>`lib/algo/engine.js` | `quant_service/execution/gate.py`<br>`quant_service/execution/risk.py` | Microsecond-level evaluation of 17 execution pairs against SMT divergence and portfolio exposure rules. |

---

## 3. Target Architecture & Folder Structure

All Python code will reside inside a cleanly encapsulated `quant_service/` directory at the project root, keeping the repository unified while enforcing strict separation of concerns.

```text
TradeSpace/
├── quant_service/                   <-- NEW: Dedicated Python Quant Engine
│   ├── pyproject.toml               <-- Dependency management (uv / poetry / pip)
│   ├── main.py                      <-- FastAPI server & microservice entry point
│   ├── config.py                    <-- System configuration, MongoDB URI, session cutoffs
│   ├── core/                        <-- Pure Mathematical & Structural Engines
│   │   ├── __init__.py
│   │   ├── pairs.py                 <-- 28-pair analysis vs 17-pair execution definitions
│   │   ├── strength.py              <-- Vectorized G8 currency strength matrix solver
│   │   ├── buildup.py               <-- V6 Liquidity Buildup structure recognition (EQH/EQL/Trendline)
│   │   ├── smt.py                   <-- Smart Money Tool (SMT) divergence & Lead-Lag detector
│   │   └── correlation.py           <-- Rolling 80-bar Pearson correlation matrix generator
│   ├── telemetry/                   <-- Snapshot & Evidence Pipeline
│   │   ├── __init__.py
│   │   ├── snapshot.py              <-- Multi-timeframe frame aggregator & snapshot builder
│   │   ├── labeler.py               <-- Vectorized r1h/r4h/r24h forward return & MFE/MAE labeler
│   │   └── store.py                 <-- Async MongoDB interface (Motor/Pymongo)
│   ├── execution/                   <-- Real-Time Signal & Risk Gating
│   │   ├── __init__.py
│   │   ├── gate.py                  <-- Rolling PF >= 1.30 evidence gate & scenario scorer
│   │   └── risk.py                  <-- Portfolio risk manager (Max 3 trades, 2.5R daily loss limit)
│   └── backtest/                    <-- Offline Research & Quantitative Backtesting
│       ├── __init__.py
│       ├── data_loader.py           <-- Dukascopy archive reader (JSON/Parquet/CSV)
│       ├── calibrate.py             <-- Stage 1 Expectancy Calibration solver
│       ├── portfolio.py             <-- Stage 2 Portfolio Trade Execution simulator
│       └── metrics.py               <-- Quant analytics (Sharpe, Sortino, Drawdown, Monte Carlo)
├── app/                             <-- Existing Next.js UI & API Gateway
├── components/                      <-- Existing React UI components & dashboards
├── lib/                             <-- Next.js frontend utilities & API relay adapters
└── scripts/                         <-- Shell & CLI automation scripts
```

### Inter-Process Communication (IPC) Protocol
1. **Shared Database State (MongoDB)**: Both Next.js and Python connect to the same MongoDB database (`tradespace`). Python is the **exclusive writer** for telemetry snapshots, labeled evidence, and calibration profiles. Next.js reads these collections asynchronously to render the frontend dashboards without CPU overhead.
2. **Internal Async REST / RPC (FastAPI)**: For live scanner sweeps and instant trade evaluations, Next.js API routes (`app/api/telemetry/route.js`, `app/api/scan/route.js`) act as thin reverse-proxies, forwarding requests to the Python microservice running on port `8000`:
   ```text
   [Client Browser / MT5 Bridge]
            │
            ▼ (HTTP / WebSocket)
   [Next.js API Gateway (Port 3000)]
            │
            ▼ (Internal Async HTTP / REST — < 5ms latency)
   [Python Quant Service (FastAPI — Port 8000)]
            │
            ▼ (Vectorized Polars / NumPy Execution)
   [MongoDB (Shared Persistent Storage)]
```

---

## 4. Step-by-Step Migration Roadmap (Phased Execution)

### Phase 1: Service Foundation & Data Ingestion Layer (Days 1–2)
* **Goal**: Establish the Python runtime environment, database drivers, and historical data loaders.
* **Tasks**:
  1. Initialize `quant_service/` with Python 3.11+ and configure `pyproject.toml` with high-performance dependencies: `numpy`, `pandas`, `polars`, `scipy`, `fastapi`, `uvicorn`, `motor` (async MongoDB driver), `pydantic`, and `pytest`.
  2. Port `scripts/scrape_dukascopy.py` logic into `quant_service/backtest/data_loader.py` to support high-speed reading of 2 years of M15/H1/H4 historical bars from `data/dukascopy/` into in-memory Polars DataFrames.
  3. Create `quant_service/config.py` to mirror `DEFAULT_CONFIG` from `store.js`, ensuring calibrated session cutoffs (`minEdge: 20`, `minScenarioScore: 65`) are loaded natively.
* **Deliverable**: A running FastAPI microservice capable of connecting to MongoDB and loading 660,000+ historical bars into memory in under 500 milliseconds.

### Phase 2: Core Quant Math & Scanner Migration (Days 3–5)
* **Goal**: Port all technical indicators, structure recognition, and currency strength algorithms to Python.
* **Tasks**:
  1. Port `lib/bias/buildup.js` to `quant_service/core/buildup.py`. Re-implement the V6 descending/ascending pivot sequence detection and liquidity buildup scoring using vectorized arrays.
  2. Port `lib/bias/engine.js` and `lib/algo/pairs.js` to `quant_service/core/strength.py` and `pairs.py`. Build a vectorized 28-pair G8 matrix solver that computes currency strength differentials across all 7 crosses per currency simultaneously.
  3. Implement `quant_service/core/smt.py` to calculate Smart Money Tool (SMT) divergence and Lead-Lag correlations between correlated asset pairs (e.g., EURUSD vs GBPUSD, AUDUSD vs NZDUSD).
* **Deliverable**: A 100% Python-based scanner engine.
* **Verification Gate**: Create an automated regression test (`tests/test_parity.py`) that feeds 50,000 identical historical bar slices into both the legacy JS scanner and the new Python scanner, asserting numerical parity within a tolerance of $10^{-6}$.

### Phase 3: Telemetry Engine & Quant Backtesters (Days 6–8)
* **Goal**: Replace Node.js replay loops with vectorized Python backtesting and build the Stage 2 Portfolio Simulator.
* **Tasks**:
  1. Port `lib/telemetry/core.js` snapshot building and forward return labeling to `quant_service/telemetry/snapshot.py` and `labeler.py`. Use Polars `join_asof` for instantaneous lookahead-free forward return matching ($r_{1h}, r_{4h}, r_{24h}$) and MFE/MAE path collection.
  2. Implement `quant_service/backtest/calibrate.py` (Stage 1 Expectancy Calibration) to generate `algo_calibration_profile.json` with vectorized grouping across sessions and edge buckets.
  3. **Build Stage 2 Portfolio Backtester (`quant_service/backtest/portfolio.py` & `metrics.py`)**:
     * Simulate live trade execution across the 17 approved execution pairs over 2 years of historical snapshots.
     * Enforce portfolio constraints: Max 3 concurrent trades, Max 2.5R daily loss, Max 8 daily trades, Max currency exposure (2), and ATR stop-loss ($3 \times \text{ATR}$).
     * Implement institutional quant statistics: **Sharpe Ratio (annualized), Sortino Ratio, Calmar Ratio, Maximum Drawdown (in R and % of equity), Win Rate, Profit Factor, Total R earned, Average Win R vs. Average Loss R, and Monte Carlo bootstrap confidence intervals**.
* **Deliverable**: Blazing-fast Stage 1 and Stage 2 backtesting CLI tools (`python -m quant_service.backtest.run_portfolio --archive data/dukascopy`).

### Phase 4: Live Execution Gating & Next.js API Integration (Days 9–10)
* **Goal**: Wire the Python quant microservice into the live Next.js backend and MT5 remote bridge.
* **Tasks**:
  1. Port `lib/telemetry/algo.js` to `quant_service/execution/gate.py` and `risk.py`. Implement the live rolling evidence gate ($PF \ge 1.30$, Net $E[r] > 0$) and automated order sizing / stop-loss calculation.
  2. Expose core FastAPI HTTP/RPC endpoints in `quant_service/main.py`:
     * `POST /api/v1/scan`: Ingests current M15/H1/H4 bars and returns the 28-pair strength matrix and bias scores.
     * `POST /api/v1/evaluate`: Evaluates candidate signals against SMT divergence, rolling evidence gates, and portfolio risk limits.
     * `GET /api/v1/status`: Returns live telemetry collection status and pending label counts.
  3. Refactor Next.js API routes (`app/api/telemetry/route.js`, `app/api/scan/route.js`) to act as lightweight proxy relays forwarding requests to `http://localhost:8000/api/v1/`.
* **Deliverable**: Complete end-to-end operational integration where Next.js handles UI/WebSockets and Python handles 100% of quant calculations and trade gating.

---

## 5. Risk Mitigation & Transition Protocol

To ensure zero downtime or trading disruption during the migration, we will strictly enforce the following protocol:

### 1. Dual-Execution Shadow Running
During Phase 4 deployment, the system will enter a **48-hour Shadow Period**.
* Both the legacy Node.js engine and the new Python Quant Service will receive live bar updates from the MT5 bridge simultaneously.
* The Node.js engine will continue to drive UI displays, while a background comparison watcher logs both engine outputs.
* Any divergence between JS and Python in currency strength scores, SMT divergence flags, or calculated ATR stop distances exceeding $0.0001\%$ will trigger an immediate automated Slack/Telegram alert and log a trace document in MongoDB.

### 2. Codebase Cleanup & Deprecation
Only after the 48-hour Shadow Period passes with **zero numerical divergence** and 100% uptime will we execute the cleanup phase:
* Deprecate and remove legacy JavaScript quant files (`lib/bias/buildup.js`, `lib/bias/engine.js`, `lib/telemetry/core.js`, `lib/telemetry/algo.js`, `lib/telemetry/replay.mjs`).
* Update `AGENTS.md` and `project_state.md` to permanently record `quant_service/` as the exclusive authority for quantitative mathematics, backtesting, and algorithmic execution in TradeSpace.

---

## 6. Verification & Acceptance Criteria

The migration will be officially signed off and considered complete when:
1. **Backtest Benchmark**: Running `python -m quant_service.backtest.run_portfolio` against 2 years of Dukascopy data executes in **under 3.0 seconds** total (vs. ~30+ seconds in Node.js) and outputs the complete Stage 2 Quant Report (Sharpe, Sortino, Drawdown, Total R).
2. **Parity Proof**: Regression test suite (`pytest quant_service/tests/`) passes with 100% coverage across all 28 G8 pairs and historical setups.
3. **Live UI Responsiveness**: Next.js dashboard loading times and WebSocket chart streaming remain butter-smooth, completely decoupled from heavy analytical processing.
