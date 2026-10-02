import type { LlmCallResult, LlmProvider, GenerateJsonOptions } from "./provider.js";
import { LlmValidationError } from "./provider.js";
import { runStructuredCall, throwForStatus, toGeminiSchema, zodToJsonSchemaObject, type ProviderBaseOptions } from "./core.js";

export interface GeminiProviderOptions extends ProviderBaseOptions {
  /**
   * Which generationConfig field carries the schema:
   *  - "responseSchema" (default): zod -> JSON Schema -> Gemini's OpenAPI subset.
   *  - "responseJsonSchema": the raw JSON Schema (newer API; supports additionalProperties).
   */
  schemaField?: "responseSchema" | "responseJsonSchema";
  baseUrl?: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export function createGeminiProvider(opts: GeminiProviderOptions): LlmProvider {
  const model = opts.model ?? "gemini-3.5-flash-lite";
  const fetchImpl = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const schemaField = opts.schemaField ?? "responseSchema";
  const id = `gemini:${model}`;

  return {
    id,
    supportsImages: true,
    async generateJson<T>(callOpts: GenerateJsonOptions<T>): Promise<LlmCallResult<T>> {
      const jsonSchema = zodToJsonSchemaObject(callOpts.schema);
      const schema = schemaField === "responseSchema" ? toGeminiSchema(jsonSchema) : jsonSchema;

      return runStructuredCall({
        providerId: id,
        model,
        opts: callOpts,
        config: opts,
        defaultTimeoutMs: 30_000,
        send: async (system, prompt, signal) => {
          const res = await fetchImpl(`${baseUrl}/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
            signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [...(callOpts.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })), { text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                [schemaField]: schema,
                ...(callOpts.maxOutputTokens ? { maxOutputTokens: callOpts.maxOutputTokens } : {}),
              },
            }),
          });
          await throwForStatus(res, "Gemini");
          const json = (await res.json()) as GeminiResponse;
          const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
          const outputTokens = (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0);
          const candidate = json.candidates?.[0];
          const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          if (!text) {
            // Billed but unusable — surfaced as invalid output so the loop re-prompts (and keeps the cost).
            const reason = json.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no text";
            return { output: new LlmValidationError(`Gemini returned no text (${reason})`, ""), inputTokens, outputTokens };
          }
          return { output: text, inputTokens, outputTokens };
        },
      });
    },
  };
}
