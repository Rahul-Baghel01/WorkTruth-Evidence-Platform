import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGeoEvidence, haversineDistanceMeters, isValidLatitude, isValidLongitude, type RawEvidenceImage } from "./geo-engine";

describe("coordinate validation", () => {
  test("latitude range", () => {
    assert.equal(isValidLatitude(45), true);
    assert.equal(isValidLatitude(90), true);
    assert.equal(isValidLatitude(-90), true);
    assert.equal(isValidLatitude(90.1), false);
    assert.equal(isValidLatitude(-90.1), false);
    assert.equal(isValidLatitude(Number.NaN), false);
    assert.equal(isValidLatitude(null), false);
    assert.equal(isValidLatitude(undefined), false);
  });

  test("longitude range", () => {
    assert.equal(isValidLongitude(120), true);
    assert.equal(isValidLongitude(180), true);
    assert.equal(isValidLongitude(-180), true);
    assert.equal(isValidLongitude(180.1), false);
    assert.equal(isValidLongitude(-200), false);
  });

  test("haversine distance between identical points is 0", () => {
    const p = { lat: 26.4499, lng: 80.3319 };
    assert.equal(haversineDistanceMeters(p, p), 0);
  });

  test("haversine distance is symmetric", () => {
    const a = { lat: 26.4499, lng: 80.3319 };
    const b = { lat: 26.46, lng: 80.34 };
    assert.equal(haversineDistanceMeters(a, b), haversineDistanceMeters(b, a));
  });
});

describe("evaluateGeoEvidence", () => {
  const declared = { latitude: 26.4499, longitude: 80.3319 };

  test("A. valid coordinates at the same location: no anomaly", () => {
    const images: RawEvidenceImage[] = [{ id: 1, label: "Photo", gpsLatitude: 26.4499, gpsLongitude: 80.3319, gpsAccuracyMeters: 10 }];
    const result = evaluateGeoEvidence(declared, images);
    assert.equal(result.status, "LOCATION_CONSISTENT");
    assert.equal(result.medianDistanceMeters, 0);
    assert.ok(result.score !== null && result.score < 0.35);
  });

  test("B. small legitimate distance stays consistent", () => {
    // ~50m north
    const images: RawEvidenceImage[] = [{ id: 1, label: "Photo", gpsLatitude: 26.4504, gpsLongitude: 80.3319, gpsAccuracyMeters: 15 }];
    const result = evaluateGeoEvidence(declared, images);
    assert.equal(result.status, "LOCATION_CONSISTENT");
    assert.ok(result.medianDistanceMeters !== null && result.medianDistanceMeters < 200);
  });

  test("C. large location mismatch is flagged as an anomaly", () => {
    // roughly 10km away
    const images: RawEvidenceImage[] = [{ id: 1, label: "Photo", gpsLatitude: 26.54, gpsLongitude: 80.3319, gpsAccuracyMeters: 10 }];
    const result = evaluateGeoEvidence(declared, images);
    assert.equal(result.status, "LOCATION_ANOMALY");
    assert.ok(result.checks.some((c) => c.name === "location_anomaly" && c.severity === "HIGH"));
    assert.ok(result.reasons.some((r) => r.includes("well beyond the expected range")));
  });

  test("D. missing GPS on all images is insufficient evidence, not an anomaly", () => {
    const images: RawEvidenceImage[] = [
      { id: 1, label: "Photo 1", gpsLatitude: null, gpsLongitude: null, gpsAccuracyMeters: null },
      { id: 2, label: "Photo 2", gpsLatitude: null, gpsLongitude: null, gpsAccuracyMeters: null },
    ];
    const result = evaluateGeoEvidence(declared, images);
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
    assert.equal(result.missingGpsCount, 2);
    assert.ok(result.reasons.some((r) => r.includes("missing from all submitted images")));
  });

  test("E. invalid latitude/longitude is excluded, not treated as valid", () => {
    const images: RawEvidenceImage[] = [{ id: 1, label: "Photo", gpsLatitude: 95, gpsLongitude: 300, gpsAccuracyMeters: 10 }];
    const result = evaluateGeoEvidence(declared, images);
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.validGpsCount, 0);
    assert.equal(result.invalidGpsCount, 1);
    assert.ok(result.checks.some((c) => c.name === "invalid_gps_metadata"));
    const point = result.points.find((p) => p.imageId === 1);
    assert.equal(point?.hasValidGps, false);
    assert.equal(point?.invalidReason, "out_of_range");
  });

  test("F. multiple evidence images: min/max/median/counts are all reported", () => {
    const images: RawEvidenceImage[] = [
      { id: 1, label: "A", gpsLatitude: 26.4499, gpsLongitude: 80.3319, gpsAccuracyMeters: 10 }, // 0m
      { id: 2, label: "B", gpsLatitude: 26.4504, gpsLongitude: 80.3319, gpsAccuracyMeters: 10 }, // ~55m
      { id: 3, label: "C", gpsLatitude: null, gpsLongitude: null, gpsAccuracyMeters: null }, // missing
      { id: 4, label: "D", gpsLatitude: 95, gpsLongitude: 80.3319, gpsAccuracyMeters: 10 }, // invalid
    ];
    const result = evaluateGeoEvidence(declared, images);
    assert.equal(result.imageCount, 4);
    assert.equal(result.validGpsCount, 2);
    assert.equal(result.missingGpsCount, 1);
    assert.equal(result.invalidGpsCount, 1);
    assert.equal(result.minDistanceMeters, 0);
    assert.ok(result.maxDistanceMeters !== null && result.maxDistanceMeters > 0);
    assert.ok(result.reasons.some((r) => r.includes("2 of 4 evidence images contained valid GPS")));
  });

  test("G. conflicting evidence-image locations are flagged", () => {
    const images: RawEvidenceImage[] = [
      { id: 1, label: "A", gpsLatitude: 26.4499, gpsLongitude: 80.3319, gpsAccuracyMeters: 10 },
      { id: 2, label: "B", gpsLatitude: 26.55, gpsLongitude: 80.42, gpsAccuracyMeters: 10 }, // far from A
    ];
    const result = evaluateGeoEvidence(declared, images);
    assert.ok(result.checks.some((c) => c.name === "conflicting_evidence_locations"));
    assert.ok(result.reasons.some((r) => r.includes("disagree with each other")));
  });

  test("H. identical evidence produces identical results regardless of project ID", () => {
    // evaluateGeoEvidence never receives a project id — only latitude/longitude
    // and image GPS data — so it cannot special-case any specific project.
    const images: RawEvidenceImage[] = [{ id: 1, label: "Photo", gpsLatitude: 26.46, gpsLongitude: 80.34, gpsAccuracyMeters: 10 }];
    const resultA = evaluateGeoEvidence(declared, images);
    const resultB = evaluateGeoEvidence(declared, images);
    assert.equal(resultA.score, resultB.score);
    assert.equal(resultA.status, resultB.status);
    assert.deepEqual(resultA.checks.map((c) => c.name), resultB.checks.map((c) => c.name));
    // Not the old hardcoded is1089/is4150 constants (0.55 / 0.72) from before P0-F.
    assert.notEqual(resultA.score, 0.55);
    assert.notEqual(resultA.score, 0.72);
  });

  test("declared coordinates out of range produce insufficient evidence, not a fabricated comparison", () => {
    const result = evaluateGeoEvidence({ latitude: 95, longitude: 80.33 }, [{ id: 1, label: "Photo", gpsLatitude: 26.45, gpsLongitude: 80.33, gpsAccuracyMeters: 10 }]);
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.score, null);
    assert.ok(result.checks.some((c) => c.name === "declared_coordinates_invalid"));
  });

  test("a single valid coordinate is noted as lower confidence", () => {
    const images: RawEvidenceImage[] = [{ id: 1, label: "Photo", gpsLatitude: 26.4499, gpsLongitude: 80.3319, gpsAccuracyMeters: 10 }];
    const result = evaluateGeoEvidence(declared, images);
    assert.ok(result.checks.some((c) => c.name === "single_coordinate_low_confidence"));
    assert.ok(result.reasons.some((r) => r.includes("confidence is limited")));
  });
});
