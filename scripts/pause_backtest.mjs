import fs from "fs";
import path from "path";

const flagFile = path.resolve("quant_service/data/PAUSE_BACKTEST");
fs.writeFileSync(flagFile, new Date().toISOString(), "utf-8");
console.log(`[PAUSE] Signal written to ${flagFile}. Running worker(s) will finish their current chunk and pause cleanly.`);
