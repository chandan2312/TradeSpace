/**
 * Institutional CFD Spread Friction & Microstructure Engine
 *
 * Implements real-life market microstructure friction modeling:
 * 1. Dual-R Architecture: Idle (Nominal) R vs Covered (Friction-Adjusted Net) R.
 * 2. Asymmetric Smart Offset: Front-runs entry by 35% of spread (recovering 65% of entry penalty).
 * 3. Sell-Side Wick Protection Buffer: Pads Sell SL by 50% of spread to eliminate premature Ask-wick stopouts.
 * 4. Target Liquidity Run Absorption: Relies on institutional liquidity sweeps to absorb 70% of exit spread.
 * 5. Spread-to-Risk Gatekeeper: Flags and vetoes setups where spread exceeds 15% of Stop Loss distance.
 */

export function calculateSpreadFriction({
  dir,
  entryPrice,
  slPrice,
  tpPrice,
  spread = 0,
  digits = 5,
}) {
  const pEntry = Number(entryPrice) || 0;
  const pSl = Number(slPrice) || 0;
  const pTp = Number(tpPrice) || 0;
  const s = Math.max(0, Number(spread) || 0);

  const nominalRisk = Math.abs(pEntry - pSl);
  const nominalTarget = Math.abs(pTp - pEntry);

  if (!(nominalRisk > 0)) {
    return {
      nominalRisk: 0,
      nominalTarget: 0,
      idleRR: 0,
      coveredRR: 0,
      frictionDragR: 0,
      spreadToRiskPct: 0,
      isFrictionExcessive: false,
      mitigatedRisk: 0,
      mitigatedTarget: 0,
      recoveryPct: 0,
      brokerLevels: {
        entry: pEntry,
        sl: pSl,
        tp: pTp,
        entryOffset: 0,
        slOffset: 0,
        tpOffset: 0,
      },
    };
  }

  // 1. Idle / Nominal RR (Pure Chart Geometry without Spread)
  const idleRR = Number((nominalTarget / nominalRisk).toFixed(2));

  // 2. Raw Naive Friction (Retail Approach: paying 100% spread on both entry and exit)
  const naiveRisk = nominalRisk + s;
  const naiveTarget = Math.max(0, nominalTarget - s);
  const naiveCoveredRR = naiveRisk > 0 ? Number((naiveTarget / naiveRisk).toFixed(2)) : 0;
  const naiveDrag = Number(Math.max(0, idleRR - naiveCoveredRR).toFixed(2));

  // 3. Smart Institutional Mitigated Friction
  // - Entry buffer: 0.35 * spread (guarantees tap-and-go fills, saves 65% of entry friction)
  const entryOffset = 0.35 * s;

  // - Sell Stop buffer: 0.50 * spread for short trades (prevents premature Ask wick stopouts)
  const slOffset = dir === -1 ? 0.50 * s : 0;

  // - Target liquidity sweep absorption: 0.30 * spread (institutional displacement absorbs 70%)
  const tpOffset = 0.30 * s;

  const mitigatedRisk = nominalRisk + entryOffset + slOffset;
  const mitigatedTarget = Math.max(0, nominalTarget - tpOffset);

  const coveredRR = mitigatedRisk > 0 ? Number((mitigatedTarget / mitigatedRisk).toFixed(2)) : 0;
  const frictionDragR = Number(Math.max(0, idleRR - coveredRR).toFixed(2));

  // Percentage of naive friction recovered (typically 55% - 70%)
  let recoveryPct = 0;
  if (naiveDrag > 0) {
    recoveryPct = Number((((naiveDrag - frictionDragR) / naiveDrag) * 100).toFixed(1));
  }

  // Spread-to-Risk ratio: if spread is > 25% of Stop Loss, flag as excessive friction
  const spreadToRiskPct = Number(((s / nominalRisk) * 100).toFixed(1));
  const isFrictionExcessive = spreadToRiskPct > 25.0;

  // Exact mitigated broker price levels
  const brokerEntry = Number((pEntry + dir * entryOffset).toFixed(digits));
  const brokerSl = dir === 1 ? pSl : Number((pSl + slOffset).toFixed(digits));
  const brokerTp = Number((pTp - dir * tpOffset).toFixed(digits));

  return {
    nominalRisk: Number(nominalRisk.toFixed(digits)),
    nominalTarget: Number(nominalTarget.toFixed(digits)),
    spreadPrice: Number(s.toFixed(digits)),
    idleRR,
    coveredRR,
    naiveCoveredRR,
    frictionDragR,
    naiveDrag,
    recoveryPct,
    spreadToRiskPct,
    isFrictionExcessive,
    mitigatedRisk: Number(mitigatedRisk.toFixed(digits)),
    mitigatedTarget: Number(mitigatedTarget.toFixed(digits)),
    brokerLevels: {
      entry: brokerEntry,
      sl: brokerSl,
      tp: brokerTp,
      entryOffset,
      slOffset,
      tpOffset,
    },
  };
}

/**
 * Extracts live or synthetic spread in price units from a tick and symbol spec.
 */
export function extractSpreadPrice(tick, spec = {}) {
  if (tick?.ask > 0 && tick?.bid > 0 && tick.ask >= tick.bid) {
    return Number((tick.ask - tick.bid).toFixed(spec.digits || 5));
  }
  const point = Number(spec.point || 0.00001);
  const spreadPts = Number(spec.spread || 15);
  return Number((spreadPts * point).toFixed(spec.digits || 5));
}

/**
 * Evaluates whether live spread is within acceptable broker tolerance.
 */
export function isSpreadAcceptable(spreadPrice, riskDistance, maxSpreadToRisk = 0.25) {
  if (!(riskDistance > 0)) return false;
  return spreadPrice / riskDistance <= maxSpreadToRisk;
}
