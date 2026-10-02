import "dotenv/config";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FilmManifest } from "@sitereel/film-runtime";
import { bundleFilmEntry, runFilmQa, startFilmServer } from "@sitereel/renderer";
import { createLocalStorageClient } from "@sitereel/storage";
import { publishManifest } from "../stages/render.js";

/**
 * Re-runs the browser QA probes on a job's built manifest, straight from
 * local storage, several times over. For chasing a QA failure that only
 * shows up some of the time (a purity failure is, by nature, intermittent).
 *
 *   pnpm --filter @sitereel/worker exec tsx src/scripts/qa-replay.ts <jobId> [runs] [format-slug]
 */
async function main() {
  const [, , jobId, runsArg, slug = "16x9"] = process.argv;
  const storageDir = process.env.STORAGE_LOCAL_DIR;
  if (!jobId || !storageDir) {
    console.error("usage: qa-replay <jobId> [runs] [format-slug]   (needs STORAGE_LOCAL_DIR)");
    process.exit(2);
  }
  const runs = Number(runsArg) || 3;
  const storage = createLocalStorageClient(storageDir);
  const manifest = JSON.parse((await fsp.readFile(path.join(storageDir, "assets", "jobs", jobId, "build", `manifest-${slug}.json`))).toString("utf8")) as FilmManifest;
  // QA_STRIP=clip,emphasis,captions removes that part of the manifest, to see which one a failure depends on.
  const strip = new Set((process.env.QA_STRIP ?? "").split(",").filter(Boolean));
  for (const s of manifest.scenes) {
    if (strip.has("clip")) delete (s.props as Record<string, unknown>).clip;
    if (strip.has("emphasis")) delete s.emphasis;
  }
  if (strip.has("captions")) delete manifest.captionStyle;
  await bundleFilmEntry();
  const server = await startFilmServer(path.resolve(storageDir), 0);
  try {
    const { resolved, manifestUrl } = await publishManifest({ manifest, storage, env: { STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: storageDir }, serverUrl: server.url, key: `jobs/${jobId}/qa/replay-${slug}.json` });
    let failures = 0;
    for (let i = 1; i <= runs; i++) {
      const r = await runFilmQa({ manifest: resolved, filmHost: server.url, manifestUrl, expectedText: {} });
      const errors = r.issues.filter((x) => x.severity === "error");
      if (errors.length > 0) failures++;
      console.log(`run ${i}: ${errors.length === 0 ? "ok" : errors.map((e) => `${e.code} ${e.message}`).join(" | ")}`);
    }
    console.log(`${failures}/${runs} runs failed`);
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
