import type { Db } from "@sitereel/db";
import type { StorageClient } from "@sitereel/storage";
import type { LlmProvider } from "@sitereel/llm";
import type { Queue } from "bullmq";
import type { Logger } from "pino";
import type { JobEvent } from "@sitereel/shared";

export interface WorkerDeps {
  db: Db;
  storage: StorageClient;
  logger: Logger;
  publish: (event: JobEvent) => Promise<void>;
  queues: {
    plan: Queue;
  };
  llm: {
    primary: LlmProvider | null;
    escalation: LlmProvider | null;
  };
}
