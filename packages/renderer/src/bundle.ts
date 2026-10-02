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
export function bundleFilmEntry(opts: { entry?: string; outfile?: string } = {}): Promise<string> {
  // Once per process per entry/outfile: QA and render both ask for the bundle on every job
  // (and for every format), and the source can't change under a running worker.
  const key = `${opts.entry ?? ""}|${opts.outfile ?? ""}`;
  let bundled = bundles.get(key);
  if (!bundled) {
    bundled = runBundle(opts);
    bundles.set(key, bundled);
    bundled.catch(() => bundles.delete(key));
  }
  return bundled;
}

const bundles = new Map<string, Promise<string>>();

async function runBundle(opts: { entry?: string; outfile?: string }): Promise<string> {
  const outfile = opts.outfile ?? path.join(PUBLIC_DIR, "film-bundle.js");
  await build({
    entryPoints: [opts.entry ?? path.join(__dirname, "film-entry.ts")],
    bundle: true,
    outfile,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    // Pin the base for source-path comments so a rebuild from the worker's cwd
    // produces the same committed bundle as one from the renderer package.
    absWorkingDir: path.join(__dirname, ".."),
    logLevel: "warning",
  });
  return outfile;
}
