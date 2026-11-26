/**
 * lib/autonomous/replayDriver.js
 * 
 * Institutional Single-Source-of-Truth Digital Twin Replay Engine
 * 
 * Key Principles:
 * 1. ZERO CODE DUPLICATION: Directly drives createAutonomousEngine() from lib/autonomous/engine.js.
 *    Any live modifications to the bias engine (lib/bias/engine.js), entry models (lib/autonomous/models.js),
 *    pre-entry validation (lib/autonomous/preEntryValidation.js), trailing stop management (lib/autonomous/management.js),
 *    or scanning (lib/autonomous/scanner.js) automatically reflect in the replay with zero code changes.
 * 2. ZERO LOOKAHEAD: Strict causal point-in-time closed-bar windowing (M5, M15, M30, H1, H4, D1).
 * 3. STRICT TIMEZONE FIDELITY: Ticks/feeds are UTC epoch seconds; sessions/killzones/daily boundaries
 *    are Europe/Athens (EET/EEST) via lib/time.js.
 * 4. PURE IN-MEMORY ISOLATION: Runs against simulated MongoDB collections with 0 external network dependencies.
 */

import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import { createAutonomousEngine } from './engine.js';
import { DEFAULT_AUTONOMOUS_CONFIG } from './store.js';
import { getEetOffsetSec, getTradingDayStartSec } from '../time.js';
import { canonOf } from './symbols.js';

// -----------------------------------------------------------------------------
// 1. In-Memory MongoDB Collection Replica
// -----------------------------------------------------------------------------
export class InMemoryCollection {
  constructor(name) {
    this.name = name;
    this.docs = [];
  }

  _matchesQuery(doc, query = {}) {
    for (const [k, v] of Object.entries(query)) {
      if (k === '$or') {
        const anyMatch = v.some(sub => this._matchesQuery(doc, sub));
        if (!anyMatch) return false;
        continue;
      }
      if (k === '$and') {
        const allMatch = v.every(sub => this._matchesQuery(doc, sub));
        if (!allMatch) return false;
        continue;
      }

      const docVal = doc[k];
      if (v !== null && typeof v === 'object' && !(v instanceof ObjectId) && !(v instanceof Date) && !(v instanceof RegExp)) {
        if ('$in' in v) {
          const list = v.$in;
          const match = Array.isArray(docVal)
            ? docVal.some(item => list.includes(item) || list.some(x => String(x) === String(item)))
            : list.includes(docVal) || list.some(x => String(x) === String(docVal));
          if (!match) return false;
        }
        if ('$nin' in v) {
          const list = v.$nin;
          const match = Array.isArray(docVal)
            ? docVal.some(item => list.includes(item) || list.some(x => String(x) === String(item)))
            : list.includes(docVal) || list.some(x => String(x) === String(docVal));
          if (match) return false;
        }
        const toComparable = (val) => {
          if (val instanceof Date) return val.getTime();
          if (typeof val === 'string' && (val.includes('T') || val.includes('-')) && !isNaN(Date.parse(val))) {
            return new Date(val).getTime();
          }
          return val;
        };
        if ('$gte' in v && !(toComparable(docVal) >= toComparable(v.$gte))) return false;
        if ('$lte' in v && !(toComparable(docVal) <= toComparable(v.$lte))) return false;
        if ('$gt' in v && !(toComparable(docVal) > toComparable(v.$gt))) return false;
        if ('$lt' in v && !(toComparable(docVal) < toComparable(v.$lt))) return false;
        if ('$ne' in v && (docVal === v.$ne || String(docVal) === String(v.$ne))) return false;
        if ('$regex' in v) {
          const re = new RegExp(v.$regex, v.$options || '');
          if (!re.test(String(docVal || ''))) return false;
        }
        if ('$not' in v) {
          const notQuery = { [k]: v.$not };
          if (this._matchesQuery(doc, notQuery)) return false;
        }
      } else if (v instanceof RegExp) {
        if (!v.test(String(docVal || ''))) return false;
      } else {
        if (docVal instanceof ObjectId || v instanceof ObjectId) {
          if (String(docVal) !== String(v)) return false;
        } else if (docVal !== v) {
          return false;
        }
      }
    }
    return true;
  }

  async findOne(query = {}) {
    const list = this.docs.filter(d => this._matchesQuery(d, query));
    return list[0] ? JSON.parse(JSON.stringify(list[0])) : null;
  }

  find(query = {}, projection = {}) {
    const matched = this.docs.filter(d => this._matchesQuery(d, query));
    let result = matched.map(d => JSON.parse(JSON.stringify(d)));

    const cursor = {
      sort: (sortObj) => {
        const [field, dir] = Object.entries(sortObj)[0] || [];
        if (field) {
          result.sort((a, b) => {
            const va = a[field], vb = b[field];
            if (va < vb) return dir === 1 ? -1 : 1;
            if (va > vb) return dir === 1 ? 1 : -1;
            return 0;
          });
        }
        return cursor;
      },
      limit: (n) => {
        result = result.slice(0, n);
        return cursor;
      },
      project: () => cursor,
      toArray: async () => result,
    };
    return cursor;
  }

  async insertOne(doc) {
    const copy = JSON.parse(JSON.stringify(doc));
    if (!copy._id) copy._id = new ObjectId();
    this.docs.push(copy);
    return { insertedId: copy._id };
  }

  async updateOne(query, update, options = {}) {
    let doc = this.docs.find(d => this._matchesQuery(d, query));
    if (!doc) {
      if (options.upsert) {
        doc = { ...query };
        if (update.$setOnInsert) Object.assign(doc, JSON.parse(JSON.stringify(update.$setOnInsert)));
        if (update.$set) Object.assign(doc, JSON.parse(JSON.stringify(update.$set)));
        if (!doc._id) doc._id = query._id || new ObjectId();
        this.docs.push(doc);
        return { matchedCount: 0, modifiedCount: 1, upsertedId: doc._id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    if (update.$set) Object.assign(doc, JSON.parse(JSON.stringify(update.$set)));
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) delete doc[k];
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        if (!Array.isArray(doc[k])) doc[k] = [];
        doc[k].push(JSON.parse(JSON.stringify(v)));
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        if (Array.isArray(doc[k])) {
          doc[k] = doc[k].filter(item => {
            if (v && typeof v === 'object') {
              for (const [subK, subV] of Object.entries(v)) {
                if (subV?.$in && subV.$in.includes(item[subK])) return false;
                if (item[subK] === subV) return false;
              }
            }
            return item !== v;
          });
        }
      }
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(query, update, options = {}) {
    const matched = this.docs.filter(d => this._matchesQuery(d, query));
    for (const doc of matched) {
      if (update.$set) Object.assign(doc, JSON.parse(JSON.stringify(update.$set)));
    }
    return { matchedCount: matched.length, modifiedCount: matched.length };
  }

  async deleteMany(query = {}) {
    const prev = this.docs.length;
    this.docs = this.docs.filter(d => !this._matchesQuery(d, query));
    return { deletedCount: prev - this.docs.length };
  }

  async countDocuments(query = {}) {
    return this.docs.filter(d => this._matchesQuery(d, query)).length;
  }

  async createIndex() {
    return Promise.resolve();
  }
}

// -----------------------------------------------------------------------------
// 2. Causal Historical Bar & Frame Provider
// -----------------------------------------------------------------------------
export const KNOWN_ASSET_SPECS = {
  NAS100: { dir: 'NAS100', filePattern: 'nas100_1m_2026.json', spread: 1.8, digits: 2, point: 0.01, trade_tick_size: 0.01, trade_tick_value: 0.01, trade_tick_value_loss: 0.01, trade_contract_size: 1, volume_min: 0.1, volume_max: 100.0, volume_step: 0.1 },
  SP500:  { dir: 'SP500',  filePattern: 'sp500_1m_2026.json',  spread: 0.45, digits: 2, point: 0.01, trade_tick_size: 0.01, trade_tick_value: 0.01, trade_tick_value_loss: 0.01, trade_contract_size: 1, volume_min: 0.1, volume_max: 100.0, volume_step: 0.1 },
  DJ30:   { dir: 'DJ30',   filePattern: 'dj30_1m_2026.json',   spread: 2.5, digits: 1, point: 0.1, trade_tick_size: 0.1, trade_tick_value: 0.1, trade_tick_value_loss: 0.1, trade_contract_size: 1, volume_min: 0.1, volume_max: 100.0, volume_step: 0.1 },
  GER40:  { dir: 'GER40',  filePattern: 'ger40_1m_2026.json',  spread: 1.5, digits: 1, point: 0.1, trade_tick_size: 0.1, trade_tick_value: 0.1, trade_tick_value_loss: 0.1, trade_contract_size: 1, volume_min: 0.1, volume_max: 100.0, volume_step: 0.1 },
  UK100:  { dir: 'UK100',  filePattern: 'uk100_1m_2026.json',  spread: 1.5, digits: 1, point: 0.1, trade_tick_size: 0.1, trade_tick_value: 0.1, trade_tick_value_loss: 0.1, trade_contract_size: 1, volume_min: 0.1, volume_max: 100.0, volume_step: 0.1 },
  EURUSD: { dir: 'EURUSD', filePattern: 'eurusd_1m_2026.json', spread: 0.00012, digits: 5, point: 0.00001, trade_tick_size: 0.00001, trade_tick_value: 1.0, trade_tick_value_loss: 1.0, trade_contract_size: 100000, volume_min: 0.01, volume_max: 100.0, volume_step: 0.01 },
  GBPUSD: { dir: 'GBPUSD', filePattern: 'gbpusd_1m_2026.json', spread: 0.00015, digits: 5, point: 0.00001, trade_tick_size: 0.00001, trade_tick_value: 1.0, trade_tick_value_loss: 1.0, trade_contract_size: 100000, volume_min: 0.01, volume_max: 100.0, volume_step: 0.01 },
  USDJPY: { dir: 'USDJPY', filePattern: 'usdjpy_1m_2026.json', spread: 0.015, digits: 3, point: 0.001, trade_tick_size: 0.001, trade_tick_value: 0.65, trade_tick_value_loss: 0.65, trade_contract_size: 100000, volume_min: 0.01, volume_max: 100.0, volume_step: 0.01 },
  USDCHF: { dir: 'USDCHF', filePattern: 'usdchf_1m_2026.json', spread: 0.00015, digits: 5, point: 0.00001, trade_tick_size: 0.00001, trade_tick_value: 1.1, trade_tick_value_loss: 1.1, trade_contract_size: 100000, volume_min: 0.01, volume_max: 100.0, volume_step: 0.01 },
  XAUUSD: { dir: 'XAUUSD', filePattern: 'xauusd_1m_2026.json', spread: 0.25, digits: 2, point: 0.01, trade_tick_size: 0.01, trade_tick_value: 1.0, trade_tick_value_loss: 1.0, trade_contract_size: 100, volume_min: 0.01, volume_max: 100.0, volume_step: 0.01 },
  BTCUSD: { dir: 'BTCUSD', filePattern: 'btcusd_1m_2026.json', spread: 15.0, digits: 2, point: 0.01, trade_tick_size: 0.01, trade_tick_value: 0.01, trade_tick_value_loss: 0.01, trade_contract_size: 1, volume_min: 0.01, volume_max: 10.0, volume_step: 0.01 },
};

export function loadHistorical1MBars(sym) {
  const conf = KNOWN_ASSET_SPECS[sym] || KNOWN_ASSET_SPECS[canonOf(sym)];
  if (!conf) return [];
  const fp = path.resolve('tick-data', conf.dir, conf.filePattern);
  if (!fs.existsSync(fp)) return [];
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return raw.map(b => ({
    t: b.t ?? b.time,
    time: b.t ?? b.time,
    open: b.o ?? b.open,
    high: b.h ?? b.high,
    low: b.l ?? b.low,
    close: b.c ?? b.close,
    volume: b.v ?? b.volume ?? 1,
    closed: true,
    timestampSemantics: 'UTC_INSTANT',
  })).sort((a, b) => a.t - b.t);
}

export function resampleBars(bars1m, tfSec) {
  const buckets = new Map();
  for (const b of bars1m) {
    let bucketT;
    if (tfSec === 86400) bucketT = getTradingDayStartSec(b.t);
    else if (tfSec === 14400) {
      const offset = getEetOffsetSec(b.t);
      const localSec = b.t + offset;
      bucketT = Math.floor(localSec / 14400) * 14400 - offset;
    } else bucketT = Math.floor(b.t / tfSec) * tfSec;

    let buck = buckets.get(bucketT);
    if (!buck) {
      buckets.set(bucketT, {
        t: bucketT,
        time: bucketT,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 1,
        closed: true,
        timestampSemantics: 'UTC_INSTANT',
      });
    } else {
      if (b.high > buck.high) buck.high = b.high;
      if (b.low < buck.low) buck.low = b.low;
      buck.close = b.close;
      buck.volume += (b.volume || 1);
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

function findLastClosedIndex(bars, closeCutoff, intervalSec) {
  let low = 0, high = bars.length - 1, ans = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (bars[mid].t + intervalSec <= closeCutoff) {
      ans = mid; low = mid + 1;
    } else high = mid - 1;
  }
  return ans;
}

// -----------------------------------------------------------------------------
// 3. Digital Twin Replay Engine Runner
// -----------------------------------------------------------------------------
export async function runDigitalTwinReplay({
  symbols = ['NAS100', 'SP500'],
  startDate = '2026-06-20T00:00:00Z',
  endDate = '2026-07-01T00:00:00Z',
  configOverrides = {},
  initialBalance = 50000,
  onProgress = null,
} = {}) {
  const inMemoryTrades = new InMemoryCollection('autonomous_trades');
  const inMemoryControl = new InMemoryCollection('autonomous_control');
  const inMemoryLogs = new InMemoryCollection('autonomous_logs');

  let virtualClockMs = new Date(startDate).getTime();
  const endVirtualMs = new Date(endDate).getTime();

  // Load and cache master frames
  const rawBars = {};
  const masterFrames = {};
  const barMaps = {};
  const paperSpecs = {};

  for (const sym of symbols) {
    const bars = loadHistorical1MBars(sym);
    if (!bars.length) {
      console.warn(`[runDigitalTwinReplay] Warning: No 1M bar data found for ${sym}`);
      continue;
    }
    rawBars[sym] = bars;
    barMaps[sym] = new Map(bars.map(b => [b.t, b]));
    masterFrames[sym] = {
      M5:  resampleBars(bars, 300),
      M15: resampleBars(bars, 900),
      M30: resampleBars(bars, 1800),
      H1:  resampleBars(bars, 3600),
      H4:  resampleBars(bars, 14400),
      D1:  resampleBars(bars, 86400),
    };
    const spec = KNOWN_ASSET_SPECS[sym] || {};
    paperSpecs[sym] = {
      symbol: sym,
      digits: spec.digits || 2,
      point: spec.point || 0.01,
      trade_tick_size: spec.trade_tick_size || spec.point || 0.01,
      trade_tick_value: spec.trade_tick_value || spec.point || 0.01,
      trade_tick_value_loss: spec.trade_tick_value_loss || spec.point || 0.01,
      trade_contract_size: spec.trade_contract_size || spec.contractSize || 1,
      volume_min: spec.volume_min || 0.1,
      volume_max: spec.volume_max || 100.0,
      volume_step: spec.volume_step || 0.1,
      spread: spec.spread || 1.0,
    };
  }

  const activeSymbols = Object.keys(rawBars);
  if (!activeSymbols.length) {
    throw new Error('No historical data available for the requested symbols.');
  }

  // Causal Point-In-Time Frames Provider
  function getCausalFrames(sym) {
    const canon = canonOf(sym);
    const master = masterFrames[sym] || masterFrames[canon];
    if (!master) return { M5: [], M15: [], M30: [], H1: [], H4: [], D1: [] };

    const currentT = Math.floor(virtualClockMs / 1000);
    // Align cutoff with the latest 15M candle boundary
    const closeCutoff = Math.floor(currentT / 900) * 900;

    const m5Idx  = findLastClosedIndex(master.M5, closeCutoff, 300);
    const m15Idx = findLastClosedIndex(master.M15, closeCutoff, 900);
    const m30Idx = findLastClosedIndex(master.M30, closeCutoff, 1800);
    const h1Idx  = findLastClosedIndex(master.H1, closeCutoff, 3600);
    const h4Idx  = findLastClosedIndex(master.H4, closeCutoff, 14400);
    const d1Idx  = findLastClosedIndex(master.D1, closeCutoff, 86400);

    return {
      M5:  m5Idx >= 0  ? master.M5.slice(Math.max(0, m5Idx - 250 + 1), m5Idx + 1) : [],
      M15: m15Idx >= 0 ? master.M15.slice(Math.max(0, m15Idx - 240 + 1), m15Idx + 1) : [],
      M30: m30Idx >= 0 ? master.M30.slice(Math.max(0, m30Idx - 200 + 1), m30Idx + 1) : [],
      H1:  h1Idx >= 0  ? master.H1.slice(Math.max(0, h1Idx - 180 + 1), h1Idx + 1) : [],
      H4:  h4Idx >= 0  ? master.H4.slice(Math.max(0, h4Idx - 140 + 1), h4Idx + 1) : [],
      D1:  d1Idx >= 0  ? master.D1.slice(Math.max(0, d1Idx - 80 + 1), d1Idx + 1) : [],
    };
  }

  const liveConfig = {
    ...DEFAULT_AUTONOMOUS_CONFIG,
    enabled: true,
    executionMode: 'autonomous',
    liveTrading: false, // Paper execution within live engine
    universe: activeSymbols,
    mainWatchlistSymbols: activeSymbols,
    accountSize: initialBalance,
    paperSymbolSpecs: paperSpecs,
    isReplay: true, // Tells engine/scanner to skip pacing sleeps
    timestampSemantics: 'UTC_INSTANT',
    ...configOverrides,
  };

  // Ensure global flag is active so engine accepts ticks
  globalThis._tsAutonomousStarted = true;

  // Instantiate the EXACT live autonomous engine
  const engine = createAutonomousEngine({
    now: () => virtualClockMs,
    autonomousCols: async () => ({
      tradesCol: inMemoryTrades,
      controlCol: inMemoryControl,
      logsCol: inMemoryLogs,
    }),
    getConfig: async () => liveConfig,
    getMainWatchlistSymbols: async () => activeSymbols,
    getFrames: async (sym) => getCausalFrames(sym),
    getMT5MicroBars: async (sym) => {
      const canon = canonOf(sym);
      const master = masterFrames[sym] || masterFrames[canon];
      if (!master?.M5) return { ok: true, bars: [] };
      const currentT = Math.floor(virtualClockMs / 1000);
      const recent = master.M5.filter(b => b.time <= currentT).slice(-10);
      return { ok: true, bars: recent };
    },
    getMT5Symbol: async (sym) => ({ ok: true, symbol: paperSpecs[sym] || paperSpecs[canonOf(sym)] }),
    reserveTradeCapacity: async () => true,
    releaseTradeCapacity: async () => {},
    getDailyBaseline: async (_key, eq) => eq || initialBalance,
    logEvent: async () => {},
    broadcast: () => {},
    sendTelegram: async () => {},
  });

  const startSec = Math.floor(virtualClockMs / 1000);
  const endSec = Math.floor(endVirtualMs / 1000);

  let scanCount = 0;
  let tickCount = 0;
  let stagedTotal = 0;
  const totalSeconds = endSec - startSec;

  const OPEN_STATES = new Set([
    'staged', 'armed', 'placing', 'pending',
    'confirming', 'reconciling', 'cancelling',
    'active', 'managing', 'closing'
  ]);

  for (let currentSec = startSec; currentSec <= endSec; currentSec += 60) {
    const hasActiveOrders = inMemoryTrades.docs.some(t => OPEN_STATES.has(t.status));

    // 1. Deliver causal sub-minute ticks (Open -> Extreme 1 -> Extreme 2 -> Close)
    // for exact limit fills, TP targets, and Stop Loss executions
    if (hasActiveOrders) {
      for (let phase = 0; phase < 4; phase++) {
        const subMs = currentSec * 1000 + phase * 15000;
        virtualClockMs = subMs;
        const ticks = {};
        for (const sym of activeSymbols) {
          const b = barMaps[sym].get(currentSec);
          if (b) {
            const spread = paperSpecs[sym]?.spread || 1.0;
            let bidPx;
            if (phase === 0) bidPx = b.open;
            else if (phase === 1) bidPx = (b.close >= b.open) ? b.low : b.high;
            else if (phase === 2) bidPx = (b.close >= b.open) ? b.high : b.low;
            else bidPx = b.close;

            ticks[sym] = {
              bid: bidPx,
              ask: bidPx + spread,
              high: b.high,
              low: b.low,
              time: subMs,
            };
          }
        }

        if (Object.keys(ticks).length > 0) {
          tickCount++;
          await engine.autonomousOnTicks(ticks);
        }
      }
    } else {
      virtualClockMs = currentSec * 1000;
    }

    // 2. Trigger autonomous strategy scan every 15 minutes (at candle close)
    if (currentSec % 900 === 0) {
      scanCount++;
      const scanRes = await engine.runAutonomousScan('interval');
      if (scanRes?.stagedCount > 0) {
        stagedTotal += scanRes.stagedCount;
      }
      if (onProgress && (scanCount % 25 === 0 || scanCount === 1)) {
        const pct = Math.min(100, Math.round(((currentSec - startSec) / (totalSeconds || 1)) * 100));
        onProgress({
          currentSec,
          pct,
          scanCount,
          tickCount,
          stagedTotal,
          activeTrades: inMemoryTrades.docs.filter(t => t.status?.startsWith('closed_') || t.status === 'active'),
          allDocsCount: inMemoryTrades.docs.length,
          recentDocs: inMemoryTrades.docs.slice(-30),
        });
      }
    }
  }

  // Final summary analysis
  const allDocs = inMemoryTrades.docs;
  const closedTrades = allDocs.filter(t => ['closed_sl', 'closed_tp', 'closed_be', 'closed_manual', 'closed_timeout'].includes(t.status) || t.realizedR != null);
  const wonTrades = closedTrades.filter(t => (t.realizedR || 0) > 0.25);
  const lostTrades = closedTrades.filter(t => (t.realizedR || 0) < -0.25);
  const beTrades = closedTrades.filter(t => Math.abs(t.realizedR || 0) <= 0.25);

  const totalWonR = wonTrades.reduce((s, t) => s + Number(t.realizedR || 0), 0);
  const totalLostR = lostTrades.reduce((s, t) => s + Math.abs(Number(t.realizedR || 0)), 0);
  const netRealizedR = totalWonR - totalLostR;
  const activeTradeCount = wonTrades.length + lostTrades.length;
  const winRate = activeTradeCount > 0 ? (wonTrades.length / activeTradeCount) * 100 : 0;
  const profitFactor = totalLostR > 0 ? totalWonR / totalLostR : totalWonR > 0 ? Infinity : 0;

  // Max drawdown in R
  let peakR = 0, currentCumR = 0, maxDrawdownR = 0;
  for (const t of closedTrades) {
    currentCumR += Number(t.realizedR || 0);
    if (currentCumR > peakR) peakR = currentCumR;
    const dd = peakR - currentCumR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;
  }

  // Model breakdown
  const modelStats = {};
  for (const t of closedTrades) {
    const m = t.modelId || t.entryModel?.id || 'other';
    if (!modelStats[m]) modelStats[m] = { trades: 0, wins: 0, losses: 0, netR: 0 };
    modelStats[m].trades++;
    if ((t.realizedR || 0) > 0.25) modelStats[m].wins++;
    else if ((t.realizedR || 0) < -0.25) modelStats[m].losses++;
    modelStats[m].netR += Number(t.realizedR || 0);
  }

  // Symbol breakdown
  const symbolStats = {};
  for (const t of closedTrades) {
    const s = t.symbol;
    if (!symbolStats[s]) symbolStats[s] = { trades: 0, wins: 0, losses: 0, netR: 0 };
    symbolStats[s].trades++;
    if ((t.realizedR || 0) > 0.25) symbolStats[s].wins++;
    else if ((t.realizedR || 0) < -0.25) symbolStats[s].losses++;
    symbolStats[s].netR += Number(t.realizedR || 0);
  }

  return {
    meta: {
      startDate,
      endDate,
      symbols: activeSymbols,
      totalScans: scanCount,
      totalTicks: tickCount,
      stagedCount: stagedTotal,
      allTradesCount: allDocs.length,
      closedTradesCount: closedTrades.length,
    },
    performance: {
      totalClosed: closedTrades.length,
      won: wonTrades.length,
      lost: lostTrades.length,
      breakeven: beTrades.length,
      winRatePct: Number(winRate.toFixed(2)),
      grossWonR: Number(totalWonR.toFixed(2)),
      grossLostR: Number(totalLostR.toFixed(2)),
      netRealizedR: Number(netRealizedR.toFixed(2)),
      profitFactor: Number(Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '99.99'),
      maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    },
    modelBreakdown: modelStats,
    symbolBreakdown: symbolStats,
    trades: closedTrades.map(t => ({
      id: String(t._id),
      symbol: t.symbol,
      dir: t.dir === 1 ? 'BUY' : 'SELL',
      modelId: t.modelId || t.entryModel?.id,
      modelName: t.modelName || t.entryModel?.name,
      entryPrice: t.filledPrice || t.entryPrice,
      slPrice: t.initialSlPrice || t.slPrice,
      tpPrice: t.tpPrice,
      exitPrice: t.exitPrice,
      realizedR: Number((t.realizedR || 0).toFixed(2)),
      status: t.status,
      filledAt: t.filledAt,
      closedAt: t.closedAt,
      eventsCount: t.events?.length || 0,
    })),
    rawDocs: allDocs,
  };
}
