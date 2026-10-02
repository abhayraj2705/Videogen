import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  createGeminiProvider,
  createAnthropicProvider,
  LlmCallError,
  computeCostUsd,
  priceFor,
  toGeminiSchema,
  zodToJsonSchemaObject,
  parsePriceTable,
  costOfError,
} from "./index.js";

const Schema = z.object({ name: z.string(), score: z.number(), note: z.string().nullable(), tags: z.array(z.enum(["a", "b"])) });
const good = { name: "x", score: 1, note: null, tags: ["a"] };
const noSleep = async () => undefined;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
const geminiOk = (data: unknown, inTok = 100, outTok = 50) =>
  json({ candidates: [{ content: { parts: [{ text: typeof data === "string" ? data : JSON.stringify(data) }] } }], usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok } });
const anthropicOk = (input: unknown, inTok = 1000, outTok = 200) =>
  json({ content: [{ type: "tool_use", name: "emit_output", input }], stop_reason: "tool_use", usage: { input_tokens: inTok, output_tokens: outTok } });

describe("pricing", () => {
  it("uses the longest matching prefix and never returns zero for unknown models", () => {
    expect(priceFor("gemini-2.0-flash-lite-001").inputPerMTok).toBe(0.075);
    expect(priceFor("gemini-2.0-flash-001").inputPerMTok).toBe(0.1);
    expect(priceFor("mystery-model").inputPerMTok).toBeGreaterThan(0);
    expect(computeCostUsd("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBe(18);
  });
  it("accepts a custom price table", () => {
    const table = parsePriceTable('{"my-model":{"inputPerMTok":1,"outputPerMTok":2}}');
    expect(computeCostUsd("my-model-v2", 1_000_000, 500_000, table)).toBe(2);
    expect(parsePriceTable("not json")).toBeUndefined();
  });
});

describe("schema conversion", () => {
  it("converts zod to Gemini responseSchema with nullable + enums and no unsupported keys", () => {
    const g = toGeminiSchema(zodToJsonSchemaObject(Schema));
    expect(g.type).toBe("OBJECT");
    const props = g.properties as Record<string, Record<string, unknown>>;
    expect(props.note).toMatchObject({ type: "STRING", nullable: true });
    expect((props.tags!.items as Record<string, unknown>).enum).toEqual(["a", "b"]);
    expect(JSON.stringify(g)).not.toContain("additionalProperties");
    expect(JSON.stringify(g)).not.toContain("$schema");
    expect(g.required).toEqual(["name", "score", "note", "tags"]);
  });
});

describe("gemini provider", () => {
  it("sends responseSchema + JSON mime type and returns parsed data with cost", async () => {
    const fetchMock = vi.fn(async () => geminiOk(good));
    const p = createGeminiProvider({ apiKey: "k", model: "gemini-2.0-flash-lite", fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });
    const r = await p.generateJson({ system: "s", prompt: "p", schema: Schema });
    expect(r.data).toEqual(good);
    expect(r.attempts).toBe(1);
    expect(r.costUsd).toBeCloseTo((100 / 1e6) * 0.075 + (50 / 1e6) * 0.3, 12);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.type).toBe("OBJECT");
  });

  it("retries 429 and 5xx with backoff, honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "rate" }, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(json({ error: "boom" }, 503))
      .mockResolvedValueOnce(geminiOk(good));
    const p = createGeminiProvider({ apiKey: "k", fetch: fetchMock, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 });
    const r = await p.generateJson({ system: "s", prompt: "p", schema: Schema });
    expect(r.data).toEqual(good);
    expect(r.attempts).toBe(3);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
    expect(sleeps).toHaveLength(2);
  });

  it("retries network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(geminiOk(good));
    const p = createGeminiProvider({ apiKey: "k", fetch: fetchMock, sleep: noSleep });
    expect((await p.generateJson({ system: "s", prompt: "p", schema: Schema })).attempts).toBe(2);
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi.fn(async () => json({ error: "bad" }, 400));
    const p = createGeminiProvider({ apiKey: "k", fetch: fetchMock, sleep: noSleep });
    await expect(p.generateJson({ system: "s", prompt: "p", schema: Schema })).rejects.toBeInstanceOf(LlmCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-prompts on invalid output and accumulates cost across all attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(geminiOk({ name: 1 }, 100, 50)).mockResolvedValueOnce(geminiOk(good, 200, 60));
    const p = createGeminiProvider({ apiKey: "k", model: "gemini-2.0-flash-lite", fetch: fetchMock, sleep: noSleep });
    const r = await p.generateJson({ system: "s", prompt: "p", schema: Schema });
    expect(r.inputTokens).toBe(300);
    expect(r.outputTokens).toBe(110);
    expect(r.costUsd).toBeCloseTo(computeCostUsd("gemini-2.0-flash-lite", 300, 110), 12);
    const secondPrompt = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).contents[0].parts[0].text;
    expect(secondPrompt).toContain("previous response was invalid");
  });

  it("throws LlmCallError carrying the cost of failed attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(geminiOk("not json {", 100, 50)).mockResolvedValueOnce(geminiOk({ wrong: true }, 100, 50));
    const p = createGeminiProvider({ apiKey: "k", model: "gemini-2.0-flash-lite", fetch: fetchMock, sleep: noSleep });
    const err = await p.generateJson({ system: "s", prompt: "p", schema: Schema }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmCallError);
    const e = err as LlmCallError;
    expect(e.attempts).toBe(2);
    expect(e.inputTokens).toBe(200);
    expect(e.costUsd).toBeGreaterThan(0);
    expect(costOfError(e)).toBe(e.costUsd);
  });

  it("gives up after maxRetries on persistent 5xx and reports attempts", async () => {
    const fetchMock = vi.fn(async () => json({}, 500));
    const p = createGeminiProvider({ apiKey: "k", fetch: fetchMock, sleep: noSleep, maxRetries: 2 });
    const err = (await p.generateJson({ system: "s", prompt: "p", schema: Schema }).catch((e: unknown) => e)) as LlmCallError;
    expect(err).toBeInstanceOf(LlmCallError);
    expect(err.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("anthropic provider", () => {
  it("forces a tool with input_schema and reads tool_use input", async () => {
    const fetchMock = vi.fn(async () => anthropicOk(good));
    const p = createAnthropicProvider({ apiKey: "k", model: "claude-sonnet-5-5", fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });
    const r = await p.generateJson({ system: "s", prompt: "p", schema: Schema });
    expect(r.data).toEqual(good);
    expect(r.costUsd).toBeCloseTo((1000 / 1e6) * 3 + (200 / 1e6) * 15, 12);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_output" });
    expect(body.tools[0].input_schema.type).toBe("object");
    expect(body.tools[0].input_schema.properties.score).toBeDefined();
  });

  it("wraps non-object schemas and unwraps the result", async () => {
    const fetchMock = vi.fn(async () => anthropicOk({ result: ["a", "b"] }));
    const p = createAnthropicProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });
    const r = await p.generateJson({ system: "s", prompt: "p", schema: z.array(z.string()) });
    expect(r.data).toEqual(["a", "b"]);
  });

  it("retries 529 overloaded then succeeds, counting cost only for billed responses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ type: "error" }, 529)).mockResolvedValueOnce(anthropicOk(good, 10, 10));
    const p = createAnthropicProvider({ apiKey: "k", fetch: fetchMock, sleep: noSleep });
    const r = await p.generateJson({ system: "s", prompt: "p", schema: Schema });
    expect(r.attempts).toBe(2);
    expect(r.inputTokens).toBe(10);
  });

  it("re-prompts when the tool input fails the schema, and throws with cost if it never validates", async () => {
    const fetchMock = vi.fn(async () => anthropicOk({ name: "x" }, 100, 100));
    const p = createAnthropicProvider({ apiKey: "k", fetch: fetchMock, sleep: noSleep });
    const err = (await p.generateJson({ system: "s", prompt: "p", schema: Schema }).catch((e: unknown) => e)) as LlmCallError;
    expect(err).toBeInstanceOf(LlmCallError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.inputTokens).toBe(200);
    expect(err.costUsd).toBeGreaterThan(0);
  });
});
