// Test-only browser entry: registers the seeded-defect templates *before*
// the normal film entry boots (ES module evaluation order), so QA tests can
// mount manifests that reference them.
import "./seeded-templates.js";
import "../film-entry.js";
