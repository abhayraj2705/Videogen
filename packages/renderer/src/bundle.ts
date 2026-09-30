import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bundles the browser-side film-entry (and its film-runtime import) into public/film-bundle.js. */
export async function bundleFilmEntry(): Promise<string> {
  const outfile = path.join(__dirname, "..", "public", "film-bundle.js");
  await build({
    entryPoints: [path.join(__dirname, "film-entry.ts")],
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
