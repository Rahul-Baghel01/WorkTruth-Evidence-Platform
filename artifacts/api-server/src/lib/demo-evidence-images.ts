import { Jimp, JimpMime } from "jimp";

// ---------------------------------------------------------------------------
// Deterministic synthetic demo photographs for the hero anomaly case.
//
// These are GENERATED images, not real site photographs — the same honest
// position the existing seed checkerboard takes (see buildSeedEvidenceImageBuffer
// in worktruth.ts). They exist so the real perceptual-hash pipeline
// (image-processing.ts) has genuine image bytes to hash: every hash, Hamming
// distance, and similarity percentage the visual engine reports for the hero
// case is computed from these actual pixels, never hardcoded.
//
// `buildHeroSceneImage` renders the same synthetic construction scene twice
// with a small, deliberate difference (a brightness shift and one displaced
// element). That makes the pair a genuine NEAR-duplicate: different bytes
// (different SHA-256, so the exact-duplicate check correctly does not fire)
// but nearly identical low-frequency structure, which is exactly what a
// perceptual hash is designed to catch — the real-world signal being
// demonstrated is "the same photograph re-submitted for a second project."
//
// Rendering is pure and deterministic (no Math.random, no clock): the same
// variant always produces byte-identical output, so the committed static copy
// under artifacts/worktruth/public/evidence/ is exactly the file whose hash is
// stored in the database at seed time.
// ---------------------------------------------------------------------------

export type HeroSceneVariant = "current" | "matched";

const SIZE = 256;

function rgba(r: number, g: number, b: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  // >>> 0 keeps this an unsigned 32-bit RGBA value — a plain `<< 24` on any
  // red channel >= 128 would produce a negative signed int that Jimp rejects.
  return ((clamp(r) << 24) | (clamp(g) << 16) | (clamp(b) << 8) | 0xff) >>> 0;
}

function fillRect(image: InstanceType<typeof Jimp>, x0: number, y0: number, w: number, h: number, color: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) image.setPixelColor(color, x, y);
    }
  }
}

// A flat, blocky "building site" scene: graded sky, ground band, a structure
// with window openings, and a small foreground object. Blocky on purpose —
// strong low-frequency structure is what a perceptual hash actually keys on,
// so the near-duplicate relationship is visible in the hash, not incidental.
export async function buildHeroSceneImage(variant: HeroSceneVariant): Promise<Buffer> {
  // The matched copy is slightly brighter overall and has its foreground
  // object shifted — the kind of difference a re-photographed or lightly
  // re-edited resubmission shows.
  const lift = variant === "matched" ? 8 : 0;
  const objectShift = variant === "matched" ? 26 : 0;
  const wingShift = variant === "matched" ? 10 : 0;

  const image = new Jimp({ width: SIZE, height: SIZE, color: rgba(150 + lift, 185 + lift, 205 + lift) });

  // Sky gradient (top ~60%).
  const horizon = 150 + (variant === "matched" ? 6 : 0);
  for (let y = 0; y < horizon; y++) {
    const t = y / horizon;
    const color = rgba(128 + 70 * t + lift, 170 + 50 * t + lift, 200 + 30 * t + lift);
    fillRect(image, 0, y, SIZE, 1, color);
  }

  // Ground band.
  fillRect(image, 0, horizon, SIZE, SIZE - horizon, rgba(138 + lift, 124 + lift, 104 + lift));
  fillRect(image, 0, horizon, SIZE, 4, rgba(112 + lift, 100 + lift, 84 + lift));

  // Main structure.
  fillRect(image, 46, 58, 120, 92, rgba(196 + lift, 192 + lift, 182 + lift));
  fillRect(image, 46, 58, 120, 6, rgba(150 + lift, 146 + lift, 138 + lift));
  // Window openings.
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      fillRect(image, 60 + col * 36 + (variant === "matched" && row === 2 ? 7 : 0), 74 + row * 26, 22, 16, rgba(74 + lift, 84 + lift, 92 + lift));
    }
  }

  // Side wing.
  fillRect(image, 170, 96 + wingShift, 54, 54 - wingShift, rgba(176 + lift, 170 + lift, 158 + lift));
  fillRect(image, 182, 112 + wingShift, 18, 38 - wingShift, rgba(88 + lift, 92 + lift, 96 + lift));

  // Scaffold uprights.
  for (const x of [50, 92, 134]) fillRect(image, x, 58, 3, 92, rgba(118 + lift, 110 + lift, 96 + lift));

  // Foreground material stack — the element that moves between the two
  // variants, so the pair differs in bytes and in a few pHash bits.
  fillRect(image, 24 + objectShift, 178, 44, 26, rgba(154 + lift, 120 + lift, 82 + lift));
  fillRect(image, 24 + objectShift, 178, 44, 5, rgba(126 + lift, 96 + lift, 64 + lift));

  // The matched copy is additionally re-cropped and rescaled back to full
  // size — the single most common way a reused photograph reappears in a
  // second submission. It shifts real low-frequency structure, so the pair
  // stays a near-duplicate without being a trivial re-encode.
  if (variant === "matched") {
    image.crop({ x: 20, y: 14, w: SIZE - 40, h: SIZE - 28 }).resize({ w: SIZE, h: SIZE });
  }

  return image.getBuffer(JimpMime.png);
}
