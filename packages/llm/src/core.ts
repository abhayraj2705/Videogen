import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LlmCallError, LlmHttpError, LlmValidationError, type GenerateJsonOptions, type LlmCallResult, type LlmUsage } from "./provider.js";

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ModelPrice {
  /** USD per 1M input tokens */
  inputPerMTok: number;
  /** USD per 1M output tokens */
  outputPerMTok: number;
}

/** Keyed by model-id prefix; the longest matching prefix wins. */
export type PriceTable = Record<string, ModelPrice>;

/**
 * Default rate card. These are list-price placeholders — pass `prices` to a
 * provider factory to override with the live rate card. The point (§8.3) is
 * that cost_usd is never silently zero: an unknown model falls back to the
 * conservative "*" entry instead of $0.
 */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  "gemini-2.0-flash-lite": { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  "gemini-2.0-flash": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  "gemini-2.5-flash-lite": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
  gemini: { inputPerMTok: 0.5, outputPerMTok: 3 },
  "claude-haiku": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus": { inputPerMTok: 5, outputPerMTok: 25 },
  claude: { inputPerMTok: 3, outputPerMTok: 15 },
  "*": { inputPerMTok: 3, outputPerMTok: 15 },
};

export function priceFor(model: string, table: PriceTable = DEFAULT_PRICE_TABLE): ModelPrice {
  let best: string | undefined;
  for (const key of Object.keys(table)) {
    if (key !== "*" && model.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return table[best ?? "*"] ?? DEFAULT_PRICE_TABLE["*"]!;
}

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number, table?: PriceTable): number {
  const p = priceFor(model, table);
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok;
}

/** Parses a JSON price table (e.g. from an env var). Invalid input returns undefined. */
export function parsePriceTable(json: string | undefined): PriceTable | undefined {
  if (!json) return undefined;
  try {
    const raw = JSON.parse(json) as Record<string, { inputPerMTok?: unknown; outputPerMTok?: unknown }>;
    const out: PriceTable = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v?.inputPerMTok === "number" && typeof v?.outputPerMTok === "number") {
        out[k] = { inputPerMTok: v.inputPerMTok, outputPerMTok: v.outputPerMTok };
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// JSON schema from zod
// ---------------------------------------------------------------------------

export type JsonSchema = Record<string, unknown>;

/** Plain JSON Schema (draft-07, no $refs) for a zod schema. */
export function zodToJsonSchemaObject(schema: z.ZodTypeAny): JsonSchema {
  const js = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" }) as JsonSchema;
  delete js.$schema;
  delete js.definitions;
  return js;
}

const GEMINI_ALLOWED_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "properties",
  "required",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "propertyOrdering",
  "anyOf",
]);

/**
 * Converts JSON Schema into Gemini's OpenAPI-subset `responseSchema` form:
 * `["x","null"]` / `anyOf [x, null]` become `nullable`, `const` becomes a
 * one-value enum, unsupported keywords (additionalProperties, default,
 * minLength, ...) are dropped, and properties keep their declared order.
 */
export function toGeminiSchema(node: unknown): JsonSchema {
  if (!node || typeof node !== "object") return {};
  const src = { ...(node as JsonSchema) };

  if (Array.isArray(src.type)) {
    const types = (src.type as string[]).filter((t) => t !== "null");
    if (types.length < (src.type as string[]).length) src.nullable = true;
    src.type = types[0];
  }
  if (Array.isArray(src.anyOf)) {
    const variants = (src.anyOf as JsonSchema[]).filter((v) => v.type !== "null");
    const hadNull = variants.length < (src.anyOf as JsonSchema[]).length;
    if (variants.length === 1) {
      const merged = toGeminiSchema({ ...variants[0], description: src.description ?? variants[0]!.description });
      if (hadNull) merged.nullable = true;
      return merged;
    }
    src.anyOf = variants;
    if (hadNull) src.nullable = true;
  }
  if ("const" in src) {
    src.enum = [src.const];
    delete src.const;
  }

  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(src)) {
    if (!GEMINI_ALLOWED_KEYS.has(k) || v === undefined) continue;
    if (k === "properties" && v && typeof v === "object") {
      const props: JsonSchema = {};
      for (const [pk, pv] of Object.entries(v as JsonSchema)) props[pk] = toGeminiSchema(pv);
      out.properties = props;
      out.propertyOrdering = Object.keys(props);
    } else if (k === "items") {
      out.items = toGeminiSchema(v);
    } else if (k === "anyOf") {
      out.anyOf = (v as unknown[]).map(toGeminiSchema);
    } else if (k !== "propertyOrdering") {
      out[k] = v;
    }
  }
  if (typeof out.type === "string") out.type = (out.type as string).toUpperCase();
  return out;
}

// ---------------------------------------------------------------------------
// Retry + structured-call loop
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Transport-level retries per request on 408/429/5xx/network/timeout. Default 3. */
  maxRetries?: number;
  /** First backoff delay; doubles each retry, with ±25% jitter. Default 800ms. */
  baseBackoffMs?: number;
  /** Cap on any single backoff (including a server-sent Retry-After). Default 20s. */
  maxBackoffMs?: number;
  /** Re-prompts after unparseable / schema-invalid output. Default 1 (2 total). */
  maxInvalidOutputRetries?: number;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam: random source for jitter. */
  random?: () => number;
}

export interface ProviderBaseOptions extends RetryConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  prices?: PriceTable;
  /** Test seam: replaces global fetch. */
  fetch?: typeof fetch;
}

export interface RawModelResponse {
  /** Tool-use input object, or the model's JSON text. */
  output: unknown;
  inputTokens: number;
  outputTokens: number;
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof LlmHttpError) return err.retryable;
  if (err instanceof LlmValidationError) return false;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    // undici surfaces network failures as TypeError("fetch failed") with a cause.
    if (err.name === "TypeError" && /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(`${err.message} ${String((err as { cause?: unknown }).cause ?? "")}`)) {
      return true;
    }
    if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(err.message)) return true;
  }
  return false;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * Shared generateJson loop for every adapter:
 *  - each request is retried on 408/429/5xx/network/timeout with exponential
 *    backoff (honouring Retry-After), up to `maxRetries`;
 *  - unparseable / schema-invalid output is re-prompted with the error text;
 *  - token usage and cost are accumulated across EVERY attempt, and attached
 *    to the thrown LlmCallError when the call ultimately fails.
 */
export async function runStructuredCall<T>(args: {
  providerId: string;
  model: string;
  opts: GenerateJsonOptions<T>;
  config: ProviderBaseOptions;
  send: (system: string, prompt: string, signal: AbortSignal) => Promise<RawModelResponse>;
  defaultTimeoutMs: number;
}): Promise<LlmCallResult<T>> {
  const { providerId, model, opts, config, send } = args;
  const maxRetries = config.maxRetries ?? 3;
  const baseBackoff = config.baseBackoffMs ?? 800;
  const maxBackoff = config.maxBackoffMs ?? 20_000;
  const maxInvalid = config.maxInvalidOutputRetries ?? 1;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = config.random ?? Math.random;
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs ?? args.defaultTimeoutMs;

  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, attempts: 0 };
  const started = Date.now();
  let lastInvalid: unknown;

  for (let v = 0; v <= maxInvalid; v++) {
    const prompt =
      v === 0
        ? opts.prompt
        : `${opts.prompt}\n\nYour previous response was invalid: ${lastInvalid instanceof Error ? lastInvalid.message : String(lastInvalid)}\n${opts.retryHint ?? "Fix the output to match the schema exactly."}`;

    let response: RawModelResponse | undefined;
    for (let t = 0; ; t++) {
      usage.attempts++;
      try {
        response = await send(opts.system, prompt, AbortSignal.timeout(timeoutMs));
        break;
      } catch (err) {
        if (t < maxRetries && isRetryableError(err)) {
          const exp = Math.min(maxBackoff, baseBackoff * 2 ** t);
          const jittered = exp * (0.75 + random() * 0.5);
          const retryAfter = err instanceof LlmHttpError ? err.retryAfterMs : undefined;
          await sleep(Math.min(maxBackoff, Math.max(jittered, retryAfter ?? 0)));
          continue;
        }
        throw new LlmCallError(`${providerId} request failed: ${(err as Error)?.message ?? String(err)}`, providerId, { ...usage }, err);
      }
    }

    usage.inputTokens += response.inputTokens;
    usage.outputTokens += response.outputTokens;
    usage.costUsd += computeCostUsd(model, response.inputTokens, response.outputTokens, config.prices);

    let candidate: unknown = response.output;
    if (candidate instanceof Error) {
      lastInvalid = candidate;
      continue;
    }
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(stripFences(candidate));
      } catch (err) {
        lastInvalid = new LlmValidationError(`Response was not valid JSON: ${(err as Error).message}`, String(response.output));
        continue;
      }
    }
    const result = opts.schema.safeParse(candidate);
    if (result.success) {
      return { data: result.data, ...usage, provider: providerId, latencyMs: Date.now() - started };
    }
    lastInvalid = new LlmValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
      JSON.stringify(candidate).slice(0, 4000),
    );
  }

  throw new LlmCallError(
    `${providerId} returned invalid output after ${maxInvalid + 1} attempt(s): ${(lastInvalid as Error)?.message ?? ""}`,
    providerId,
    { ...usage },
    lastInvalid,
  );
}

export async function throwForStatus(res: Response, provider: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new LlmHttpError(res.status, `${provider} API error ${res.status}: ${body.slice(0, 500)}`, parseRetryAfterMs(res.headers.get("retry-after")));
}
