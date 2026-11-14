import fs from "fs";
import { AutonomousQuantEngine } from "../lib/autonomous_system2/index.js";

const ASSET_CONFIGS = [
  { symbol: "NAS100", dataPath: "quant_service/data/nas100_15m.json", spreadPts: 1.5, minSlPoints: 30.0, maxSlPoints: 140.0 },
  { symbol: "SPX500", dataPath: "quant_service/data/spx500_15m.json", spreadPts: 0.5, minSlPoints: 5.0, maxSlPoints: 28.0 },
  { symbol: "GER40",  dataPath: "quant_service/data/ger40_15m.json",  spreadPts: 2.0, minSlPoints: 25.0, maxSlPoints: 130.0 },
  { symbol: "DJ30",   dataPath: "quant_service/data/dj30_15m.json",   spreadPts: 3.0, minSlPoints: 40.0, maxSlPoints: 200.0 },
  { symbol: "XAUUSD", dataPath: "quant_service/data/xauusd_15m.json", spreadPts: 0.30, minSlPoints: 4.0, maxSlPoints: 25.0 },
  { symbol: "EURUSD", dataPath: "quant_service/data/eurusd_15m.json", spreadPts: 0.00010, minSlPoints: 0.0006, maxSlPoints: 0.0035 },
  { symbol: "GBPUSD", dataPath: "quant_service/data/gbpusd_15m.json", spreadPts: 0.00015, minSlPoints: 0.0008, maxSlPoints: 0.0045 },
];

console.log("==========================================================================");
console.log("PURE TPO AUCTION MARKET THEORY AUDIT (MODELS 0 & 1 ONLY - ZERO SQUEEZE)");
console.log("==========================================================================");

let totalAuctionPnl = 0;
let totalAuctionTrades = 0;
let totalWins = 0;

for (const cfg of ASSET_CONFIGS) {
  const rawBars = JSON.parse(fs.readFileSync(cfg.dataPath, "utf8"));
  const engine = new AutonomousQuantEngine({
    spreadPts: cfg.spreadPts,
    minSlPoints: cfg.minSlPoints,
    maxSlPoints: cfg.maxSlPoints,
    accountBalance: 100000,
    riskPerTradePct: 0.75,
  });

  for (let i = 0; i < rawBars.length; i++) {
    const b = rawBars[i];
    engine.onBar({
      time: b.t ?? b.time,
      open: b.o ?? b.open,
      high: b.h ?? b.high,
      low: b.l ?? b.low,
      close: b.c ?? b.close,
    });
  }

  // Filter to pure auction trades (Steidlmayer 80% Rule + IB Failed Auction Trap)
  const auctionTrades = engine.closedTrades.filter(
    (t) => t.modelId === "STEIDLMAYER_80_PERCENT_RULE" || t.modelId === "MODEL_1_IB_FAILED_AUCTION_TRAP"
  );
  const wins = auctionTrades.filter((t) => t.finalPnlDollars > 0);
  const pnl = auctionTrades.reduce((acc, t) => acc + t.finalPnlDollars, 0);
  const wr = auctionTrades.length > 0 ? ((wins.length / auctionTrades.length) * 100).toFixed(1) : "0.0";

  totalAuctionPnl += pnl;
  totalAuctionTrades += auctionTrades.length;
  totalWins += wins.length;

  const pnlStr = (pnl >= 0 ? "+$" : "-$") + Math.abs(pnl).toFixed(2);
  console.log(`${cfg.symbol.padEnd(8)} | Trades: ${auctionTrades.length.toString().padStart(4)} | WinRate: ${wr.padStart(5)}% | Net PnL: ${pnlStr.padStart(12)}`);
}

const totalWr = totalAuctionTrades > 0 ? ((totalWins / totalAuctionTrades) * 100).toFixed(1) : "0.0";
const totalPnlStr = (totalAuctionPnl >= 0 ? "+$" : "-$") + Math.abs(totalAuctionPnl).toFixed(2);
console.log("--------------------------------------------------------------------------");
console.log(`TOTAL    | Trades: ${totalAuctionTrades.toString().padStart(4)} | WinRate: ${totalWr.padStart(5)}% | Net PnL: ${totalPnlStr.padStart(12)}`);
console.log("==========================================================================");
