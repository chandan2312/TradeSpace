import { evaluateAllEntryModels, symbolUnits } from "./models.js";

export function selectOptimalEntryLevel({
  symbol,
  dir,
  scenario,
  frames = {},
  ranges,
  htfFvg,
  targetDOL,
  config = {},
  brain = {},
}) {
  // 1. Try resolving via the 5 Dynamic Institutional Entry Models
  const modelResult = evaluateAllEntryModels({
    symbol,
    dir,
    scenario,
    frames,
    ranges,
    htfFvg,
    targetDOL,
    config,
    brain,
  });

  const units = symbolUnits(symbol, { ...config, symbolMeta: frames?.symbolMeta || config?.symbolMeta });

  if (modelResult) {
    const risk = Math.abs(modelResult.entry - modelResult.sl);
    return {
      ...modelResult,
      riskPips: units.pip > 0 ? Math.abs(modelResult.entry - modelResult.sl) / units.pip : null,
      riskDistance: risk,
      targetDOL,
      dealingRange: brain?.dealingRange || (
        scenario?.id === "swing" ? (ranges?.D1 || ranges?.H4) :
        scenario?.id === "scalp" ? (ranges?.M30 || ranges?.["30M"] || ranges?.M15 || ranges?.M5) :
        (ranges?.H4 || ranges?.H1)
      ),
      thesisId: brain?.thesisId || brain?.verdict || "HTF_STRUCTURE",
      ideaId: `${brain?.thesisId || "thesis"}:${modelResult.modelId}:${modelResult.tf}:${modelResult.entry}`,
    };
  }

  // Institutional Rule: NO SYNTHETIC FALLBACK!
  // If no strict causal entry model met its conditions, zero trades are staged.
  return null;
}

export { evaluateExecutionVetoes } from "./models.js";
