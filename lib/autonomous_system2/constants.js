/**
 * lib/autonomous_system2/constants.js
 *
 * System #2 Institutional Quantitative Architecture Constants
 * Strictly purged of all retail indicators (Bollinger, Keltner, retail oscillators).
 * Founded on Market Microstructure, Steidlmayer CBOT TPO, Anchored VWAP, and Variance Ratios.
 */

export const ENGINE_ID = "SYSTEM_2_INSTITUTIONAL_QUANT";
export const ENGINE_VERSION = "3.0.0-PROD_SPEC";

// ---------------------------------------------------------------------------
// 1. DISTRIBUTION TOPOLOGY STATES (Profile Physics)
// ---------------------------------------------------------------------------
export const TOPOLOGY_SHAPES = {
  D_SHAPE_BALANCED: "D_SHAPE_BALANCED",                 // Symmetrical distribution: Market in two-sided balance at POC
  P_SHAPE_BUYER_INITIATIVE: "P_SHAPE_BUYER_INITIATIVE", // Open drive up: Thin lower profile, high-level balance consolidation
  B_SHAPE_SELLER_INITIATIVE: "B_SHAPE_SELLER_INITIATIVE",// Open drive down: Thin upper profile, low-level balance consolidation
  DOUBLE_DISTRIBUTION: "DOUBLE_DISTRIBUTION",           // Two distinct Value Areas separated by a Low-Volume Node (LVN)
  TRENDING_AUCTION: "TRENDING_AUCTION",                 // Elongated single prints (> 2.2x Initial Balance extension)
};

// ---------------------------------------------------------------------------
// 2. VARIANCE RATIO REGIMES (Lo-MacKinlay Microstructure Test)
// ---------------------------------------------------------------------------
export const VARIANCE_REGIMES = {
  SUB_DIFFUSIVE_MEAN_REVERTING: "SUB_DIFFUSIVE_MEAN_REVERTING", // VR < 0.90: Mean-reverting anti-persistence
  SUPER_DIFFUSIVE_MOMENTUM: "SUPER_DIFFUSIVE_MOMENTUM",         // VR > 1.15: Directional trend persistence
  RANDOM_WALK_BROWNIAN: "RANDOM_WALK_BROWNIAN",                 // 0.90 <= VR <= 1.15: Pure noise (Stand aside)
};

// Legacy / Compatible Regime Enums
export const REGIMES = {
  TREND_PERSISTENT: "TREND_PERSISTENT",
  MEAN_REVERTING: "MEAN_REVERTING",
  RANDOM_WALK_NOISE: "RANDOM_WALK_NOISE",
  VOLATILITY_SQUEEZE: "VOLATILITY_SQUEEZE",
  VOLATILITY_EXPANSION: "VOLATILITY_EXPANSION",
};

// Steidlmayer CBOT TPO Auction Day Types
export const TPO_DAY_TYPES = {
  NORMAL_DAY: "NORMAL_DAY",
  NORMAL_VARIATION: "NORMAL_VARIATION",
  TREND_DAY: "TREND_DAY",
  NEUTRAL_DAY: "NEUTRAL_DAY",
  NON_TREND_DAY: "NON_TREND_DAY",
};

// Value Area Relationships
export const VALUE_RELATIONSHIPS = {
  HIGHER_VALUE: "HIGHER_VALUE",
  LOWER_VALUE: "LOWER_VALUE",
  OVERLAPPING_HIGHER: "OVERLAPPING_HIGHER",
  OVERLAPPING_LOWER: "OVERLAPPING_LOWER",
  INSIDE_VALUE: "INSIDE_VALUE",
  OUTSIDE_VALUE: "OUTSIDE_VALUE",
};

// ---------------------------------------------------------------------------
// 3. MASTER SCENARIOS
// ---------------------------------------------------------------------------
export const AUCTION_SCENARIOS = {
  SCENARIO_ROTATIONAL_BALANCE: {
    id: "SCENARIO_ROTATIONAL_BALANCE",
    name: "Two-Sided Rotational Auction (D-Shape Balance)",
    description: "Market participants agree on fair value. Inventory mean reversion and 80% Rule traversals dominate.",
  },
  SCENARIO_INITIATIVE_MIGRATION: {
    id: "SCENARIO_INITIATIVE_MIGRATION",
    name: "Initiative Value Migration (P-Shape / b-Shape Discovery)",
    description: "Institutions actively re-pricing asset. Trend continuation trades executed strictly on pullbacks to Developing POC/VWAP.",
  },
  SCENARIO_UNFINISHED_AUCTION: {
    id: "SCENARIO_UNFINISHED_AUCTION",
    name: "Unfinished Auction Resolution (Poor Extremes Magnet)",
    description: "Market left a blunt extreme without single-print excess tails. Targeted as high-probability structural magnets.",
  },
  SCENARIO_STAND_ASIDE_NOISE: {
    id: "SCENARIO_STAND_ASIDE_NOISE",
    name: "Random Walk / Illiquid Capital Preservation",
    description: "Brownian noise without structural distribution edge. Capital preservation active.",
  },
};

// ---------------------------------------------------------------------------
// 4. ORTHOGONAL INSTITUTIONAL QUANT MODELS
// ---------------------------------------------------------------------------
export const MODELS = {
  MODEL_VWAP_MEAN_REVERSION: "MODEL_VWAP_MEAN_REVERSION",           // Inventory exhaustion fade outside ±2.0σ in D-Shape
  STEIDLMAYER_80_PERCENT_RULE: "STEIDLMAYER_80_PERCENT_RULE",       // Classic Value Area traversal upon 2 consecutive closes inside
  MODEL_INITIATIVE_VALUE_RETEST: "MODEL_INITIATIVE_VALUE_RETEST",   // P/b-Shape trend continuation on pullback to Developing POC/VWAP
  MODEL_IB_FAILED_AUCTION_TRAP: "MODEL_IB_FAILED_AUCTION_TRAP",     // Initial Balance liquidity sweep fade with verified Excess Tail
};

// ---------------------------------------------------------------------------
// 5. MASTER BIAS STATES
// ---------------------------------------------------------------------------
export const MASTER_BIAS = {
  BULLISH_TREND: "BULLISH_TREND",
  BEARISH_TREND: "BEARISH_TREND",
  ROTATIONAL_BALANCED: "ROTATIONAL_BALANCED",
  STAND_ASIDE_CHOP: "STAND_ASIDE_CHOP",
};

// ---------------------------------------------------------------------------
// 6. SESSION WINDOWS (Europe/Athens EET / EEST Protocol)
// ---------------------------------------------------------------------------
export const SESSIONS_EET = {
  ASIA_START_MIN: 180,        // 03:00 EET
  ASIA_END_MIN: 480,          // 08:00 EET
  LONDON_IB_START_MIN: 540,   // 09:00 EET
  LONDON_IB_END_MIN: 600,     // 10:00 EET (First 60 mins)
  LONDON_KZ_START_MIN: 540,   // 09:00 EET
  LONDON_KZ_END_MIN: 750,     // 12:30 EET
  NY_IB_START_MIN: 930,       // 15:30 EET
  NY_IB_END_MIN: 990,         // 16:30 EET (First 60 mins)
  NY_KZ_START_MIN: 930,       // 15:30 EET
  NY_KZ_END_MIN: 1170,        // 19:30 EET
  DAY_CLOSE_MIN: 1380,        // 23:00 EET (17:00 NY)
};

// ---------------------------------------------------------------------------
// 7. INSTITUTIONAL PROP FIRM RISK GUARDRAILS
// ---------------------------------------------------------------------------
export const RISK_GUARDRAILS = {
  MAX_DAILY_LOSS_PCT: 2.2,        // Halt trading if daily loss reaches 2.2%
  MAX_TOTAL_LOSS_PCT: 5.0,        // Max cumulative floating drawdown shield
  RISK_PER_TRADE_PCT: 0.75,       // Fixed risk: 0.75% of account balance
  MIN_RR_RATIO: 2.0,              // Reject any setup with < 2.0 Risk-to-Reward
  MAX_SPREAD_RATIO: 0.12,         // Reject if broker spread exceeds 12% of stop distance
  MIN_STOP_LOSS_POINTS: 30.0,     // Default minimum stop bracket (customizable per asset)
  MAX_STOP_LOSS_POINTS: 140.0,    // Default maximum stop bracket (customizable per asset)
  MAX_CONCURRENT_TRADES: 2,       // Maximum active concurrent trades allowed
  MAX_HOLD_BARS: 48,              // Max holding time in M15 bars (12 hours)
  ALPHA_HALF_LIFE_BARS: 16,       // Prune / tighten trade if no traction after 4 hours
};

// ---------------------------------------------------------------------------
// 8. QUANTITATIVE AUCTION THRESHOLDS
// ---------------------------------------------------------------------------
export const QUANT_THRESHOLDS = {
  TPO_VALUE_AREA_PCT: 0.70,       // 70% of distribution defines the Value Area (1 standard deviation)
  TPO_PRICE_STEP_ATR_DIVISOR: 20, // Dynamic TPO step = ATR(14) / 20
  VWAP_SIGMA_1: 1.0,              // 1st Standard Deviation Band (~68.2% of session volume)
  VWAP_SIGMA_2: 2.0,              // 2nd Standard Deviation Band (~95.4% of session volume - Exhaustion Zone)
  VWAP_SIGMA_3: 3.0,              // 3rd Standard Deviation Band (~99.7% of session volume - Statistical Anomaly)
  VARIANCE_RATIO_HORIZON: 4,      // Lo-MacKinlay horizon period k=4
  MIN_EXCESS_WICK_RATIO: 0.22,    // Rejection wick must exceed 22% of candle range to confirm excess
};
