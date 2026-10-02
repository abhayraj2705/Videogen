import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createOpenAiCompatProvider, extractJsonText, LlmCallError } from "./index.js";

const Schema = z.object({ name: z.string(), score: z.number() });
const noSleep = async () => undefined;

const chatOk = (content: string, inTok = 10, outTok = 5) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: inTok, completion_tokens: outTok } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("extractJsonText", () => {
  it("unwraps fenced and prose-wrapped JSON", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('Sure! Here it is: {"a":{"b":2}} Hope that helps.')).toBe('{"a":{"b":2}}');
    expect(extractJsonText("no json here")).toBe("no json here");
  });
});

describe("OpenAI-compatible provider (WebAI-to-API)", () => {
  it("puts the schema in the system prompt and omits response_format/temperature", async () => {
    const fetchMock = vi.fn(async () => chatOk('Here you go:\n```json\n{"name":"x","score":1}\n```'));
    const p = createOpenAiCompatProvider({ baseUrl: "http://localhost:6969/v1/", fetch: fetchMock as typeof fetch, sleep: noSleep });
    const r = await p.generateJson({ system: "SYS", prompt: "go", schema: Schema });

    expect(r.data).toEqual({ name: "x", score: 1 });
    expect(r.costUsd).toBe(0);
    expect(p.id).toBe("openai-compat:gemini-3-flash");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:6969/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("temperature");
    expect(body.messages[0].content).toContain("SYS");
    expect(body.messages[0].content).toContain('"score"');
  });

  it("re-prompts on schema-invalid output, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(chatOk('{"name":"x"}')).mockResolvedValueOnce(chatOk('{"name":"x","score":2}'));
    const p = createOpenAiCompatProvider({ baseUrl: "http://localhost:6969/v1", fetch: fetchMock as typeof fetch, sleep: noSleep });
    const r = await p.generateJson({ system: "s", prompt: "p", schema: Schema });
    expect(r.data.score).toBe(2);
    expect(r.attempts).toBe(2);
    const retryBody = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(retryBody.messages[1].content).toContain("previous response was invalid");
  });

  it("retries a 503 (gateway needs re-login) and surfaces the failure", async () => {
    const fetchMock = vi.fn(async () => new Response("login required", { status: 503 }));
    const p = createOpenAiCompatProvider({ baseUrl: "http://localhost:6969/v1", fetch: fetchMock as typeof fetch, sleep: noSleep, maxRetries: 1 });
    await expect(p.generateJson({ system: "s", prompt: "p", schema: Schema })).rejects.toBeInstanceOf(LlmCallError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
