import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { FilmManifest } from "@sitereel/film-runtime";
import { ffprobe } from "@sitereel/shared";
import { bundleFilmEntry } from "./bundle.js";
import { startFilmServer } from "./server.js";
import { renderChunked, renderFilm } from "./render.js";
import { runPurityTest } from "./purity.js";
import { runFilmQa, settleTimes } from "./qa.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "benchmark", "fixtures");
const OUT_DIR = path.join(__dirname, "..", "out");

const FORMATS: Record<string, { width: number; height: number; slug: string }> = {
  "16:9": { width: 1920, height: 1080, slug: "16x9" },
  "9:16": { width: 1080, height: 1920, slug: "9x16" },
  "1:1": { width: 1080, height: 1080, slug: "1x1" },
};

function listFixtures(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".manifest.json"))
    .map((f) => f.replace(".manifest.json", ""));
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * Usage:
 *   render [fixture] [--formats 16:9,9:16,1:1|all] [--single] [--chunks N] [--concurrency N]
 *   purity [fixture]
 *   qa [fixture] [--formats ...]      (writes out/<fixture>-<fmt>.qa.json + contact sheet)
 */
async function main() {
  const [, , cmd, ...rest] = process.argv;
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(rest[i - 1] ?? "").startsWith("--"));
  const fixtures = positional[0] ? [positional[0]] : listFixtures();
  const formatsArg = flag(rest, "formats") ?? "16:9";
  const formats = formatsArg === "all" ? Object.keys(FORMATS) : formatsArg.split(",");

  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}. Expected *.manifest.json files.`);
    process.exit(1);
  }

  console.log("Bundling film-entry...");
  await bundleFilmEntry();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Per-format manifests are written next to the fixtures' assets in a scratch dir served alongside them.
  const scratch = path.join(OUT_DIR, "manifests");
  fs.mkdirSync(scratch, { recursive: true });
  const server = await startFilmServer(FIXTURES_DIR, 0);
  const scratchServer = await startFilmServer(scratch, 0);
  console.log(`Film server up at ${server.url}`);

  try {
    for (const name of fixtures) {
      const base = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.manifest.json`), "utf8")) as FilmManifest;
      for (const format of formats) {
        const dims = FORMATS[format];
        if (!dims) throw new Error(`unknown format ${format}`);
        const manifest: FilmManifest = { ...base, width: dims.width, height: dims.height };
        // Asset paths in fixtures are relative to the fixtures dir; make them absolute so the scratch-served manifest resolves them.
        manifest.scenes = manifest.scenes.map((s) => ({
          ...s,
          props: Object.fromEntries(
            Object.entries(s.props).map(([k, v]) => [k, typeof v === "string" && /\.(svg|png|jpe?g|webp)$/.test(v) && !/^https?:/.test(v) ? `${server.url}/${v}` : v]),
          ),
        }));
        manifest.posterTime ??= settleTimes(manifest)[0]?.t;
        const tag = `${name}-${dims.slug}`;
        fs.writeFileSync(path.join(scratch, `${tag}.json`), JSON.stringify(manifest));
        const manifestUrl = `${scratchServer.url}/${tag}.json`;

        if (cmd === "purity") {
          const result = await runPurityTest(manifest, server.url, manifestUrl);
          console.log(`[${tag}] purity: ${result.passed ? "PASSED" : "FAILED"}`);
          if (!result.passed) process.exitCode = 1;
        } else if (cmd === "qa") {
          const expectedText = Object.fromEntries(manifest.scenes.map((s) => [s.id, []]));
          const r = await runFilmQa({ manifest, filmHost: server.url, manifestUrl, expectedText });
          if (r.contactSheet) fs.writeFileSync(path.join(OUT_DIR, `${tag}.contact.jpg`), r.contactSheet);
          const { contactSheet: _c, ...json } = r;
          fs.writeFileSync(path.join(OUT_DIR, `${tag}.qa.json`), JSON.stringify(json, null, 2));
          console.log(`[${tag}] QA ${r.passed ? "PASSED" : "FAILED"} in ${(r.durationMs / 1000).toFixed(1)}s`);
          for (const i of r.issues) console.log(`   ${i.severity.toUpperCase()} ${i.code}: ${i.message}`);
          if (!r.passed) process.exitCode = 1;
        } else {
          const outPath = path.join(OUT_DIR, `${tag}.mp4`);
          const audioPath = fs.existsSync(path.join(FIXTURES_DIR, `${name}.audio.mp3`)) ? path.join(FIXTURES_DIR, `${name}.audio.mp3`) : undefined;
          const start = Date.now();
          const onProgress = (frame: number, total: number) => {
            if (frame % 60 === 0 || frame === total) process.stdout.write(`\r  [${tag}] frame ${frame}/${total}`);
          };
          if (rest.includes("--single")) {
            await renderFilm({ manifest, filmHost: server.url, manifestUrl, outPath, audioPath, onProgress });
            console.log(`\n[${tag}] single-process render done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
          } else {
            const chunks = flag(rest, "chunks");
            const concurrency = flag(rest, "concurrency");
            const r = await renderChunked({
              manifest,
              filmHost: server.url,
              manifestUrl,
              outPath,
              audioPath,
              chunks: chunks ? Number(chunks) : undefined,
              concurrency: concurrency ? Number(concurrency) : undefined,
              onProgress,
            });
            console.log(
              `\n[${tag}] distributed render: ${r.totalFrames} frames, ${r.chunks} chunks x ${r.concurrency} parallel, capture ${(r.renderMs / 1000).toFixed(1)}s + concat/mux ${(r.concatMs / 1000).toFixed(1)}s (total ${((Date.now() - start) / 1000).toFixed(1)}s)`,
            );
          }
          const probe = await ffprobe(outPath);
          const v = probe.streams.find((s) => s.codec_type === "video");
          console.log(`[${tag}] ffprobe: ${v?.codec_name} ${v?.width}x${v?.height} ${v?.nb_frames} frames, ${probe.durationSec.toFixed(2)}s, primaries=${v?.color_primaries}`);
        }
      }
    }
  } finally {
    await server.close();
    await scratchServer.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
