// Institutional Trading Time Slots & Killzone Engine (EET / Broker Server Time Standard)
// Sessions use Europe/Athens (EET/EEST). Wall-clock inputs are UTC instants;
// broker-naive bars must explicitly carry timestampSemantics: BROKER_NAIVE.

import { baseOf, canonOf } from "./symbols.js";
import { BROKER_TIMEZONE, toUtcSec, getTradingDayKey, getTradingDayStartSec, getEetDayOfWeek, getEetTime as coreGetEetTime } from "../time.js";

export { BROKER_TIMEZONE, toUtcSec, getTradingDayKey, getTradingDayStartSec, getEetDayOfWeek };

// Canonical Institutional Phases (EET):
//   - Rollover Dead Zone / Spread Expansion (00:00 - 02:00 EET)
//   - Asian Range Accumulation (02:00 - 06:00 EET)
//   - Asian Close / Pre-European Lull (06:00 - 08:00 EET)
//   - Pre-London Preparation / Frankfurt (08:00 - 10:00 EET)
//   - London Open Killzone (10:00 - 13:00 EET)
//   - London Lunch Lull (13:00 - 15:00 EET)
//   - Pre-New York Session Setup (15:00 - 16:25 EET)
//   - New York Session / AM Killzone (16:25 - 20:30 EET)
//   - New York Silver Bullet Window (17:00 - 18:00 EET)
//   - London Close Killzone (18:00 - 20:00 EET)
//   - New York PM Killzone (21:00 - 23:00 EET)

export const TIME_SLOTS = {
  ASIAN_RANGE: {
    id: "asian_range",
    name: "Asian Range Accumulation",
    shortBadge: "ASIA 02-06",
    phase: "ACCUMULATION",
    startMinute: 120,         // 02:00 EET
    endMinute: 360,           // 06:00 EET
    eetRange: "02:00 - 06:00 EET",
    brokerRange: "02:00 - 06:00 Broker Server Time",
    utcRange: "23:00 - 03:00 UTC",
    startUtcMinute: 0,
    endUtcMinute: 180,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "LOW_TO_MEDIUM",
    description: "Range building & liquidity accumulation (02:00 - 06:00 EET). Sets Asian High/Low as key reference targets for London Judas sweeps.",
    favoredAssets: ["JPY", "AUD", "NZD", "BTCUSD"],
    modelAffinities: {
      ote_continuation: 10,
      turtle_soup: 15,
      ict_2022: 5,
      breaker_block: 5,
      silver_bullet: -20,
      displacement_breakout: -10,
    },
  },
  PRE_LONDON_PREP: {
    id: "pre_london_prep",
    name: "Pre-London Session Setup",
    shortBadge: "PRE-LDN 08-10",
    phase: "PREP",
    startMinute: 480,         // 08:00 EET
    endMinute: 600,           // 10:00 EET
    eetRange: "08:00 - 10:00 EET",
    brokerRange: "08:00 - 10:00 Broker Server Time",
    utcRange: "05:00 - 07:00 UTC",
    startUtcMinute: 300,
    endUtcMinute: 420,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "MEDIUM",
    description: "Frankfurt open and pre-London liquidity building.",
    favoredAssets: ["EUR", "GBP", "GER40"],
    modelAffinities: {
      turtle_soup: 20,
      ict_2022: 15,
      breaker_block: 10,
      ote_continuation: 10,
      silver_bullet: -10,
      displacement_breakout: 10,
    },
  },
  LONDON_OPEN: {
    id: "london_open",
    name: "London Open Killzone (LOKZ)",
    shortBadge: "LOKZ 10-13",
    phase: "KILLZONE",
    startMinute: 600,         // 10:00 EET
    endMinute: 780,           // 13:00 EET
    eetRange: "10:00 - 13:00 EET",
    brokerRange: "10:00 - 13:00 Broker Server Time",
    utcRange: "07:00 - 10:00 UTC",
    startUtcMinute: 420,
    endUtcMinute: 600,
    isKillzone: true,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "VERY_HIGH",
    description: "Peak European liquidity. Classic Judas Swing manipulations sweeping Asian extremes before true trend of the day.",
    favoredAssets: ["EUR", "GBP", "GER40", "XAUUSD"],
    modelAffinities: {
      judas_swing: 35,        // Archetype London Open false move reversal
      turtle_soup: 35,        // Prime for Asian high/low raids
      ict_2022: 30,           // Judas swing + MSS + FVG
      smt_divergence_sweep: 30, // Intermarket divergence at London Open
      breaker_block: 25,
      fvg_rejection: 25,
      ote_continuation: 20,
      silver_bullet: 15,
      displacement_breakout: 35,
    },
  },
  LONDON_LUNCH: {
    id: "london_lunch",
    name: "London Lunch Lull",
    shortBadge: "LUNCH 13-15",
    phase: "CONSOLIDATION",
    startMinute: 780,         // 13:00 EET
    endMinute: 900,           // 15:00 EET
    eetRange: "13:00 - 15:00 EET",
    brokerRange: "13:00 - 15:00 Broker Server Time",
    utcRange: "10:00 - 12:00 UTC",
    startUtcMinute: 600,
    endUtcMinute: 720,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: false, // Disabled by default to avoid midday chop
    volatility: "LOW",
    description: "Midday liquidity dip and consolidation ahead of New York news drops. Chop risk is elevated.",
    favoredAssets: ["EUR", "GBP"],
    modelAffinities: {
      ote_continuation: 10,
      turtle_soup: -15,
      ict_2022: -10,
      breaker_block: -10,
      silver_bullet: -25,
      displacement_breakout: -15,
    },
  },
  PRE_NY_PREP: {
    id: "pre_ny_prep",
    name: "Pre-New York Session Setup",
    shortBadge: "PRE-NY 15-16:25",
    phase: "PREP",
    startMinute: 900,         // 15:00 EET
    endMinute: 985,           // 16:25 EET
    eetRange: "15:00 - 16:25 EET",
    brokerRange: "15:00 - 16:25 Broker Server Time",
    utcRange: "12:00 - 13:25 UTC",
    startUtcMinute: 720,
    endUtcMinute: 805,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: false,
    volatility: "MEDIUM",
    description: "US pre-market liquidity building ahead of New York Cash Open (16:25 EET).",
    favoredAssets: ["NAS100", "US30", "SP500", "GER40", "XAUUSD", "EURUSD", "GBPUSD"],
    modelAffinities: {
      turtle_soup: 15,
      ict_2022: 15,
      ote_continuation: 10,
      breaker_block: 10,
      silver_bullet: -10,
      displacement_breakout: 15,
    },
  },
  NEW_YORK_AM: {
    id: "ny_open",
    name: "New York Session / AM Killzone (NYKZ)",
    shortBadge: "NYKZ 16:25-20:30",
    phase: "KILLZONE",
    startMinute: 985,         // 16:25 EET
    endMinute: 1230,          // 20:30 EET
    eetRange: "16:25 - 20:30 EET",
    brokerRange: "16:25 - 20:30 Broker Server Time",
    utcRange: "13:25 - 17:30 UTC",
    startUtcMinute: 805,
    endUtcMinute: 1050,
    isKillzone: true,
    isSilverBullet: false,    // Overlaps with NY Silver Bullet at 17:00
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "MAXIMUM",
    description: "New York main trading session (16:25 - 20:30 EET). US Macro economic data & US Equities cash open (16:25/16:30 EET) through afternoon delivery.",
    favoredAssets: ["NAS100", "US30", "SP500", "GER40", "XAUUSD", "EURUSD", "GBPUSD"],
    modelAffinities: {
      displacement_breakout: 40,
      ict_2022: 35,
      po3_daily_cycle: 35,    // NY Midnight / Cash Open manipulation into distribution
      silver_bullet: 30,
      breaker_block: 30,
      smt_divergence_sweep: 30, // NY cash open intermarket index divergence
      fvg_rejection: 30,
      ote_continuation: 25,
      turtle_soup: 25,
    },
  },
  NY_SILVER_BULLET: {
    id: "ny_silver_bullet",
    name: "New York Silver Bullet Window",
    shortBadge: "NYSB 17-18",
    phase: "SILVER_BULLET",
    startMinute: 1020,        // 17:00 EET (10:00 AM NY)
    endMinute: 1080,          // 18:00 EET (11:00 AM NY)
    eetRange: "17:00 - 18:00 EET",
    brokerRange: "17:00 - 18:00 Broker Server Time",
    utcRange: "14:00 - 15:00 UTC",
    startUtcMinute: 840,
    endUtcMinute: 900,
    isKillzone: true,
    isSilverBullet: true,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "HIGH",
    description: "ICT 60-Minute Algorithmic Delivery Window (10:00 - 11:00 NY = 17:00 - 18:00 EET). Clean institutional FVG sweeps.",
    favoredAssets: ["NAS100", "SP500", "US30", "XAUUSD", "EURUSD"],
    modelAffinities: {
      silver_bullet: 45,      // Dominant model in this window
      ict_2022: 25,
      breaker_block: 20,
      ote_continuation: 15,
      turtle_soup: 10,
      displacement_breakout: 25,
    },
  },
  LONDON_CLOSE: {
    id: "london_close",
    name: "London Close Killzone (LCKZ)",
    shortBadge: "LCKZ 18-20",
    phase: "KILLZONE",
    startMinute: 1080,        // 18:00 EET
    endMinute: 1200,          // 20:00 EET
    eetRange: "18:00 - 20:00 EET",
    brokerRange: "18:00 - 20:00 Broker Server Time",
    utcRange: "15:00 - 17:00 UTC",
    startUtcMinute: 900,
    endUtcMinute: 1020,
    isKillzone: true,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "HIGH",
    description: "European fixing, counter-trend profit taking, or daily high/low formation completion.",
    favoredAssets: ["EUR", "GBP", "XAUUSD"],
    modelAffinities: {
      turtle_soup: 30,        // Profit taking reversals
      ict_2022: 20,
      ote_continuation: 15,
      breaker_block: 15,
      silver_bullet: -10,
      displacement_breakout: 15,
    },
  },
  NEW_YORK_PM: {
    id: "ny_pm",
    name: "New York PM Killzone",
    shortBadge: "NYPM 21-23",
    phase: "KILLZONE",
    startMinute: 1260,        // 21:00 EET
    endMinute: 1380,          // 23:00 EET
    eetRange: "21:00 - 23:00 EET",
    brokerRange: "21:00 - 23:00 Broker Server Time",
    utcRange: "18:00 - 20:00 UTC",
    startUtcMinute: 1080,
    endUtcMinute: 1200,
    isKillzone: true,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "MEDIUM_TO_HIGH",
    description: "Afternoon continuation & US cash close positioning (13:00 - 15:00 NY = 21:00 - 23:00 EET).",
    favoredAssets: ["NAS100", "US30", "SP500"],
    modelAffinities: {
      silver_bullet: 30,
      ote_continuation: 25,
      ict_2022: 20,
      breaker_block: 20,
      turtle_soup: 10,
      displacement_breakout: 20,
    },
  },
  DEAD_ZONE: {
    id: "dead_zone",
    name: "Post-Close Rollover / Spread Widening",
    shortBadge: "DEAD 00-02",
    phase: "DEAD_ZONE",
    startMinute: 0,           // 00:00 EET
    endMinute: 120,           // 02:00 EET
    eetRange: "00:00 - 02:00 EET",
    brokerRange: "00:00 - 02:00 Broker Server Time",
    utcRange: "21:00 - 23:00 UTC",
    startUtcMinute: 1260,
    endUtcMinute: 1440,
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: true,
    tradingAllowedByDefault: false, // STRICTLY FALSE by default!
    volatility: "UNPREDICTABLE",
    description: "Daily rollover, broker settlement, and extreme spread expansion. Staging/entering new trades is blocked.",
    favoredAssets: [],
    modelAffinities: {
      silver_bullet: -50,
      ict_2022: -50,
      turtle_soup: -50,
      breaker_block: -50,
      ote_continuation: -50,
      displacement_breakout: -50,
    },
  },
};

/**
 * Extracts the exact EET / Broker Server Time hours, minutes, and total minutes.
 * Handles Date objects, MT5 raw bar objects, or epoch seconds.
 * @param {Date|Object|number} input
 * @returns {{ h: number, m: number, s: number, totalMinutes: number }}
 */
export function getEetTime(input = new Date(), options = {}) {
  let value = input;
  const isBar = input && typeof input === "object" && !(input instanceof Date);
  if (isBar) value = input.time ?? input.t;
  const numeric = typeof value === "number";
  // Legacy clock-only callers pass seconds since local midnight (for example
  // 17:30 => 63,000). Treat those as an EET wall-clock value; real epoch
  // timestamps are much larger and continue through timezone conversion.
  if (numeric && value >= 0 && value < 86400 && !isBar) {
    const totalMinutes = Math.floor(value / 60) % 1440;
    return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60, s: Math.floor(value % 60), totalMinutes };
  }
  const semantics = isBar ? input.timestampSemantics || options.timestampSemantics : options.timestampSemantics;
  // Legacy broker clocks are opt-in. The canonical data feed converts them to UTC.
  if (semantics === "BROKER_NAIVE" && numeric) {
    const ms = value < 1e11 ? value * 1000 : value;
    const date = new Date(ms);
    const h = date.getUTCHours(), m = date.getUTCMinutes(), s = date.getUTCSeconds();
    return { h, m, s, totalMinutes: h * 60 + m };
  }
  return coreGetEetTime(input);
}

// Independent of configurable/general slots: Silver Bullet cannot be enabled
// outside its exact half-open hour, nor inherited from NY PM/other killzones.
export function getSilverBulletWindow(input = new Date()) {
  const { totalMinutes } = getEetTime(input);
  if (totalMinutes >= 600 && totalMinutes < 660) return { id: "london_sb", startMinute: 600, endMinute: 660, eetRange: "10:00 - 11:00 EET" };
  if (totalMinutes >= 1020 && totalMinutes < 1080) return { id: "ny_sb", startMinute: 1020, endMinute: 1080, eetRange: "17:00 - 18:00 EET" };
  return null;
}

/**
 * Returns the Unix timestamp (ms) for the start of the current ICT trading day.
 * The ICT/broker trading day resets at midnight EET (00:00 Europe/Athens),
 * which is equivalent to 5 PM New York time (NY Close = Daily Candle Rollover).
 *
 * Used by the Trade Idea Day Exhaustion Guard to scope "today's" consumed trade ideas
 * within a single broker trading session.
 *
 * @param {Date} [now=new Date()] - Reference point, defaults to current wall-clock time.
 * @returns {number} Unix timestamp (ms) for 00:00:00 EET of the current trading day.
 */
export function getStartOfTradingDay(now = new Date()) {
  try {
    // Format date parts in Europe/Athens timezone to get the EET calendar date
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Athens",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(now);
    const year  = parseInt(parts.find((p) => p.type === "year")?.value  ?? "0", 10);
    const month = parseInt(parts.find((p) => p.type === "month")?.value ?? "1", 10) - 1; // 0-indexed
    const day   = parseInt(parts.find((p) => p.type === "day")?.value   ?? "1", 10);

    // Build candidate midnight UTC for that EET calendar date
    const midnightUtcCandidate = Date.UTC(year, month, day, 0, 0, 0, 0);

    // Determine the EET offset (UTC+2 or UTC+3 depending on DST) at that point
    const { h: eetHourAtMidnightUtc } = getEetTime(new Date(midnightUtcCandidate));
    // eetHourAtMidnightUtc tells us how many hours past midnight UTC = EET time
    // e.g., if eetH === 2 then UTC+00:00 is 02:00 EET → midnight EET was 2h earlier
    const eetOffsetMs = eetHourAtMidnightUtc * 3_600_000;
    return midnightUtcCandidate - eetOffsetMs;
  } catch {
    // Fallback: EET is UTC+3 in summer (EEST) which covers most trading sessions
    const EET_OFFSET_MS = 3 * 3_600_000;
    const nowMs = now.getTime();
    return nowMs - ((nowMs + EET_OFFSET_MS) % 86_400_000) - EET_OFFSET_MS;
  }
}

/**
 * Parses "HH:MM" (e.g. "16:25") into total minutes from midnight (0..1439).
 * Returns null if format is invalid.
 * @param {string} timeStr
 * @returns {number|null}
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Formats total minutes from midnight (0..1439) into "HH:MM" string.
 * @param {number} totalMinutes
 * @returns {string}
 */
export function formatMinutesToTime(totalMinutes) {
  if (typeof totalMinutes !== "number" || isNaN(totalMinutes)) return "00:00";
  const norm = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Resolves effective institutional time slots, incorporating any user-configured custom timings
 * from config.slotCustomTimings or config.sessionTimings.
 * @param {Object} [config]
 * @returns {Object} Effective time slots dictionary
 */
export function getEffectiveTimeSlots(config = {}) {
  const customMap = config?.slotCustomTimings || {};
  const sessionTimings = config?.sessionTimings || {};

  const effective = {};
  for (const [key, slot] of Object.entries(TIME_SLOTS)) {
    effective[key] = { ...slot };
  }

  const slotByKey = {};
  for (const [key, slot] of Object.entries(effective)) {
    slotByKey[slot.id] = key;
  }

  // 1. Apply slotCustomTimings overrides
  if (customMap && typeof customMap === "object") {
    for (const [slotId, timing] of Object.entries(customMap)) {
      const key = slotByKey[slotId];
      if (!key || !timing || typeof timing !== "object") continue;
      const startMin = parseTimeToMinutes(timing.start);
      const endMin = parseTimeToMinutes(timing.end);
      if (startMin !== null && endMin !== null) {
        const slot = effective[key];
        slot.startMinute = startMin;
        slot.endMinute = endMin;
        slot.eetRange = `${timing.start} - ${timing.end} EET`;
        slot.brokerRange = `${timing.start} - ${timing.end} Broker Server Time`;
        const prefix = slot.shortBadge?.split(" ")[0] || slot.id.toUpperCase();
        slot.shortBadge = `${prefix} ${timing.start}-${timing.end}`;
        slot.isCustomTiming = true;
      }
    }
  }

  // 2. Apply sessionTimings fallback if slotCustomTimings not set for major sessions
  if (sessionTimings && typeof sessionTimings === "object") {
    if (sessionTimings.asia && !customMap.asian_range && effective.ASIAN_RANGE) {
      const startMin = parseTimeToMinutes(sessionTimings.asia.start);
      const endMin = parseTimeToMinutes(sessionTimings.asia.end);
      if (startMin !== null && endMin !== null) {
        effective.ASIAN_RANGE.startMinute = startMin;
        effective.ASIAN_RANGE.endMinute = endMin;
        effective.ASIAN_RANGE.eetRange = `${sessionTimings.asia.start} - ${sessionTimings.asia.end} EET`;
        effective.ASIAN_RANGE.shortBadge = `ASIA ${sessionTimings.asia.start}-${sessionTimings.asia.end}`;
      }
    }
    if (sessionTimings.newyork && !customMap.ny_open && effective.NEW_YORK_AM) {
      const startMin = parseTimeToMinutes(sessionTimings.newyork.start);
      const endMin = parseTimeToMinutes(sessionTimings.newyork.end);
      if (startMin !== null && endMin !== null) {
        effective.NEW_YORK_AM.startMinute = startMin;
        effective.NEW_YORK_AM.endMinute = endMin;
        effective.NEW_YORK_AM.eetRange = `${sessionTimings.newyork.start} - ${sessionTimings.newyork.end} EET`;
        effective.NEW_YORK_AM.shortBadge = `NYKZ ${sessionTimings.newyork.start}-${sessionTimings.newyork.end}`;
      }
    }
    if (sessionTimings.london && !customMap.london_open && effective.LONDON_OPEN) {
      const startMin = parseTimeToMinutes(sessionTimings.london.start);
      const endMin = parseTimeToMinutes(sessionTimings.london.end);
      if (startMin !== null && endMin !== null) {
        effective.LONDON_OPEN.startMinute = startMin;
        effective.LONDON_OPEN.endMinute = endMin;
        effective.LONDON_OPEN.eetRange = `${sessionTimings.london.start} - ${sessionTimings.london.end} EET`;
        effective.LONDON_OPEN.shortBadge = `LDN ${sessionTimings.london.start}-${sessionTimings.london.end}`;
      }
    }
  }

  // 3. Dynamic Harmonization & Interlock:
  // If NEW_YORK_AM starts earlier (e.g. 15:30 or 15:00 instead of default 16:25),
  // PRE_NY_PREP and LONDON_LUNCH MUST NOT overlap or shadow NEW_YORK_AM!
  if (effective.NEW_YORK_AM && effective.NEW_YORK_AM.startMinute < 985) {
    if (effective.PRE_NY_PREP) {
      if (effective.NEW_YORK_AM.startMinute <= effective.PRE_NY_PREP.startMinute) {
        // NY starts at or before Pre-NY start -> collapse PRE_NY_PREP so it never intercepts NY
        effective.PRE_NY_PREP.startMinute = 0;
        effective.PRE_NY_PREP.endMinute = 0;
      } else {
        // Clamp PRE_NY_PREP endMinute to exactly where NEW_YORK_AM begins
        effective.PRE_NY_PREP.endMinute = effective.NEW_YORK_AM.startMinute;
        effective.PRE_NY_PREP.eetRange = `${formatMinutesToTime(effective.PRE_NY_PREP.startMinute)} - ${formatMinutesToTime(effective.PRE_NY_PREP.endMinute)} EET`;
        effective.PRE_NY_PREP.brokerRange = `${formatMinutesToTime(effective.PRE_NY_PREP.startMinute)} - ${formatMinutesToTime(effective.PRE_NY_PREP.endMinute)} Broker Server Time`;
        effective.PRE_NY_PREP.shortBadge = `PRE-NY ${formatMinutesToTime(effective.PRE_NY_PREP.startMinute)}-${formatMinutesToTime(effective.PRE_NY_PREP.endMinute)}`;
      }
    }
    // If NY starts earlier than 15:00 EET (900 min), clamp LONDON_LUNCH so it doesn't shadow early NY
    if (effective.LONDON_LUNCH && effective.NEW_YORK_AM.startMinute < 900) {
      if (effective.NEW_YORK_AM.startMinute <= effective.LONDON_LUNCH.startMinute) {
        // NY starts at or before London Lunch start -> collapse LONDON_LUNCH
        effective.LONDON_LUNCH.startMinute = 0;
        effective.LONDON_LUNCH.endMinute = 0;
      } else {
        effective.LONDON_LUNCH.endMinute = effective.NEW_YORK_AM.startMinute;
        effective.LONDON_LUNCH.eetRange = `${formatMinutesToTime(effective.LONDON_LUNCH.startMinute)} - ${formatMinutesToTime(effective.LONDON_LUNCH.endMinute)} EET`;
        effective.LONDON_LUNCH.brokerRange = `${formatMinutesToTime(effective.LONDON_LUNCH.startMinute)} - ${formatMinutesToTime(effective.LONDON_LUNCH.endMinute)} Broker Server Time`;
        effective.LONDON_LUNCH.shortBadge = `LUNCH ${formatMinutesToTime(effective.LONDON_LUNCH.startMinute)}-${formatMinutesToTime(effective.LONDON_LUNCH.endMinute)}`;
      }
    }
  }

  return effective;
}

/**
 * Checks if a specific time slot is currently enabled and allowed to trade in configuration.
 * Considers user allowedTimeSlots, deletedTimeSlots, and legacy sessionFilters.
 * @param {Object} slot
 * @param {Object} [config]
 * @returns {boolean}
 */
export function isSlotActiveAndAllowed(slot, config = {}) {
  if (!slot) return false;
  if (slot.id === "dead_zone" || slot.isDeadZone) return false;

  const deleted = new Set(config?.deletedTimeSlots || []);
  if (deleted.has(slot.id)) return false;

  if (config?.allowedTimeSlots && typeof config.allowedTimeSlots === "object") {
    if (config.allowedTimeSlots[slot.id] === false) return false;
    if (config.allowedTimeSlots[slot.id] === true) return true;
  }

  if (config?.sessionFilters) {
    if (slot.id === "asian_range" && config.sessionFilters.asia === false) return false;
    if (["london_open", "london_lunch", "london_close"].includes(slot.id) && config.sessionFilters.london === false) return false;
    if (["ny_open", "ny_silver_bullet", "ny_pm"].includes(slot.id) && config.sessionFilters.newyork === false) return false;
  }

  return !!slot.tradingAllowedByDefault;
}

/**
 * Returns all institutional time slots that cover the given EET minute,
 * excluding any deleted sessions.
 * @param {Date|Object|number} input
 * @param {Object} [config]
 * @returns {Array<Object>}
 */
export function getAllActiveSlotsAt(input = new Date(), config = {}) {
  const { totalMinutes } = getEetTime(input);
  const eff = getEffectiveTimeSlots(config);
  const deleted = new Set(config?.deletedTimeSlots || []);

  const candidates = [];
  for (const slot of Object.values(eff)) {
    if (!slot || deleted.has(slot.id)) continue;
    if (slot.id === "dead_zone") {
      if (totalMinutes < slot.endMinute || totalMinutes >= 1410) {
        candidates.push(enrichSlot(slot, totalMinutes));
      }
    } else {
      if (totalMinutes >= slot.startMinute && totalMinutes < slot.endMinute) {
        const enriched = enrichSlot(slot, totalMinutes);
        if (slot.id === "london_open") {
          enriched.isSilverBullet = totalMinutes < (slot.startMinute + 60);
        }
        candidates.push(enriched);
      }
    }
  }
  return candidates;
}

/**
 * Returns the currently active time slot object based on EET (Broker Server Time)
 * and optional user configuration with custom session timings.
 * Prioritizes active enabled overlapping sessions so disabling one session (e.g. Silver Bullet)
 * never shadows or blocks another active enabled session (e.g. New York AM).
 * @param {Date|Object|number} input
 * @param {Object} [config]
 * @returns {Object} Active time slot with metadata and countdown
 */
export function getCurrentTimeSlot(input = new Date(), config = {}) {
  const { totalMinutes } = getEetTime(input);
  const eff = getEffectiveTimeSlots(config);

  // 1. Rollover Dead Zone (00:00 - 02:00 EET or 23:30 - 24:00 EET) - hard priority veto
  if (totalMinutes < eff.DEAD_ZONE.endMinute || totalMinutes >= 1410) {
    return enrichSlot(eff.DEAD_ZONE, totalMinutes);
  }

  // 2. Find all candidate active sessions at this minute (excluding deleted slots)
  const candidates = getAllActiveSlotsAt(input, config).filter((s) => s.id !== "dead_zone");

  // Filter candidates to those enabled by user configuration
  const enabledCandidates = candidates.filter((s) => isSlotActiveAndAllowed(s, config));

  // If there are enabled candidates covering the current minute, choose the best active one:
  if (enabledCandidates.length > 0) {
    // If user has NY Silver Bullet enabled and active, prefer it for specialized model boost
    const sb = enabledCandidates.find((s) => s.id === "ny_silver_bullet");
    if (sb) return sb;

    // Prefer specialized narrower killzones when enabled (e.g. London Close Killzone 18:00 - 20:00 EET):
    const ldnClose = enabledCandidates.find((s) => s.id === "london_close");
    if (ldnClose) return ldnClose;

    // Next prefer primary New York AM session:
    const nyAm = enabledCandidates.find((s) => s.id === "ny_open");
    if (nyAm) return nyAm;

    const nyPm = enabledCandidates.find((s) => s.id === "ny_pm");
    if (nyPm) return nyPm;

    const ldnOpen = enabledCandidates.find((s) => s.id === "london_open");
    if (ldnOpen) return ldnOpen;

    const asia = enabledCandidates.find((s) => s.id === "asian_range");
    if (asia) return asia;

    const preNy = enabledCandidates.find((s) => s.id === "pre_ny_prep");
    if (preNy) return preNy;

    const preLdn = enabledCandidates.find((s) => s.id === "pre_london_prep");
    if (preLdn) return preLdn;

    const ldnLunch = enabledCandidates.find((s) => s.id === "london_lunch");
    if (ldnLunch) return ldnLunch;

    return enabledCandidates[0];
  }

  // If there are candidate sessions, but ALL of them are disabled by the user:
  if (candidates.length > 0) {
    // Return the primary canonical session covering this time so UI can show it as toggled off
    const ldnClose = candidates.find((s) => s.id === "london_close");
    if (ldnClose) return ldnClose;
    const nyAm = candidates.find((s) => s.id === "ny_open");
    if (nyAm) return nyAm;
    const ldnOpen = candidates.find((s) => s.id === "london_open");
    if (ldnOpen) return ldnOpen;
    return candidates[0];
  }

  // 3. Interstitial Lull Periods (between sessions)
  // Asian Close / Pre-European Lull
  const preLdn = eff.PRE_LONDON_PREP;
  const preLdnStart = preLdn ? preLdn.startMinute : eff.LONDON_OPEN.startMinute;
  if (totalMinutes >= eff.ASIAN_RANGE.endMinute && totalMinutes < preLdnStart) {
    return {
      id: "off_session_lull",
      name: "Asian Close / Pre-European Lull",
      shortBadge: `LULL ${formatMinutesToTime(eff.ASIAN_RANGE.endMinute).slice(0, 2)}-${formatMinutesToTime(preLdnStart).slice(0, 2)}`,
      phase: "LULL",
      startMinute: eff.ASIAN_RANGE.endMinute,
      endMinute: preLdnStart,
      eetRange: `${formatMinutesToTime(eff.ASIAN_RANGE.endMinute)} - ${formatMinutesToTime(preLdnStart)} EET`,
      brokerRange: `${formatMinutesToTime(eff.ASIAN_RANGE.endMinute)} - ${formatMinutesToTime(preLdnStart)} Broker Server Time`,
      utcRange: "03:00 - 05:00 UTC",
      isKillzone: false,
      isSilverBullet: false,
      isDeadZone: false,
      tradingAllowedByDefault: false,
      volatility: "LOW",
      description: "Asian range conclusion and pre-European liquidity lull.",
      favoredAssets: [],
      modelAffinities: {},
      minutesRemaining: preLdnStart - totalMinutes,
    };
  }

  // Interstitial Evening Lull (20:30 - 21:00 EET & 23:00 - 23:30 EET)
  const eveningLullEnd = totalMinutes >= 1380 ? 1410 : eff.NEW_YORK_PM.startMinute;
  return {
    id: "off_session_lull",
    name: "Inter-Session Volume Lull",
    shortBadge: "LULL",
    phase: "LULL",
    startMinute: totalMinutes,
    endMinute: eveningLullEnd,
    eetRange: "Inter-Session Lull",
    brokerRange: "Inter-Session Lull",
    utcRange: "Inter-Session Lull",
    isKillzone: false,
    isSilverBullet: false,
    isDeadZone: false,
    tradingAllowedByDefault: true,
    volatility: "LOW",
    description: "Lower market participation window between primary institutional sessions.",
    favoredAssets: [],
    modelAffinities: {},
    minutesRemaining: eveningLullEnd - totalMinutes,
  };
}

function enrichSlot(slot, currentMin) {
  let minutesRemaining = 0;
  if (slot.id === "dead_zone") {
    minutesRemaining = currentMin >= 1410 ? (1440 - currentMin + 120) : Math.max(0, 120 - currentMin);
  } else {
    minutesRemaining = Math.max(0, slot.endMinute - currentMin);
  }
  return {
    ...slot,
    minutesRemaining,
  };
}

/**
 * Returns all defined institutional time slots in chronological order,
 * with any user-configured custom timings applied and deleted sessions filtered out.
 * @param {Object} [config]
 * @returns {Array<Object>}
 */
export function getAllTimeSlots(config = {}) {
  const eff = getEffectiveTimeSlots(config);
  const deleted = new Set(config?.deletedTimeSlots || []);
  return [
    eff.ASIAN_RANGE,
    eff.PRE_LONDON_PREP,
    eff.LONDON_OPEN,
    eff.LONDON_LUNCH,
    eff.PRE_NY_PREP,
    eff.NEW_YORK_AM,
    eff.NY_SILVER_BULLET,
    eff.LONDON_CLOSE,
    eff.NEW_YORK_PM,
    eff.DEAD_ZONE,
  ].filter((s) => s && !deleted.has(s.id));
}

// ============================================================================
// Institutional Symbol-Specific Session Profiles & Gating Matrix
// ============================================================================
export const SYMBOL_SESSION_PROFILES = {
  // 1. US Equities / Indices: Strictly New York sessions (16:25 - 23:30 EET, continuous including London Close overlap & Midday)
  US_INDICES: {
    category: "US Indices",
    profileKey: "US_INDICES",
    label: "NY Only",
    badgeColor: "#3b82f6", // Blue
    fullLabel: "New York Sessions (16:25 - 23:30 EET)",
    eetHoursLabel: "16:25 - 23:30 EET",
    symbols: ["NAS100", "US30", "DJ30", "US500", "SP500", "SPX500"],
    startMinute: 985,     // 16:25 EET
    endMinute: 1410,      // 23:30 EET (continuous up to rollover dead zone)
    allowedSlotIds: [
      "ny_open",          // 16:25 - 18:00 EET (NY AM Killzone)
      "ny_silver_bullet", // 17:00 - 18:00 EET (NY Silver Bullet Window)
      "london_close",     // 18:00 - 20:00 EET (London Close / NY Midday Expansion)
      "off_session_lull", // 20:00 - 21:00 & 23:00 - 23:30 EET (NY Midday Lull & Cash Close Wrap)
      "ny_pm",            // 21:00 - 23:00 EET (NY PM Killzone & Cash Close)
    ],
    description: "US cash equities & index futures volume strictly concentrated during New York sessions (16:25 - 23:30 EET, including London Close overlap).",
  },

  // 2. European Indices: London and New York sessions (08:00 - 23:30 EET)
  EU_INDICES: {
    category: "European Indices",
    profileKey: "EU_INDICES",
    label: "London & NY",
    badgeColor: "#10b981", // Emerald
    fullLabel: "London & New York Sessions",
    eetHoursLabel: "08:00 - 23:30 EET",
    symbols: ["GER40", "DAX", "DE40", "UK100", "FTSE100"],
    startMinute: 480,     // 08:00 EET
    endMinute: 1410,      // 23:30 EET
    allowedSlotIds: [
      "pre_london_prep",  // 08:00 - 10:00 EET
      "london_open",      // 10:00 - 13:00 EET
      "london_lunch",     // 13:00 - 15:00 EET
      "ny_open",          // 16:25 - 18:00 EET (New York AM Killzone)
      "ny_silver_bullet", // 17:00 - 18:00 EET (NY Silver Bullet Window)
      "london_close",     // 18:00 - 20:00 EET (European Close & Fix)
      "off_session_lull", // 20:00 - 21:00 & 23:00 - 23:30 EET
      "ny_pm",            // 21:00 - 23:00 EET (New York PM Killzone)
    ],
    description: "European and US session liquidity. European morning expansion and New York afternoon liquidity.",
  },

  // 3. Precious Metals & Crypto: Asia, London, and New York (24-hour continuous liquidity except dead zone)
  METALS_CRYPTO: {
    category: "Metals & Crypto",
    profileKey: "METALS_CRYPTO",
    label: "Asia, London & NY",
    badgeColor: "#eab308", // Amber
    fullLabel: "Asia, London & New York",
    eetHoursLabel: "02:00 - 23:30 EET",
    symbols: ["XAUUSD", "GOLD", "XAGUSD", "SILVER", "BTCUSD", "ETHUSD", "SOLUSD"],
    startMinute: 120,     // 02:00 EET
    endMinute: 1410,      // 23:30 EET
    allowedSlotIds: [
      "asian_range",      // 02:00 - 08:00 EET
      "pre_london_prep",  // 08:00 - 10:00 EET
      "london_open",      // 10:00 - 13:00 EET
      "london_lunch",     // 13:00 - 15:00 EET
      "ny_open",          // 15:00 - 18:00 EET
      "ny_silver_bullet", // 17:00 - 18:00 EET
      "london_close",     // 18:00 - 20:00 EET
      "off_session_lull", // 20:00 - 21:00 & 23:00 - 23:30 EET
      "ny_pm",            // 21:00 - 23:00 EET
    ],
    description: "Global 24hr liquidity. Asian accumulation, London fix, and New York COMEX/spot delivery.",
  },

  // 4. European Forex Majors & Crosses: London and New York sessions (08:00 - 23:30 EET)
  EU_FOREX: {
    category: "European Forex",
    profileKey: "EU_FOREX",
    label: "London & NY",
    badgeColor: "#6366f1", // Indigo
    fullLabel: "London & New York Sessions",
    eetHoursLabel: "08:00 - 23:30 EET",
    symbols: ["EURUSD", "GBPUSD", "EURGBP", "EURCAD", "GBPCAD", "EURAUD", "GBPAUD", "USDCHF", "USDCAD"],
    startMinute: 480,     // 08:00 EET
    endMinute: 1410,      // 23:30 EET
    allowedSlotIds: [
      "pre_london_prep",  // 08:00 - 10:00 EET
      "london_open",      // 10:00 - 13:00 EET
      "london_lunch",     // 13:00 - 15:00 EET
      "ny_open",          // 15:00 - 18:00 EET
      "ny_silver_bullet", // 17:00 - 18:00 EET
      "london_close",     // 18:00 - 20:00 EET
      "off_session_lull", // 20:00 - 21:00 & 23:00 - 23:30 EET
      "ny_pm",            // 21:00 - 23:00 EET
    ],
    description: "European interbank flow and New York macro overlap. Asian session is low-liquidity accumulation.",
  },

  // 5. Yen Pairs & Asian Pacific: Asia and New York sessions (02:00 - 08:00 & 15:00 - 23:30 EET)
  ASIA_YEN_FOREX: {
    category: "Asian & Yen Forex",
    profileKey: "ASIA_YEN_FOREX",
    label: "Asia & NY",
    badgeColor: "#ec4899", // Pink
    fullLabel: "Asia & New York Sessions",
    eetHoursLabel: "02:00 - 08:00 & 15:00 - 23:30 EET",
    symbols: ["USDJPY", "AUDUSD", "NZDUSD", "AUDJPY"],
    windows: [[120, 480], [900, 1410]],
    allowedSlotIds: [
      "asian_range",      // 02:00 - 08:00 EET
      "ny_open",          // 15:00 - 18:00 EET
      "ny_silver_bullet", // 17:00 - 18:00 EET
      "london_close",     // 18:00 - 20:00 EET
      "off_session_lull", // 20:00 - 21:00 & 23:00 - 23:30 EET
      "ny_pm",            // 21:00 - 23:00 EET
    ],
    description: "Active Tokyo interbank session (02:00 - 08:00 EET) and New York USD flow (15:00 - 23:30 EET).",
  },

  // 6. Cross Yen pairs that trade across Asia, London & NY (02:00 - 23:30 EET)
  CROSS_YEN_FOREX: {
    category: "Yen Crosses",
    profileKey: "CROSS_YEN_FOREX",
    label: "Asia, London & NY",
    badgeColor: "#a855f7", // Purple
    fullLabel: "Asia, London & New York",
    eetHoursLabel: "02:00 - 23:30 EET",
    symbols: ["GBPJPY", "EURJPY"],
    startMinute: 120,     // 02:00 EET
    endMinute: 1410,      // 23:30 EET
    allowedSlotIds: [
      "asian_range",      // 02:00 - 08:00 EET
      "pre_london_prep",  // 08:00 - 10:00 EET
      "london_open",      // 10:00 - 13:00 EET
      "london_lunch",     // 13:00 - 15:00 EET
      "ny_open",          // 15:00 - 18:00 EET
      "ny_silver_bullet", // 17:00 - 18:00 EET
      "london_close",     // 18:00 - 20:00 EET
      "off_session_lull", // 20:00 - 21:00 & 23:00 - 23:30 EET
      "ny_pm",            // 21:00 - 23:00 EET
    ],
    description: "High volatility across Asian session and London/NY institutional cross flows.",
  },
};

/**
 * Extracts custom allowed slots for a symbol from config.symbolTimeSlots if configured.
 * @param {string} symbol
 * @param {Object} config
 * @returns {string[]|null}
 */
export function getCustomAllowedSlots(symbol, config = {}) {
  if (!symbol || !config?.symbolTimeSlots || typeof config.symbolTimeSlots !== "object") return null;
  const direct = config.symbolTimeSlots[symbol];
  if (Array.isArray(direct)) return direct;
  const upper = config.symbolTimeSlots[symbol.toUpperCase()];
  if (Array.isArray(upper)) return upper;
  const canon = config.symbolTimeSlots[canonOf(symbol)];
  if (Array.isArray(canon)) return canon;
  const base = config.symbolTimeSlots[baseOf(symbol)];
  if (Array.isArray(base)) return base;
  if (/^(US30|DJ30)/i.test(symbol)) {
    const alt = config.symbolTimeSlots.DJ30 || config.symbolTimeSlots.US30;
    if (Array.isArray(alt)) return alt;
  }
  return null;
}

/**
 * Resolves the institutional session profile and allowed trading windows for a given symbol.
 * Incorporates custom overrides from config.symbolTimeSlots if set by the user.
 * @param {string} symbol - e.g. "NAS100", "EURUSD.I", "GER40", "XAUUSD", "BTCUSD", "USDJPY"
 * @param {Object} [config] - optional autonomous configuration
 * @returns {Object} Session profile object with category, label, allowedSlotIds, and EET hours.
 */
export function getSymbolSessionProfile(symbol, config = {}) {
  if (!symbol) {
    return {
      category: "General Market",
      profileKey: "DEFAULT",
      label: "All Active Sessions",
      badgeColor: "#94a3b8",
      fullLabel: "All Active Sessions",
      eetHoursLabel: "08:00 - 23:00 EET",
      allowedSlotIds: ["pre_london_prep", "london_open", "ny_open", "ny_silver_bullet", "london_close", "ny_pm"],
      description: "Default institutional session hours.",
    };
  }

  const base = baseOf(symbol);
  const canon = canonOf(symbol);

  let profile = null;

  // 1. Direct symbol check in predefined profiles
  for (const p of Object.values(SYMBOL_SESSION_PROFILES)) {
    if (
      p.symbols.includes(canon) ||
      p.symbols.includes(base) ||
      p.symbols.includes(symbol.toUpperCase())
    ) {
      profile = { ...p, allowedSlotIds: [...p.allowedSlotIds] };
      break;
    }
  }

  if (!profile) {
    // 2. Heuristic classification for unlisted or custom broker symbols:
    if (/^(US|NAS|SPX|SP5|DJ|DOW|NDX|DAX|GER|FTSE|UK)/i.test(base)) {
      if (/^(GER|DAX|DE|UK|FTSE)/i.test(base)) profile = { ...SYMBOL_SESSION_PROFILES.EU_INDICES, allowedSlotIds: [...SYMBOL_SESSION_PROFILES.EU_INDICES.allowedSlotIds] };
      else profile = { ...SYMBOL_SESSION_PROFILES.US_INDICES, allowedSlotIds: [...SYMBOL_SESSION_PROFILES.US_INDICES.allowedSlotIds] };
    } else if (/^(BTC|ETH|SOL|XAU|GOLD|XAG|SILVER)/i.test(base)) {
      profile = { ...SYMBOL_SESSION_PROFILES.METALS_CRYPTO, allowedSlotIds: [...SYMBOL_SESSION_PROFILES.METALS_CRYPTO.allowedSlotIds] };
    } else if (base.endsWith("JPY") || base.startsWith("AUD") || base.startsWith("NZD")) {
      if (base.startsWith("GBP") || base.startsWith("EUR")) {
        profile = { ...SYMBOL_SESSION_PROFILES.CROSS_YEN_FOREX, allowedSlotIds: [...SYMBOL_SESSION_PROFILES.CROSS_YEN_FOREX.allowedSlotIds] };
      } else {
        profile = { ...SYMBOL_SESSION_PROFILES.ASIA_YEN_FOREX, allowedSlotIds: [...SYMBOL_SESSION_PROFILES.ASIA_YEN_FOREX.allowedSlotIds] };
      }
    } else {
      profile = { ...SYMBOL_SESSION_PROFILES.EU_FOREX, allowedSlotIds: [...SYMBOL_SESSION_PROFILES.EU_FOREX.allowedSlotIds] };
    }
  }

  // 3. Dynamically align profile to user-configured effective time slots
  if (config && typeof config === "object") {
    const eff = getEffectiveTimeSlots(config);
    if (profile.profileKey === "US_INDICES") {
      if (eff.NEW_YORK_AM) {
        profile.startMinute = eff.NEW_YORK_AM.startMinute;
        profile.endMinute = eff.NEW_YORK_PM?.endMinute ?? 1410;
        profile.eetHoursLabel = `${formatMinutesToTime(profile.startMinute)} - ${formatMinutesToTime(profile.endMinute)} EET`;
        profile.fullLabel = `New York Sessions (${profile.eetHoursLabel})`;
      }
      if (config.allowedTimeSlots?.pre_ny_prep === true && !profile.allowedSlotIds.includes("pre_ny_prep")) {
        profile.allowedSlotIds.push("pre_ny_prep");
      }
    } else if (profile.profileKey === "EU_INDICES") {
      if (eff.LONDON_OPEN) {
        profile.startMinute = eff.LONDON_OPEN.startMinute;
        profile.endMinute = eff.NEW_YORK_PM?.endMinute ?? 1410;
        profile.eetHoursLabel = `${formatMinutesToTime(profile.startMinute)} - ${formatMinutesToTime(profile.endMinute)} EET`;
        profile.fullLabel = `London & New York Sessions (${profile.eetHoursLabel})`;
      }
      if (config.allowedTimeSlots?.pre_ny_prep === true && !profile.allowedSlotIds.includes("pre_ny_prep")) {
        profile.allowedSlotIds.push("pre_ny_prep");
      }
    } else if (profile.profileKey === "METALS_CRYPTO" || profile.profileKey === "EU_FOREX" || profile.profileKey === "ASIA_YEN_FOREX") {
      if (config.allowedTimeSlots?.pre_ny_prep === true && !profile.allowedSlotIds.includes("pre_ny_prep")) {
        profile.allowedSlotIds.push("pre_ny_prep");
      }
    }
  }

  // 4. Apply custom user overrides from config.symbolTimeSlots if configured
  const custom = getCustomAllowedSlots(symbol, config);
  if (custom && Array.isArray(custom)) {
    profile.allowedSlotIds = custom;
    profile.isCustomized = true;
    profile.label = `${custom.length} Custom Slot${custom.length === 1 ? "" : "s"}`;
  }

  // 5. Filter out any slots deleted by user in configuration
  if (config?.deletedTimeSlots && Array.isArray(config.deletedTimeSlots) && config.deletedTimeSlots.length > 0) {
    const deleted = new Set(config.deletedTimeSlots);
    profile.allowedSlotIds = profile.allowedSlotIds.filter((id) => !deleted.has(id));
  }

  return profile;
}

/**
 * Checks if a specific symbol is permitted to trade in a specific time slot ID.
 * @param {string} symbol
 * @param {string} slotId
 * @param {Object} [config]
 * @returns {boolean}
 */
export function isSymbolPermittedInSlot(symbol, slotId, config = {}) {
  if (!symbol || !slotId) return false;
  if (slotId === "dead_zone") return false;
  const deleted = new Set(config?.deletedTimeSlots || []);
  if (deleted.has(slotId)) return false;
  const profile = getSymbolSessionProfile(symbol, config);
  if (!profile.allowedSlotIds || profile.allowedSlotIds.length === 0) return false;
  if (profile.allowedSlotIds.includes(slotId)) return true;
  if (profile.isCustomized) {
    if (slotId === "off_session_lull") {
      return (
        profile.allowedSlotIds.includes("ny_open") ||
        profile.allowedSlotIds.includes("ny_pm") ||
        profile.allowedSlotIds.includes("london_close")
      );
    }
    if (slotId === "london_lunch") {
      return (
        profile.allowedSlotIds.includes("london_open") ||
        profile.allowedSlotIds.includes("london_close")
      );
    }
    return false;
  }
  if (slotId === "off_session_lull") {
    return (
      profile.allowedSlotIds.includes("ny_open") ||
      profile.allowedSlotIds.includes("ny_pm") ||
      profile.allowedSlotIds.includes("london_close") ||
      profile.profileKey === "US_INDICES" ||
      profile.profileKey === "EU_INDICES" ||
      profile.profileKey === "METALS_CRYPTO" ||
      profile.profileKey === "EU_FOREX" ||
      profile.profileKey === "CROSS_YEN_FOREX" ||
      profile.profileKey === "ASIA_YEN_FOREX"
    );
  }
  if (slotId === "london_lunch") {
    return (
      profile.allowedSlotIds.includes("london_open") ||
      profile.allowedSlotIds.includes("london_close") ||
      profile.profileKey === "EU_INDICES" ||
      profile.profileKey === "EU_FOREX" ||
      profile.profileKey === "METALS_CRYPTO" ||
      profile.profileKey === "CROSS_YEN_FOREX"
    );
  }
  return false;
}

/**
 * Validates if order entry is permitted right now based on active time slot,
 * global user config, and symbol-specific session profiles.
 * @param {Date|Object|number} input - current time, bar object, or epoch seconds
 * @param {Object} config - autonomous configuration
 * @param {string|null} symbol - optional symbol to apply institutional asset gating
 * @returns {Object} { permitted: boolean, reason: string, slot: Object, profile?: Object }
 */
export function isTradingPermittedNow(input = new Date(), config = {}, symbol = null) {
  const eet = getEetTime(input);
  if (!Number.isFinite(eet.totalMinutes)) {
    return { permitted: false, reason: "Trading blocked: invalid execution clock.", isInvalidClock: true, slot: null };
  }
  const { totalMinutes } = eet;
  const eff = getEffectiveTimeSlots(config);

  // 1. Strict Dead Zone Check (Spread Protection across ALL symbols)
  if (totalMinutes < eff.DEAD_ZONE.endMinute || totalMinutes >= 1410) {
    const deadSlot = enrichSlot(eff.DEAD_ZONE, totalMinutes);
    return {
      permitted: false,
      isDeadZone: true,
      reason: `Trading Blocked: Market is in Dead Zone / Rollover (${deadSlot.eetRange}).`,
      slot: deadSlot,
    };
  }

  // 2. Multi-Session Overlap Resolution:
  // Gather all candidate active non-deadzone sessions covering current time
  const candidates = getAllActiveSlotsAt(input, config).filter((s) => s.id !== "dead_zone");
  const enabledSlots = candidates.filter((s) => isSlotActiveAndAllowed(s, config));

  const primarySlot = getCurrentTimeSlot(input, config);

  // If there are candidate sessions, but ALL of them are disabled in user configuration:
  if (candidates.length > 0 && enabledSlots.length === 0) {
    const names = candidates.map((c) => `'${c.name}'`).join(" and ");
    return {
      permitted: false,
      isUserSlotDisabled: true,
      reason: `Trading Blocked: ${names} (${candidates[0].eetRange}) are disabled in user configuration.`,
      slot: primarySlot,
    };
  }

  // If no canonical session covers this time (off-session lull period)
  if (candidates.length === 0) {
    if (!primarySlot.tradingAllowedByDefault && config?.allowedTimeSlots?.[primarySlot.id] !== true) {
      return {
        permitted: false,
        isOffSession: true,
        reason: `Trading Blocked: ${primarySlot.name} is disabled by default.`,
        slot: primarySlot,
      };
    }
  }

  // 3. Institutional Symbol-Specific Session Gating (Active by default)
  if (symbol && config?.enforceSymbolSessions !== false) {
    const profile = getSymbolSessionProfile(symbol, config);

    // If user explicitly unticked all sessions for this symbol, strictly forbid trading 24/7!
    const PRIMARY_SESSION_SLOTS = [
      "asian_range", "pre_london_prep", "london_open", "london_lunch",
      "pre_ny_prep", "ny_open", "ny_silver_bullet", "london_close", "ny_pm"
    ];
    const hasPrimarySession = (profile.allowedSlotIds || []).some((s) => PRIMARY_SESSION_SLOTS.includes(s));

    if (!profile.allowedSlotIds || profile.allowedSlotIds.length === 0 || !hasPrimarySession) {
      return {
        permitted: false,
        isOffSession: true,
        profile,
        slot: primarySlot,
        reason: `Trading Blocked: All trading sessions are disabled for ${symbol} in configuration.`,
      };
    }

    // Strict Institutional Lockout: US Equities/Indices are strictly forbidden during European/Asian morning & lunch sessions
    const isUsIndex = /^(NAS100|US30|DJ30|US500|SP500|SPX500)$/i.test(canonOf(symbol));
    if (!config?.allowLondonForIndices && isUsIndex) {
      // Check if any enabled active slot is a valid US session
      const hasUsSession = enabledSlots.some((s) => ["ny_open", "ny_silver_bullet", "ny_pm", "london_close"].includes(s.id));
      if (!hasUsSession && enabledSlots.some((s) => ["asian_range", "pre_london_prep", "london_open", "london_lunch"].includes(s.id))) {
        return {
          permitted: false,
          isOffSession: true,
          profile,
          slot: primarySlot,
          reason: `Trading Blocked: US Index ${symbol} is restricted to New York trading sessions (${profile.eetHoursLabel || "New York Sessions"}).`,
        };
      }
    }

    // Harmonize matching allowed slot across ALL enabled candidate slots:
    // If ANY active enabled slot covering this minute is allowed for this symbol, permit trading!
    let matchingAllowedSlot = enabledSlots.find((s) => profile.allowedSlotIds.includes(s.id));

    // Dynamic resolution for interstitial lull periods (20:00 - 21:00 & 23:00 - 23:30 EET)
    // and midday lunch periods (13:00 - 15:00 EET):
    if (!matchingAllowedSlot && !profile.isCustomized) {
      if (primarySlot.id === "off_session_lull") {
        if (totalMinutes >= 900 && totalMinutes < 1410) {
          if (
            profile.allowedSlotIds.includes("ny_open") ||
            profile.allowedSlotIds.includes("ny_pm") ||
            profile.allowedSlotIds.includes("london_close") ||
            ["US_INDICES", "EU_INDICES", "METALS_CRYPTO", "EU_FOREX", "CROSS_YEN_FOREX", "ASIA_YEN_FOREX"].includes(profile.profileKey)
          ) {
            matchingAllowedSlot = primarySlot;
          }
        }
      } else if (primarySlot.id === "london_lunch") {
        if (totalMinutes >= 780 && totalMinutes < 900) {
          if (
            profile.allowedSlotIds.includes("london_open") ||
            profile.allowedSlotIds.includes("london_close") ||
            ["EU_INDICES", "EU_FOREX", "METALS_CRYPTO", "CROSS_YEN_FOREX"].includes(profile.profileKey)
          ) {
            matchingAllowedSlot = primarySlot;
          }
        }
      }
    } else if (!matchingAllowedSlot && profile.isCustomized) {
      // For customized profiles, allow lull/lunch strictly if active parent sessions are enabled
      if (primarySlot.id === "off_session_lull" && totalMinutes >= 900 && totalMinutes < 1410) {
        if (
          profile.allowedSlotIds.includes("ny_open") ||
          profile.allowedSlotIds.includes("ny_pm") ||
          profile.allowedSlotIds.includes("london_close")
        ) {
          matchingAllowedSlot = primarySlot;
        }
      } else if (primarySlot.id === "london_lunch" && totalMinutes >= 780 && totalMinutes < 900) {
        if (
          profile.allowedSlotIds.includes("london_open") ||
          profile.allowedSlotIds.includes("london_close")
        ) {
          matchingAllowedSlot = primarySlot;
        }
      }
    }

    if (!matchingAllowedSlot) {
      return {
        permitted: false,
        isOffSession: true,
        profile,
        slot: primarySlot,
        reason: `Off-Session Gating: ${symbol} (${profile.category}) is restricted to ${profile.fullLabel} (${profile.eetHoursLabel}). Current slot '${primarySlot.name}' (${primarySlot.eetRange}) is inactive for this asset.`,
      };
    }

    return {
      permitted: true,
      reason: `Trading Approved: Active slot '${matchingAllowedSlot.name}' (${matchingAllowedSlot.eetRange}).`,
      slot: matchingAllowedSlot,
      profile,
    };
  }

  const activeSlot = enabledSlots[0] || primarySlot;
  return {
    permitted: true,
    reason: `Trading Approved: Active slot '${activeSlot.name}' (${activeSlot.eetRange}).`,
    slot: activeSlot,
    profile: null,
  };
}

/**
 * Resolves the institutional time slot for a historical candle bar or timestamp.
 * In TradeSpace, MT5 candle timestamps are natively in EET (Broker Server Time),
 * so passing the bar directly resolves into the exact matching institutional slot.
 * @param {Object|number} bar - Candle bar object ({ time, ... } or { t, ... }) or timestamp
 * @returns {Object} Active time slot
 */
export function getTimeSlotForBar(bar, config = {}) {
  if (bar && typeof bar === "object" && bar.timestampSemantics == null) {
    return getCurrentTimeSlot({ ...bar, timestampSemantics: "BROKER_NAIVE" }, config);
  }
  return getCurrentTimeSlot(bar, config);
}

/**
 * Resolves the dynamic adaptive scan schedule interval based on current market time (EET)
 * and user configuration. Peak volume windows (first 2-3h of major sessions) use fastIntervalMinutes (e.g. 5m);
 * off-peak and lull hours use standardIntervalMinutes (e.g. 15m).
 *
 * @param {Date|Object|number} [input=new Date()]
 * @param {Object} [config={}]
 * @returns {{ isPeak: boolean, activeSessionName: string, minutesRemainingInPeak: number, effectiveIntervalMin: number }}
 */
export function getAdaptiveScheduleWindow(input = new Date(), config = {}) {
  const eet = getEetTime(input);
  const totalMinutes = eet.totalMinutes;
  const fastCfg = config?.fastScheduleConfig || {};
  const isAdaptiveEnabled = fastCfg.enabled !== false;
  const fastMin = Math.max(1, Math.min(60, Number(fastCfg.fastIntervalMinutes) || 5));
  const stdMin = Math.max(1, Math.min(120, Number(fastCfg.standardIntervalMinutes) || 15));

  if (!isAdaptiveEnabled) {
    return {
      isPeak: true,
      activeSessionName: "Fixed Cadence",
      minutesRemainingInPeak: 0,
      effectiveIntervalMin: fastMin,
    };
  }

  const eff = getEffectiveTimeSlots(config);
  const asianPeakHours = Number(fastCfg.asianPeakHours ?? 2);
  const londonPeakHours = Number(fastCfg.londonPeakHours ?? 2);
  const newyorkPeakHours = Number(fastCfg.newyorkPeakHours ?? 3);

  // 1. Asian Session Peak (starts at eff.ASIAN_RANGE.startMinute, extends for asianPeakHours)
  if (eff.ASIAN_RANGE && isSlotActiveAndAllowed(eff.ASIAN_RANGE, config) && asianPeakHours > 0) {
    const start = eff.ASIAN_RANGE.startMinute;
    const end = Math.min(eff.ASIAN_RANGE.endMinute, start + (asianPeakHours * 60));
    if (totalMinutes >= start && totalMinutes < end) {
      return {
        isPeak: true,
        activeSessionName: `Asian Session Peak (First ${asianPeakHours}h)`,
        minutesRemainingInPeak: end - totalMinutes,
        effectiveIntervalMin: fastMin,
      };
    }
  }

  // 2. London Session Peak (starts at eff.LONDON_OPEN.startMinute, extends for londonPeakHours)
  if (eff.LONDON_OPEN && isSlotActiveAndAllowed(eff.LONDON_OPEN, config) && londonPeakHours > 0) {
    const start = eff.LONDON_OPEN.startMinute;
    const end = Math.min(eff.LONDON_OPEN.endMinute, start + (londonPeakHours * 60));
    if (totalMinutes >= start && totalMinutes < end) {
      return {
        isPeak: true,
        activeSessionName: `London Open Peak (First ${londonPeakHours}h)`,
        minutesRemainingInPeak: end - totalMinutes,
        effectiveIntervalMin: fastMin,
      };
    }
  }

  // 3. New York Session Peak (starts at eff.NEW_YORK_AM.startMinute, extends for newyorkPeakHours)
  if (eff.NEW_YORK_AM && isSlotActiveAndAllowed(eff.NEW_YORK_AM, config) && newyorkPeakHours > 0) {
    const start = eff.NEW_YORK_AM.startMinute;
    const end = Math.min(eff.NEW_YORK_PM?.endMinute ?? 1410, start + (newyorkPeakHours * 60));
    if (totalMinutes >= start && totalMinutes < end) {
      return {
        isPeak: true,
        activeSessionName: `New York Session Peak (First ${newyorkPeakHours}h)`,
        minutesRemainingInPeak: end - totalMinutes,
        effectiveIntervalMin: fastMin,
      };
    }
  }

  // Outside configured peak hours -> standard relaxed interval (15m)
  return {
    isPeak: false,
    activeSessionName: "Off-Peak / Lull Interval",
    minutesRemainingInPeak: 0,
    effectiveIntervalMin: stdMin,
  };
}
