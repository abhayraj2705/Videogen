import type { LlmCallResult, LlmProvider, GenerateJsonOptions } from "./provider.js";
import { LlmValidationError } from "./provider.js";

// Placeholder rate card (Sonnet-class pricing) — replace with the live rate
// card before launch; the point is cost_usd is never silently zero (§8.3).
const USD_PER_1M_INPUT_TOKENS = 3.0;
const USD_PER_1M_OUTPUT_TOKENS = 15.0;

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Escalation provider (§4.6 "Plan": "escalation to Sonnet after 2 failures").
 * Used only when the default provider's retries are exhausted — most jobs
 * never call this, so its cost only shows up in stage_runs for the jobs that
 * actually needed it.
 */
export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const model = opts.model ?? "claude-sonnet-5-5";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function callOnce(system: string, prompt: string, maxOutputTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: maxOutputTokens ?? 2000,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = json.content?.find((c) => c.type === "text")?.text;
      if (!text) throw new Error("Anthropic response had no text content");
      return { text, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    id: `anthropic:${model}`,
    async generateJson<T>(callOpts: GenerateJsonOptions<T>): Promise<LlmCallResult<T>> {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const prompt =
          attempt === 0
            ? callOpts.prompt
            : `${callOpts.prompt}\n\nYour previous response was invalid: ${String(lastError)}\n${callOpts.retryHint ?? "Fix the JSON to match the schema exactly."}`;
        const system = `${callOpts.system}\n\nRespond with JSON only — no prose, no markdown code fences.`;

        const { text, inputTokens, outputTokens } = await callOnce(system, prompt, callOpts.maxOutputTokens);
        const costUsd = (inputTokens / 1_000_000) * USD_PER_1M_INPUT_TOKENS + (outputTokens / 1_000_000) * USD_PER_1M_OUTPUT_TOKENS;

        let parsedJson: unknown;
        try {
          // Anthropic doesn't have a JSON-mode flag — strip a markdown fence if the model added one anyway.
          const cleaned = text.trim().replace(/^```(?:json)?\n?/, "").replace(/```$/, "");
          parsedJson = JSON.parse(cleaned);
        } catch (err) {
          lastError = err;
          continue;
        }
        const result = callOpts.schema.safeParse(parsedJson);
        if (result.success) {
          return { data: result.data, costUsd, inputTokens, outputTokens };
        }
        lastError = new LlmValidationError(result.error.message, text);
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}
