import { createHash } from "node:crypto";
import { Jimp } from "jimp";
import exifr from "exifr";

// ---------------------------------------------------------------------------
// What this actually does, and what it does not
// ---------------------------------------------------------------------------
// - SHA-256 (Node's built-in crypto, zero dependency): exact-byte identity.
// - Perceptual hash: jimp's built-in `image.hash(2)`, a real pHash
//   implementation (resize to 32x32 -> greyscale -> 32x32 DCT -> keep the
//   top-left 8x8 low-frequency coefficients -> threshold against their mean
//   -> 64-bit string), the classic algorithm described at
//   hackerfactor.com/blog "Looks Like It". Returned in base 2 (64 characters
//   of '0'/'1') so Hamming distance is a direct character comparison.
// - EXIF (via exifr): capture date and GPS, read directly from the file's
//   embedded metadata — never derived, guessed, or defaulted to upload time.
// - No object/content recognition of any kind exists here. There is no
//   "this looks 70% complete" capability — that would require a real vision
//   model, which this workspace does not have and this phase does not add.

export type ExtractedImageMetadata = {
  width: number | null;
  height: number | null;
  capturedAt: Date | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracyMeters: number | null;
  perceptualHash: string | null;
};

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Character-wise Hamming distance between two equal-length binary pHash
// strings. Mismatched lengths (should not happen for hashes this module
// produces) are treated as maximally different rather than thrown on, since
// this is meant to be a safe comparison, not a strict-typed assertion.
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return Math.max(hashA.length, hashB.length);
  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) distance += 1;
  }
  return distance;
}

// Decodes the image (dimensions + perceptual hash) and separately reads its
// EXIF metadata (capture date + GPS). Each half fails independently and
// silently degrades to nulls — a file with no EXIF is not an error, and a
// file jimp can't decode still gets whatever EXIF it might carry checked
// (rare in practice, kept for robustness). The caller is responsible for
// deciding whether "could not decode as an image at all" should reject the
// upload outright.
export async function extractImageMetadata(buffer: Buffer): Promise<ExtractedImageMetadata> {
  let width: number | null = null;
  let height: number | null = null;
  let perceptualHash: string | null = null;
  try {
    const image = await Jimp.read(buffer);
    width = image.bitmap.width;
    height = image.bitmap.height;
    perceptualHash = image.hash(2);
  } catch {
    // Not decodable as an image by jimp's supported formats (jpeg/png/bmp/gif/tiff).
  }

  let capturedAt: Date | null = null;
  let gpsLatitude: number | null = null;
  let gpsLongitude: number | null = null;
  let gpsAccuracyMeters: number | null = null;
  try {
    const tags = await exifr.parse(buffer, { pick: ["DateTimeOriginal", "CreateDate", "GPSHPositioningError"] });
    const rawDate = tags?.DateTimeOriginal ?? tags?.CreateDate ?? null;
    if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) capturedAt = rawDate;
    if (typeof tags?.GPSHPositioningError === "number") gpsAccuracyMeters = tags.GPSHPositioningError;
  } catch {
    // No EXIF segment, or a corrupt one — leave capturedAt/accuracy null.
  }
  try {
    const gps = await exifr.gps(buffer);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      gpsLatitude = gps.latitude;
      gpsLongitude = gps.longitude;
    }
  } catch {
    // No GPS IFD present — leave gpsLatitude/gpsLongitude null. Never invented.
  }

  return { width, height, capturedAt, gpsLatitude, gpsLongitude, gpsAccuracyMeters, perceptualHash };
}
