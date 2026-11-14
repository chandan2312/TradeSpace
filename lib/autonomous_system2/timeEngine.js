/**
 * lib/autonomous_quant/timeEngine.js
 *
 * System #2 Time & Session Engine
 * Strictly follows the TradeSpace Unified Timezone Protocol (Europe/Athens EET/EEST).
 * Handles Initial Balance (IB) calculation windows, London/NY Killzones, and dead-zone filtering.
 */

import { getEetTime, getTradingDayKey, toUtcSec } from "../time.js";
import { SESSIONS_EET } from "./constants.js";

/**
 * Classifies an incoming bar's timestamp into its precise session and auction phase.
 * @param {number|object} timestamp - UTC epoch seconds or bar object
 * @returns {object} Detailed session state
 */
export function classifyAuctionTime(timestamp) {
  const utcSec = toUtcSec(timestamp);
  if (!Number.isFinite(utcSec)) {
    return {
      isValid: false,
      isTradeable: false,
      error: "INVALID_TIMESTAMP",
    };
  }

  const { h, m, totalMinutes } = getEetTime(utcSec);
  const tradingDayKey = getTradingDayKey(utcSec);

  // Check Day of Week in Europe/Athens using dynamic DST-aware tradingDayKey
  // Unix Epoch Day 0 (1970-01-01) was Thursday = 4. (0 = Sun, 6 = Sat)
  const dayOfWeek = ((tradingDayKey % 7) + 4) % 7;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 || (dayOfWeek === 5 && totalMinutes >= SESSIONS_EET.DAY_CLOSE_MIN);

  // 1. Initial Balance (IB) Phase Detection
  // London IB: 09:00 - 10:00 EET
  const isLondonIB = totalMinutes >= SESSIONS_EET.LONDON_IB_START_MIN && totalMinutes < SESSIONS_EET.LONDON_IB_END_MIN;
  // NY IB: 15:30 - 16:30 EET
  const isNyIB = totalMinutes >= SESSIONS_EET.NY_IB_START_MIN && totalMinutes < SESSIONS_EET.NY_IB_END_MIN;
  const isInitialBalanceWindow = isLondonIB || isNyIB;

  // 2. Main Active Killzones (Where execution is permitted)
  // London Killzone: 09:00 - 12:30 EET
  const isLondonKZ = totalMinutes >= SESSIONS_EET.LONDON_KZ_START_MIN && totalMinutes <= SESSIONS_EET.LONDON_KZ_END_MIN;
  // New York Cash Killzone: 15:30 - 19:30 EET
  const isNyKZ = totalMinutes >= SESSIONS_EET.NY_KZ_START_MIN && totalMinutes <= SESSIONS_EET.NY_KZ_END_MIN;
  const isActiveKillzone = (isLondonKZ || isNyKZ) && !isWeekend;

  // 3. Trade Entry Permission Window
  // We do NOT enter during the first 45 mins of IB (let IB establish its range first!)
  // Entries are permitted once IB has formed (after 09:45 EET for London, after 16:15 EET for NY)
  const isPostLondonIBFormation = totalMinutes >= 585 && totalMinutes <= SESSIONS_EET.LONDON_KZ_END_MIN;
  const isPostNyIBFormation = totalMinutes >= 975 && totalMinutes <= SESSIONS_EET.NY_KZ_END_MIN;
  const isEntryPermittedWindow = (isPostLondonIBFormation || isPostNyIBFormation) && !isWeekend;

  // 4. Dead-Zone / Rollover Shield (22:30 - 02:00 EET - High spreads & bank swap rollover)
  const isDeadZone = totalMinutes >= 1350 || totalMinutes < 120 || isWeekend;

  let activeSessionName = "OFF_HOURS";
  if (isLondonKZ) activeSessionName = "LONDON";
  else if (isNyKZ) activeSessionName = "NEW_YORK";
  else if (totalMinutes >= SESSIONS_EET.ASIA_START_MIN && totalMinutes <= SESSIONS_EET.ASIA_END_MIN) activeSessionName = "ASIA";

  return {
    isValid: true,
    utcSec,
    tradingDayKey,
    eetHours: h,
    eetMinutes: m,
    totalMinutes,
    dayOfWeek,
    isWeekend,
    activeSessionName,
    isInitialBalanceWindow,
    isLondonIB,
    isNyIB,
    isLondonKZ,
    isNyKZ,
    isActiveKillzone,
    isEntryPermittedWindow,
    isDeadZone,
  };
}

/**
 * Helper to identify whether a bar is the first bar of a new trading session.
 */
export function isSessionStartBar(prevTime, curTime) {
  const prev = classifyAuctionTime(prevTime);
  const cur = classifyAuctionTime(curTime);
  if (!prev.isValid || !cur.isValid) return false;
  return prev.tradingDayKey !== cur.tradingDayKey;
}
