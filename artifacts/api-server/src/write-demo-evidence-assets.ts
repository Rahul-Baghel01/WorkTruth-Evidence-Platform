// Writes the hero case's two demo photographs into the FRONTEND's static
// asset directory (artifacts/worktruth/public/evidence/), where they are
// committed to Git and shipped as part of the frontend build.
//
// Why static rather than API-served: the API serves evidence files from
// EVIDENCE_UPLOAD_DIR behind requireAuth. On a serverless deployment that
// directory is ephemeral. Serving the two hero photographs as committed
// frontend assets keeps the demo available across serverless instances.
//
// These bytes come from the same deterministic generator the database seed
// hashes (demo-evidence-images.ts), so the committed file is byte-identical
// to the image whose SHA-256/perceptual hash is stored on the evidence row —
// the displayed photograph is genuinely the one that was hashed.
//
// Run: pnpm --filter @workspace/api-server run write-demo-assets
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHeroSceneImage, type HeroSceneVariant } from "./lib/demo-evidence-images";
import { HERO_EVIDENCE_ASSETS } from "./lib/hero-case";
import { sha256Hex } from "./lib/image-processing";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(here, "../../worktruth/public/evidence");

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  for (const asset of HERO_EVIDENCE_ASSETS) {
    const buffer = await buildHeroSceneImage(asset.variant as HeroSceneVariant);
    const target = path.join(outputDir, asset.filename);
    await writeFile(target, buffer);
    console.log(`${asset.filename}  ${buffer.length} bytes  sha256=${sha256Hex(buffer).slice(0, 16)}…`);
  }
  console.log(`\nWrote ${HERO_EVIDENCE_ASSETS.length} demo evidence assets to ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
