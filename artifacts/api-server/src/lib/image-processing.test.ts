import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Jimp, JimpMime } from "jimp";
import { extractImageMetadata, hammingDistance, sha256Hex } from "./image-processing";

// Small synthetic images generated in-process — no binary fixtures committed
// to the repo, per the instruction to avoid unnecessary binary test assets.
async function solidColorPng(width: number, height: number, color: number): Promise<Buffer> {
  const image = new Jimp({ width, height, color });
  return image.getBuffer(JimpMime.png);
}

// A checkerboard, not a flat fill: pHash operates on low-frequency
// *structure* after greyscale+DCT, so two uniform flat colors (no edges at
// all) can legitimately hash identically — that's correct algorithm
// behavior, not a bug. Genuinely distinguishing two images requires actual
// spatial structure, which a checkerboard provides.
async function checkerboardPng(size: number, colorA: number, colorB: number): Promise<Buffer> {
  const image = new Jimp({ width: size, height: size, color: colorA });
  const cell = Math.max(1, Math.floor(size / 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 1) {
        image.setPixelColor(colorB, x, y);
      }
    }
  }
  return image.getBuffer(JimpMime.png);
}

describe("sha256Hex", () => {
  test("matches Node's own crypto for the same bytes", () => {
    const buffer = Buffer.from("evidence bytes");
    assert.equal(sha256Hex(buffer), createHash("sha256").update(buffer).digest("hex"));
  });

  test("differs for different bytes", () => {
    assert.notEqual(sha256Hex(Buffer.from("a")), sha256Hex(Buffer.from("b")));
  });

  test("is deterministic", () => {
    const buffer = Buffer.from("repeat me");
    assert.equal(sha256Hex(buffer), sha256Hex(buffer));
  });
});

describe("hammingDistance", () => {
  test("identical hashes have distance 0", () => {
    assert.equal(hammingDistance("1010", "1010"), 0);
  });

  test("counts differing characters", () => {
    assert.equal(hammingDistance("1010", "1111"), 2);
  });

  test("mismatched lengths are treated as maximally different rather than throwing", () => {
    assert.equal(hammingDistance("1010", "10"), 4);
  });
});

describe("extractImageMetadata", () => {
  test("decodes a real image: dimensions and perceptual hash are populated", async () => {
    const buffer = await solidColorPng(20, 12, 0x2244ffff);
    const metadata = await extractImageMetadata(buffer);
    assert.equal(metadata.width, 20);
    assert.equal(metadata.height, 12);
    assert.equal(typeof metadata.perceptualHash, "string");
    assert.equal(metadata.perceptualHash?.length, 64);
    assert.ok(/^[01]{64}$/.test(metadata.perceptualHash ?? ""));
  });

  test("a synthetic image with no EXIF yields null capture/GPS fields, not fabricated ones", async () => {
    const buffer = await solidColorPng(10, 10, 0x00ff00ff);
    const metadata = await extractImageMetadata(buffer);
    assert.equal(metadata.capturedAt, null);
    assert.equal(metadata.gpsLatitude, null);
    assert.equal(metadata.gpsLongitude, null);
    assert.equal(metadata.gpsAccuracyMeters, null);
  });

  test("two structurally different images produce different perceptual hashes", async () => {
    const checkerboard = await checkerboardPng(32, 0xff0000ff, 0x0000ffff);
    const flat = await solidColorPng(32, 32, 0xff0000ff);
    const checkerMeta = await extractImageMetadata(checkerboard);
    const flatMeta = await extractImageMetadata(flat);
    assert.ok(checkerMeta.perceptualHash && flatMeta.perceptualHash);
    assert.ok(hammingDistance(checkerMeta.perceptualHash!, flatMeta.perceptualHash!) > 0);
  });

  test("identical image bytes produce identical perceptual hashes and identical SHA-256", async () => {
    const buffer = await solidColorPng(24, 24, 0x804020ff);
    const a = await extractImageMetadata(buffer);
    const b = await extractImageMetadata(buffer);
    assert.equal(a.perceptualHash, b.perceptualHash);
    assert.equal(sha256Hex(buffer), sha256Hex(buffer));
  });

  test("an invalid/non-image file decodes to null dimensions and hash rather than throwing", async () => {
    const garbage = Buffer.from("this is not an image, just plain text bytes");
    const metadata = await extractImageMetadata(garbage);
    assert.equal(metadata.width, null);
    assert.equal(metadata.height, null);
    assert.equal(metadata.perceptualHash, null);
  });
});
