import type { Job as BullJob } from "bullmq";
import { eq, desc } from "drizzle-orm";
import { jobs, crawls } from "@sitereel/db";
import { QUEUE_NAMES, type CrawlOutput, type JobOptions, type JobStatus } from "@sitereel/shared";
import { runPlanStage } from "../stages/plan.js";
import { scriptProviders } from "../lib/llm-providers.js";
import { buildSiteProfile } from "../lib/site-profile.js";
import { deriveSiteLook } from "../lib/site-look.js";
import { chainJobId } from "./voice-processor.js";
import type { WorkerDeps } from "./types.js";
import { PlanJobDataP6, type PlanOverrides } from "../lib/phase6-contracts.js";
import { sha16 } from "../lib/input-hash.js";
import { storyboardRowSource } from "../lib/job-policy.js";
import { finishStageRun, insertStoryboardVersion, startStageRun } from "../lib/db-adapters.js";
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

export function createPlanProcessor(deps: WorkerDeps) {
  return async function processPlan(job: BullJob): Promise<void> {
    const data = PlanJobDataP6.parse(job.data);
    const { jobId } = data;
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
    const result = await runPlanStage(crawlOutput, options, { primaryProvider: deps.llm.primary, escalationProvider: deps.llm.escalation, ...scriptProviders(deps.llm), seed: jobId });
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
