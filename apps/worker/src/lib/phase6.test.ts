import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BrandTokens, JobOptions, Storyboard } from "@sitereel/shared";
import { createLocalStorageClient } from "@sitereel/storage";
import {
  buildStageHash,
  decideVoiceScenes,
  qaStageHash,
  renderStageHash,
  sceneVoiceHash,
  shouldSkipStage,
  stableStringify,
  voiceSceneHashes,
  voiceStageHash,
} from "./input-hash.js";
import { decideRefund, decideWatermark, nextStoryboardVersion, storyboardRowSource } from "./job-policy.js";
import { buildManualCrawlOutput, filterUploadKeys, normalizeBrandColor } from "./manual-crawl.js";
import { applyBrandKit, brandKitFromCrawl, userHasKitForHost } from "./brand-kit.js";
import { emailSkipReason, sendJobEmail } from "./email.js";
import { CrawlJobDataP6, PlanJobDataP6, VoiceJobDataP6 } from "./phase6-contracts.js";
import { runVoiceStage } from "../stages/voice.js";
import { downstreamStageNames } from "../processors/rerun-processor.js";
import { applyPlanOverrides } from "../processors/plan-processor.js";

const JOB_ID = "11111111-2222-4333-8444-555555555555";

const storyboard = (narrations: (string | undefined)[]): Storyboard => ({
  version: 1,
  targetDurationSec: 20,
  tone: "clean",
  language: "en",
  rubric: { what: "a", who: "b", differentiator: "c", strongestClaim: "d", visualHook: "e", userFlow: "f", caption: "g" },
  scenes: narrations.map((n, i) => ({ id: `s${i + 1}`, templateId: "KineticHook", durationSec: 3, narration: n, onScreenText: ["Hi"], factIds: [], props: {} })),
  shareCaption: "x",
  source: "fallback",
});

const brand: BrandTokens = { bg: "#ffffff", fg: "#111111", accent: "#ff0000", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null };

describe("input hashes + skip logic", () => {
  const opts = { voiceId: "default", voiceLanguage: "en" as const };

  it("per-scene voice hash changes only for the edited scene", () => {
    const a = voiceSceneHashes(storyboard(["One line.", "Two line.", "Three."]), opts);
    const b = voiceSceneHashes(storyboard(["One line.", "Two lines, edited.", "Three."]), opts);
    expect(a.get("s1")).toBe(b.get("s1"));
    expect(a.get("s2")).not.toBe(b.get("s2"));
    expect(a.get("s3")).toBe(b.get("s3"));
    expect(voiceStageHash(a)).not.toBe(voiceStageHash(b));
  });

  it("voice hash ignores whitespace but not voice/language", () => {
    const base = { voiceId: "v1", language: "en" };
    expect(sceneVoiceHash("Hello   world ", base)).toBe(sceneVoiceHash("Hello world", base));
    expect(sceneVoiceHash("Hello world", base)).not.toBe(sceneVoiceHash("Hello world", { ...base, voiceId: "v2" }));
    expect(sceneVoiceHash("Hello world", base)).not.toBe(sceneVoiceHash("Hello world", { ...base, language: "hi" }));
    expect(sceneVoiceHash("Hello", { ...base, noVoiceover: true })).toBe(sceneVoiceHash(undefined, base));
  });

  it("decideVoiceScenes re-synthesizes changed, missing and forced scenes only", () => {
    const current = new Map([["s1", "h1"], ["s2", "h2b"], ["s3", "h3"], ["s4", "h4"]]);
    const prev = new Map([["s1", "h1"], ["s2", "h2"], ["s3", "h3"]]);
    expect(decideVoiceScenes(current, prev)).toEqual({ synthesize: ["s2", "s4"], reuse: ["s1", "s3"] });
    expect(decideVoiceScenes(current, prev, { forceSceneIds: ["s1"] }).synthesize).toEqual(["s1", "s2", "s4"]);
    expect(decideVoiceScenes(current, prev, { forceAll: true }).reuse).toEqual([]);
  });

  it("shouldSkipStage compares with the latest successful, non-invalidated run only", () => {
    expect(shouldSkipStage("A", [])).toBe(false);
    expect(shouldSkipStage("A", [{ inputsHash: "A", status: "ok" }])).toBe(true);
    expect(shouldSkipStage("A", [{ inputsHash: "A", status: "skipped" }])).toBe(true);
    // newest first: a later run with different inputs overwrote the outputs
    expect(shouldSkipStage("A", [{ inputsHash: "B", status: "ok" }, { inputsHash: "A", status: "ok" }])).toBe(false);
    // failed/running runs are ignored when finding the latest successful one
    expect(shouldSkipStage("A", [{ inputsHash: "B", status: "failed" }, { inputsHash: "A", status: "ok" }])).toBe(true);
    expect(shouldSkipStage("A", [{ inputsHash: "A", status: "ok", invalidated: true }])).toBe(false);
    expect(shouldSkipStage("A", [{ inputsHash: "A", status: "ok" }], { force: true })).toBe(false);
  });

  it("build hash depends on content, not key order or storyboard version", () => {
    const sb = storyboard(["One.", "Two."]);
    const h1 = buildStageHash({ storyboard: sb, audioHashes: { s1: "a", s2: "b" }, brand, musicId: "m", formats: ["16:9"] });
    const h2 = buildStageHash({ storyboard: { ...sb, version: 7 } as Storyboard, audioHashes: new Map([["s2", "b"], ["s1", "a"]]), brand: { ...brand }, musicId: "m", formats: ["16:9"] });
    expect(h1).toBe(h2);
    expect(buildStageHash({ storyboard: sb, audioHashes: { s1: "a", s2: "CHANGED" }, brand, musicId: "m", formats: ["16:9"] })).not.toBe(h1);
    expect(buildStageHash({ storyboard: sb, audioHashes: { s1: "a", s2: "b" }, brand: { ...brand, accent: "#00ff00" }, musicId: "m", formats: ["16:9"] })).not.toBe(h1);
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });

  it("qa/render hashes are format-scoped and render depends on watermark", () => {
    expect(qaStageHash("m", "16:9").startsWith("16:9:")).toBe(true);
    expect(qaStageHash("m", "16:9")).not.toBe(qaStageHash("m", "1:1"));
    const r = (watermark: boolean) => renderStageHash({ manifestHash: "m", format: "9:16", watermark });
    expect(r(true)).not.toBe(r(false));
    expect(r(true).startsWith("9:16:")).toBe(true);
  });
});

describe("voice stage reuse (downstream-only re-voice)", () => {
  it("re-synthesizes only scenes missing from the reuse map", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "p6-voice-"));
    try {
      const storage = createLocalStorageClient(dir);
      const options = { voiceId: "default", voiceLanguage: "en", noVoiceover: false } as JobOptions;
      const sb1 = storyboard(["First line here.", "Second line here.", "Third line."]);
      const hashes1 = voiceSceneHashes(sb1, options);
      const first = await runVoiceStage(JOB_ID, sb1, options, { storage, ttsProvider: null, sceneHashes: hashes1 });
      expect(first.synthesized).toEqual(["s1", "s2", "s3"]);

      const sb2 = storyboard(["First line here.", "A brand new second line.", "Third line."]);
      const hashes2 = voiceSceneHashes(sb2, options);
      const decision = decideVoiceScenes(hashes2, hashes1);
      const reuse = new Map(first.scenes.filter((s) => decision.reuse.includes(s.sceneId)).map((s) => [s.sceneId, s]));
      const second = await runVoiceStage(JOB_ID, sb2, options, { storage, ttsProvider: null, reuse, sceneHashes: hashes2 });
      expect(second.synthesized).toEqual(["s2"]);
      expect(second.reused).toEqual(["s1", "s3"]);
      // content-addressed keys: the old s2 take is untouched, the new one has a new key
      const old2 = first.scenes.find((s) => s.sceneId === "s2")!.audioKey!;
      const new2 = second.scenes.find((s) => s.sceneId === "s2")!.audioKey!;
      expect(new2).not.toBe(old2);
      expect(second.scenes.find((s) => s.sceneId === "s1")!.audioKey).toBe(first.scenes.find((s) => s.sceneId === "s1")!.audioKey);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("storyboard versioning", () => {
  it("increments from the max existing version", () => {
    expect(nextStoryboardVersion([])).toBe(1);
    expect(nextStoryboardVersion([1])).toBe(2);
    expect(nextStoryboardVersion([3, 1, 2])).toBe(4);
    expect(nextStoryboardVersion([1, 5])).toBe(6); // gaps don't matter
  });

  it("maps storyboard sources to the contract vocabulary", () => {
    expect(storyboardRowSource("llm")).toBe("llm");
    expect(storyboardRowSource("llm-escalated")).toBe("llm");
    expect(storyboardRowSource("fallback")).toBe("fallback");
    expect(storyboardRowSource("user")).toBe("user");
  });
});

describe("refund decision table", () => {
  it.each([
    [{ status: "failed", errorCode: "render_failed" }, true, "system_failure"],
    [{ status: "failed", errorCode: "qa_failed" }, true, "system_failure"],
    [{ status: "failed", errorCode: null }, true, "system_failure"],
    [{ status: "failed", errorCode: "storyboard_invalid" }, false, "user_fault"],
    [{ status: "needs_input", errorCode: "blocked" }, false, "needs_input"],
    [{ status: "cancelled", errorCode: null }, false, "cancelled"],
    [{ status: "done", errorCode: null }, false, "not_failed"],
    [{ status: "rendering", errorCode: null }, false, "not_failed"],
  ] as const)("%o -> refund=%s (%s)", (input, refund, reason) => {
    expect(decideRefund(input)).toEqual({ refund, reason });
  });
});

describe("watermark", () => {
  it("free -> on, paid now or paid at creation -> off", () => {
    expect(decideWatermark({ currentPlan: "free" })).toBe(true);
    expect(decideWatermark({ currentPlan: "pro" })).toBe(false);
    expect(decideWatermark({ currentPlan: "creator" })).toBe(false);
    expect(decideWatermark({ currentPlan: "free", snapshot: false })).toBe(false); // created while paid, since downgraded
    expect(decideWatermark({ currentPlan: "pro", snapshot: true })).toBe(false); // upgraded since
  });
});

describe("manual FactLedger builder (needs-input resume)", () => {
  const url = "https://www.acme.test/";
  it("builds facts, pages and brand from manual input", () => {
    const out = buildManualCrawlOutput({
      jobId: JOB_ID,
      url,
      manual: {
        keys: [`jobs/${JOB_ID}/uploads/a.png`, `jobs/${JOB_ID}/uploads/b.webp`, "jobs/other-job/uploads/x.png", `jobs/${JOB_ID}/uploads/../../evil.png`],
        description: "Acme makes invoices painless. Teams close books 3x faster.",
        features: ["Auto-reconcile bank feeds", "Multi-currency", "Auto-reconcile bank feeds"],
        brandColor: "ff6600",
      },
    });
    expect(out.domain).toBe("www.acme.test");
    expect(out.facts.map((f) => [f.kind, f.text])).toEqual([
      ["hero", "Acme makes invoices painless."],
      ["other", "Teams close books 3x faster."],
      ["feature", "Auto-reconcile bank feeds"],
      ["feature", "Multi-currency"],
    ]);
    expect(new Set(out.facts.map((f) => f.id)).size).toBe(4);
    expect(out.facts.every((f) => f.sourceUrl === url)).toBe(true);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[0]).toMatchObject({ url, screenshotKey: `jobs/${JOB_ID}/uploads/a.png`, sectionScreenshotKeys: [`jobs/${JOB_ID}/uploads/a.png`, `jobs/${JOB_ID}/uploads/b.webp`] });
    expect(out.pages[1]!.url).toBe("https://www.acme.test/#upload-2");
    expect(out.brand.accent).toBe("#ff6600");
    expect(out.siteBrief.factIds).toEqual(out.facts.map((f) => f.id));
    expect(out.siteBrief.strongestClaimFactId).toBe(out.facts[2]!.id);
  });

  it("falls back to a page without screenshot and the default accent", () => {
    const out = buildManualCrawlOutput({ jobId: JOB_ID, url, manual: { keys: [], description: "Hello there world." } });
    expect(out.pages).toEqual([{ url, screenshotKey: "" }]);
    expect(normalizeBrandColor("not-a-colour")).toBeNull();
    expect(out.brand.accent).toBe("#4f46e5");
  });

  it("only accepts this job's upload keys", () => {
    expect(filterUploadKeys(JOB_ID, [`jobs/${JOB_ID}/uploads/a.png`, `jobs/${JOB_ID}/crawl/home.png`, "x"])).toEqual([`jobs/${JOB_ID}/uploads/a.png`]);
  });

  it("queue payloads accept the contract shapes", () => {
    expect(CrawlJobDataP6.parse({ jobId: JOB_ID, url, manual: { keys: ["k"] } }).manual?.keys).toEqual(["k"]);
    expect(VoiceJobDataP6.parse({ jobId: JOB_ID, storyboardVersion: 2, sceneIds: ["s1"] }).sceneIds).toEqual(["s1"]);
    expect(PlanJobDataP6.parse({ jobId: JOB_ID, reason: "quick-change", overrides: { tone: "playful", lengthSec: 45 } }).overrides?.lengthSec).toBe(45);
  });
});

describe("brand kits", () => {
  it("overrides crawl brand tokens with a kit (contract vocabulary)", () => {
    const out = applyBrandKit(brand, { colors: { primary: "#123456", background: "#000000", foreground: "#fafafa" }, fonts: { heading: "Poppins", body: "Lato" }, logoKey: "kits/u/logo.png" });
    expect(out).toEqual({ bg: "#000000", fg: "#fafafa", accent: "#123456", fontDisplay: "Poppins", fontBody: "Lato", logoUrl: "asset://assets/kits/u/logo.png" });
  });

  it("supports the Wave A vocabulary and keeps unset fields", () => {
    const out = applyBrandKit({ ...brand, logoUrl: "https://acme.test/logo.svg" }, { colors: { text: "#222222", accent: "#00aa00" }, fonts: {} });
    expect(out).toEqual({ ...brand, fg: "#222222", accent: "#00aa00", logoUrl: "https://acme.test/logo.svg" });
    expect(applyBrandKit(brand, null)).toBe(brand);
  });

  it("auto-create builds a kit named after the hostname and dedupes per host", () => {
    const kit = brandKitFromCrawl(brand, "https://www.acme.test/pricing");
    expect(kit.name).toBe("acme.test");
    expect(kit.colors).toMatchObject({ primary: "#ff0000", background: "#ffffff", foreground: "#111111" });
    expect(applyBrandKit({ ...brand, accent: "#000000" }, kit).accent).toBe("#ff0000"); // round-trips
    expect(userHasKitForHost([{ name: "Mine", sourceUrl: "https://acme.test" }], "https://www.acme.test/x")).toBe(true);
    expect(userHasKitForHost([{ name: "acme.test", sourceUrl: null }], "https://acme.test")).toBe(true);
    expect(userHasKitForHost([{ name: "other.test", sourceUrl: "https://other.test" }], "https://acme.test")).toBe(false);
  });
});

describe("email skip conditions", () => {
  const cfg = { webUrl: "http://web.test/", internalSecret: "s3cret" };
  it("skips when unconfigured, no recipient, or opted out", () => {
    expect(emailSkipReason({ ...cfg, internalSecret: null }, "a@b.c", null)).toBe("no_secret");
    expect(emailSkipReason({ ...cfg, webUrl: "" }, "a@b.c", null)).toBe("no_web_url");
    expect(emailSkipReason(cfg, null, null)).toBe("no_recipient");
    expect(emailSkipReason(cfg, "a@b.c", { emailNotifications: false })).toBe("opted_out");
    expect(emailSkipReason(cfg, "a@b.c", { emailNotifications: true })).toBeNull();
    expect(emailSkipReason(cfg, "a@b.c", {})).toBeNull(); // unset pref = send
    expect(emailSkipReason(cfg, "a@b.c", null)).toBeNull();
  });

  it("posts the contract body with the internal secret", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const r = await sendJobEmail(cfg, { template: "video-ready", to: "a@b.c", settings: null, data: { jobId: JOB_ID, title: "Acme", url: "https://acme.test" } }, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ sent: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://web.test/api/internal/email");
    expect((init.headers as Record<string, string>)["x-internal-secret"]).toBe("s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ template: "video-ready", to: "a@b.c", data: { jobId: JOB_ID, title: "Acme", url: "https://acme.test" } });
  });

  it("never throws on email errors and never calls fetch when skipped", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await sendJobEmail(cfg, { template: "needs-input", to: "a@b.c", settings: null, data: { jobId: JOB_ID, title: "t", url: "u", reason: "blocked" } }, boom as unknown as typeof fetch)).toEqual({ sent: false, error: "ECONNREFUSED" });
    const http500 = vi.fn(async () => new Response("x", { status: 500 }));
    expect(await sendJobEmail(cfg, { template: "needs-input", to: "a@b.c", settings: null, data: { jobId: JOB_ID, title: "t", url: "u" } }, http500 as unknown as typeof fetch)).toEqual({ sent: false, error: "HTTP 500" });
    const never = vi.fn();
    expect(await sendJobEmail(cfg, { template: "video-ready", to: "a@b.c", settings: { emailNotifications: false }, data: { jobId: JOB_ID, title: "t", url: "u" } }, never as unknown as typeof fetch)).toEqual({ sent: false, skipped: "opted_out" });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("re-run from stage + quick change", () => {
  it("lists the stage and everything downstream", () => {
    expect(downstreamStageNames("crawl")).toEqual(["crawl", "extract", "plan", "voice", "build", "qa", "render", "encode"]);
    expect(downstreamStageNames("voice")).toEqual(["voice", "build", "qa", "render", "encode"]);
    expect(downstreamStageNames("render")).toEqual(["render", "encode"]);
  });

  it("applies tone/length/voice overrides", () => {
    const base = { formats: ["16:9"], lengthSec: 20, tone: "clean", voiceLanguage: "en", voiceId: "default", noVoiceover: false, musicOn: true, musicMood: "upbeat", reviewBeforeRender: true } as JobOptions;
    expect(applyPlanOverrides(base, undefined)).toBe(base);
    expect(applyPlanOverrides(base, { tone: "playful", lengthSec: 45 })).toMatchObject({ tone: "playful", lengthSec: 45, voiceId: "default" });
  });
});
