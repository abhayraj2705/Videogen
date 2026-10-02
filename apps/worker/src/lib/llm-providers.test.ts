import { describe, it, expect } from "vitest";
import { selectLlmProviders } from "./llm-providers.js";

describe("selectLlmProviders", () => {
  it("returns nulls when nothing is configured", () => {
    expect(selectLlmProviders({})).toEqual({ primary: null, escalation: null });
  });

  it("auto order: proxy first, DeepSeek as escalation when Anthropic is unset", () => {
    const { primary, escalation } = selectLlmProviders({ OPENAI_COMPAT_BASE_URL: "http://localhost:6969/v1", DEEPSEEK_API_KEY: "sk-x", GEMINI_API_KEY: "g" });
    expect(primary?.id).toBe("openai-compat:gemini-3-flash");
    expect(escalation?.id).toBe("deepseek:deepseek-chat");
  });

  it("LLM_PRIMARY=deepseek promotes DeepSeek and demotes the proxy to escalation", () => {
    const { primary, escalation } = selectLlmProviders({ LLM_PRIMARY: "deepseek", OPENAI_COMPAT_BASE_URL: "http://localhost:6969/v1", DEEPSEEK_API_KEY: "sk-x", DEEPSEEK_MODEL: "deepseek-reasoner" });
    expect(primary?.id).toBe("deepseek:deepseek-reasoner");
    expect(escalation?.id).toBe("openai-compat:gemini-3-flash");
  });

  it("falls back to auto when the named primary is not configured; Anthropic wins escalation", () => {
    const { primary, escalation } = selectLlmProviders({ LLM_PRIMARY: "deepseek", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" });
    expect(primary?.id).toContain("gemini");
    expect(escalation?.id).toContain("claude");
  });
});
