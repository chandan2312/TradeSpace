import fs from "fs";
import { AutonomousQuantEngine } from "../lib/autonomous_system2/index.js";

// Load 30,000 bars of NAS100 (~1.2 years)
const rawBars = JSON.parse(fs.readFileSync("quant_service/data/nas100_15m.json", "utf8")).slice(0, 30000);

class DebouncedEngine extends AutonomousQuantEngine {
  constructor(config = {}) {
    super(config);
    this.sessionModelTrades = new Set();
    this.lastTradeBarIndex = -999;
    this.barCount = 0;
  }

  onBar(bar) {
    this.barCount++;
    const prevDayKey = this.currentTradingDayKey;
    
    // Call parent onBar, but intercept candidate trade creation
    // To do that cleanly, let's observe how onBar handles rollover
    const res = super.onBar(bar);
    
    if (this.currentTradingDayKey !== prevDayKey) {
      this.sessionModelTrades.clear();
    }
    return res;
  }
}
