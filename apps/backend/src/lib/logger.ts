import { pino } from "pino";

/**
 * Every log line that touches a job must carry jobId (and userId where known) —
 * the admin job inspector (§3.6 W13) and incident runbooks (§7.7) both key off it.
 */
export function createLogger(level: string) {
  return pino({
    level,
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
  });
}

export type Logger = ReturnType<typeof createLogger>;

export function withJob(logger: Logger, jobId: string, userId?: string) {
  return logger.child({ jobId, ...(userId ? { userId } : {}) });
}
