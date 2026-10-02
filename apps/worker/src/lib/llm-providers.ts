import { createAnthropicProvider, createGeminiProvider, createOpenAiCompatProvider, type LlmProvider } from "@sitereel/llm";

/** The LLM slice of ServerEnv; also satisfied by raw process.env (scripts). */
export interface LlmEnv {
  LLM_PRIMARY?: string;
  OPENAI_COMPAT_BASE_URL?: string;
  OPENAI_COMPAT_MODEL?: string;
  OPENAI_COMPAT_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

type PrimaryKind = "openai-compat" | "deepseek" | "gemini";
const AUTO_ORDER: PrimaryKind[] = ["openai-compat", "deepseek", "gemini"];

/**
 * Builds the primary + escalation providers from env. Primary is LLM_PRIMARY
 * when that provider is configured, otherwise the first configured of
 * openai-compat (e.g. a Gemini-web proxy), deepseek, gemini. Escalation is
 * Anthropic when configured, otherwise the next configured provider — so an
 * expired proxy login falls through to a real API instead of the
 * deterministic storyboard.
 */
export function selectLlmProviders(env: LlmEnv): { primary: LlmProvider | null; escalation: LlmProvider | null } {
  const build: Record<PrimaryKind, () => LlmProvider | null> = {
    "openai-compat": () =>
      env.OPENAI_COMPAT_BASE_URL
        ? createOpenAiCompatProvider({
            baseUrl: env.OPENAI_COMPAT_BASE_URL,
            model: env.OPENAI_COMPAT_MODEL || "gemini-3-flash",
            apiKey: env.OPENAI_COMPAT_API_KEY || undefined,
          })
        : null,
    deepseek: () =>
      env.DEEPSEEK_API_KEY
        ? createOpenAiCompatProvider({
            baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
            model: env.DEEPSEEK_MODEL || "deepseek-chat",
            apiKey: env.DEEPSEEK_API_KEY,
            label: "deepseek",
            jsonObjectMode: true,
          })
        : null,
    gemini: () => (env.GEMINI_API_KEY ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-3.5-flash-lite" }) : null),
  };

  const preferred = AUTO_ORDER.find((k) => k === env.LLM_PRIMARY);
  const order = preferred ? [preferred, ...AUTO_ORDER.filter((k) => k !== preferred)] : AUTO_ORDER;
  const configured = order.map((k) => build[k]()).filter((p): p is LlmProvider => p !== null);

  const anthropic = env.ANTHROPIC_API_KEY ? createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5" }) : null;
  return { primary: configured[0] ?? null, escalation: anthropic ?? configured[1] ?? null };
}
