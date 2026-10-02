import type { LlmCallResult, LlmProvider, GenerateJsonOptions } from "./provider.js";
import { LlmValidationError } from "./provider.js";
import { runStructuredCall, throwForStatus, zodToJsonSchemaObject, type ProviderBaseOptions } from "./core.js";

export interface OpenAiCompatProviderOptions extends Omit<ProviderBaseOptions, "apiKey"> {
  /** e.g. http://localhost:6969/v1 (WebAI-to-API) — `/chat/completions` is appended. */
  baseUrl: string;
  /** Many local gateways ignore the key; it is still sent as a bearer token. */
  apiKey?: string;
  /**
   * Send `response_format: { type: "json_schema" }`. Off by default because
   * Gemini-web gateways (WebAI-to-API) reject it with HTTP 400; the schema is
   * then put in the system prompt and enforced by the zod re-prompt loop.
   */
  nativeJsonSchema?: boolean;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Pulls the JSON object out of a chat reply that may wrap it in prose or a
 * ```json fence. Falls back to the raw text so the caller's JSON.parse error
 * (and the re-prompt) still fires on genuinely bad output.
 */
export function extractJsonText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]?.trim().startsWith("{")) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/**
 * Adapter for any OpenAI-compatible /chat/completions endpoint — used for
 * local development against WebAI-to-API (Gemini via a browser login) so the
 * planner can run without a paid API key. Cost is $0 unless `prices` says otherwise.
 */
export function createOpenAiCompatProvider(opts: OpenAiCompatProviderOptions): LlmProvider {
  const model = opts.model ?? "gemini-3-flash";
  const fetchImpl = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const id = `openai-compat:${model}`;
  const config: ProviderBaseOptions = {
    ...opts,
    apiKey: opts.apiKey ?? "not-needed",
    prices: opts.prices ?? { "*": { inputPerMTok: 0, outputPerMTok: 0 } },
  };

  return {
    id,
    async generateJson<T>(callOpts: GenerateJsonOptions<T>): Promise<LlmCallResult<T>> {
      const jsonSchema = zodToJsonSchemaObject(callOpts.schema);
      const system = opts.nativeJsonSchema
        ? callOpts.system
        : `${callOpts.system}\n\nRespond with ONLY a single JSON object (no prose, no markdown) that validates against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;

      return runStructuredCall({
        providerId: id,
        model,
        opts: { ...callOpts, system },
        config,
        // Browser-session gateways are slower than first-party APIs.
        defaultTimeoutMs: 90_000,
        send: async (sys, prompt, signal) => {
          const res = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
            signal,
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: sys },
                { role: "user", content: prompt },
              ],
              ...(opts.nativeJsonSchema
                ? { response_format: { type: "json_schema", json_schema: { name: callOpts.schemaName ?? "output", schema: jsonSchema } } }
                : {}),
              ...(callOpts.maxOutputTokens ? { max_tokens: callOpts.maxOutputTokens } : {}),
            }),
          });
          await throwForStatus(res, "OpenAI-compatible");
          const json = (await res.json()) as ChatCompletionResponse;
          const inputTokens = json.usage?.prompt_tokens ?? 0;
          const outputTokens = json.usage?.completion_tokens ?? 0;
          const text = json.choices?.[0]?.message?.content ?? "";
          if (!text) {
            const reason = json.choices?.[0]?.finish_reason ?? "no text";
            return { output: new LlmValidationError(`OpenAI-compatible endpoint returned no text (${reason})`, ""), inputTokens, outputTokens };
          }
          return { output: extractJsonText(text), inputTokens, outputTokens };
        },
      });
    },
  };
}
