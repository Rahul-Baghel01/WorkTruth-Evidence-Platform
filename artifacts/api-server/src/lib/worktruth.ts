import { count, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  investigationNotesTable,
  investigationsTable,
  projectAnalysesTable,
  projectsTable,
  usersTable,
  type ProjectRow,
} from "@workspace/db";

type Priority = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

const imageA =
  "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=900&q=80";
const imageB =
  "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=900&q=80";

const baseProjects = [
  ["P-1089", "Construction of Community Hall at Village X", "Community Hall", "Kanpur Nagar", "Uttar Pradesh", 2700000, 2680000, 100, 82, "HIGH", "High cost + similar photograph", 26.4499, 80.3319, "2024-01-15", "2024-07-15", "Village X, Kanpur", "BuildWell Infrastructure"],
  ["P-2041", "Upgradation of Primary School at Bithoor", "School", "Kanpur Nagar", "Uttar Pradesh", 1850000, 1710000, 88, 94, "LOW", "No anomaly detected", 26.6067, 80.2707, "2024-02-01", "2024-09-30", "Bithoor, Kanpur", "Shiksha Works"],
  ["P-3022", "Development of Public Community Centre at Village X", "Community Hall", "Kanpur Nagar", "Uttar Pradesh", 2250000, 2140000, 72, 78, "MODERATE", "Similar project description", 26.4531, 80.3401, "2024-03-12", "2024-11-30", "Village X, Kanpur", "Jan Sewa Projects"],
  ["P-4150", "Improvement of rural access road near Chaubepur", "Road", "Kanpur Dehat", "Uttar Pradesh", 3200000, 3060000, 100, 69, "HIGH", "GPS mismatch + visual reuse", 26.5052, 80.1453, "2023-11-10", "2024-05-30", "Chaubepur, Kanpur Dehat", "Rural Connect LLP"],
  ["P-1007", "Solar drinking water unit at Bidhnu", "Water", "Kanpur Nagar", "Uttar Pradesh", 920000, 840000, 100, 91, "LOW", "No anomaly detected", 26.3479, 80.2764, "2024-01-20", "2024-06-30", "Bidhnu, Kanpur", "Jal Jeevan Mission"],
  ["P-1182", "Covered drain construction at Kalyanpur", "Sanitation", "Kanpur Nagar", "Uttar Pradesh", 1460000, 1390000, 92, 86, "MODERATE", "Completion evidence missing", 26.5121, 80.2332, "2024-02-18", "2024-08-31", "Kalyanpur, Kanpur", "Nagar Seva Works"],
  ["P-1293", "Community library and reading room", "Public Facility", "Lucknow", "Uttar Pradesh", 2450000, 2320000, 84, 89, "LOW", "No anomaly detected", 26.8467, 80.9462, "2024-01-08", "2024-10-15", "Aliganj, Lucknow", "CivicBuild"],
  ["P-1416", "Village approach road resurfacing", "Road", "Unnao", "Uttar Pradesh", 4100000, 3990000, 64, 76, "MODERATE", "Progress record incomplete", 26.5471, 80.4877, "2024-04-02", "2024-12-20", "Safipur, Unnao", "State Road Services"],
  ["P-1562", "Girls hostel sanitation block", "Sanitation", "Farrukhabad", "Uttar Pradesh", 1200000, 1180000, 100, 96, "LOW", "No anomaly detected", 27.3919, 79.5805, "2023-12-12", "2024-06-10", "Farrukhabad City", "Nirman Sahayata"],
  ["P-1688", "Minor irrigation canal lining", "Water", "Etawah", "Uttar Pradesh", 2850000, 2800000, 78, 83, "MODERATE", "Expenditure above benchmark", 26.7855, 79.0218, "2024-02-25", "2024-11-15", "Jaswantnagar, Etawah", "Kisan Infra"],
  ["P-1724", "High school science laboratory", "School", "Aurैया", "Uttar Pradesh", 1980000, 1900000, 100, 93, "LOW", "No anomaly detected", 26.4606, 79.5088, "2024-01-05", "2024-07-20", "Auraiya Town", "Shiksha Works"],
  ["P-1895", "Solid waste collection point", "Sanitation", "Kannauj", "Uttar Pradesh", 760000, 720000, 100, 88, "LOW", "No anomaly detected", 27.0552, 79.9184, "2024-03-01", "2024-08-01", "Kannauj City", "Clean Districts"],
  ["P-2135", "Flood protection embankment", "Water", "Fatehpur", "Uttar Pradesh", 5200000, 4980000, 58, 71, "HIGH", "Delayed progress", 25.927, 80.8129, "2024-01-28", "2024-10-31", "Bindki, Fatehpur", "RiverSafe Contractors"],
  ["P-2280", "Public health sub-centre repair", "Public Facility", "Hamirpur", "Uttar Pradesh", 1750000, 1680000, 100, 90, "LOW", "No anomaly detected", 25.955, 80.148, "2023-12-04", "2024-06-15", "Rath, Hamirpur", "HealthBuild"],
  ["P-2414", "Concrete lane and street lighting", "Road", "Jalaun", "Uttar Pradesh", 2300000, 2210000, 93, 80, "MODERATE", "Visual evidence incomplete", 26.1458, 79.3364, "2024-02-14", "2024-09-05", "Orai, Jalaun", "Gram Vikas"],
  ["P-2671", "Anganwadi centre construction", "Public Facility", "Mahoba", "Uttar Pradesh", 1320000, 1270000, 100, 95, "LOW", "No anomaly detected", 25.292, 79.872, "2024-01-12", "2024-07-01", "Mahoba City", "Bal Vikas"],
  ["P-2818", "Rainwater harvesting system", "Water", "Banda", "Uttar Pradesh", 1040000, 1030000, 97, 85, "MODERATE", "GPS metadata absent", 25.475, 80.339, "2024-03-20", "2024-09-10", "Baberu, Banda", "Jal Raksha"],
  ["P-3184", "Panchayat office renovation", "Public Facility", "Prayagraj", "Uttar Pradesh", 1580000, 1510000, 100, 92, "LOW", "No anomaly detected", 25.4358, 81.8463, "2023-11-22", "2024-05-25", "Koraon, Prayagraj", "CivicBuild"],
  ["P-3369", "Primary road culvert replacement", "Road", "Mirzapur", "Uttar Pradesh", 3650000, 3520000, 81, 74, "HIGH", "Cost deviation + delay", 25.146, 82.569, "2024-01-30", "2024-10-10", "Chunar, Mirzapur", "BridgePoint"],
  ["P-3902", "Drinking water pipeline extension", "Water", "Varanasi", "Uttar Pradesh", 2900000, 2750000, 100, 87, "LOW", "No anomaly detected", 25.3176, 82.9739, "2024-02-08", "2024-08-20", "Rohania, Varanasi", "Jal Jeevan Mission"],
] as const;

function projectDescription(name: string) {
  return name;
}

function riskFor(priority: Priority) {
  return priority === "CRITICAL" ? 0.86 : priority === "HIGH" ? 0.64 : priority === "MODERATE" ? 0.38 : 0.12;
}

export function buildAnalysis(project: ProjectRow) {
  const is1089 = project.id === "P-1089";
  const is4150 = project.id === "P-4150";
  const is3022 = project.id === "P-3022";
  const score = riskFor(project.priority as Priority);
  const benchmark = is1089 ? 1165000 : Math.round(project.sanctionAmount * (is4150 ? 0.56 : 0.68));
  const financialScore = is1089 ? 0.7 : is4150 ? 0.63 : is3022 ? 0.43 : Math.min(0.62, Math.max(0.08, (project.expenditure / benchmark - 1) * 0.55));
  const visualScore = is1089 ? 0.91 : is4150 ? 0.86 : is3022 ? 0.22 : 0.08;
  const geoScore = is1089 ? 0.55 : is4150 ? 0.72 : 0.06;
  const temporalScore = is1089 ? 0.8 : is4150 ? 0.61 : project.progress < 70 ? 0.48 : 0.1;
  const textScore = is3022 ? 0.87 : 0.12;
  const weights = { Financial: 0.25, Visual: 0.25, Geographic: 0.15, Temporal: 0.2, Text: 0.15 };
  const components = [
    ["Financial", financialScore],
    ["Visual", visualScore],
    ["Geographic", geoScore],
    ["Temporal", temporalScore],
    ["Text", textScore],
  ].map(([label, signal]) => ({
    label: String(label),
    score: Number(signal),
    weight: weights[String(label) as keyof typeof weights],
    contribution: Number(signal) * weights[String(label) as keyof typeof weights] * 100,
  }));
  const reasons = is1089
    ? [
        "Expenditure is 2.3× above the peer benchmark for comparable community halls.",
        "Project photograph has 91% visual similarity with another project's evidence.",
        "Reported progress reached 100% while visual evidence shows minimal change.",
        "Photograph GPS differs from the declared project location by 1.4 km.",
      ]
    : is4150
      ? ["Photograph metadata is 2.1 km from the declared worksite.", "Evidence image matches another road project at 86% similarity.", "Progress is behind the expected completion curve."]
      : is3022
        ? ["Project description is 87% semantically similar to another work in the same village.", "Two project records may represent overlapping public works.", "Evidence completeness is below the monitoring threshold."]
        : project.priority === "LOW"
          ? ["No anomaly detected in the available evidence.", "Evidence is sufficiently complete for routine monitoring."]
          : ["Evidence completeness is below the monitoring threshold.", "One or more signals require officer review before closure."];
  return {
    status: "Completed",
    risk: {
      score,
      priority: project.priority,
      reasons,
      recommendation: project.priority === "LOW" ? "No immediate action" : project.priority === "MODERATE" ? "Document review recommended" : "Physical site verification recommended",
      weights,
      components,
    },
    financial: {
      sanction: project.sanctionAmount,
      expenditure: project.expenditure,
      benchmark,
      deviation: Number((project.expenditure / benchmark).toFixed(1)),
      score: financialScore,
      status: financialScore > 0.6 ? "MODERATE ANOMALY" : "WITHIN EXPECTED RANGE",
      explanation: financialScore > 0.6 ? "The project expenditure is significantly above the benchmark for comparable projects in the same asset category and region." : "Expenditure is within the observed range for comparable projects in the same asset category and region.",
      peers: [
        { label: "Peer 01", amount: Math.round(benchmark * 0.82) },
        { label: "Peer 02", amount: benchmark },
        { label: "Peer 03", amount: Math.round(benchmark * 1.12) },
        { label: "Current", amount: project.expenditure },
      ],
    },
    visual: {
      score: visualScore,
      status: visualScore > 0.75 ? "HIGH CONCERN" : visualScore > 0.3 ? "MODERATE" : "NO MATCH DETECTED",
      explanation: visualScore > 0.75 ? "This photograph is visually similar to evidence associated with another project." : "No strong visual reuse signal was detected in the available evidence.",
      images: [
        { id: `${project.id}-img-1`, label: "Current project photograph", captureDate: "2024-06-18", gps: `${project.latitude.toFixed(4)}, ${project.longitude.toFixed(4)}`, quality: project.evidenceQuality / 100, similarity: visualScore, imageUrl: imageA, matchedImageUrl: imageB },
        { id: `${project.id}-img-2`, label: "Completion evidence", captureDate: "2024-07-01", gps: null, quality: Math.min(0.98, project.evidenceQuality / 100 + 0.05), similarity: Math.max(0.04, visualScore - 0.11), imageUrl: imageB, matchedImageUrl: imageA },
      ],
    },
    text: {
      score: textScore,
      status: textScore > 0.75 ? "MODERATE" : "LOW",
      explanation: textScore > 0.75 ? "The project descriptions are semantically similar and may represent overlapping work." : "The description is distinct from the indexed project records.",
      current: project.description,
      similar: is3022 ? "Construction of Community Hall at Village X" : "No material description overlap found",
      similarity: is3022 ? 0.87 : 0.12,
    },
    geo: {
      score: geoScore,
      status: geoScore > 0.5 ? "LOCATION REQUIRES VERIFICATION" : "LOCATION CONSISTENT",
      explanation: geoScore > 0.5 ? "Photograph GPS differs from the declared project location. GPS accuracy and missing metadata should be considered during review." : "Available location metadata is consistent with the declared project location.",
      declared: { lat: project.latitude, lng: project.longitude },
      photograph: { lat: project.latitude + (geoScore > 0.5 ? 0.0062 : 0.0002), lng: project.longitude + (geoScore > 0.5 ? 0.0101 : 0.0002) },
      distanceKm: geoScore > 0.5 ? 1.4 : 0.03,
      nearby: [],
    },
    temporal: {
      score: temporalScore,
      status: temporalScore > 0.7 ? "HIGH CONCERN" : temporalScore > 0.4 ? "MODERATE" : "CONSISTENT",
      explanation: temporalScore > 0.7 ? "Reported progress reached 100%, while visual evidence shows minimal change across the available timeline." : "Reported progress and the available evidence chronology are broadly consistent.",
      reportedProgress: project.progress,
      visualProgress: temporalScore > 0.7 ? "Minimal change detected" : project.progress > 80 ? "Substantial completion detected" : "Progression appears consistent",
      timeline: [
        { label: "Month 1", progress: Math.min(project.progress, 20) },
        { label: "Month 3", progress: Math.min(project.progress, 60) },
        { label: "Month 6", progress: project.progress },
      ],
    },
    updatedAt: new Date().toISOString(),
  };
}

function toProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    district: row.district,
    state: row.state,
    location: row.location,
    sanctionAmount: row.sanctionAmount,
    expenditure: row.expenditure,
    progress: row.progress,
    evidenceQuality: row.evidenceQuality,
    priority: row.priority,
    primaryFlag: row.primaryFlag,
    latitude: row.latitude,
    longitude: row.longitude,
    startDate: row.startDate,
    expectedCompletion: row.expectedCompletion,
    actualCompletion: row.actualCompletion,
  };
}

export { toProject };

export async function ensureSeeded() {
  const [{ value }] = await db.select({ value: count() }).from(projectsTable);
  if (Number(value) > 0) return;
  const projects = baseProjects.map((item) => ({
    id: item[0],
    name: item[1],
    category: item[2],
    district: item[3],
    state: item[4],
    sanctionAmount: item[5],
    expenditure: item[6],
    progress: item[7],
    evidenceQuality: item[8],
    priority: item[9],
    primaryFlag: item[10],
    latitude: item[11],
    longitude: item[12],
    startDate: item[13],
    expectedCompletion: item[14],
    actualCompletion: null,
    location: item[15],
    contractor: item[16],
    description: projectDescription(item[1]),
  }));
  await db.insert(usersTable).values({ email: "officer@worktruth.gov.in", name: "Aarav Mehta", role: "District Monitoring Officer" }).onConflictDoNothing();
  await db.insert(projectsTable).values(projects).onConflictDoNothing();
  const rows = await db.select().from(projectsTable);
  await db.insert(projectAnalysesTable).values(rows.map((project) => ({ projectId: project.id, status: "Completed", payload: buildAnalysis(project) }))).onConflictDoNothing();
  await db.insert(investigationsTable).values(rows.map((project) => ({ projectId: project.id, status: "Pending Review", notes: "", decision: "" }))).onConflictDoNothing();
}

export async function getProject(id: string) {
  await ensureSeeded();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) return undefined;
  const [analysisRow] = await db.select().from(projectAnalysesTable).where(eq(projectAnalysesTable.projectId, id));
  const [investigation] = await db.select().from(investigationsTable).where(eq(investigationsTable.projectId, id));
  const history = await db.select().from(investigationNotesTable).where(eq(investigationNotesTable.projectId, id)).orderBy(desc(investigationNotesTable.createdAt));
  const analysis = (analysisRow?.payload as ReturnType<typeof buildAnalysis> | undefined) ?? buildAnalysis(project);
  analysis.risk.components = analysis.risk.components.map((component) => ({
    ...component,
    contribution: component.contribution <= 1 ? component.contribution * 100 : component.contribution,
  }));
  return {
    project,
    analysis,
    investigation: {
      status: investigation?.status ?? "Pending Review",
      notes: investigation?.notes ?? "",
      decision: investigation?.decision ?? "",
      history: history.map((item) => ({ id: String(item.id), status: item.status, note: item.note, officer: item.officer, time: item.createdAt.toISOString() })),
    },
  };
}

export async function listProjectRows() {
  await ensureSeeded();
  return db.select().from(projectsTable).orderBy(desc(projectsTable.evidenceQuality));
}

export async function updateInvestigationRecord(id: string, status: string, notes: string, decision: string) {
  await ensureSeeded();
  await db.update(investigationsTable).set({ status, notes, decision, updatedAt: new Date() }).where(eq(investigationsTable.projectId, id));
  await db.insert(investigationNotesTable).values({ projectId: id, status, note: notes || decision || "Investigation updated", officer: "Aarav Mehta" });
  const detail = await getProject(id);
  return detail?.investigation;
}