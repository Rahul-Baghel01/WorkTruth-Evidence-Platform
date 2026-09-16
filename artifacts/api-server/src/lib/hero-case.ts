// ---------------------------------------------------------------------------
// The demo portfolio's hero anomaly case — one project that exercises every
// lens end to end, so the whole WorkTruth pipeline can be walked through on a
// single record.
//
// Everything here is SYNTHETIC DEMO DATA and is stored with a `seed_demo`
// provenance so it is never mistaken for a real record. What is NOT synthetic
// is the analysis: these rows are fed to the same financial/geo/temporal/text/
// visual engines, cross-modal rules, fusion, and verification-priority routing
// as any other project. No score, priority, similarity percentage, or ratio is
// hardcoded anywhere — this file only describes the EVIDENCE, and the engines
// decide what it means.
//
// The intended (and verified) signals this evidence produces:
//   - Financial : sanction far above the comparable-project median cost, plus
//                 expenditure recorded before the sanction date.
//   - Visual    : the project's photograph is a perceptual near-duplicate of a
//                 photograph submitted for a DIFFERENT project.
//   - Text      : its description is near-identical to that other project's.
//   - Geospatial: the photograph's GPS sits well outside the declared site.
//   - Temporal  : nearly all money spent while reported progress stays low.
//   - Cross-modal / fusion / priority then follow from those, on their own.
// ---------------------------------------------------------------------------

/** The hero project: the record a reviewer opens to see the whole pipeline. */
export const HERO_PROJECT_ID = "P-1089";

/** The earlier project whose photograph and description the hero record reuses. */
export const HERO_SOURCE_PROJECT_ID = "P-3022";

// Marks the two hero photographs as served from the frontend's own static
// assets (artifacts/worktruth/public/evidence/) rather than from the API's
// upload directory. Distinct from plain "seed_demo" so the image-serving
// route and the frontend can both recognise them without guessing.
export const HERO_STATIC_EVIDENCE_SOURCE = "seed_demo_static";

export type HeroEvidenceAsset = {
  /** File name under the frontend's public/evidence/ directory. */
  filename: string;
  /** Which rendering of the shared synthetic scene this file holds. */
  variant: "current" | "matched";
  projectId: string;
  label: string;
  /** Metres the photograph's GPS sits from its project's declared location. */
  gpsOffsetDegrees: number;
  capturedAt: string;
};

// Both photographs render the SAME synthetic scene with a small deliberate
// difference (see demo-evidence-images.ts), so the pair is a real perceptual
// near-duplicate: different bytes, near-identical low-frequency structure.
// The similarity the UI shows is measured from these files at seed time, not
// written down here.
export const HERO_EVIDENCE_ASSETS: readonly HeroEvidenceAsset[] = [
  {
    filename: "hero-current.png",
    variant: "current",
    projectId: HERO_PROJECT_ID,
    label: "Site photograph submitted with completion claim",
    // ~1.4 km from the declared site — past the geo engine's 1 km HIGH bar.
    gpsOffsetDegrees: 0.0126,
    capturedAt: "2024-05-18T10:24:00.000Z",
  },
  {
    filename: "hero-matched.png",
    variant: "matched",
    projectId: HERO_SOURCE_PROJECT_ID,
    label: "Site photograph submitted with earlier project",
    gpsOffsetDegrees: 0.0004,
    capturedAt: "2024-04-02T09:12:00.000Z",
  },
] as const;

// Near-identical project narratives — a copied-and-lightly-edited submission.
// The text engine measures the actual TF-IDF cosine similarity between them;
// these strings just supply the evidence.
export const HERO_DESCRIPTION =
  "Construction of a community hall at Village X including RCC framed structure, brick masonry walls, flooring, electrification, and boundary wall with approach path. Work includes site levelling, foundation work, roofing, plastering, painting, and provision of water and sanitation connections for community use.";

export const HERO_SOURCE_DESCRIPTION =
  "Development of a public community centre at Village X including RCC framed structure, brick masonry walls, flooring, electrification, and boundary wall with approach path. Work includes site levelling, foundation work, roofing, plastering, painting, and provision of water and sanitation connections for community use.";

// The hero's financial ledger, replacing the generic two-row ledger the other
// seed projects get. The first expenditure is dated BEFORE the sanction —
// a chronology fault the financial and cross-modal engines detect on their own.
// Expenditure rows sum to the project's recorded expenditure, so the ledger
// reconciles and the anomaly is the DATE, not a bookkeeping mismatch.
export const HERO_FINANCIAL_RECORDS = [
  { type: "SANCTION" as const, amount: 2_700_000, recordedDate: "2024-01-15" },
  { type: "EXPENDITURE" as const, amount: 720_000, recordedDate: "2023-12-20" },
  { type: "EXPENDITURE" as const, amount: 1_960_000, recordedDate: "2024-03-10" },
];

// Reported physical progress stays low while the money is nearly all spent.
export const HERO_PROGRESS_RECORDS = [
  { reportDate: "2024-02-10", progressPercent: 12, note: "Site levelling and foundation marking reported." },
  { reportDate: "2024-04-05", progressPercent: 22, note: "Foundation work reported in progress." },
  { reportDate: "2024-05-20", progressPercent: 28, note: "Progress reported largely unchanged since April." },
];
