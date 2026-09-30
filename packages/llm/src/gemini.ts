import type { LlmCallResult, LlmProvider, GenerateJsonOptions } from "./provider.js";
import { LlmValidationError } from "./provider.js";

// Gemini Flash-Lite pricing is volatile and promo-priced per the plan's cost
// notes (§8.3) — these are a conservative placeholder so cost_usd is never
// silently zero; replace with the live rate card before launch.
const USD_PER_1M_INPUT_TOKENS = 0.075;
const USD_PER_1M_OUTPUT_TOKENS = 0.3;

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export function createGeminiProvider(opts: GeminiProviderOptions): LlmProvider {
  const model = opts.model ?? "gemini-2.0-flash-lite";
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function callOnce(system: string, prompt: string, maxOutputTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            ...(maxOutputTokens ? { maxOutputTokens } : {}),
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini response had no text part");
      return {
        text,
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    id: `gemini:${model}`,
    async generateJson<T>(callOpts: GenerateJsonOptions<T>): Promise<LlmCallResult<T>> {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const prompt =
          attempt === 0
            ? callOpts.prompt
            : `${callOpts.prompt}\n\nYour previous response was invalid: ${String(lastError)}\n${callOpts.retryHint ?? "Fix the JSON to match the schema exactly."}`;

        const { text, inputTokens, outputTokens } = await callOnce(callOpts.system, prompt, callOpts.maxOutputTokens);
        const costUsd = (inputTokens / 1_000_000) * USD_PER_1M_INPUT_TOKENS + (outputTokens / 1_000_000) * USD_PER_1M_OUTPUT_TOKENS;

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
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
