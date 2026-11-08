/**
 * lib/time.js
 *
 * TradeSpace Authoritative Time, Timezone & Session Engine.
 *
 * THE 2 IMMUTABLE TIME LAWS OF TRADESPACE:
 * 1. DATA LAYER (Storage, Feeds, Bars, Ticks):
 *    All timestamps are STRICTLY UTC Epoch seconds (or milliseconds).
 *    Never store, emit, or expect timestamps in broker or local time.
 *    Every bar has `time` (UTC seconds) and `timestampSemantics: "UTC_INSTANT"`.
 *
 * 2. TRADING & SESSION LOGIC (Sessions, Killzones, Daily Boundaries):
 *    All trading hours, killzones, daily candle boundaries, and intraday sessions
 *    are STRICTLY evaluated in `Europe/Athens` (EET / EEST = UTC+2 in winter, UTC+3 in summer).
 *
 * Why Europe/Athens?
 * Europe/Athens midnight (00:00:00) exactly aligns with 5:00 PM New York (the global Forex/Futures
 * market close) across all 52 weeks of the year, preventing the creation of artificial "Sunday candles"
 * and synchronizing US & European Daylight Saving Time (DST).
 *
 * STRICT PROHIBITIONS:
 * - NEVER do `time % 86400` or `time % DAY` to determine hours or days.
 * - NEVER call `date.getHours()` or `date.getUTCHours()` to classify trading sessions or killzones.
 * - NEVER hardcode static UTC offsets (e.g. `+2` or `+3`) without dynamic DST awareness.
 */

export const BROKER_TIMEZONE = "Europe/Athens";
export const DAY_SEC = 86400;

// Reusable Date formatters for Europe/Athens
const dtfEet = new Intl.DateTimeFormat("en-GB", {
  timeZone: BROKER_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dtfDateOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: BROKER_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Cache for dynamic DST offsets: dayIndex (epochSec / 86400) -> offset in seconds (+7200 or +10800)
const offsetCache = new Map();

/**
 * Returns dynamic Europe/Athens UTC offset in seconds (+7200 in winter, +10800 in summer).
 * Fast O(1) cached lookup; fully DST-aware.
 * @param {number} epochSec - UTC epoch seconds
 * @returns {number} Offset in seconds
 */
export function getEetOffsetSec(epochSec) {
  if (typeof epochSec !== "number" || !Number.isFinite(epochSec)) return 7200;
  const dayIdx = Math.floor(epochSec / DAY_SEC);
  let offset = offsetCache.get(dayIdx);
  if (offset !== undefined) return offset;

  try {
    const date = new Date(epochSec * 1000);
    const parts = Object.fromEntries(dtfEet.formatToParts(date).map((p) => [p.type, p.value]));
    const localUtcMs = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    offset = Math.round((localUtcMs - date.getTime()) / 1000);
  } catch {
    offset = 7200; // Fallback to standard EET (UTC+2)
  }

  // Prevent map from growing unbounded in multi-year backtests
  if (offsetCache.size > 20000) offsetCache.clear();
  offsetCache.set(dayIdx, offset);
  return offset;
}

/**
 * Normalizes any timestamp, Date, or bar object into UTC Epoch seconds.
 * @param {Date|number|string|object} input
 * @returns {number} UTC epoch seconds
 */
export function toUtcSec(input) {
  if (input == null) return NaN;
  if (typeof input === "number") {
    return input > 1e11 ? Math.floor(input / 1000) : Math.floor(input);
  }
  if (input instanceof Date) {
    return Math.floor(input.getTime() / 1000);
  }
  if (typeof input === "object") {
    const raw = input.time ?? input.t ?? input.timestamp;
    if (typeof raw === "number") {
      return raw > 1e11 ? Math.floor(raw / 1000) : Math.floor(raw);
    }
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    const n = Number(input);
    if (Number.isFinite(n)) return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
  }
  return NaN;
}

/**
 * Normalizes any timestamp, Date, or bar object into UTC Epoch milliseconds.
 * @param {Date|number|string|object} input
 * @returns {number} UTC epoch milliseconds
 */
export function toUtcMs(input) {
  const sec = toUtcSec(input);
  return Number.isFinite(sec) ? sec * 1000 : NaN;
}

/**
 * Extracts exact Europe/Athens (EET/EEST) hours, minutes, seconds, and total minutes.
 * Handles Date objects, timestamps (sec or ms), or bar objects.
 * @param {Date|number|string|object} [input=new Date()]
 * @returns {{ h: number, m: number, s: number, totalMinutes: number }}
 */
export function getEetTime(input = new Date()) {
  const sec = toUtcSec(input);
  if (!Number.isFinite(sec)) {
    return { h: NaN, m: NaN, s: NaN, totalMinutes: NaN };
  }

  const offset = getEetOffsetSec(sec);
  const totalLocalSec = ((sec + offset) % DAY_SEC + DAY_SEC) % DAY_SEC;
  const h = Math.floor(totalLocalSec / 3600);
  const m = Math.floor((totalLocalSec % 3600) / 60);
  const s = totalLocalSec % 60;
  return { h, m, s, totalMinutes: h * 60 + m };
}

/**
 * Returns integer trading day key in Europe/Athens (e.g. 19742).
 * The trading day rolls over at 00:00:00 Europe/Athens (= 17:00 New York Close).
 * Every bar in the same 24-hour ICT trading day returns the EXACT same key.
 * @param {Date|number|string|object} input
 * @returns {number}
 */
export function getTradingDayKey(input) {
  const sec = toUtcSec(input);
  if (!Number.isFinite(sec)) return NaN;
  const offset = getEetOffsetSec(sec);
  return Math.floor((sec + offset) / DAY_SEC);
}

/**
 * Returns string trading date in Europe/Athens (e.g. "2026-11-07").
 * @param {Date|number|string|object} input
 * @returns {string}
 */
export function getTradingDateString(input) {
  const ms = toUtcMs(input);
  if (!Number.isFinite(ms)) return "";
  try {
    const parts = Object.fromEntries(dtfDateOnly.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return "";
  }
}

/**
 * Returns the UTC epoch seconds for 00:00:00 Europe/Athens of the input's trading day.
 * @param {Date|number|string|object} [input=new Date()]
 * @returns {number} UTC epoch seconds
 */
export function getTradingDayStartSec(input = new Date()) {
  const sec = toUtcSec(input);
  if (!Number.isFinite(sec)) return NaN;
  const offset = getEetOffsetSec(sec);
  const dayIndex = Math.floor((sec + offset) / DAY_SEC);
  const midnightLocalSec = dayIndex * DAY_SEC;
  return midnightLocalSec - offset;
}

/**
 * Returns the day of the week (0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday)
 * evaluated in Europe/Athens.
 * @param {Date|number|string|object} [input=new Date()]
 * @returns {number} 0-6
 */
export function getEetDayOfWeek(input = new Date()) {
  const sec = toUtcSec(input);
  if (!Number.isFinite(sec)) return NaN;
  const offset = getEetOffsetSec(sec);
  // Unix Epoch (1970-01-01) was a Thursday (day 4)
  const dayIndex = Math.floor((sec + offset) / DAY_SEC);
  return (((dayIndex + 4) % 7) + 7) % 7;
}

/**
 * Canonical Institutional Sessions & Killzones (EET / Europe/Athens).
 */
export const SESSIONS = [
  { id: "dead_zone", label: "Dead Zone", from: 0, to: 2, isKillzone: false },
  { id: "asia", label: "Asia", from: 2, to: 6, isKillzone: false },
  { id: "pre_london", label: "Pre-London", from: 8, to: 10, isKillzone: false },
  { id: "london", label: "London", from: 10, to: 13, isKillzone: true },
  { id: "london_lunch", label: "London Lunch", from: 13, to: 15, isKillzone: false },
  { id: "pre_ny", label: "Pre-NY", from: 15, to: 16.417, isKillzone: false }, // 16:25 EET
  { id: "ny", label: "New York", from: 16.417, to: 20.5, isKillzone: true },   // 16:25 - 20:30 EET
  { id: "ny_pm", label: "New York PM", from: 21, to: 23, isKillzone: true },
];

/**
 * Classifies the institutional session for a timestamp.
 * Returns { id, label, isKillzone }.
 * @param {Date|number|string|object} input
 * @returns {{ id: string, label: string, isKillzone: boolean }}
 */
export function sessionOf(input) {
  const { totalMinutes } = getEetTime(input);
  if (!Number.isFinite(totalMinutes)) return { id: "off", label: "Off-hours", isKillzone: false };

  const hourDecimal = totalMinutes / 60;

  // 1. London Open Killzone (10:00 - 13:00 EET)
  if (hourDecimal >= 10 && hourDecimal < 13) {
    return { id: "london", label: "London", isKillzone: true };
  }

  // 2. New York Session / AM Killzone (16:25 - 20:30 EET)
  if (hourDecimal >= (16 + 25 / 60) && hourDecimal < 20.5) {
    return { id: "ny", label: "New York", isKillzone: true };
  }

  // 3. Asian Range (02:00 - 06:00 EET)
  if (hourDecimal >= 2 && hourDecimal < 6) {
    return { id: "asia", label: "Asia", isKillzone: false };
  }

  // 4. Pre-London / Frankfurt (08:00 - 10:00 EET)
  if (hourDecimal >= 8 && hourDecimal < 10) {
    return { id: "pre_london", label: "Pre-London", isKillzone: false };
  }

  // 5. Pre-NY Setup (15:00 - 16:25 EET)
  if (hourDecimal >= 15 && hourDecimal < (16 + 25 / 60)) {
    return { id: "pre_ny", label: "Pre-NY", isKillzone: false };
  }

  // 6. London Lunch (13:00 - 15:00 EET)
  if (hourDecimal >= 13 && hourDecimal < 15) {
    return { id: "london_lunch", label: "London Lunch", isKillzone: false };
  }

  // 7. New York PM Killzone (21:00 - 23:00 EET)
  if (hourDecimal >= 21 && hourDecimal < 23) {
    return { id: "ny_pm", label: "New York PM", isKillzone: true };
  }

  // 8. Daily Rollover Dead Zone (00:00 - 02:00 EET or 23:30 - 24:00 EET)
  if (hourDecimal < 2 || hourDecimal >= 23.5) {
    return { id: "dead_zone", label: "Dead Zone", isKillzone: false };
  }

  return { id: "off", label: "Off-hours", isKillzone: false };
}

/**
 * Checks whether the input falls inside a major expansion killzone (London Open, NY AM, NY PM).
 * @param {Date|number|string|object} input
 * @returns {boolean}
 */
export function isKillzone(input) {
  return sessionOf(input).isKillzone;
}

/**
 * Checks whether the input falls inside the ICT Silver Bullet window.
 * London Silver Bullet: 10:00 - 11:00 EET (03:00 - 04:00 NY)
 * New York Silver Bullet: 17:00 - 18:00 EET (10:00 - 11:00 NY)
 * @param {Date|number|string|object} input
 * @returns {{ id: string, label: string }|null}
 */
export function isSilverBullet(input) {
  const { totalMinutes } = getEetTime(input);
  if (totalMinutes >= 600 && totalMinutes < 660) {
    return { id: "london_sb", label: "London Silver Bullet (10:00 - 11:00 EET)" };
  }
  if (totalMinutes >= 1020 && totalMinutes < 1080) {
    return { id: "ny_sb", label: "NY Silver Bullet (17:00 - 18:00 EET)" };
  }
  return null;
}

/**
 * Checks whether the input falls inside the Daily Rollover Dead Zone (00:00 - 02:00 EET).
 * @param {Date|number|string|object} input
 * @returns {boolean}
 */
export function isDeadZone(input) {
  const { totalMinutes } = getEetTime(input);
  return totalMinutes < 120 || totalMinutes >= 1410;
}

/**
 * Ingestion Boundary Normalizer: Converts broker server naive timestamps (Europe/Athens EET/EEST)
 * into true UTC Epoch milliseconds (UTC_INSTANT).
 *
 * Dynamically resolves Daylight Saving Time (DST) for the exact epoch date:
 * - In Winter (EET):   UTC+2 (subtracts 2 hours / 7,200,000 ms)
 * - In Summer (EEST):  UTC+3 (subtracts 3 hours / 10,800,000 ms)
 *
 * If the input already has UTC semantics or is already a UTC instant, it is safely preserved.
 *
 * @param {Date|number|string|object} value - Raw timestamp or bar object
 * @param {object} [options={}] - Options including brokerTimeZone, timestampSemantics, now
 * @returns {number} UTC epoch milliseconds (NaN if invalid)
 */
export function brokerTimestampToUtcMs(value, options = {}) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)) return Date.parse(value);
  const number = Number(typeof value === "object" && value != null ? (value.t ?? value.time) : value);
  if (!Number.isFinite(number)) return NaN;
  const rawMs = number < 1e11 ? number * 1000 : number;
  const semantics = options.timestampSemantics || process.env.MT5_TIMESTAMP_SEMANTICS || "BROKER_NAIVE";
  const nowMs = Number(options.now) || Date.now();
  const isBrokerTime = semantics === "BROKER_NAIVE" || rawMs > nowMs + 60_000;
  if (!isBrokerTime) return rawMs;

  if (options.brokerUtcOffsetMinutes != null && Number.isFinite(Number(options.brokerUtcOffsetMinutes))) {
    return rawMs - Number(options.brokerUtcOffsetMinutes) * 60000;
  }

  const zone = options.brokerTimeZone || process.env.MT5_BROKER_TIMEZONE || BROKER_TIMEZONE;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  let utcMs = rawMs;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    const localMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    utcMs += rawMs - localMs;
  }
  return utcMs;
}

/**
 * Ingestion Boundary Normalizer: Converts broker server naive timestamps (Europe/Athens EET/EEST)
 * into true UTC Epoch seconds (UTC_INSTANT).
 *
 * @param {Date|number|string|object} value
 * @param {object} [options={}]
 * @returns {number} UTC epoch seconds
 */
export function brokerTimestampToUtcSec(value, options = {}) {
  const ms = brokerTimestampToUtcMs(value, options);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

export const timestampToUtcMs = brokerTimestampToUtcMs;
export const timestampToUtcSec = brokerTimestampToUtcSec;

