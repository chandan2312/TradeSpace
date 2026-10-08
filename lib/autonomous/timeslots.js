// Institutional Trading Time Slots & Killzone Engine (EET / Broker Server Time Standard)
// Sessions use Europe/Athens (EET/EEST). Wall-clock inputs are UTC instants;
// broker-naive bars must explicitly carry timestampSemantics: BROKER_NAIVE.

import { baseOf, canonOf } from "./symbols.js";

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
      turtle_soup: 35,        // Prime for Asian high/low raids
      ict_2022: 30,           // Judas swing + MSS + FVG
      breaker_block: 25,
      ote_continuation: 20,
      silver_bullet: 15,
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
      ict_2022: 35,
      silver_bullet: 30,
      breaker_block: 30,
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
  const ms = numeric && value < 1e11 ? value * 1000 : value;
  const semantics = isBar ? input.timestampSemantics || options.timestampSemantics : options.timestampSemantics;
  // Legacy broker clocks are opt-in. The canonical data feed converts them to UTC.
  if (semantics === "BROKER_NAIVE" && numeric) {
    const date = new Date(ms);
    const h = date.getUTCHours(), m = date.getUTCMinutes(), s = date.getUTCSeconds();
    return { h, m, s, totalMinutes: h * 60 + m };
  }
  const date = value instanceof Date ? value : new Date(ms);
  try {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Athens",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const s = parseInt(parts.find((p) => p.type === "second")?.value ?? "0", 10);
    return { h, m, s, totalMinutes: h * 60 + m };
  } catch {
    return { h: NaN, m: NaN, s: NaN, totalMinutes: NaN };
  }
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
  }

  return effective;
}

/**
 * Returns the currently active time slot object based on EET (Broker Server Time)
 * and optional user configuration with custom session timings.
 * @param {Date|Object|number} input
 * @param {Object} [config]
 * @returns {Object} Active time slot with metadata and countdown
 */
export function getCurrentTimeSlot(input = new Date(), config = {}) {
  const { totalMinutes } = getEetTime(input);
  const eff = getEffectiveTimeSlots(config);

  // 1. New York Silver Bullet Window (ICT 60-min window)
  if (totalMinutes >= eff.NY_SILVER_BULLET.startMinute && totalMinutes < eff.NY_SILVER_BULLET.endMinute) {
    return enrichSlot(eff.NY_SILVER_BULLET, totalMinutes);
  }

  // 2. Rollover Dead Zone (00:00 - 02:00 EET or 23:30 - 24:00 EET)
  if (totalMinutes < eff.DEAD_ZONE.endMinute || totalMinutes >= 1410) {
    return enrichSlot(eff.DEAD_ZONE, totalMinutes);
  }

  // 3. New York PM Killzone (21:00 - 23:00 EET)
  if (totalMinutes >= eff.NEW_YORK_PM.startMinute && totalMinutes < eff.NEW_YORK_PM.endMinute) {
    return enrichSlot(eff.NEW_YORK_PM, totalMinutes);
  }

  // 4. London Close Killzone (18:00 - 20:00 EET)
  if (totalMinutes >= eff.LONDON_CLOSE.startMinute && totalMinutes < eff.LONDON_CLOSE.endMinute) {
    return enrichSlot(eff.LONDON_CLOSE, totalMinutes);
  }

  // 5. New York AM / Main Session Killzone (16:25 - 20:30 EET)
  if (totalMinutes >= eff.NEW_YORK_AM.startMinute && totalMinutes < eff.NEW_YORK_AM.endMinute) {
    return enrichSlot(eff.NEW_YORK_AM, totalMinutes);
  }

  // 6. Pre-New York Session Setup (15:00 - 16:25 EET)
  const preNy = eff.PRE_NY_PREP;
  if (preNy && totalMinutes >= preNy.startMinute && totalMinutes < preNy.endMinute) {
    return enrichSlot(preNy, totalMinutes);
  }

  // 7. London Lunch Lull (13:00 - 15:00 EET)
  if (totalMinutes >= eff.LONDON_LUNCH.startMinute && totalMinutes < eff.LONDON_LUNCH.endMinute) {
    return enrichSlot(eff.LONDON_LUNCH, totalMinutes);
  }

  // 8. London Open Killzone (10:00 - 13:00 EET)
  if (totalMinutes >= eff.LONDON_OPEN.startMinute && totalMinutes < eff.LONDON_OPEN.endMinute) {
    return { ...enrichSlot(eff.LONDON_OPEN, totalMinutes), isSilverBullet: totalMinutes < (eff.LONDON_OPEN.startMinute + 60) };
  }

  // 9. Pre-London Prep (08:00 - 10:00 EET)
  const preLdn = eff.PRE_LONDON_PREP;
  if (preLdn && totalMinutes >= preLdn.startMinute && totalMinutes < preLdn.endMinute) {
    return enrichSlot(preLdn, totalMinutes);
  }

  // 10. Asian Close / Pre-European Lull (between Asia end and Pre-London start)
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

  // 11. Asian Range Accumulation (02:00 - 06:00 EET)
  if (totalMinutes >= eff.ASIAN_RANGE.startMinute && totalMinutes < eff.ASIAN_RANGE.endMinute) {
    return enrichSlot(eff.ASIAN_RANGE, totalMinutes);
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
 * with any user-configured custom timings applied.
 * @param {Object} [config]
 * @returns {Array<Object>}
 */
export function getAllTimeSlots(config = {}) {
  const eff = getEffectiveTimeSlots(config);
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
  ].filter(Boolean);
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

  // 3. Apply custom user overrides from config.symbolTimeSlots if configured
  const custom = getCustomAllowedSlots(symbol, config);
  if (custom && Array.isArray(custom)) {
    profile.allowedSlotIds = custom;
    profile.isCustomized = true;
    profile.label = `${custom.length} Custom Slot${custom.length === 1 ? "" : "s"}`;
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
  const profile = getSymbolSessionProfile(symbol, config);
  if (profile.allowedSlotIds.includes(slotId)) return true;
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
  const slot = getCurrentTimeSlot(input, config);

  // 1. Strict Dead Zone Check (Spread Protection across ALL symbols)
  if (slot.isDeadZone) {
    return {
      permitted: false,
      isDeadZone: true,
      reason: `Trading Blocked: Market is in Dead Zone / Rollover (${slot.eetRange}).`,
      slot,
    };
  }

  if (config?.allowedTimeSlots?.[slot.id] !== true && !slot.tradingAllowedByDefault) {
    return { permitted: false, reason: `Trading Blocked: ${slot.name} is disabled by default.`, slot };
  }

  // 2. User Time Slot Filter Check
  if (config?.allowedTimeSlots && typeof config.allowedTimeSlots === "object") {
    if (config.allowedTimeSlots[slot.id] === false) {
      return {
        permitted: false,
        isUserSlotDisabled: true,
        reason: `Trading Blocked: Time slot '${slot.name}' (${slot.eetRange}) is disabled in user configuration.`,
        slot,
      };
    }
  }

  // 3. Fallback to legacy sessionFilters if allowedTimeSlots not defined
  if (config?.sessionFilters) {
    if (slot.id === "asian_range" && config.sessionFilters.asia === false) {
      return { permitted: false, isUserSlotDisabled: true, reason: "Trading Blocked: Asian session disabled.", slot };
    }
    if ((slot.id === "london_open" || slot.id === "london_lunch" || slot.id === "london_close") && config.sessionFilters.london === false) {
      return { permitted: false, isUserSlotDisabled: true, reason: "Trading Blocked: London session disabled.", slot };
    }
    if ((slot.id === "ny_open" || slot.id === "ny_silver_bullet" || slot.id === "ny_pm") && config.sessionFilters.newyork === false) {
      return { permitted: false, isUserSlotDisabled: true, reason: "Trading Blocked: New York session disabled.", slot };
    }
  }

  // 4. Institutional Symbol-Specific Session Gating (Active by default)
  if (symbol && config?.enforceSymbolSessions !== false) {
    const profile = getSymbolSessionProfile(symbol, config);
    let isSlotAllowedForSymbol = profile.allowedSlotIds.includes(slot.id);

    // Dynamic resolution for interstitial lull periods (20:00 - 21:00 & 23:00 - 23:30 EET)
    // and midday lunch periods (13:00 - 15:00 EET):
    // When slot is off_session_lull or london_lunch within a symbol's continuous operational window,
    // allow symbols configured for those institutional sessions.
    if (!isSlotAllowedForSymbol) {
      if (slot.id === "off_session_lull") {
        // Interstitial evening lulls (20:00 - 21:00 EET & 23:00 - 23:30 EET):
        // Active throughout the New York trading window (15:00 - 23:30 EET)
        if (totalMinutes >= 900 && totalMinutes < 1410) {
          if (
            profile.allowedSlotIds.includes("ny_open") ||
            profile.allowedSlotIds.includes("ny_pm") ||
            profile.allowedSlotIds.includes("london_close") ||
            profile.profileKey === "US_INDICES" ||
            profile.profileKey === "EU_INDICES" ||
            profile.profileKey === "METALS_CRYPTO" ||
            profile.profileKey === "EU_FOREX" ||
            profile.profileKey === "CROSS_YEN_FOREX" ||
            profile.profileKey === "ASIA_YEN_FOREX"
          ) {
            isSlotAllowedForSymbol = true;
          }
        }
      } else if (slot.id === "london_lunch") {
        // London lunch lull (13:00 - 15:00 EET):
        // European daytime trading (08:00 - 20:00 EET)
        if (totalMinutes >= 780 && totalMinutes < 900) {
          if (
            profile.allowedSlotIds.includes("london_open") ||
            profile.allowedSlotIds.includes("london_close") ||
            profile.profileKey === "EU_INDICES" ||
            profile.profileKey === "EU_FOREX" ||
            profile.profileKey === "METALS_CRYPTO" ||
            profile.profileKey === "CROSS_YEN_FOREX"
          ) {
            isSlotAllowedForSymbol = true;
          }
        }
      }
    }

    if (!isSlotAllowedForSymbol) {
      return {
        permitted: false,
        isOffSession: true,
        profile,
        slot,
        reason: `Off-Session Gating: ${symbol} (${profile.category}) is restricted to ${profile.fullLabel} (${profile.eetHoursLabel}). Current slot '${slot.name}' (${slot.eetRange}) is inactive for this asset.`,
      };
    }
  }

  return {
    permitted: true,
    reason: `Trading Approved: Active slot '${slot.name}' (${slot.eetRange}).`,
    slot,
    profile: symbol ? getSymbolSessionProfile(symbol, config) : null,
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
