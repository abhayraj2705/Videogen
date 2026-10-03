import { createElevenLabsTtsProvider, createGeminiTtsProvider, type TtsProvider } from "@sitereel/tts";
import { costOfError, createAnthropicProvider, createGeminiProvider, createOpenAiCompatProvider, type LlmProvider } from "@sitereel/llm";

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

/**
 * Who writes and who edits the script (stages/plan.ts). The strongest model available writes:
 * GEMINI_SCRIPT_MODEL (a larger Gemini model, used for the script alone) when it is set, else
 * Anthropic when that is the escalation provider, else the primary. The escalation slot is only
 * trusted as a writer when it is Anthropic: otherwise it is just the next configured fallback
 * (often a local proxy), not a better model. When writer and primary differ, the primary grades
 * the draft, since a model marking its own work is lenient.
 * PLANNER_SCRIPT=off turns the script step off (single-call planner).
 */
export function scriptProviders(
  llm: { primary: LlmProvider | null; escalation: LlmProvider | null },
  env: Record<string, string | undefined> = process.env,
): { scriptProvider: LlmProvider | null; criticProvider: LlmProvider | null } {
  if ((env.PLANNER_SCRIPT ?? "").toLowerCase() === "off") return { scriptProvider: null, criticProvider: null };
  const named = env.GEMINI_SCRIPT_MODEL && env.GEMINI_API_KEY ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_SCRIPT_MODEL }) : null;
  const anthropic = llm.escalation?.id.startsWith("anthropic") ? llm.escalation : null;
  const writer = named ?? anthropic ?? llm.primary ?? llm.escalation;
  return { scriptProvider: writer, criticProvider: llm.primary && llm.primary !== writer ? llm.primary : writer };
}

/**
 * Who designs the scenes (lib/scene-composer.ts): the same strongest-available model that writes the script
 * (GEMINI_SCRIPT_MODEL, else Anthropic, else the primary). Designed scenes are the default way films are made;
 * SITEREEL_HTML_SCENES=off cuts films from the template catalogue alone.
 */
export function composeProvider(llm: { primary: LlmProvider | null; escalation: LlmProvider | null }, env: Record<string, string | undefined> = process.env): LlmProvider | null {
  if ((env.SITEREEL_HTML_SCENES ?? "").toLowerCase() === "off") return null;
  const named = env.GEMINI_SCRIPT_MODEL && env.GEMINI_API_KEY ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_SCRIPT_MODEL }) : null;
  const anthropic = llm.escalation?.id.startsWith("anthropic") ? llm.escalation : null;
  const chosen = named ?? anthropic ?? llm.primary ?? llm.escalation;
  // Out of quota on the chosen model: the primary designs instead of the film falling back to templates.
  return chosen && llm.primary && chosen !== llm.primary ? onRateLimit(chosen, llm.primary) : chosen;
}

/** `first`, and `then` for any call `first` fails with a rate limit / exhausted quota (after its own retries). */
export function onRateLimit(first: LlmProvider, then: LlmProvider): LlmProvider {
  return {
    id: first.id,
    ...(first.supportsImages && then.supportsImages ? { supportsImages: true } : {}),
    async generateJson(opts) {
      try {
        return await first.generateJson(opts);
      } catch (err) {
        if (!/\b429\b|quota|rate.?limit/i.test(String((err as Error)?.message))) throw err;
        const res = await then.generateJson(opts);
        // The failed call's cost still counts.
        return { ...res, costUsd: res.costUsd + costOfError(err) };
      }
    },
  };
}

/**
 * The voice provider from env: ElevenLabs when ELEVENLABS_API_KEY is set (the premium option;
 * voice ids come from ELEVENLABS_VOICE_DEFAULT / _ENERGETIC / _CALM), else Gemini TTS when
 * GEMINI_API_KEY is set, else none (lines fall back to silence). TTS_PROVIDER=gemini|elevenlabs forces one.
 */
export function selectTtsProvider(env: Record<string, string | undefined> = process.env): TtsProvider | null {
  const want = (env.TTS_PROVIDER ?? "").toLowerCase();
  const eleven = () =>
    env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_DEFAULT
      ? createElevenLabsTtsProvider({
          apiKey: env.ELEVENLABS_API_KEY,
          model: env.ELEVENLABS_MODEL || undefined,
          voices: {
            default: env.ELEVENLABS_VOICE_DEFAULT,
            warm: env.ELEVENLABS_VOICE_DEFAULT,
            energetic: env.ELEVENLABS_VOICE_ENERGETIC || env.ELEVENLABS_VOICE_DEFAULT,
            calm: env.ELEVENLABS_VOICE_CALM || env.ELEVENLABS_VOICE_DEFAULT,
          },
        })
      : null;
  const gemini = () => (env.GEMINI_API_KEY ? createGeminiTtsProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_TTS_MODEL || undefined }) : null);
  if (want === "gemini") return gemini();
  if (want === "elevenlabs") return eleven();
  return eleven() ?? gemini();
}
