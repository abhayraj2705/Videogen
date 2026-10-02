import type { Db } from "@sitereel/db";
import type { StorageClient } from "@sitereel/storage";
import type { LlmProvider } from "@sitereel/llm";
import type { TtsProvider } from "@sitereel/tts";
import type { Queue } from "bullmq";
import type { Logger } from "pino";
import type { JobEvent, ServerEnv } from "@sitereel/shared";
import type { AudioSidecarClient } from "../lib/audio-sidecar.js";
import type { VirusScanner } from "../lib/virus-scan.js";

export interface WorkerDeps {
  db: Db;
  storage: StorageClient;
  logger: Logger;
  env: ServerEnv;
  repoRoot: string;
  publish: (event: JobEvent) => Promise<void>;
  queues: {
    /** Optional so Phase 2-5 call sites/tests keep compiling; index.ts always provides it (admin re-run from crawl). */
    crawl?: Queue;
    plan: Queue;
    voice: Queue;
    build: Queue;
    qa: Queue;
    render: Queue;
  };
  llm: {
    primary: LlmProvider | null;
    escalation: LlmProvider | null;
  };
  tts: TtsProvider | null;
  /**
   * Audio sidecar (beats/align/loudness/mix). Optional: when absent,
   * processors use AUDIO_SIDECAR_URL via getAudioSidecarFromEnv(), and when
   * that's unset or down they fall back to local ffmpeg / estimated timings.
   */
  sidecar?: AudioSidecarClient | null;
  /** Phase 7: clamd scanner for user uploads. Absent/null = uploads are used unscanned. */
  virusScanner?: VirusScanner | null;
  /** Phase 6: worker -> web email + Supabase admin. All optional; unset = feature skipped. */
  phase6?: {
    webUrl?: string | null;
    internalSecret?: string | null;
    fetch?: typeof fetch;
  };
}
