// lib/autonomous/magicEncoder.js — Institutional Deterministic Magic Number & Copier Tag Engine
// Pure mathematical encoding/decoding: zero external dependencies, bundles seamlessly into Node & Client.

import { canonOf } from "./symbols.js";

export const MAGIC_PREFIX = 23; // TradeSpace institutional signature

export const ASSET_CLASS_SPECS = {
  INDEX:    { code: 1, key: "index",    label: "Indices",    aliases: ["US30", "DJ30", "NAS100", "US500", "SP500", "GER40", "UK100", "JP225"] },
  METAL:    { code: 2, key: "metal",    label: "Metals",     aliases: ["XAUUSD", "XAGUSD", "GOLD", "SILVER"] },
  CRYPTO:   { code: 3, key: "crypto",   label: "Crypto",     aliases: ["BTCUSD", "ETHUSD", "BITCOIN", "ETHEREUM"] },
  FX_MAJOR: { code: 4, key: "fx_major", label: "FX Majors",  aliases: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD"] },
  FX_CROSS: { code: 5, key: "fx_cross", label: "FX Crosses", aliases: [] },
  OTHER:    { code: 9, key: "other",    label: "Other",      aliases: [] },
};

export const HORIZON_SPECS = {
  SWING: { code: 1, key: "swing", label: "Swing (1D-1H)",     badge: "1D-1H",  tag: "SWG", htTf: "1D",  ltTf: "1H",  tfs: ["1D-1H", "1D", "D1", "DAILY", "SWING", "1H", "H1"] },
  DAY:   { code: 2, key: "day",   label: "Day Trade (4H-15M)", badge: "4H-15M", tag: "DAY", htTf: "4H",  ltTf: "15M", tfs: ["4H-15M", "4H", "H4", "15M", "M15", "DAY", "DAY_TRADE", "INTRADAY"] },
  SCALP: { code: 3, key: "scalp", label: "Scalp (15M-1M)",     badge: "15M-1M", tag: "SCP", htTf: "15M", ltTf: "1M",  tfs: ["15M-1M", "5M", "M5", "1M", "M1", "SCALP"] },
  OTHER: { code: 9, key: "other", label: "Other",             badge: "OTHER",  tag: "OTH", htTf: "15M", ltTf: "15M", tfs: [] },
};

export const MODEL_SPECS = {
  ict_2022:         { code: 1, key: "ict_2022",         badge: "ICT 2022",      short: "M1" },
  turtle_soup:      { code: 2, key: "turtle_soup",      badge: "Turtle Soup",   short: "M2" },
  breaker_block:    { code: 3, key: "breaker_block",    badge: "Breaker Block", short: "M3" },
  ote_continuation: { code: 4, key: "ote_continuation", badge: "OTE Trend",     short: "M4" },
  silver_bullet:    { code: 5, key: "silver_bullet",    badge: "Silver Bullet", short: "M5" },
  other:            { code: 9, key: "other",            badge: "SMC Generic",   short: "M0" },
};

export const MANAGEMENT_SPECS = {
  milestone_50:   { code: 1, key: "milestone_50",   label: "50% Milestone + Runner", short: "MG1", desc: "40% booked at 50% TP, SL to BE, 60% runner (unrestricted for swing)" },
  prop_firm_safe: { code: 2, key: "prop_firm_safe", label: "Prop-Firm Safe",         short: "MG2", desc: "1.5R–2.5R TP; SL to -0.5R at 1.0R; SL to BE at 1.5R; full exit at TP" },
  other:          { code: 9, key: "other",          label: "Default / Custom",       short: "MG0", desc: "Default broker bracket" },
};

export const DEFAULT_COPIER_PROFILES = [
  {
    id: "ftmo_indices_day",
    name: "FTMO 100K · Indices Day Trade",
    accountTier: 1,
    enabled: true,
    allowedAssets: ["index"],
    allowedSymbols: ["NAS100", "US30", "DJ30", "US500", "SP500"],
    allowedHorizons: ["day", "4H-15M", "15M", "M15", "intraday"],
    allowedModels: ["all"],
    allowedManagements: ["prop_firm_safe", "milestone_50"],
    riskOverridePct: 0.5,
    description: "Selective 4H-15M day trade setups on NAS100/DJ30/SP500 for FTMO challenge preservation.",
  },
  {
    id: "fundednext_metals_crypto",
    name: "FundedNext 200K · Metals & Crypto",
    accountTier: 2,
    enabled: true,
    allowedAssets: ["metal", "crypto"],
    allowedSymbols: ["XAUUSD", "BTCUSD", "ETHUSD"],
    allowedHorizons: ["all"],
    allowedModels: ["all"],
    allowedManagements: ["prop_firm_safe"],
    riskOverridePct: 0.25,
    description: "Prop-firm risk management on Gold and Bitcoin with conservative 1.5R–2.5R brackets.",
  },
  {
    id: "personal_swing_macro",
    name: "Personal Account · Swing Macro",
    accountTier: 3,
    enabled: true,
    allowedAssets: ["all"],
    allowedSymbols: ["all"],
    allowedHorizons: ["swing", "1D-1H", "1D", "D1", "1H", "H1"],
    allowedModels: ["all"],
    allowedManagements: ["milestone_50"],
    riskOverridePct: 1.0,
    description: "Macro swing runner portfolio targeting unrestricted HTF DOL on personal capital.",
  },
];

/**
 * Determine the asset class key & numeric code for any symbol or alias.
 */
export function getAssetClass(symbol) {
  const canonical = canonOf(symbol).toUpperCase();
  if (ASSET_CLASS_SPECS.INDEX.aliases.includes(canonical) || /^(US30|DJ30|NAS100|US500|SP500|GER40|UK100|JP225)/.test(canonical)) {
    return ASSET_CLASS_SPECS.INDEX;
  }
  if (ASSET_CLASS_SPECS.METAL.aliases.includes(canonical) || /^(XAU|XAG|GOLD|SILVER)/.test(canonical)) {
    return ASSET_CLASS_SPECS.METAL;
  }
  if (ASSET_CLASS_SPECS.CRYPTO.aliases.includes(canonical) || /^(BTC|ETH|SOL|BNB)/.test(canonical)) {
    return ASSET_CLASS_SPECS.CRYPTO;
  }
  if (ASSET_CLASS_SPECS.FX_MAJOR.aliases.includes(canonical)) {
    return ASSET_CLASS_SPECS.FX_MAJOR;
  }
  if (/^[A-Z]{6}$/.test(canonical)) {
    return ASSET_CLASS_SPECS.FX_CROSS;
  }
  return ASSET_CLASS_SPECS.OTHER;
}

/**
 * Determine the horizon key & numeric code from scenario id or timeframe string.
 * Official 3 Horizons:
 * 1: SWING (1D-1H)
 * 2: DAY   (4H-15M)
 * 3: SCALP (15M-1M)
 */
export function getHorizonCode(scenarioIdOrTf) {
  const str = String(scenarioIdOrTf || "").toUpperCase().trim();
  if (str === "SWING" || str === "1D-1H" || HORIZON_SPECS.SWING.tfs.includes(str)) {
    return HORIZON_SPECS.SWING;
  }
  if (str === "DAY" || str === "DAY_TRADE" || str === "4H-15M" || str === "INTRADAY" || HORIZON_SPECS.DAY.tfs.includes(str)) {
    return HORIZON_SPECS.DAY;
  }
  if (str === "SCALP" || str === "15M-1M" || HORIZON_SPECS.SCALP.tfs.includes(str)) {
    return HORIZON_SPECS.SCALP;
  }
  return HORIZON_SPECS.OTHER;
}

/**
 * Determine the model key & numeric code from entry model id.
 */
export function getModelCode(modelId) {
  const id = String(modelId || "").toLowerCase().trim();
  if (MODEL_SPECS[id]) return MODEL_SPECS[id];
  for (const spec of Object.values(MODEL_SPECS)) {
    if (id.includes(spec.key) || id === spec.short.toLowerCase()) return spec;
  }
  return MODEL_SPECS.other;
}

/**
 * Determine the management key & numeric code.
 */
export function getManagementCode(mgtId) {
  const id = String(mgtId || "").toLowerCase().trim();
  if (MANAGEMENT_SPECS[id]) return MANAGEMENT_SPECS[id];
  if (["milestone_50", "milestone", "runner", "swing", "mg1", "1"].includes(id)) {
    return MANAGEMENT_SPECS.milestone_50;
  }
  if (["prop_firm_safe", "prop_firm", "safe", "bracket", "mg2", "2", "trailing_fractal", "fixed_target", "mg3", "mg4", "mg5"].includes(id)) {
    return MANAGEMENT_SPECS.prop_firm_safe;
  }
  for (const spec of Object.values(MANAGEMENT_SPECS)) {
    if (id.includes(spec.key) || id === spec.short.toLowerCase()) return spec;
  }
  return MANAGEMENT_SPECS.milestone_50; // TradeSpace default management
}

/**
 * Encode an institutional Decimal Magic Number (8 digits: PP A H M L RR).
 * Range: 23000000 to 23999999 (completely within standard 32-bit uint).
 */
export function encodeDecimalMagic({
  symbol,
  horizon,
  modelId,
  management,
  accountTier = 0,
  prefix = MAGIC_PREFIX,
} = {}) {
  const assetSpec = getAssetClass(symbol);
  const horizonSpec = getHorizonCode(horizon);
  const modelSpec = getModelCode(modelId);
  const mgtSpec = getManagementCode(management);

  const p = Math.max(10, Math.min(99, Number(prefix) || MAGIC_PREFIX));
  const a = Math.max(0, Math.min(9, assetSpec.code));
  const h = Math.max(0, Math.min(9, horizonSpec.code));
  const m = Math.max(0, Math.min(9, modelSpec.code));
  const l = Math.max(0, Math.min(9, mgtSpec.code));
  const r = Math.max(0, Math.min(99, Number(accountTier) || 0));

  return p * 1000000 + a * 100000 + h * 10000 + m * 1000 + l * 100 + r;
}

/**
 * Decode an 8-digit Decimal Magic Number into its structural dimensions.
 */
export function decodeDecimalMagic(magic) {
  const num = Number(magic);
  if (!Number.isFinite(num) || num < 10000000 || num > 99999999) {
    return { valid: false, error: "Invalid magic number length/format" };
  }

  const prefix = Math.floor(num / 1000000);
  const a = Math.floor((num % 1000000) / 100000);
  const h = Math.floor((num % 100000) / 10000);
  const m = Math.floor((num % 10000) / 1000);
  const l = Math.floor((num % 1000) / 100);
  const r = num % 100;

  const asset = Object.values(ASSET_CLASS_SPECS).find((s) => s.code === a) || ASSET_CLASS_SPECS.OTHER;
  const horizon = Object.values(HORIZON_SPECS).find((s) => s.code === h) || HORIZON_SPECS.OTHER;
  const model = Object.values(MODEL_SPECS).find((s) => s.code === m) || MODEL_SPECS.other;
  const management = Object.values(MANAGEMENT_SPECS).find((s) => s.code === l) || MANAGEMENT_SPECS.other;

  return {
    valid: true,
    magic: num,
    prefix,
    isTradeSpace: prefix === MAGIC_PREFIX,
    asset,
    horizon,
    model,
    management,
    accountTier: r,
    summary: `${asset.label} · ${horizon.label} · ${model.badge} · ${management.label} (Tier ${r.toString().padStart(2, "0")})`,
  };
}

/**
 * Format an ultra-clean, structured MT5 Comment string (guaranteed <= 31 characters).
 * Format: "TS:SYM_TAG:TF:MDL:MGT:Txx"
 * Example: "TS:NAS15:M1:MG1:T01" (19 chars)
 */
export function formatCopierComment({
  symbol,
  tf = "15M",
  horizon,
  modelId,
  management,
  accountTier = 0,
  prefix = "TS",
} = {}) {
  const canon = canonOf(symbol);
  const baseSym = canon === "NAS100" ? "NAS" : canon.replace(/USD$/i, "").slice(0, 5);
  const cleanTf = String(tf || (horizon ? getHorizonCode(horizon).key : "15M")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const mdlShort = getModelCode(modelId).short;
  const mgtShort = getManagementCode(management).short;
  const tierStr = `T${String(accountTier).padStart(2, "0")}`;

  const comment = `${prefix}:${baseSym}:${cleanTf}:${mdlShort}:${mgtShort}:${tierStr}`;
  return comment.slice(0, 31);
}

/**
 * Parse a structured TradeSpace comment back into tags.
 */
export function parseCopierComment(commentStr) {
  if (!commentStr || typeof commentStr !== "string") return null;
  const parts = commentStr.split(":");
  if (parts.length < 5 || parts[0] !== "TS") return null;

  return {
    prefix: parts[0],
    symbolTag: parts[1],
    tf: parts[2],
    modelTag: parts[3],
    managementTag: parts[4],
    tierTag: parts[5] || "T00",
  };
}

/**
 * Evaluate if a trade is eligible for a specific Copier / Funded Account Profile.
 * Provides the core routing logic for multi-account diversification.
 */
export function evaluateCopierEligibility(trade, profile) {
  if (!profile || profile.enabled === false) {
    return { eligible: false, reasons: ["Profile disabled"] };
  }

  const tradeSymbol = canonOf(trade.symbol || trade.canonicalSymbol);
  const tradeAsset = getAssetClass(tradeSymbol).key;
  const tradeHorizon = getHorizonCode(trade.scenario?.id || trade.tf || "intraday").key;
  const tradeModel = getModelCode(trade.entryModel?.id || trade.modelId).key;
  const tradeMgt = getManagementCode(trade.managementLogic || "milestone_50").key;

  const reasons = [];
  const matches = [];

  // 1. Asset Class Filter
  if (profile.allowedAssets && !profile.allowedAssets.includes("all")) {
    if (!profile.allowedAssets.includes(tradeAsset)) {
      reasons.push(`Asset class '${tradeAsset}' not allowed in [${profile.allowedAssets.join(", ")}]`);
    } else {
      matches.push(`Asset class '${tradeAsset}' matched`);
    }
  }

  // 2. Explicit Symbol Whitelist
  if (profile.allowedSymbols && !profile.allowedSymbols.includes("all")) {
    const symbolMatches = profile.allowedSymbols.some((s) => canonOf(s) === tradeSymbol);
    if (!symbolMatches) {
      reasons.push(`Symbol '${tradeSymbol}' not allowed in [${profile.allowedSymbols.join(", ")}]`);
    } else {
      matches.push(`Symbol '${tradeSymbol}' whitelisted`);
    }
  }

  // 3. Horizon Filter
  if (profile.allowedHorizons && !profile.allowedHorizons.includes("all") && !profile.allowedHorizons.includes("any")) {
    const allowed = profile.allowedHorizons.map((h) => getHorizonCode(h).key);
    if (!allowed.includes(tradeHorizon)) {
      reasons.push(`Horizon '${tradeHorizon}' not allowed in [${profile.allowedHorizons.join(", ")}]`);
    } else {
      matches.push(`Horizon '${tradeHorizon}' matched`);
    }
  }

  // 4. Entry Model Filter
  if (profile.allowedModels && !profile.allowedModels.includes("all")) {
    if (!profile.allowedModels.includes(tradeModel)) {
      reasons.push(`Model '${tradeModel}' not allowed in [${profile.allowedModels.join(", ")}]`);
    } else {
      matches.push(`Model '${tradeModel}' matched`);
    }
  }

  // 5. Management Logic Filter
  if (profile.allowedManagements && !profile.allowedManagements.includes("all")) {
    if (!profile.allowedManagements.includes(tradeMgt)) {
      reasons.push(`Management '${tradeMgt}' not allowed in [${profile.allowedManagements.join(", ")}]`);
    } else {
      matches.push(`Management '${tradeMgt}' matched`);
    }
  }

  const eligible = reasons.length === 0;
  return {
    profileId: profile.id,
    profileName: profile.name,
    accountTier: profile.accountTier,
    riskOverridePct: profile.riskOverridePct,
    eligible,
    matches,
    reasons,
  };
}

/**
 * Resolve routing across all defined copier profiles for a given trade.
 */
export function resolveCopierRouting(trade, profiles = DEFAULT_COPIER_PROFILES) {
  const evaluations = (profiles || DEFAULT_COPIER_PROFILES).map((p) => evaluateCopierEligibility(trade, p));
  const eligibleAccounts = evaluations.filter((e) => e.eligible);
  const filteredAccounts = evaluations.filter((e) => !e.eligible);

  const primaryTier = eligibleAccounts.length > 0 ? eligibleAccounts[0].accountTier : 0;
  const magicNumber = encodeDecimalMagic({
    symbol: trade.symbol || trade.canonicalSymbol,
    horizon: trade.scenario?.id || trade.tf || "15M",
    modelId: trade.entryModel?.id || trade.modelId,
    management: trade.managementLogic || "milestone_50",
    accountTier: primaryTier,
  });

  const comment = formatCopierComment({
    symbol: trade.symbol || trade.canonicalSymbol,
    tf: trade.tf || "15M",
    horizon: trade.scenario?.id || trade.tf || "15M",
    modelId: trade.entryModel?.id || trade.modelId,
    management: trade.managementLogic || "milestone_50",
    accountTier: primaryTier,
  });

  return {
    magicNumber,
    comment,
    primaryTier,
    eligibleAccounts,
    filteredAccounts,
    evaluations,
    allAccountsCount: evaluations.length,
    eligibleCount: eligibleAccounts.length,
  };
}

