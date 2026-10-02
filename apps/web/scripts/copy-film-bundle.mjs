// Copies the film-runtime browser bundle (built by packages/renderer, committed at
// packages/renderer/public/film-bundle.js) into apps/web/public/film/ so the
// script-review editor's live preview iframe (public/film/host.html) runs the exact
// same template code as the final render. See components/editor/film-preview.tsx.
//
// Why a copy instead of an import: @sitereel/film-runtime / @sitereel/shared use `.js`
// import specifiers and Node-only modules that Next's webpack can't resolve for the
// browser, and the bundle is already the renderer's single source of truth.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../../packages/renderer/public/film-bundle.js");
const destDir = join(here, "../public/film");
const dest = join(destDir, "film-bundle.js");

if (!existsSync(src)) {
  console.warn(`[copy-film-bundle] ${src} not found — the editor preview will show an error until it's built.`);
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("[copy-film-bundle] public/film/film-bundle.js updated");
