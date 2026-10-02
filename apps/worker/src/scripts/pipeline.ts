import "dotenv/config";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CrawlOutput, JobOptions, Storyboard, ffprobe, formatSlug, runFfmpegQuiet, validateStoryboard, type AspectFormat } from "@sitereel/shared";
import { createLocalStorageClient, type StorageClient } from "@sitereel/storage";
import { selectLlmProviders, type LlmEnv } from "../lib/llm-providers.js";
import { createGeminiTtsProvider } from "@sitereel/tts";
import { parseColor, type FilmManifest } from "@sitereel/film-runtime";
import { bundleFilmEntry, startFilmServer } from "@sitereel/renderer";
import { runCrawlStage } from "../stages/crawl.js";
import { runPlanStage } from "../stages/plan.js";
import { runVoiceStage, type VoiceSceneResult } from "../stages/voice.js";
import { buildFilmManifest } from "../stages/build.js";
import { runQaStage, createLlmVisionReviewer, skippedVisionReviewer } from "../stages/qa.js";
import { publishManifest, runRenderStage } from "../stages/render.js";
import { assembleNarrationTrack, mixFinalAudio } from "../lib/audio-mix.js";
import { buildVtt } from "../lib/vtt.js";
import { getAudioSidecarFromEnv } from "../lib/audio-sidecar.js";
import { selectMusicTrack } from "../lib/music.js";
import { screenshotPageUrls } from "../lib/storyboard-fallback.js";
import { buildStageHash, decideVoiceScenes, manifestHash, qaStageHash, renderStageHash, sha16, voiceSceneHashes } from "../lib/input-hash.js";

/**
 * End-to-end local pipeline (Phase 4 "pnpm pipeline run <url>"): crawl -> plan
 * -> voice -> build -> QA -> render+encode, all in-process — no Redis, no
 * Postgres, no queues. Works fully offline from a saved crawl fixture
 * (benchmark/fixtures/*.json): no LLM key = deterministic fallback storyboard,
 * no TTS key = silent fallback voice, no sidecar = local ffmpeg mix.
 *
 *   pnpm pipeline run benchmark/fixtures/<id>.json [--out DIR] [--formats 16:9,9:16,1:1]
 *                     [--music upbeat|calm|energetic|cinematic|off] [--tone clean|playful|cinematic|app-store]
 *                     [--no-voice] [--plan free|pro]
 *                     [--concurrency N] [--chunks N] [--force] [--edit storyboard.json]
 *   pnpm pipeline run https://example.com            (live crawl; needs network)
 *
 * Phase 6 downstream-only re-runs: every run records per-stage input hashes
 * in <out>/stage-cache.json (same pure hash functions the queue processors
 * use). Re-running into the same --out skips any stage whose inputs are
 * unchanged and reuses its outputs. `--edit <storyboard.json>` replaces the
 * plan stage with an edited storyboard (e.g. <out>/storyboard.json with one
 * scene's narration changed): only the edited scenes are re-voiced, and
 * build / QA / render re-run only if their inputs actually changed.
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

/** Per-stage input hashes + reusable outputs from the previous run into the same --out dir. */
interface StageCache {
  jobId: string;
  plan?: { hash: string };
  voice?: Record<string, { hash: string; result: VoiceSceneResult }>;
  build?: { hash: string };
  mix?: { hash: string };
  qa?: Record<string, { hash: string; passed: boolean }>;
  render?: Record<string, { hash: string }>;
}

async function main() {
  const [, , cmd, target, ...rest] = process.argv;
  if (cmd !== "run" || !target) {
    console.error(
      "usage: pnpm pipeline run <url-or-crawl-fixture.json> [--out DIR] [--formats 16:9,9:16,1:1] [--music MOOD|off] [--tone clean|playful|cinematic|app-store] [--no-voice] [--plan free|pro] [--force] [--edit storyboard.json]",
    );
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
    tone: flag(rest, "tone") ?? "clean",
    voiceLanguage: "en",
    voiceId: "default",
    noVoiceover: rest.includes("--no-voice"),
    musicOn: music !== "off",
    musicMood: music === "off" ? "upbeat" : music,
    reviewBeforeRender: false,
  });
  const plan = (flag(rest, "plan") ?? "free") as "free" | "creator" | "pro";
  const force = rest.includes("--force");
  const editArg = flag(rest, "edit");
  const editPath = editArg ? [path.resolve(cwd, editArg), path.resolve(REPO_ROOT, editArg)].find((p) => fs.existsSync(p)) : undefined;
  if (editArg && !editPath) throw new Error(`--edit storyboard not found: ${editArg}`);

  // Stage cache: reused across runs into the same --out (and the same jobId, so storage keys line up).
  const cachePath = path.join(outDir, "stage-cache.json");
  const cache: StageCache = fs.existsSync(cachePath) ? (JSON.parse(await fsp.readFile(cachePath, "utf8")) as StageCache) : { jobId: randomUUID() };
  const saveCache = () => fsp.writeFile(cachePath, JSON.stringify(cache, null, 2));
  const reuseLog: { stage: string; action: "ran" | "skipped" | "partial"; detail?: string }[] = [];
  const note = (stage: string, action: "ran" | "skipped" | "partial", detail?: string) => {
    reuseLog.push({ stage, action, detail });
    if (action !== "ran") console.log(`  ${action === "skipped" ? "SKIPPED" : "PARTIAL"} ${stage}${detail ? `: ${detail}` : ""}`);
  };

  const storage = createLocalStorageClient(storageDir);
  const env = { STORAGE_DRIVER: "local" as const, STORAGE_LOCAL_DIR: storageDir };
  const { primary: gemini, escalation: anthropic } = selectLlmProviders(process.env as LlmEnv);
  if (gemini) console.log(`  LLM: ${gemini.id}${anthropic ? ` (escalation: ${anthropic.id})` : ""}`);
  const tts = process.env.GEMINI_API_KEY ? createGeminiTtsProvider({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_TTS_MODEL || undefined }) : null;
  const sidecar = getAudioSidecarFromEnv((m) => console.warn(`  [sidecar] ${m}`));
  const jobId = cache.jobId;
  const timings: Record<string, number> = {};
  const t = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    process.stdout.write(`> ${stage}... `);
    const r = await fn();
    timings[stage] = Date.now() - s;
    console.log(`${(timings[stage]! / 1000).toFixed(1)}s`);
    return r;
  };

  console.log(`SiteReel pipeline  job=${jobId}${editPath ? `  (edit run: ${editPath})` : ""}`);
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
    // Saved in fixture form: re-run offline against the same site with `pipeline run <out>/crawl.json --out <out>`
    // (same --out, so the screenshots already in <out>/storage are found).
    await fsp.writeFile(path.join(outDir, "crawl.json"), JSON.stringify({ url: target, ...r.crawlOutput }, null, 2));
    return r.crawlOutput;
  });
  note("crawl", fixturePath ? "skipped" : "ran", fixturePath ? "saved fixture" : undefined);

  // 2. Plan — or the edited storyboard (W6 editor save), which replaces it.
  const planHash = sha16(["plan-v1", crawl, options.tone, options.lengthSec, options.voiceLanguage, options.noVoiceover, gemini?.id ?? null, anthropic?.id ?? null]);
  const plannedPath = path.join(outDir, "storyboard.planned.json");
  let storyboard: Storyboard;
  if (editPath) {
    storyboard = Storyboard.parse(JSON.parse(await fsp.readFile(editPath, "utf8")));
    storyboard = { ...storyboard, version: storyboard.version + 1 };
    const report = validateStoryboard(storyboard, crawl.facts, { pageUrls: screenshotPageUrls(crawl) });
    if (!report.valid) console.log(`  edited storyboard has ${report.issues.filter((i) => i.severity === "error").length} validation error(s) (rendering anyway)`);
    note("plan", "skipped", `edited storyboard v${storyboard.version} (${path.basename(editPath)})`);
  } else if (!force && cache.plan?.hash === planHash && fs.existsSync(plannedPath)) {
    storyboard = Storyboard.parse(JSON.parse(await fsp.readFile(plannedPath, "utf8")));
    note("plan", "skipped", "inputs unchanged — reused storyboard.planned.json");
  } else {
    const planned = await t("plan", () => runPlanStage(crawl, options, { primaryProvider: gemini, escalationProvider: anthropic }));
    storyboard = planned.storyboard;
    await fsp.writeFile(plannedPath, JSON.stringify(storyboard, null, 2));
    cache.plan = { hash: planHash };
    note("plan", "ran");
  }
  // storyboard.json is always the version that was voiced/rendered — edit a copy of it for the next --edit run.
  await fsp.writeFile(path.join(outDir, "storyboard.json"), JSON.stringify(storyboard, null, 2));

  // 3. Voice — per-scene input hashes; only changed scenes are synthesized.
  const sceneHashes = voiceSceneHashes(storyboard, options);
  const prevVoice = force ? {} : (cache.voice ?? {});
  const decision = decideVoiceScenes(sceneHashes, new Map(Object.entries(prevVoice).map(([id, v]) => [id, v.hash])));
  const reuse = new Map(decision.reuse.map((id) => [id, prevVoice[id]!.result]));
  const voice = await t("voice", () =>
    runVoiceStage(jobId, storyboard, options, { storage, ttsProvider: tts, aligner: sidecar, repoRoot: REPO_ROOT, log: (m) => console.warn(`  [voice] ${m}`), reuse, sceneHashes }),
  );
  cache.voice = Object.fromEntries(voice.scenes.map((s) => [s.sceneId, { hash: sceneHashes.get(s.sceneId)!, result: s }]));
  if (voice.synthesized.length === 0) note("voice", "skipped", `all ${voice.reused.length} scenes unchanged`);
  else if (voice.reused.length > 0) note("voice", "partial", `re-voiced [${voice.synthesized.join(", ")}], reused [${voice.reused.join(", ")}]`);
  else note("voice", "ran", `${voice.synthesized.length} scenes`);
  await saveCache();

  // 4. Build — skip when storyboard content, audio, brand, music and formats are unchanged.
  const track = selectMusicTrack(REPO_ROOT, { ...options, seed: flag(rest, "track") ?? jobId });
  const audioHashes = Object.fromEntries(voice.scenes.map((s) => [s.sceneId, `${sceneHashes.get(s.sceneId)}:${s.audioKey ?? ""}`]));
  const buildHash = buildStageHash({ storyboard, audioHashes, brand: crawl.brand, musicId: track?.id ?? null, formats });
  const manifests = new Map<AspectFormat, FilmManifest>();
  const buildSkipped = !force && cache.build?.hash === buildHash && formats.every((f) => fs.existsSync(path.join(outDir, `manifest-${formatSlug(f)}.json`)));
  if (buildSkipped) {
    for (const f of formats) manifests.set(f, JSON.parse(await fsp.readFile(path.join(outDir, `manifest-${formatSlug(f)}.json`), "utf8")) as FilmManifest);
    note("build", "skipped", "inputs unchanged — reused manifests");
  } else {
    await t("build", async () => {
      for (const f of formats) {
        const m = buildFilmManifest({ storyboard, crawlOutput: crawl, voiceScenes: voice.scenes, format: f, music: track });
        manifests.set(f, m);
        await fsp.writeFile(path.join(outDir, `manifest-${formatSlug(f)}.json`), JSON.stringify(m, null, 2));
      }
    });
    cache.build = { hash: buildHash };
    note("build", "ran");
  }
  await saveCache();

  // 5. Audio mix (format-independent: every format shares one timeline)
  const baseManifest = manifests.get(formats[0]!)!;
  const mixHash = sha16(["mix-v2", manifestHash({ ...baseManifest, width: 0, height: 0 }), audioHashes, track?.id ?? null]);
  const audioPath = path.join(outDir, "audio.wav");
  let mixAudio: Buffer | null = null;
  let mixInfo: { path: string; lufs: number | null; truePeakDbtp: number | null } | null = null;
  if (!force && cache.mix?.hash === mixHash && fs.existsSync(audioPath)) {
    mixAudio = await fsp.readFile(audioPath);
    note("mix", "skipped", "narration + music unchanged — reused audio.wav");
  } else {
    const mix = await t("mix", async () => {
      if (!voice.scenes.some((v) => v.audioKey) && !track) return null;
      const narration = await assembleNarrationTrack({ manifest: baseManifest, voiceScenes: voice.scenes, storage, repoRoot: REPO_ROOT, sfx: Boolean(track) });
      return mixFinalAudio({ narration, music: track, durationSec: baseManifest.duration, sidecar, repoRoot: REPO_ROOT });
    });
    if (mix) {
      await fsp.writeFile(audioPath, mix.audio);
      mixAudio = mix.audio;
      mixInfo = { path: mix.path, lufs: mix.lufs ?? null, truePeakDbtp: mix.truePeakDbtp ?? null };
      console.log(`  audio: ${mix.path}, music=${track?.id ?? "none"}, ${mix.lufs?.toFixed(1) ?? "n/a"} LUFS, TP ${mix.truePeakDbtp?.toFixed(1) ?? "n/a"} dBTP`);
    }
    cache.mix = { hash: mixHash };
    note("mix", "ran");
  }
  await saveCache();

  await bundleFilmEntry();
  const server = await startFilmServer(storageDir, 0);
  const results: Record<string, unknown>[] = [];
  let failed = false;
  try {
    // 6. QA (hard gate) — every format at once (QA is light and mostly idle on the browser);
    //    skipped per format when that exact manifest already passed.
    const qaPassed = new Map<AspectFormat, boolean>();
    const qaTodo = formats.filter((format) => {
      const qaHash = qaStageHash(manifestHash(manifests.get(format)!), format);
      if (!force && cache.qa?.[format]?.hash === qaHash && cache.qa[format]!.passed) {
        qaPassed.set(format, true);
        note(`qa ${format}`, "skipped", "manifest unchanged — previous pass reused");
        return false;
      }
      return true;
    });
    if (qaTodo.length > 0) {
      const reports = await t(`qa ${qaTodo.join(" ")}`, () =>
        Promise.all(
          qaTodo.map(async (format) => {
            const { resolved, manifestUrl } = await publishManifest({ manifest: manifests.get(format)!, storage, env, serverUrl: server.url, key: `jobs/${jobId}/qa/manifest-${formatSlug(format)}.json` });
            const llm = gemini ?? anthropic;
            return runQaStage({
              manifest: resolved,
              filmHost: server.url,
              manifestUrl,
              storyboard,
              facts: crawl.facts,
              vision: llm ? createLlmVisionReviewer(llm) : skippedVisionReviewer,
              secondary: format !== formats[0],
            });
          }),
        ),
      );
      for (const [i, format] of qaTodo.entries()) {
        const slug = formatSlug(format);
        const { report, contactSheet } = reports[i]!;
        if (contactSheet) await fsp.writeFile(path.join(outDir, `contact-${slug}.jpg`), contactSheet);
        await fsp.writeFile(path.join(outDir, `qa-${slug}.json`), JSON.stringify(report, null, 2));
        const warnings = report.issues.filter((x) => x.severity === "warning").length;
        console.log(`  QA ${format}: ${report.passed ? "PASSED" : "FAILED"} (${report.blocking.length} blocking, ${warnings} warnings; vision: ${report.vision.status}; ${(report.durationMs / 1000).toFixed(1)}s)`);
        for (const b of report.blocking) console.log(`    BLOCKING ${b.code}: ${b.message}`);
        qaPassed.set(format, report.passed);
        cache.qa = { ...(cache.qa ?? {}), [format]: { hash: qaStageHash(manifestHash(manifests.get(format)!), format), passed: report.passed } };
        note(`qa ${format}`, "ran");
        if (!report.passed && !force) {
          failed = true;
          results.push({ format, qa: "failed", blocking: report.blocking });
        }
      }
      await saveCache();
    }

    for (const format of formats) {
      const slug = formatSlug(format);
      const manifest = manifests.get(format)!;
      const mHash = manifestHash(manifest);
      const passed = qaPassed.get(format) ?? false;
      if (!passed && !force) continue;

      // 7. Render + encode — skipped when manifest, audio and watermark are unchanged and the MP4 exists.
      const mp4 = path.join(outDir, `${slug}.mp4`);
      const renderHash = renderStageHash({ manifestHash: mHash, format, watermark: plan === "free", audioHash: mixHash });
      if (!force && cache.render?.[format]?.hash === renderHash && fs.existsSync(mp4)) {
        note(`render ${format}`, "skipped", `inputs unchanged — reused ${slug}.mp4`);
        results.push({ format, qa: passed ? "passed" : "forced", file: mp4, reused: true });
        continue;
      }
      const r = await t(`render ${format}`, () =>
        runRenderStage({
          jobId,
          format,
          manifest,
          audioBuffer: mixAudio,
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
      await fsp.writeFile(mp4, r.videoBuffer);
      await fsp.writeFile(path.join(outDir, `${slug}.png`), r.posterBuffer);
      await fsp.writeFile(path.join(outDir, `${slug}.vtt`), buildVtt(manifest));
      cache.render = { ...(cache.render ?? {}), [format]: { hash: renderHash } };
      await saveCache();
      note(`render ${format}`, "ran");
      const probe = await ffprobe(mp4);
      const v = probe.streams.find((s) => s.codec_type === "video");
      const a = probe.streams.find((s) => s.codec_type === "audio");
      console.log(
        `  ${slug}.mp4: ${v?.codec_name} ${v?.width}x${v?.height} ${v?.nb_frames} frames ${probe.durationSec.toFixed(2)}s, audio=${a ? `${a.codec_name}` : "none"}, ${(r.bytes / 1024 / 1024).toFixed(2)} MB, ` +
          `${r.chunked.chunks} chunks x ${r.chunked.concurrency} (reused ${r.chunked.chunksReused}), captions=${manifest.captions.length}`,
      );
      results.push({ format, qa: passed ? "passed" : "forced", file: mp4, probe: { video: v, audio: a ?? null, durationSec: probe.durationSec }, chunked: r.chunked });
    }
  } finally {
    await server.close();
  }

  const summary = {
    jobId,
    input: isUrl ? target : fixturePath,
    edit: editPath ?? null,
    storyboardVersion: storyboard.version,
    storyboardSource: storyboard.source,
    scenes: storyboard.scenes.map((s) => s.templateId),
    durationSec: baseManifest.duration,
    beatLocked: Boolean(track),
    music: track?.id ?? null,
    voice: { providerIds: [...new Set(voice.scenes.map((s) => s.provider))], cacheHits: voice.cacheHits, aligned: voice.aligned, synthesized: voice.synthesized, reused: voice.reused },
    audio: mixInfo,
    stageReuse: reuseLog,
    timingsMs: timings,
    totalMs: Date.now() - started,
    results,
  };
  await fsp.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log("\nStage reuse:");
  for (const r of reuseLog) console.log(`  ${r.stage.padEnd(12)} ${r.action.toUpperCase().padEnd(8)} ${r.detail ?? ""}`);
  console.log(`\nDone in ${(summary.totalMs / 1000).toFixed(1)}s -> ${outDir}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
