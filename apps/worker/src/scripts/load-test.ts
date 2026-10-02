import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTestPassed, summarizeLoadTest, type LoadJobResult } from "../lib/load-stats.js";

/**
 * Phase 7 load test: N jobs in flight at once against a running stack
 * (API + workers), through the same public API the web app uses.
 *
 *   pnpm loadtest --api https://api.staging.example --tokens tokens.txt
 *                 [--jobs 50] [--urls benchmark/urls.json] [--formats 16:9]
 *                 [--timeout-min 15] [--out benchmark/out/load-report.json]
 *
 * `--tokens` is a file of Supabase access tokens (JWTs), one per line — one
 * per test user. Jobs are spread across them round-robin, because the API caps
 * active jobs per user (MAX_ACTIVE_JOBS_PER_USER) and throttles per target
 * domain: use enough users, or raise those limits on the staging backend for
 * the run (see docs/deployment.md "Load test"). `--token <jwt>` works for a
 * single user. Each user needs enough credits for their share of the jobs.
 *
 * Exits non-zero unless >= 95% of the jobs that entered the pipeline finish
 * `done` and the median total time is under 5 minutes (the Phase 4/7 bar).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const TERMINAL = new Set(["done", "failed", "needs_input", "cancelled"]);
const POLL_MS = 5_000;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runOne(api: string, token: string, url: string, formats: string[], deadline: number): Promise<LoadJobResult> {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const started = Date.now();
  let jobId: string | undefined;
  try {
    const res = await fetch(`${api}/api/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, options: { formats, lengthSec: 20, tone: "clean", reviewBeforeRender: false } }),
    });
    if (res.status !== 201) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { url, outcome: "rejected", rejectStatus: res.status, errorCode: body.error ?? null };
    }
    jobId = ((await res.json()) as { id: string }).id;

    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const poll = await fetch(`${api}/api/jobs/${jobId}`, { headers });
      if (poll.status === 429) continue; // our own polling tripped the per-user limiter; back off one tick
      if (!poll.ok) continue;
      const job = (await poll.json()) as { status: string; errorCode: string | null };
      if (TERMINAL.has(job.status)) {
        return { url, jobId, outcome: job.status as LoadJobResult["outcome"], errorCode: job.errorCode, totalMs: Date.now() - started };
      }
    }
    return { url, jobId, outcome: "timeout", totalMs: Date.now() - started };
  } catch (err) {
    return { url, jobId, outcome: "error", errorCode: (err as Error).message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const api = (flag(args, "api") ?? "").replace(/\/+$/, "");
  const tokensFile = flag(args, "tokens");
  const tokens = tokensFile
    ? fs.readFileSync(path.resolve(cwd, tokensFile), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : flag(args, "token")
      ? [flag(args, "token")!]
      : [];
  if (!api || tokens.length === 0) {
    console.error("usage: pnpm loadtest --api <base url> (--tokens <file> | --token <jwt>) [--jobs 50] [--urls benchmark/urls.json] [--formats 16:9] [--timeout-min 15] [--out report.json]");
    process.exit(2);
  }
  const jobs = Number(flag(args, "jobs") ?? 50);
  const formats = (flag(args, "formats") ?? "16:9").split(",");
  const timeoutMin = Number(flag(args, "timeout-min") ?? 15);
  const urlsPath = [path.resolve(cwd, flag(args, "urls") ?? "benchmark/urls.json"), path.resolve(REPO_ROOT, flag(args, "urls") ?? "benchmark/urls.json")].find((p) => fs.existsSync(p));
  if (!urlsPath) throw new Error("urls file not found");
  const urls = (JSON.parse(fs.readFileSync(urlsPath, "utf8")) as { url: string }[]).map((u) => u.url);

  console.log(`Load test: ${jobs} concurrent jobs, ${tokens.length} user(s), ${urls.length} distinct URLs, formats ${formats.join(",")} -> ${api}`);
  const deadline = Date.now() + timeoutMin * 60_000;
  const started = Date.now();
  let finished = 0;
  const results = await Promise.all(
    Array.from({ length: jobs }, async (_, i) => {
      const r = await runOne(api, tokens[i % tokens.length]!, urls[i % urls.length]!, formats, deadline);
      finished++;
      console.log(`  [${finished}/${jobs}] ${r.outcome.padEnd(11)} ${r.totalMs ? `${(r.totalMs / 1000).toFixed(0)}s`.padStart(5) : "    -"}  ${r.url}${r.errorCode ? `  (${r.errorCode})` : ""}`);
      return r;
    }),
  );

  const report = summarizeLoadTest(results);
  const passed = loadTestPassed(report);
  const fmt = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(0)}s`);
  console.log(`\nAccepted ${report.accepted}/${report.total}  outcomes ${JSON.stringify(report.byOutcome)}`);
  console.log(`Success rate ${report.successRate === null ? "n/a" : `${(report.successRate * 100).toFixed(1)}%`}  p50 ${fmt(report.p50Ms)}  p95 ${fmt(report.p95Ms)}  max ${fmt(report.maxMs)}  wall ${fmt(Date.now() - started)}`);
  if (Object.keys(report.rejectedByStatus).length > 0) console.log(`Rejected at create (never entered the pipeline): ${JSON.stringify(report.rejectedByStatus)}`);
  if (Object.keys(report.failuresByCode).length > 0) console.log(`Failures by error code: ${JSON.stringify(report.failuresByCode)}`);
  console.log(passed ? "PASS" : "FAIL (needs >= 95% success and p50 <= 5 min)");

  const out = flag(args, "out");
  if (out) {
    const outPath = path.resolve(cwd, out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), api, jobs, users: tokens.length, formats, passed, report, results }, null, 2));
    console.log(`Report written to ${outPath}`);
  }
  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
