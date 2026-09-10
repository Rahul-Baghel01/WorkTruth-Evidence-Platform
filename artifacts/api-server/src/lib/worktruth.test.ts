import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toSignalComponents } from "./worktruth";
import { DEFAULT_LENS_WEIGHTS, type EvidenceFusionResult, type NormalizedLens } from "./fusion-engine";

// toSignalComponents only reads fusion.lenses[{lens,score,effectiveWeight,
// isInsufficientEvidence}] and fusion.weights, so a partial fixture cast to
// the result type is the precise level to test the mapping at.
function lens(over: Partial<NormalizedLens> & Pick<NormalizedLens, "lens">): NormalizedLens {
  return {
    status: "WITHIN_EXPECTED_RANGE",
    isInsufficientEvidence: false,
    isAnomalous: false,
    score: 0,
    confidence: 0.8,
    effectiveWeight: 0,
    checks: [],
    reasons: [],
    engineVersion: "test",
    ...over,
  };
}

function fusion(lenses: NormalizedLens[]): EvidenceFusionResult {
  return { weights: DEFAULT_LENS_WEIGHTS, lenses } as EvidenceFusionResult;
}

describe("toSignalComponents (risk.components mapping)", () => {
  test("P-1562 shape: a tiny geographic score yields a tiny contribution, not ~59", () => {
    // Geographic score ~0.03 with its real fusion effectiveWeight ~0.14 —
    // contribution must be well under 1 point. The old code multiplied the
    // raw configured weight (0.2) then a stale getProject re-scale ×100'd it.
    const components = toSignalComponents(
      fusion([
        lens({ lens: "financial", score: 0 }),
        lens({ lens: "geospatial", score: 0.0297, effectiveWeight: 0.1414 }),
        lens({ lens: "temporal", score: 0 }),
        lens({ lens: "text", score: 0 }),
        lens({ lens: "visual", score: 0 }),
      ]),
    );
    const geo = components.find((c) => c.label === "Geographic")!;
    assert.equal(geo.score, 0.0297); // unchanged raw lens score — still ~3% in the UI
    assert.ok(geo.contribution < 1, `expected < 1 point, got ${geo.contribution}`);
    assert.ok(Math.round(geo.contribution) === 0);
  });

  test("contribution uses effectiveWeight (confidence-adjusted), not the raw configured weight", () => {
    const [fin] = toSignalComponents(fusion([lens({ lens: "financial", score: 0.8, effectiveWeight: 0.5 })]));
    assert.equal(fin.weight, DEFAULT_LENS_WEIGHTS.financial); // configured weight surfaced as-is
    assert.equal(fin.contribution, 0.8 * 0.5 * 100); // 40 points, from effectiveWeight
  });

  test("an insufficient-evidence lens is marked evidenceSufficient:false with a 0 contribution", () => {
    const [t] = toSignalComponents(fusion([lens({ lens: "text", score: null, isInsufficientEvidence: true, effectiveWeight: 0 })]));
    assert.equal(t.evidenceSufficient, false);
    assert.equal(t.score, 0);
    assert.equal(t.contribution, 0);
  });

  test("available lenses' contributions sum to the fusion base score ×100", () => {
    // effectiveWeights sum to 1 across available lenses (as the engine guarantees).
    const components = toSignalComponents(
      fusion([
        lens({ lens: "financial", score: 0.4, effectiveWeight: 0.3 }),
        lens({ lens: "geospatial", score: 0.1, effectiveWeight: 0.2 }),
        lens({ lens: "temporal", score: 0, effectiveWeight: 0.2 }),
        lens({ lens: "text", score: 0.2, effectiveWeight: 0.1 }),
        lens({ lens: "visual", score: 0.6, effectiveWeight: 0.2 }),
      ]),
    );
    const sum = components.reduce((s, c) => s + c.contribution, 0);
    const expected = (0.4 * 0.3 + 0.1 * 0.2 + 0 + 0.2 * 0.1 + 0.6 * 0.2) * 100;
    assert.ok(Math.abs(sum - expected) < 1e-9);
  });
});
