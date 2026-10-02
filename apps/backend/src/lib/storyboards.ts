import { and, desc, eq } from "drizzle-orm";
import { crawls, storyboards, type Db } from "@sitereel/db";
import { validateStoryboard, type FactLedger, type ValidationReport } from "@sitereel/shared";

export type StoryboardRow = typeof storyboards.$inferSelect;
export type CrawlRow = typeof crawls.$inferSelect;

/** Statuses in which the storyboard may be edited, re-voiced or (re-)approved. */
export const EDITABLE_STATUSES = ["review", "done", "failed"] as const;

export function isEditableStatus(status: string): status is (typeof EDITABLE_STATUSES)[number] {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

export async function loadLatestStoryboard(db: Db, jobId: string): Promise<StoryboardRow | undefined> {
  const [row] = await db.select().from(storyboards).where(eq(storyboards.jobId, jobId)).orderBy(desc(storyboards.version)).limit(1);
  return row;
}

export async function loadStoryboardVersion(db: Db, jobId: string, version: number): Promise<StoryboardRow | undefined> {
  const [row] = await db
    .select()
    .from(storyboards)
    .where(and(eq(storyboards.jobId, jobId), eq(storyboards.version, version)))
    .limit(1);
  return row;
}

export async function loadLatestCrawl(db: Db, jobId: string): Promise<CrawlRow | undefined> {
  const [row] = await db.select().from(crawls).where(eq(crawls.jobId, jobId)).orderBy(desc(crawls.createdAt)).limit(1);
  return row;
}

/** Same validators the planner uses, against the job's latest crawl. */
export function validateAgainstCrawl(json: unknown, crawl: CrawlRow | undefined): ValidationReport {
  const facts: FactLedger = crawl?.facts ?? [];
  const pageUrls = crawl?.pages?.map((p) => p.url).filter(Boolean);
  return validateStoryboard(json, facts, pageUrls && pageUrls.length > 0 ? { pageUrls } : {});
}

export interface ValidationView {
  ok: boolean;
  errors: { code: string; message: string; sceneId?: string }[];
  /** Additive to the contract: soft issues that don't block approve. */
  warnings: { code: string; message: string; sceneId?: string }[];
}

export function toValidationView(report: ValidationReport): ValidationView {
  const pick = (severity: "error" | "warning") =>
    report.issues
      .filter((i) => i.severity === severity)
      .map((i) => ({ code: i.code, message: i.message, ...(i.sceneId ? { sceneId: i.sceneId } : {}) }));
  return { ok: report.valid, errors: pick("error"), warnings: pick("warning") };
}

/** Contract exposes llm|fallback|user; "llm-escalated" is an llm storyboard. */
export function publicSource(source: StoryboardRow["source"]): "llm" | "fallback" | "user" {
  return source === "llm-escalated" ? "llm" : source;
}
