import type { LlmCallResult, LlmProvider, GenerateJsonOptions } from "./provider.js";
import { LlmValidationError } from "./provider.js";
import { runStructuredCall, throwForStatus, zodToJsonSchemaObject, type ProviderBaseOptions } from "./core.js";

export interface AnthropicProviderOptions extends ProviderBaseOptions {
  baseUrl?: string;
}

interface AnthropicResponse {
  content?: { type: string; text?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

function toolNameFor(name: string | undefined): string {
  const cleaned = (name ?? "emit_output").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "emit_output";
}

/**
 * Escalation provider (§4.6 "Plan": "escalation to Sonnet after 2 failures").
 * Structured output via tool use: one tool whose input_schema is the zod
 * schema's JSON Schema, forced with tool_choice, so the model's answer arrives
 * as an already-parsed `input` object instead of free text.
 */
export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const model = opts.model ?? "claude-sonnet-5-5";
  const fetchImpl = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
  const id = `anthropic:${model}`;

  return {
    id,
    async generateJson<T>(callOpts: GenerateJsonOptions<T>): Promise<LlmCallResult<T>> {
      const toolName = toolNameFor(callOpts.schemaName);
      const jsonSchema = zodToJsonSchemaObject(callOpts.schema);
      // input_schema must be an object; wrap anything else and unwrap on the way back.
      const wrapped = jsonSchema.type !== "object";
      const inputSchema = wrapped ? { type: "object", properties: { result: jsonSchema }, required: ["result"] } : jsonSchema;

      return runStructuredCall({
        providerId: id,
        model,
        opts: callOpts,
        config: opts,
        defaultTimeoutMs: 60_000,
        send: async (system, prompt, signal) => {
          const res = await fetchImpl(`${baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": opts.apiKey,
              "anthropic-version": "2023-06-01",
            },
            signal,
            body: JSON.stringify({
              model,
              max_tokens: callOpts.maxOutputTokens ?? 4096,
              system,
              messages: [{ role: "user", content: prompt }],
              tools: [{ name: toolName, description: "Return the result. Call this exactly once with the complete output.", input_schema: inputSchema }],
              tool_choice: { type: "tool", name: toolName },
            }),
          });
          await throwForStatus(res, "Anthropic");
          const json = (await res.json()) as AnthropicResponse;
          const inputTokens = (json.usage?.input_tokens ?? 0) + (json.usage?.cache_creation_input_tokens ?? 0) + (json.usage?.cache_read_input_tokens ?? 0);
          const outputTokens = json.usage?.output_tokens ?? 0;
          const toolUse = json.content?.find((c) => c.type === "tool_use" && c.name === toolName);
          if (!toolUse || toolUse.input === undefined) {
            return {
              output: new LlmValidationError(`Anthropic response had no ${toolName} tool_use block (stop_reason=${json.stop_reason ?? "?"})`, ""),
              inputTokens,
              outputTokens,
            };
          }
          const input = wrapped ? (toolUse.input as { result?: unknown }).result : toolUse.input;
          return { output: input, inputTokens, outputTokens };
        },
      });
    },
  };
}
