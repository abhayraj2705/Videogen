import "dotenv/config";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CrawlOutput, JobOptions, ffprobe, formatSlug, runFfmpegQuiet, type AspectFormat } from "@sitereel/shared";
import { createLocalStorageClient, type StorageClient } from "@sitereel/storage";
import { createAnthropicProvider, createGeminiProvider, type LlmProvider } from "@sitereel/llm";
import { createGeminiTtsProvider } from "@sitereel/tts";
import { parseColor } from "@sitereel/film-runtime";
import { bundleFilmEntry, startFilmServer } from "@sitereel/renderer";
import { runCrawlStage } from "../stages/crawl.js";
import { runPlanStage } from "../stages/plan.js";
import { runVoiceStage } from "../stages/voice.js";
import { buildFilmManifest } from "../stages/build.js";
import { runQaStage, createLlmVisionReviewer, skippedVisionReviewer } from "../stages/qa.js";
import { publishManifest, runRenderStage } from "../stages/render.js";
import { assembleNarrationTrack, mixFinalAudio } from "../lib/audio-mix.js";
import { buildVtt } from "../lib/vtt.js";
import { getAudioSidecarFromEnv } from "../lib/audio-sidecar.js";
import { selectMusicTrack } from "../lib/music.js";

/**
 * End-to-end local pipeline (Phase 4 "pnpm pipeline run <url>"): crawl -> plan
 * -> voice -> build -> QA -> render+encode, all in-process — no Redis, no
 * Postgres, no queues. Works fully offline from a saved crawl fixture
 * (benchmark/fixtures/*.json): no LLM key = deterministic fallback storyboard,
 * no TTS key = silent fallback voice, no sidecar = local ffmpeg mix.
 *
 *   pnpm pipeline run benchmark/fixtures/<id>.json [--out DIR] [--formats 16:9,9:16,1:1]
 *                     [--music upbeat|calm|energetic|cinematic|off] [--no-voice] [--plan free|pro]
 *                     [--concurrency N] [--chunks N] [--force]
 *   pnpm pipeline run https://example.com            (live crawl; needs network)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const hex = (color: string, fallback: string) => {
  const rgb = parseColor(color);
  return rgb ? `0x${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}` : fallback;
};

/**
 * Saved crawl fixtures reference screenshot keys from the machine that
 * crawled them (not committed). Reuse a local copy if one exists, else draw
 * an on-brand wireframe "page" so showcase scenes still have an image.
 */
async function ensureScreenshots(crawl: CrawlOutput, storage: StorageClient, storageDir: string): Promise<number> {
  let generated = 0;
  for (const [i, page] of crawl.pages.entries()) {
    const dest = path.join(storageDir, "assets", page.screenshotKey);
    if (fs.existsSync(dest)) continue;
    const local = path.join(REPO_ROOT, "benchmark", "out", "storage", "assets", page.screenshotKey);
    if (fs.existsSync(local)) {
      await storage.putObject("assets", page.screenshotKey, await fsp.readFile(local), "image/png");
      continue;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const bg = hex(crawl.brand.bg, "0xf4f4f4");
    const fg = hex(crawl.brand.fg, "0x222222");
    const accent = hex(crawl.brand.accent, "0x7c5cff");
    const boxes = [
      `drawbox=x=0:y=0:w=iw:h=72:color=${fg}@0.06:t=fill`,
      `drawbox=x=64:y=24:w=160:h=24:color=${accent}:t=fill`,
      `drawbox=x=iw-280:y=20:w=200:h=32:color=${accent}:t=fill`,
      `drawbox=x=96:y=170:w=760:h=56:color=${fg}@0.85:t=fill`,
      `drawbox=x=96:y=250:w=560:h=28:color=${fg}@0.45:t=fill`,
      `drawbox=x=96:y=320:w=220:h=56:color=${accent}:t=fill`,
      `drawbox=x=820+${i * 40}:y=150:w=520:h=340:color=${accent}@0.25:t=fill`,
      ...[0, 1, 2].map((k) => `drawbox=x=${96 + k * 430}:y=580:w=390:h=300:color=${fg}@0.08:t=fill`),
      ...[0, 1, 2].map((k) => `drawbox=x=${126 + k * 430}:y=830:w=220:h=20:color=${fg}@0.6:t=fill`),
    ].join(",");
    await runFfmpegQuiet(["-y", "-f", "lavfi", "-i", `color=c=${bg}:s=1440x1000`, "-vf", boxes, "-frames:v", "1", dest]);
    generated++;
  }
  return generated;
}

async function main() {
  const [, , cmd, target, ...rest] = process.argv;
  if (cmd !== "run" || !target) {
    console.error("usage: pnpm pipeline run <url-or-crawl-fixture.json> [--out DIR] [--formats 16:9,9:16,1:1] [--music MOOD|off] [--no-voice] [--plan free|pro] [--force]");
    process.exit(2);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const isUrl = /^https?:\/\//.test(target);
  const fixturePath = isUrl ? null : [path.resolve(cwd, target), path.resolve(REPO_ROOT, target)].find((p) => fs.existsSync(p));
  if (!isUrl && !fixturePath) throw new Error(`fixture not found: ${target}`);
  const name = isUrl ? new URL(target).hostname : path.basename(target, ".json").slice(0, 12);
  const outDir = path.resolve(cwd, flag(rest, "out") ?? path.join(REPO_ROOT, "benchmark", "out", "pipeline", name));
  const storageDir = path.join(outDir, "storage");
  await fsp.mkdir(outDir, { recursive: true });

  const formats = (flag(rest, "formats") ?? "16:9,9:16,1:1").split(",") as AspectFormat[];
  const music = flag(rest, "music") ?? "upbeat";
  const options = JobOptions.parse({
    formats,
    lengthSec: 20,
    tone: "clean",
    voiceLanguage: "en",
    voiceId: "default",
    noVoiceover: rest.includes("--no-voice"),
    musicOn: music !== "off",
    musicMood: music === "off" ? "upbeat" : music,
    reviewBeforeRender: false,
  });
  const plan = (flag(rest, "plan") ?? "free") as "free" | "creator" | "pro";
  const force = rest.includes("--force");

  const storage = createLocalStorageClient(storageDir);
  const env = { STORAGE_DRIVER: "local" as const, STORAGE_LOCAL_DIR: storageDir };
  const gemini: LlmProvider | null = process.env.GEMINI_API_KEY ? createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash-lite" }) : null;
  const anthropic: LlmProvider | null = process.env.ANTHROPIC_API_KEY ? createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5" }) : null;
  const tts = process.env.GEMINI_API_KEY ? createGeminiTtsProvider({ apiKey: process.env.GEMINI_API_KEY }) : null;
  const sidecar = getAudioSidecarFromEnv((m) => console.warn(`  [sidecar] ${m}`));
  const jobId = randomUUID();
  const timings: Record<string, number> = {};
  const t = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    process.stdout.write(`> ${stage}... `);
    const r = await fn();
    timings[stage] = Date.now() - s;
    console.log(`${(timings[stage]! / 1000).toFixed(1)}s`);
    return r;
  };

  console.log(`SiteReel pipeline  job=${jobId}`);
  console.log(`  input=${isUrl ? target : fixturePath}  out=${outDir}`);
  console.log(`  llm=${gemini?.id ?? anthropic?.id ?? "fallback"}  tts=${tts?.id ?? "fallback:silence"}  sidecar=${sidecar?.baseUrl ?? "off (ffmpeg fallback)"}  plan=${plan}  music=${music}`);
  const started = Date.now();

  // 1. Crawl (or load fixture)
  const crawl = await t("crawl", async () => {
    if (fixturePath) {
      const raw = JSON.parse(await fsp.readFile(fixturePath, "utf8")) as Record<string, unknown>;
      const parsed = CrawlOutput.parse({ domain: raw.domain, pages: raw.pages, brand: raw.brand, facts: raw.facts, siteBrief: raw.siteBrief });
      const generated = await ensureScreenshots(parsed, storage, storageDir);
      if (generated) process.stdout.write(`(${generated} placeholder screenshots) `);
      return parsed;
    }
    const r = await runCrawlStage(jobId, target, { storage, llmProvider: gemini });
    if (r.outcome !== "ok") throw new Error(`crawl needs input: ${r.reason} — ${r.message}`);
    return r.crawlOutput;
  });

  // 2. Plan
  const planned = await t("plan", () => runPlanStage(crawl, options, { primaryProvider: gemini, escalationProvider: anthropic }));
  await fsp.writeFile(path.join(outDir, "storyboard.json"), JSON.stringify(planned.storyboard, null, 2));

  // 3. Voice
  const voice = await t("voice", () => runVoiceStage(jobId, planned.storyboard, options, { storage, ttsProvider: tts, aligner: sidecar, repoRoot: REPO_ROOT, log: (m) => console.warn(`  [voice] ${m}`) }));

  // 4. Music + audio mix (format-independent: every format shares one timeline)
  const track = selectMusicTrack(REPO_ROOT, options);
  const baseManifest = buildFilmManifest({ storyboard: planned.storyboard, crawlOutput: crawl, voiceScenes: voice.scenes, format: formats[0]!, music: track });
  const mix = await t("mix", async () => {
    if (!voice.scenes.some((v) => v.audioKey) && !track) return null;
    const narration = await assembleNarrationTrack({ manifest: baseManifest, voiceScenes: voice.scenes, storage, repoRoot: REPO_ROOT });
    return mixFinalAudio({ narration, music: track, durationSec: baseManifest.duration, sidecar, repoRoot: REPO_ROOT });
  });
  if (mix) {
    await fsp.writeFile(path.join(outDir, "audio.wav"), mix.audio);
    console.log(`  audio: ${mix.path}, music=${track?.id ?? "none"}, ${mix.lufs?.toFixed(1) ?? "n/a"} LUFS, TP ${mix.truePeakDbtp?.toFixed(1) ?? "n/a"} dBTP`);
  }

  await bundleFilmEntry();
  const server = await startFilmServer(storageDir, 0);
  const results: Record<string, unknown>[] = [];
  let failed = false;
  try {
    for (const format of formats) {
      const slug = formatSlug(format);
      const manifest = buildFilmManifest({ storyboard: planned.storyboard, crawlOutput: crawl, voiceScenes: voice.scenes, format, music: track });
      await fsp.writeFile(path.join(outDir, `manifest-${slug}.json`), JSON.stringify(manifest, null, 2));

      // 5. QA (hard gate)
      const { report, contactSheet } = await t(`qa ${format}`, async () => {
        const { resolved, manifestUrl } = await publishManifest({ manifest, storage, env, serverUrl: server.url, key: `jobs/${jobId}/qa/manifest-${slug}.json` });
        const llm = gemini ?? anthropic;
        return runQaStage({ manifest: resolved, filmHost: server.url, manifestUrl, storyboard: planned.storyboard, facts: crawl.facts, vision: llm ? createLlmVisionReviewer(llm) : skippedVisionReviewer });
      });
      if (contactSheet) await fsp.writeFile(path.join(outDir, `contact-${slug}.jpg`), contactSheet);
      await fsp.writeFile(path.join(outDir, `qa-${slug}.json`), JSON.stringify(report, null, 2));
      const warnings = report.issues.filter((i) => i.severity === "warning").length;
      console.log(`  QA ${format}: ${report.passed ? "PASSED" : "FAILED"} (${report.blocking.length} blocking, ${warnings} warnings; vision: ${report.vision.status})`);
      for (const i of report.blocking) console.log(`    BLOCKING ${i.code}: ${i.message}`);
      if (!report.passed && !force) {
        failed = true;
        results.push({ format, qa: "failed", blocking: report.blocking });
        continue;
      }

      // 6. Render + encode
      const r = await t(`render ${format}`, () =>
        runRenderStage({
          jobId,
          format,
          manifest,
          audioBuffer: mix?.audio ?? null,
          storage,
          env,
          watermark: plan === "free",
          concurrency: flag(rest, "concurrency") ? Number(flag(rest, "concurrency")) : undefined,
          chunks: flag(rest, "chunks") ? Number(flag(rest, "chunks")) : undefined,
          onProgress: (f, total) => {
            if (f % 60 === 0 || f === total) process.stdout.write(`\r> render ${format}... frame ${f}/${total} `);
          },
        }),
      );
      const mp4 = path.join(outDir, `${slug}.mp4`);
      await fsp.writeFile(mp4, r.videoBuffer);
      await fsp.writeFile(path.join(outDir, `${slug}.png`), r.posterBuffer);
      await fsp.writeFile(path.join(outDir, `${slug}.vtt`), buildVtt(manifest));
      const probe = await ffprobe(mp4);
      const v = probe.streams.find((s) => s.codec_type === "video");
      const a = probe.streams.find((s) => s.codec_type === "audio");
      console.log(
        `  ${slug}.mp4: ${v?.codec_name} ${v?.width}x${v?.height} ${v?.nb_frames} frames ${probe.durationSec.toFixed(2)}s, audio=${a ? `${a.codec_name}` : "none"}, ${(r.bytes / 1024 / 1024).toFixed(2)} MB, ` +
          `${r.chunked.chunks} chunks x ${r.chunked.concurrency} (reused ${r.chunked.chunksReused}), captions=${manifest.captions.length}`,
      );
      results.push({ format, qa: report.passed ? "passed" : "forced", file: mp4, probe: { video: v, audio: a ?? null, durationSec: probe.durationSec }, chunked: r.chunked });
    }
  } finally {
    await server.close();
  }

  const summary = {
    jobId,
    input: isUrl ? target : fixturePath,
    storyboardSource: planned.storyboard.source,
    scenes: planned.storyboard.scenes.map((s) => s.templateId),
    durationSec: baseManifest.duration,
    beatLocked: Boolean(track),
    music: track?.id ?? null,
    voice: { providerIds: [...new Set(voice.scenes.map((s) => s.provider))], cacheHits: voice.cacheHits, aligned: voice.aligned },
    audio: mix ? { path: mix.path, lufs: mix.lufs, truePeakDbtp: mix.truePeakDbtp } : null,
    timingsMs: timings,
    totalMs: Date.now() - started,
    results,
  };
  await fsp.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nDone in ${(summary.totalMs / 1000).toFixed(1)}s -> ${outDir}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
