/**
 * lib/autonomous_quant/constants.js
 *
 * System #2: Quantitative Regime & TPO Auction Autonomous Engine
 * Core constants, state definitions, model IDs, time rules, and prop firm risk parameters.
 */

export const ENGINE_ID = "SYSTEM_2_QUANT_AUCTION";
export const ENGINE_VERSION = "2.0.0-PROD_SPEC";

// ---------------------------------------------------------------------------
// 1. REGIME ENUMS (Hurst & Volatility States)
// ---------------------------------------------------------------------------
export const REGIMES = {
  TREND_PERSISTENT: "TREND_PERSISTENT",   // Hurst H > 0.55 (Trending / Momentum)
  MEAN_REVERTING: "MEAN_REVERTING",       // Hurst H < 0.45 (Rotational / Range-bound)
  RANDOM_WALK_NOISE: "RANDOM_WALK_NOISE", // 0.45 <= H <= 0.55 (Brownian Motion / Stand Aside)
  VOLATILITY_SQUEEZE: "VOLATILITY_SQUEEZE", // BB compressed inside Keltner Channel
  VOLATILITY_EXPANSION: "VOLATILITY_EXPANSION", // Squeeze released / Momentum impulse
};

// ---------------------------------------------------------------------------
// 2. TPO AUCTION DAY TYPES (Steidlmayer CBOT Framework)
// ---------------------------------------------------------------------------
export const TPO_DAY_TYPES = {
  NORMAL_DAY: "NORMAL_DAY",                 // Base case: Price stays mostly inside Initial Balance (IB <= 1.25x)
  NORMAL_VARIATION: "NORMAL_VARIATION",     // One-sided IB extension up to 2.0x IB range
  TREND_DAY: "TREND_DAY",                   // Relentless one-sided expansion (> 2.5x IB range)
  NEUTRAL_DAY: "NEUTRAL_DAY",               // Extends both IB High and Low, closes in middle
  NON_TREND_DAY: "NON_TREND_DAY",           // Extremely narrow consolidation, zero extension
};

// ---------------------------------------------------------------------------
// 3. VALUE AREA RELATIONSHIPS (Multi-Day Bias)
// ---------------------------------------------------------------------------
export const VALUE_RELATIONSHIPS = {
  HIGHER_VALUE: "HIGHER_VALUE",         // Today's VAH/VAL clearly above yesterday's
  LOWER_VALUE: "LOWER_VALUE",           // Today's VAH/VAL clearly below yesterday's
  OVERLAPPING_HIGHER: "OVERLAPPING_HIGHER", // VAH higher, but VAL inside yesterday
  OVERLAPPING_LOWER: "OVERLAPPING_LOWER",   // VAL lower, but VAH inside yesterday
  INSIDE_VALUE: "INSIDE_VALUE",         // Complete contraction inside yesterday's Value
  OUTSIDE_VALUE: "OUTSIDE_VALUE",       // Complete expansion engulfing yesterday's Value
};

// ---------------------------------------------------------------------------
// 4. AUCTION SCENARIOS (Structural Foundation)
// ---------------------------------------------------------------------------
export const AUCTION_SCENARIOS = {
  SCENARIO_ROTATIONAL_BALANCE: {
    id: "SCENARIO_ROTATIONAL_BALANCE",
    name: "Two-Sided Rotational Auction (Balance / Range)",
    description: "Price is accepted inside prior value area or initial balance; participants agree on price. Fading extremes and 80% Rule re-entries dominate.",
  },
  SCENARIO_INITIATIVE_EXPANSION: {
    id: "SCENARIO_INITIATIVE_EXPANSION",
    name: "Initiative Directional Expansion (Trend / Value Migration)",
    description: "Strong buyers or sellers driving price to seek new value. Coiled energy release with pure TPO POC Value Acceptance.",
  },
  SCENARIO_UNFINISHED_AUCTION: {
    id: "SCENARIO_UNFINISHED_AUCTION",
    name: "Unfinished Auction Resolution (Poor High / Low Sweep)",
    description: "Market printed an incomplete auction extreme without excess single-print tails. Institutions exploit the structural void.",
  },
  SCENARIO_STAND_ASIDE_NOISE: {
    id: "SCENARIO_STAND_ASIDE_NOISE",
    name: "Random Walk Noise / Capital Preservation",
    description: "Brownian motion with low directional persistence and no compressed energy. Stand aside.",
  },
};

// ---------------------------------------------------------------------------
// 5. MODEL IDENTIFIERS
// ---------------------------------------------------------------------------
export const MODELS = {
  STEIDLMAYER_80_PERCENT_RULE: "STEIDLMAYER_80_PERCENT_RULE",
  MODEL_1_IB_FAILED_AUCTION_TRAP: "MODEL_1_IB_FAILED_AUCTION_TRAP",
  MODEL_2_COILED_SQUEEZE_EXPANSION: "MODEL_2_COILED_SQUEEZE_EXPANSION",
  MODEL_3_UNFINISHED_AUCTION_SWEEP: "MODEL_3_UNFINISHED_AUCTION_SWEEP",
};

// ---------------------------------------------------------------------------
// 6. MASTER BIAS STATES
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
// All session windows are strictly in Europe/Athens local time (minutes from midnight)
export const SESSIONS_EET = {
  // Asia Session (Liquidity Build): 03:00 - 08:00 EET
  ASIA_START_MIN: 180,
  ASIA_END_MIN: 480,

  // London Initial Balance (IB): 09:00 - 10:00 EET (First 60 mins)
  LONDON_IB_START_MIN: 540,
  LONDON_IB_END_MIN: 600,

  // London Main Killzone: 09:00 - 12:30 EET
  LONDON_KZ_START_MIN: 540,
  LONDON_KZ_END_MIN: 750,

  // New York Cash Initial Balance (IB): 15:30 - 16:30 EET (First 60 mins)
  NY_IB_START_MIN: 930,
  NY_IB_END_MIN: 990,

  // New York Main Cash Killzone: 15:30 - 19:30 EET
  NY_KZ_START_MIN: 930,
  NY_KZ_END_MIN: 1170,

  // End of Trading Day / Session Close: 23:00 EET (17:00 NY)
  DAY_CLOSE_MIN: 1380,
};

// ---------------------------------------------------------------------------
// 7. PROP FIRM RISK GUARDRAILS
// ---------------------------------------------------------------------------
export const RISK_GUARDRAILS = {
  MAX_DAILY_LOSS_PCT: 2.2,        // Halt trading if daily loss reaches 2.2% (shield for 5% prop limit)
  MAX_TOTAL_LOSS_PCT: 5.0,        // Max cumulative floating drawdown limit (shield for 8-10% prop limit)
  RISK_PER_TRADE_PCT: 0.75,       // Standard risk per setup (0.75% of account balance)
  MIN_RR_RATIO: 2.2,              // Strictly reject any setup with < 2.2 Risk-to-Reward
  MAX_SPREAD_RATIO: 0.12,         // Reject if broker spread exceeds 12% of stop loss distance
  MIN_STOP_LOSS_POINTS: 30.0,     // Minimum structural stop distance on NAS100 (shields against intra-bar flicker & noise)
  MAX_STOP_LOSS_POINTS: 140.0,    // Maximum structural stop distance on NAS100 (shields against unachievable intraday R:R targets)
  MAX_CONCURRENT_TRADES: 2,       // Maximum active concurrent trades allowed
  MAX_HOLD_BARS: 48,              // Max holding time in M15 bars (12 hours - no overnight rollover risk)
};

// ---------------------------------------------------------------------------
// 8. QUANTITATIVE THRESHOLDS
// ---------------------------------------------------------------------------
export const QUANT_THRESHOLDS = {
  HURST_TREND_THRESHOLD: 0.55,    // Above 0.55 = Trending persistence
  HURST_MEAN_REV_THRESHOLD: 0.45, // Below 0.45 = Mean-reverting anti-persistence
  HURST_LOOKBACK_BARS: 100,       // Lookback window for rolling Rescaled Range (R/S)
  
  BOLLINGER_PERIOD: 20,
  BOLLINGER_STDDEV: 2.0,
  KELTNER_PERIOD: 20,
  KELTNER_ATR_MULT: 1.5,
  MIN_SQUEEZE_BARS: 4,            // Minimum bars Bollinger must remain inside Keltner to validate coiled energy

  TPO_VALUE_AREA_PCT: 0.70,       // 70% of TPOs define the Value Area (1 standard deviation)
  TPO_PRICE_STEP_ATR_DIVISOR: 20, // Dynamic TPO step = ATR(14) / 20 for granular pricing
};
