import type { z } from "zod";

export interface LlmCallResult<T> {
  data: T;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateJsonOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  /** On a validation failure, retried once with this appended to the prompt plus the validator's error text. */
  retryHint?: string;
}

/**
 * Every LLM call in the pipeline goes through this interface (§2.1, §4.3) so
 * providers are swappable via env var and every call's cost is logged the same
 * way into stage_runs.cost_usd regardless of which model answered it.
 */
export interface LlmProvider {
  id: string;
  generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmCallResult<T>>;
}

export class LlmValidationError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = "LlmValidationError";
  }
}
