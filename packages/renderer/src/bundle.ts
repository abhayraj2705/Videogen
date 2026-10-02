import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PUBLIC_DIR = path.join(__dirname, "..", "public");

/**
 * Bundles the browser-side film-entry (and its film-runtime import) into
 * public/film-bundle.js. `entry`/`outfile` let tests bundle an alternate
 * entry (e.g. one that registers seeded-defect templates) elsewhere.
 */
export async function bundleFilmEntry(opts: { entry?: string; outfile?: string } = {}): Promise<string> {
  const outfile = opts.outfile ?? path.join(PUBLIC_DIR, "film-bundle.js");
  await build({
    entryPoints: [opts.entry ?? path.join(__dirname, "film-entry.ts")],
    bundle: true,
    outfile,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    logLevel: "warning",
  });
  return outfile;
}
