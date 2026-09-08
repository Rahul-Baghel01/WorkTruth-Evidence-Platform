---
name: WorkTruth score semantics
description: The score units used by WorkTruth’s evidence and risk payloads.
---

WorkTruth risk and evidence-lens scores are normalized fractions between 0 and 1, while risk contribution values are percentage points for display.

**Why:** A mixed-unit payload previously rendered a 0.64 risk score as 1 and fractional contributions as 0%, obscuring the investigation priority.

**How to apply:** When adding score UI, normalize fraction scores to percentages at the presentation boundary and keep contribution labels explicit about percentage units.