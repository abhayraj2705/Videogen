import type { Db } from "@sitereel/db";
import type { StorageClient } from "@sitereel/storage";
import type { LlmProvider } from "@sitereel/llm";
import type { TtsProvider } from "@sitereel/tts";
import type { Queue } from "bullmq";
import type { Logger } from "pino";
import type { JobEvent, ServerEnv } from "@sitereel/shared";

export interface WorkerDeps {
  db: Db;
  storage: StorageClient;
  logger: Logger;
  env: ServerEnv;
  repoRoot: string;
  publish: (event: JobEvent) => Promise<void>;
  queues: {
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
}
