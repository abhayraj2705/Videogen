import type { JobStatus } from "@sitereel/shared";

/** §3.6 W5 pipeline order (the rows the stage tracker shows). */
export const PIPELINE_STAGES: { status: JobStatus; label: string; stage: string }[] = [
  { status: "crawling", label: "Reading your site", stage: "crawl" },
  { status: "extracting", label: "Understanding it", stage: "extract" },
  { status: "planning", label: "Writing the script", stage: "plan" },
  { status: "review", label: "Your review", stage: "review" },
  { status: "voicing", label: "Recording voiceover", stage: "voice" },
  { status: "building", label: "Building scenes", stage: "build" },
  { status: "checking", label: "Quality checks", stage: "qa" },
  { status: "rendering", label: "Rendering", stage: "render" },
  { status: "encoding", label: "Finishing", stage: "encode" },
];

export const IN_PROGRESS: ReadonlySet<JobStatus> = new Set([
  "queued",
  "crawling",
  "extracting",
  "planning",
  "review",
  "voicing",
  "building",
  "checking",
  "rendering",
  "encoding",
]);

export const TERMINAL: ReadonlySet<JobStatus> = new Set(["done", "failed", "cancelled", "needs_input"]);

export type DashboardTab = "all" | "in_progress" | "done" | "needs_input" | "failed";

export const DASHBOARD_TABS: { value: DashboardTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "needs_input", label: "Needs input" },
  { value: "failed", label: "Failed" },
];

export function matchesTab(status: JobStatus, tab: DashboardTab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "in_progress":
      return IN_PROGRESS.has(status);
    case "done":
      return status === "done";
    case "needs_input":
      return status === "needs_input";
    case "failed":
      return status === "failed" || status === "cancelled";
  }
}

export function stageNumber(status: JobStatus): number {
  return PIPELINE_STAGES.findIndex((s) => s.status === status) + 1;
}

/** Status badge per W3: processing = primary, review = warning, done = success, failed/needs-input = destructive. */
export const STATUS_META: Record<JobStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  queued: { label: "Queued", variant: "secondary" },
  crawling: { label: "Reading site", variant: "default" },
  extracting: { label: "Understanding", variant: "default" },
  needs_input: { label: "Needs input", variant: "destructive" },
  planning: { label: "Writing script", variant: "default" },
  review: { label: "Needs review", variant: "warning" },
  voicing: { label: "Voicing", variant: "default" },
  building: { label: "Building", variant: "default" },
  checking: { label: "Checking", variant: "default" },
  rendering: { label: "Rendering", variant: "default" },
  encoding: { label: "Finishing", variant: "default" },
  done: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
