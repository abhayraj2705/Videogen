import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { FilmManifest } from "@sitereel/film-runtime";
import { bundleFilmEntry } from "./bundle.js";
import { startFilmServer } from "./server.js";
import { renderFilm } from "./render.js";
import { runPurityTest } from "./purity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "benchmark", "fixtures");
const OUT_DIR = path.join(__dirname, "..", "out");

function listFixtures(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".manifest.json"))
    .map((f) => f.replace(".manifest.json", ""));
}

async function main() {
  const [, , cmd, fixtureArg] = process.argv;
  const fixtures = fixtureArg ? [fixtureArg] : listFixtures();

  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}. Expected *.manifest.json files.`);
    process.exit(1);
  }

  console.log("Bundling film-entry...");
  await bundleFilmEntry();

  const server = await startFilmServer(FIXTURES_DIR);
  console.log(`Film server up at ${server.url}`);

  try {
    for (const name of fixtures) {
      const manifestPath = path.join(FIXTURES_DIR, `${name}.manifest.json`);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as FilmManifest;
      const manifestUrl = `${server.url}/${name}.manifest.json`;

      if (cmd === "purity") {
        console.log(`\n[${name}] running purity test (${manifest.scenes.length} scenes, ${manifest.duration}s)...`);
        const result = await runPurityTest(manifest, server.url, manifestUrl);
        for (const s of result.samples) {
          console.log(`  t=${s.t.toFixed(2)}s  ${s.ok ? "OK" : "FAIL"}  ${s.hash1.slice(0, 8)}/${s.hash2.slice(0, 8)}/${s.hash3.slice(0, 8)}`);
        }
        console.log(`[${name}] purity: ${result.passed ? "PASSED" : "FAILED"}`);
        if (!result.passed) process.exitCode = 1;
      } else {
        const outPath = path.join(OUT_DIR, `${name}.mp4`);
        const audioPath = fs.existsSync(path.join(FIXTURES_DIR, `${name}.audio.mp3`))
          ? path.join(FIXTURES_DIR, `${name}.audio.mp3`)
          : undefined;

        console.log(`\n[${name}] rendering -> ${outPath}`);
        const start = Date.now();
        await renderFilm({
          manifest,
          filmHost: server.url,
          manifestUrl,
          outPath,
          audioPath,
          onProgress: (frame, total) => {
            if (frame % 30 === 0 || frame === total) {
              process.stdout.write(`\r  frame ${frame}/${total}`);
            }
          },
        });
        const secs = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`\n[${name}] done in ${secs}s`);
      }
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
