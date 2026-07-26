"""Runtime config. Mirrors DEFAULT_CONFIG in lib/telemetry/store.js.

Kept as a plain dict so it round-trips with the Mongo `telemetry_config` doc
the JS side already writes — one source of truth, two readers.
"""

import os

from .core.pairs import TELEMETRY_EXECUTION_FX

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGODB_DB", "TradeSpace")

# TF bar counts the JS bias engine requests (lib/bias/data.js SPEC).
SPEC_COUNTS = {"D1": 80, "H4": 200, "H1": 240, "M15": 320}

HORIZONS = [("r1h", 3_600_000), ("r4h", 4 * 3_600_000), ("r24h", 24 * 3_600_000)]

DEFAULT_CONFIG = {
    "enabled": True,
    "fallbackMs": 180_000,
    "minSymbols": 8,
    "analysisMinSymbols": 24,
    "maxJumpAtr": 12,
    "labelEveryMs": 300_000,
    "labelTolMs": 240_000,
    "algoEnabled": False,
    "algoLive": False,
    "algoHorizon": "r4h",
    "algoConfirmHorizon": "r24h",
    "algoMinEdge": 20,
    "algoMinEdgeBySession": {"london": 20, "ny": 20, "asia": 20, "overlap": 20},
    "algoMinSamples": 30,
    "algoMinWinRate": 55,
    "algoMinMeanRet": 0.0005,
    "algoMinProfitFactor": 1.30,
    "algoCalibrationProfile": None,
    "algoConfirmMinSamples": 30,
    "algoConfirmMinWinRate": 50,
    "algoConfirmMinMeanRet": 0,
    "algoSlAtrMult": 3,
    "algoLotSize": 0.01,
    "algoMaxConcurrent": 3,
    "algoMinStopPips": 10,
    "algoMinStopJpyCadPips": 15,
    "algoAssumedCostPips": 1.2,
    "algoMinScenarioScore": 65,
    "algoMinScenarioScoreBySession": {"london": 65, "ny": 65, "asia": 65, "overlap": 65},
    "algoMaxDailyLossR": 2.5,
    "algoMaxDailyTrades": 8,
    "algoMaxLossStreak": 3,
    "algoMaxOpenRiskR": 3,
    "algoMaxCurrencyExposure": 2,
    "algoCorrelationEnabled": True,
    "algoCorrelationLookback": 80,
    "algoCorrelationMinSamples": 20,
    "algoMaxDirectionalCorrelation": 0.75,
    "algoExecutionEnabled": True,
    "algoExecutionSweepMaxAge": 4,
    "algoExecutionBreakoutMaxAge": 12,
    "algoExecutionHtfMinAlignments": 1,
    "algoExecutionSymbols": TELEMETRY_EXECUTION_FX,
}


def load_config(overrides: dict | None = None) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v is not None})
    return cfg
