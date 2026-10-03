import type { Job as BullJob } from "bullmq";
import { eq, desc } from "drizzle-orm";
import { jobs, crawls } from "@sitereel/db";
import { QUEUE_NAMES, validateStoryboard, type CrawlOutput, type JobOptions, type JobStatus, type Storyboard } from "@sitereel/shared";
import { ICON_NAMES } from "@sitereel/film-runtime";
import { runPlanStage } from "../stages/plan.js";
import { redesignScene } from "../lib/scene-composer.js";
import { screenshotPageUrls } from "../lib/storyboard-fallback.js";
import { composeProvider, scriptProviders } from "../lib/llm-providers.js";
import { buildSiteProfile } from "../lib/site-profile.js";
import { deriveSiteLook } from "../lib/site-look.js";
import { chainJobId } from "./voice-processor.js";
import type { WorkerDeps } from "./types.js";
import { PlanJobDataP6, type PlanOverrides } from "../lib/phase6-contracts.js";
import { sha16 } from "../lib/input-hash.js";
import { storyboardRowSource } from "../lib/job-policy.js";
import { finishStageRun, insertStoryboardVersion, loadStoryboardVersion, startStageRun } from "../lib/db-adapters.js";
import { assertNotCancelled, setJobStatus } from "../lib/job-lifecycle.js";

/** Applies quick-change overrides (tone / length / voice) on top of the job's options. */
export function applyPlanOverrides(options: JobOptions, overrides: PlanOverrides | undefined): JobOptions {
  if (!overrides) return options;
  return {
    ...options,
    // A tone the user picks themselves ends "match the site".
    ...(overrides.tone ? { tone: overrides.tone, toneAuto: false } : {}),
    // Contract lengths (15|30|45|60) are wider than JobOptions v1's literal union; the planner takes any target.
    ...(overrides.lengthSec ? { lengthSec: overrides.lengthSec as JobOptions["lengthSec"] } : {}),
    ...(overrides.voiceId ? { voiceId: overrides.voiceId } : {}),
  };
}

/**
 * The editor's "redesign this scene": one scene of one version re-composed as asked, saved as the next version.
 * The job's status doesn't move (the user is still reviewing, or looking at a finished film); the editor learns
 * the outcome from the published event and reloads.
 */
async function processRedesign(deps: WorkerDeps, jobId: string, ask: NonNullable<PlanJobDataP6["redesign"]>): Promise<void> {
  const log = deps.logger.child({ jobId, stage: "plan", reason: "redesign", sceneId: ask.sceneId });
  const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const [crawlRow] = await deps.db.select().from(crawls).where(eq(crawls.jobId, jobId)).orderBy(desc(crawls.createdAt)).limit(1);
  const row = await loadStoryboardVersion(deps.db, jobId, ask.baseVersion);
  if (!jobRow || !crawlRow || !row) throw new Error(`redesign: missing job, crawl or storyboard v${ask.baseVersion} for jobId=${jobId}`);
  const crawl: CrawlOutput = { domain: crawlRow.domain, pages: crawlRow.pages, brand: crawlRow.brand, facts: crawlRow.facts, siteBrief: crawlRow.siteBrief };
  const announce = (ok: boolean, message: string, extra: Record<string, unknown> = {}) =>
    deps.publish({ jobId, stage: "plan", status: jobRow.status, pct: 100, message, payload: { redesign: { sceneId: ask.sceneId, ok, ...extra } }, at: new Date().toISOString() });

  const provider = composeProvider(deps.llm);
  if (!provider) {
    await announce(false, "No design model is configured", { reason: "no_model" });
    return;
  }
  const inputsHash = sha16(["redesign-v1", row.id, ask.sceneId, ask.instruction]);
  const runId = await startStageRun(deps.db, { jobId, stage: "plan", inputsHash });
  const result = await redesignScene(row.json as Storyboard, ask.sceneId, ask.instruction, crawl, jobRow.options, provider);
  const costUsd = result.calls.reduce((n, c) => n + c.costUsd, 0);
  const validation = result.storyboard ? validateStoryboard(result.storyboard, crawl.facts, { pageUrls: screenshotPageUrls(crawl), iconNames: ICON_NAMES }) : null;
  if (!result.storyboard || !validation?.valid) {
    const reason = result.storyboard ? (validation?.issues.find((i) => i.severity === "error")?.message ?? "invalid") : result.reason;
    await finishStageRun(deps.db, runId, { status: "ok", inputsHash, costUsd, outputs: { redesign: { sceneId: ask.sceneId, ok: false, reason }, llmCalls: result.calls } });
    log.warn({ reason }, "redesign produced no valid scene");
    await announce(false, "Couldn't redesign that scene", { reason });
    return;
  }
  const saved = await insertStoryboardVersion(deps.db, { jobId, storyboard: result.storyboard, validation, source: storyboardRowSource("llm") });
  await finishStageRun(deps.db, runId, { status: "ok", inputsHash, costUsd, outputs: { redesign: { sceneId: ask.sceneId, ok: true, version: saved.version }, llmCalls: result.calls } });
  log.info({ version: saved.version, costUsd }, "scene redesigned");
  await announce(true, `Scene redesigned (v${saved.version})`, { version: saved.version });
}

export function createPlanProcessor(deps: WorkerDeps) {
  return async function processPlan(job: BullJob): Promise<void> {
    const data = PlanJobDataP6.parse(job.data);
    const { jobId } = data;
    if (data.reason === "redesign" && data.redesign) return processRedesign(deps, jobId, data.redesign);
    const isQuickChange = data.reason === "quick-change";
    const log = deps.logger.child({ jobId, stage: "plan", reason: data.reason });

    await setJobStatus(deps, jobId, "planning");
    await deps.publish({ jobId, stage: "plan", status: "planning", pct: 10, message: isQuickChange ? "Rewriting the script" : "Writing the script", at: new Date().toISOString() });

    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    const [crawlRow] = await deps.db.select().from(crawls).where(eq(crawls.jobId, jobId)).orderBy(desc(crawls.createdAt)).limit(1);
    if (!jobRow || !crawlRow) throw new Error(`plan stage: missing job or crawl row for jobId=${jobId}`);

    const crawlForLook: CrawlOutput = { domain: crawlRow.domain, pages: crawlRow.pages, brand: crawlRow.brand, facts: crawlRow.facts, siteBrief: crawlRow.siteBrief };
    let options = applyPlanOverrides(jobRow.options, data.overrides);
    // "Match the site": the film's style is the one that fits how the site looks. Decided once, here, and
    // saved, so every later stage (style pack, music mood, re-runs) sees the same concrete tone.
    const autoTone = options.toneAuto ? deriveSiteLook(crawlForLook) : null;
    if (autoTone) options = { ...options, tone: autoTone.tone, toneAuto: false };
    if (data.overrides || autoTone) {
      // Persist so every later stage (voice hash, music, re-runs) sees the quick-changed options.
      await deps.db.update(jobs).set({ options, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    }

    const crawlOutput = crawlForLook;
    const inputsHash = sha16(["plan-v1", crawlRow.id, options.videoType ?? "launch", options.tone, options.lengthSec, options.voiceLanguage, options.noVoiceover, data.reason ?? null]);
    const runId = await startStageRun(deps.db, { jobId, stage: "plan", inputsHash });

    const profile = buildSiteProfile(crawlOutput, options.videoType);
    const result = await runPlanStage(crawlOutput, options, {
      primaryProvider: deps.llm.primary,
      escalationProvider: deps.llm.escalation,
      ...scriptProviders(deps.llm),
      composeProvider: composeProvider(deps.llm),
      seed: jobId,
      log: (m) => log.info(m),
    });
    await assertNotCancelled(deps, jobId);

    // Storyboard versioning (W6): every plan appends max(version)+1.
    const storyboardRow = await insertStoryboardVersion(deps.db, {
      jobId,
      storyboard: result.storyboard,
      validation: result.validation,
      source: storyboardRowSource(result.storyboard.source),
    });

    await finishStageRun(deps.db, runId, {
      status: "ok",
      inputsHash,
      costUsd: result.costUsd,
      outputs: {
        storyboardVersion: storyboardRow.version,
        source: result.storyboard.source,
        attempts: result.attempts,
        valid: result.validation.valid,
        sceneCount: result.storyboard.scenes.length,
        latencyMs: result.latencyMs,
        // Per-call cost/latency (including failed calls) so cost per plan is auditable (§8.3).
        llmCalls: result.calls,
        featured: result.featured,
        ...(result.addedScenes.length ? { addedScenes: result.addedScenes } : {}),
        // Which scenes were designed for this film and which kept their template (and why), with the composer's calls.
        ...(result.compose ? { compose: result.compose } : {}),
        // The script the storyboard was cut to, with the editor's scores, and what writing it cost.
        ...(result.script ? { script: { hook: result.script.hook, lines: result.script.lines.map((l) => l.line), critique: result.script.critique, rewritten: result.script.rewritten } } : {}),
        ...(result.scriptCalls?.length ? { scriptCalls: result.scriptCalls } : {}),
        ...(data.overrides ? { overrides: data.overrides } : {}),
      },
    });

    await deps.db.update(jobs).set({ currentStoryboardId: storyboardRow.id, updatedAt: new Date() }).where(eq(jobs.id, jobId));

    log.info(
      { version: storyboardRow.version, source: result.storyboard.source, attempts: result.attempts, valid: result.validation.valid, costUsd: result.costUsd, latencyMs: result.latencyMs },
      "plan completed",
    );

    // reviewBeforeRender=true parks the job at "review" until approve enqueues voice.
    // A quick change (tone/length from the result page) is auto-approved: the
    // user already approved a script for this job and asked for a variation.
    const autoApprove = isQuickChange || !options.reviewBeforeRender;
    const nextStatus: JobStatus = autoApprove ? "voicing" : "review";
    await setJobStatus(deps, jobId, nextStatus);
    if (autoApprove) {
      await deps.queues.voice.add(
        QUEUE_NAMES.voice,
        { jobId, storyboardVersion: storyboardRow.version },
        { jobId: chainJobId(jobId, "voice", `v${storyboardRow.version}`), attempts: 2, backoff: { type: "fixed", delay: 5_000 } },
      );
    }

    await deps.publish({
      jobId,
      stage: "plan",
      status: nextStatus,
      pct: 100,
      message: `Storyboard v${storyboardRow.version} ready (${result.storyboard.source}, ${result.storyboard.scenes.length} scenes)`,
      payload: {
        storyboardId: storyboardRow.id,
        version: storyboardRow.version,
        source: storyboardRowSource(result.storyboard.source),
        valid: result.validation.valid,
        autoApproved: autoApprove,
        // The storyboard as the live view lists it: each scene, and why that template was open to this site.
        scenes: result.storyboard.scenes.map((s) => ({
          template: s.templateId,
          title: s.onScreenText[0] ?? s.templateId,
          narration: s.narration,
          durationMs: Math.round(s.durationSec * 1000),
          why: profile.templates.find((t) => t.id === s.templateId)?.reason,
        })),
      },
      at: new Date().toISOString(),
    });
  };
}
