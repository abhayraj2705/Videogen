import type { z } from "zod";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** HTTP requests actually sent, including failed ones (429/5xx/network/invalid output). */
  attempts: number;
}

export interface LlmCallResult<T> extends LlmUsage {
  data: T;
  provider: string;
  latencyMs: number;
}

/** An image attached to a prompt (vision-capable providers only — see LlmProvider.supportsImages). */
export interface LlmImage {
  /** e.g. "image/jpeg" */
  mimeType: string;
  base64: string;
}

export interface GenerateJsonOptions<T> {
  system: string;
  prompt: string;
  /** Images the model should look at alongside the prompt. Providers without vision ignore them. */
  images?: LlmImage[];
  schema: z.ZodType<T>;
  /** Name for the structured-output schema/tool (letters, digits, underscores). */
  schemaName?: string;
  maxOutputTokens?: number;
  /** On an invalid-output failure, the re-prompt appends this plus the parse/zod error text. */
  retryHint?: string;
  /** Overrides the provider's default per-request timeout. */
  timeoutMs?: number;
}

/**
 * Every LLM call in the pipeline goes through this interface (§2.1, §4.3) so
 * providers are swappable via env var and every call's cost is logged the same
 * way into stage_runs.cost_usd regardless of which model answered it.
 */
export interface LlmProvider {
  id: string;
  /** True when generateJson() actually sends `images` to the model. */
  supportsImages?: boolean;
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

/** HTTP-level failure from a provider. `retryable` marks 408/429/5xx. */
export class LlmHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmHttpError";
  }
  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/**
 * Thrown when a call ultimately fails. Carries the usage of every attempt
 * that was made — including the failed ones — so callers can still bill /
 * log what the failure cost (§8.3: cost_usd must never be silently zero).
 */
export class LlmCallError extends Error implements LlmUsage {
  public readonly inputTokens: number;
  public readonly outputTokens: number;
  public readonly costUsd: number;
  public readonly attempts: number;
  constructor(
    message: string,
    public readonly provider: string,
    usage: LlmUsage,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "LlmCallError";
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.outputTokens;
    this.costUsd = usage.costUsd;
    this.attempts = usage.attempts;
  }
}

/** Extracts accumulated cost from anything a provider threw (0 for foreign errors). */
export function costOfError(err: unknown): number {
  return err instanceof LlmCallError ? err.costUsd : 0;
}
