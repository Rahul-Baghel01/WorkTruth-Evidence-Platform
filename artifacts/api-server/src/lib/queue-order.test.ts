import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { compareByVerificationPriority } from "./worktruth";

type Row = { id: string; computedPriority: string; computedRiskScore: number };

const row = (id: string, computedPriority: string, computedRiskScore: number): Row => ({ id, computedPriority, computedRiskScore });
const order = (rows: Row[]) => [...rows].sort(compareByVerificationPriority).map((r) => r.id);

describe("verification queue ordering", () => {
  test("the most urgent band comes first", () => {
    const rows = [row("low", "LOW", 0.1), row("critical", "CRITICAL", 0.9), row("moderate", "MODERATE", 0.4), row("high", "HIGH", 0.6)];
    assert.deepEqual(order(rows), ["critical", "high", "moderate", "low"]);
  });

  test("regression: a CRITICAL project never sorts below a clean one, whatever its other fields say", () => {
    // The bug this guards: the default queue sort was unimplemented, so rows
    // kept an incoming evidence-quality ordering and a CRITICAL project could
    // appear below a LOW one — the opposite of what the queue is for.
    const rows = [row("spotless", "LOW", 0), row("hero", "CRITICAL", 0.92)];
    assert.deepEqual(order(rows), ["hero", "spotless"]);
  });

  test("within one band, the higher routing score comes first", () => {
    const rows = [row("weaker", "HIGH", 0.55), row("stronger", "HIGH", 0.81)];
    assert.deepEqual(order(rows), ["stronger", "weaker"]);
  });

  test("an unknown priority string sorts last rather than throwing", () => {
    const rows = [row("mystery", "NOT_A_PRIORITY", 0.99), row("low", "LOW", 0.01)];
    assert.deepEqual(order(rows), ["low", "mystery"]);
  });

  test("ordering is stable and total — sorting twice changes nothing", () => {
    const rows = [row("a", "MODERATE", 0.3), row("b", "CRITICAL", 0.9), row("c", "LOW", 0.2), row("d", "HIGH", 0.7)];
    const once = order(rows);
    assert.deepEqual(order(rows.slice().reverse()), once);
  });
});
