import { eq } from "drizzle-orm";
import { db, evidenceImagesTable, type ProjectRow } from "@workspace/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const GEO_ENGINE_VERSION = "geo-v1";

export type GeoCheckSeverity = "INFO" | "LOW" | "MODERATE" | "HIGH";

export type GeoCheck = {
  name: string;
  severity: GeoCheckSeverity;
  message: string;
  observed?: Record<string, number>;
  supportingImageIds?: number[];
};

export type GeoEvidencePoint = {
  imageId: number;
  label: string | null;
  hasValidGps: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  invalidReason: "missing" | "out_of_range" | null;
};

export type GeoStatus = "INSUFFICIENT_EVIDENCE" | "LOCATION_CONSISTENT" | "LOCATION_ANOMALY";

export type GeoAnalysisResult = {
  status: GeoStatus;
  score: number | null;
  confidence: number;
  declaredLatitude: number | null;
  declaredLongitude: number | null;
  imageCount: number;
  validGpsCount: number;
  invalidGpsCount: number;
  missingGpsCount: number;
  minDistanceMeters: number | null;
  maxDistanceMeters: number | null;
  medianDistanceMeters: number | null;
  points: GeoEvidencePoint[];
  checks: GeoCheck[];
  reasons: string[];
  engineVersion: string;
  updatedAt: string;
};

export type RawEvidenceImage = {
  id: number;
  label: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracyMeters: number | null;
};

// ---------------------------------------------------------------------------
// Tunable constants — documented so the score is reproducible and explainable
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000;

// A median (or pairwise-spread) distance at or beyond this saturates the
// score component at 1.0. 2km is well beyond plausible GPS drift or a large
// project site — chosen as a conservative "clearly a different place" bar.
const DISTANCE_SATURATION_METERS = 2000;

// Below this, distance is treated as consistent with normal GPS drift /
// project-site footprint — no check is raised.
const MODERATE_DISTANCE_METERS = 200;

// Beyond this, a distance is flagged HIGH rather than MODERATE.
const HIGH_DISTANCE_METERS = 1000;

// score >= this maps to LOCATION_ANOMALY, otherwise LOCATION_CONSISTENT.
const ANOMALY_SCORE_THRESHOLD = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

// ---------------------------------------------------------------------------
// Coordinate validation and distance — pure, unit-testable
// ---------------------------------------------------------------------------

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS_METERS * c;
}

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O, fully unit-testable with synthetic fixtures
// ---------------------------------------------------------------------------

export function evaluateGeoEvidence(project: { latitude: number; longitude: number }, rawImages: RawEvidenceImage[]): GeoAnalysisResult {
  const now = new Date().toISOString();
  const checks: GeoCheck[] = [];
  const reasons: string[] = [];

  const declaredValid = isValidLatitude(project.latitude) && isValidLongitude(project.longitude);
  if (!declaredValid) {
    checks.push({
      name: "declared_coordinates_invalid",
      severity: "HIGH",
      message: "The project's recorded coordinates are missing or out of range; geospatial comparison could not be performed.",
    });
    return {
      status: "INSUFFICIENT_EVIDENCE",
      score: null,
      confidence: 0,
      declaredLatitude: Number.isFinite(project.latitude) ? project.latitude : null,
      declaredLongitude: Number.isFinite(project.longitude) ? project.longitude : null,
      imageCount: rawImages.length,
      validGpsCount: 0,
      invalidGpsCount: 0,
      missingGpsCount: 0,
      minDistanceMeters: null,
      maxDistanceMeters: null,
      medianDistanceMeters: null,
      points: [],
      checks,
      reasons: ["The project's recorded coordinates are invalid, so evidence GPS could not be compared against a project location."],
      engineVersion: GEO_ENGINE_VERSION,
      updatedAt: now,
    };
  }

  const declared = { lat: project.latitude, lng: project.longitude };
  const points: GeoEvidencePoint[] = rawImages.map((image) => {
    const hasLat = image.gpsLatitude !== null && image.gpsLatitude !== undefined;
    const hasLng = image.gpsLongitude !== null && image.gpsLongitude !== undefined;
    const accuracyMeters = image.gpsAccuracyMeters ?? null;
    if (!hasLat && !hasLng) {
      return { imageId: image.id, label: image.label, hasValidGps: false, latitude: null, longitude: null, accuracyMeters, distanceMeters: null, invalidReason: "missing" };
    }
    const latValid = isValidLatitude(image.gpsLatitude);
    const lngValid = isValidLongitude(image.gpsLongitude);
    if (!hasLat || !hasLng || !latValid || !lngValid) {
      return {
        imageId: image.id,
        label: image.label,
        hasValidGps: false,
        latitude: hasLat && latValid ? (image.gpsLatitude as number) : null,
        longitude: hasLng && lngValid ? (image.gpsLongitude as number) : null,
        accuracyMeters,
        distanceMeters: null,
        invalidReason: "out_of_range",
      };
    }
    const lat = image.gpsLatitude as number;
    const lng = image.gpsLongitude as number;
    return { imageId: image.id, label: image.label, hasValidGps: true, latitude: lat, longitude: lng, accuracyMeters, distanceMeters: haversineDistanceMeters(declared, { lat, lng }), invalidReason: null };
  });

  const validPoints = points.filter((p) => p.hasValidGps);
  const invalidPoints = points.filter((p) => p.invalidReason === "out_of_range");
  const missingPoints = points.filter((p) => p.invalidReason === "missing");

  if (invalidPoints.length) {
    checks.push({
      name: "invalid_gps_metadata",
      severity: "LOW",
      message: `${invalidPoints.length} evidence image${invalidPoints.length === 1 ? "" : "s"} had malformed or out-of-range GPS metadata and could not be used.`,
      supportingImageIds: invalidPoints.map((p) => p.imageId),
    });
  }
  if (!rawImages.length) {
    checks.push({ name: "no_evidence_images", severity: "INFO", message: "No evidence images are recorded for this project." });
  }

  if (!validPoints.length) {
    reasons.push(rawImages.length ? "GPS coordinates were missing from all submitted images." : "No evidence images are available for this project.");
    return {
      status: "INSUFFICIENT_EVIDENCE",
      score: null,
      confidence: 0,
      declaredLatitude: declared.lat,
      declaredLongitude: declared.lng,
      imageCount: rawImages.length,
      validGpsCount: 0,
      invalidGpsCount: invalidPoints.length,
      missingGpsCount: missingPoints.length,
      minDistanceMeters: null,
      maxDistanceMeters: null,
      medianDistanceMeters: null,
      points,
      checks,
      reasons,
      engineVersion: GEO_ENGINE_VERSION,
      updatedAt: now,
    };
  }

  const distances = validPoints.map((p) => p.distanceMeters as number);
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const medianDistance = median(distances) as number;

  reasons.push(`${validPoints.length} of ${rawImages.length} evidence image${rawImages.length === 1 ? "" : "s"} contained valid GPS coordinates.`);
  if (validPoints.length === 1) {
    reasons.push(`One evidence image was ${formatDistance(distances[0])} from the recorded project location.`);
    const singleCoordinateCheck = { name: "single_coordinate_low_confidence", severity: "INFO" as const, message: "Only one valid coordinate was available; confidence is limited." };
    checks.push(singleCoordinateCheck);
    reasons.push(singleCoordinateCheck.message);
  } else {
    reasons.push(`Median distance from the recorded project location was ${formatDistance(medianDistance)}.`);
  }

  if (medianDistance > HIGH_DISTANCE_METERS) {
    checks.push({
      name: "location_anomaly",
      severity: "HIGH",
      message: `Evidence GPS is ${formatDistance(medianDistance)} (median) from the recorded project location — well beyond the expected range.`,
      observed: { medianDistanceMeters: medianDistance },
      supportingImageIds: validPoints.map((p) => p.imageId),
    });
  } else if (medianDistance > MODERATE_DISTANCE_METERS) {
    checks.push({
      name: "location_anomaly",
      severity: "MODERATE",
      message: `Evidence GPS is ${formatDistance(medianDistance)} (median) from the recorded project location.`,
      observed: { medianDistanceMeters: medianDistance },
      supportingImageIds: validPoints.map((p) => p.imageId),
    });
  } else {
    checks.push({ name: "location_consistent", severity: "INFO", message: `Evidence GPS is consistent with the recorded project location (median ${formatDistance(medianDistance)}).`, observed: { medianDistanceMeters: medianDistance } });
  }

  let maxPairwiseDistance = 0;
  for (let i = 0; i < validPoints.length; i++) {
    for (let j = i + 1; j < validPoints.length; j++) {
      const d = haversineDistanceMeters(
        { lat: validPoints[i].latitude as number, lng: validPoints[i].longitude as number },
        { lat: validPoints[j].latitude as number, lng: validPoints[j].longitude as number },
      );
      if (d > maxPairwiseDistance) maxPairwiseDistance = d;
    }
  }
  if (validPoints.length >= 2 && maxPairwiseDistance > MODERATE_DISTANCE_METERS) {
    checks.push({
      name: "conflicting_evidence_locations",
      severity: maxPairwiseDistance > HIGH_DISTANCE_METERS ? "HIGH" : "MODERATE",
      message: `Evidence images disagree with each other by up to ${formatDistance(maxPairwiseDistance)} — they may not represent the same physical location.`,
      observed: { maxPairwiseDistanceMeters: maxPairwiseDistance },
      supportingImageIds: validPoints.map((p) => p.imageId),
    });
  }

  // Score: max of a distance-from-declared component and an
  // images-disagree-with-each-other component, each bounded to [0,1].
  const distanceComponent = clamp(medianDistance / DISTANCE_SATURATION_METERS, 0, 1);
  const spreadComponent = validPoints.length >= 2 ? clamp(maxPairwiseDistance / DISTANCE_SATURATION_METERS, 0, 1) : 0;
  const score = clamp(Math.max(distanceComponent, spreadComponent), 0, 1);
  const status: GeoStatus = score >= ANOMALY_SCORE_THRESHOLD ? "LOCATION_ANOMALY" : "LOCATION_CONSISTENT";

  // Confidence is separate from the anomaly score: more corroborating valid
  // points raise it (capped), malformed metadata lowers it slightly.
  let confidence = 0.25 + Math.min(validPoints.length, 4) * 0.15;
  if (invalidPoints.length) confidence -= 0.05 * Math.min(invalidPoints.length, 3);
  confidence = clamp(confidence, 0.1, 0.95);

  const triggered = checks.filter((c) => c.severity !== "INFO");
  if (triggered.length) {
    for (const c of triggered) if (!reasons.includes(c.message)) reasons.push(c.message);
  } else {
    reasons.push("Available location metadata is consistent with the declared project location.");
  }

  return {
    status,
    score,
    confidence,
    declaredLatitude: declared.lat,
    declaredLongitude: declared.lng,
    imageCount: rawImages.length,
    validGpsCount: validPoints.length,
    invalidGpsCount: invalidPoints.length,
    missingGpsCount: missingPoints.length,
    minDistanceMeters: minDistance,
    maxDistanceMeters: maxDistance,
    medianDistanceMeters: medianDistance,
    points,
    checks,
    reasons,
    engineVersion: GEO_ENGINE_VERSION,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// I/O wrapper
// ---------------------------------------------------------------------------

export async function computeGeoAnalysis(project: ProjectRow): Promise<GeoAnalysisResult> {
  const images = await db.select().from(evidenceImagesTable).where(eq(evidenceImagesTable.projectId, project.id));
  const rawImages: RawEvidenceImage[] = images.map((image) => ({
    id: image.id,
    label: image.label,
    gpsLatitude: image.gpsLatitude,
    gpsLongitude: image.gpsLongitude,
    gpsAccuracyMeters: image.gpsAccuracyMeters,
  }));
  return evaluateGeoEvidence(project, rawImages);
}
