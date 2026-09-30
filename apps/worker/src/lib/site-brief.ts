import { z } from "zod";
import { SiteBrief, type FactLedger } from "@sitereel/shared";
import type { LlmProvider } from "@sitereel/llm";

const LlmSiteBriefShape = z.object({
  productName: z.string(),
  summary: z.string(),
  audience: z.string(),
  differentiator: z.string(),
  strongestClaimFactId: z.string().nullable(),
});

export interface SiteBriefResult {
  brief: SiteBrief;
  costUsd: number;
}

function buildFallbackBrief(domain: string, facts: FactLedger): SiteBrief {
  const hero = facts.find((f) => f.kind === "hero");
  const feature = facts.find((f) => f.kind === "feature");
  const stat = facts.find((f) => f.kind === "stat");

  return {
    productName: domain.replace(/^www\./, "").split(".")[0] ?? domain,
    summary: hero?.text ?? `${domain} — see the site for details.`,
    audience: "general",
    differentiator: feature?.text ?? hero?.text ?? "See site for details.",
    strongestClaimFactId: stat?.id ?? feature?.id ?? hero?.id ?? null,
    factIds: facts.map((f) => f.id),
    source: "fallback",
  };
}

/**
 * One cheap LLM call (§4.6 "Extract") to turn the raw FactLedger into a short,
 * grounded brief the Phase 3 planner can work from. Every field must cite fact
 * ids that actually exist — with no LLM_PROVIDER configured (or on any call
 * failure), a deterministic fallback keeps the pipeline working end to end
 * without ever inventing a claim.
 */
export async function buildSiteBrief(opts: {
  domain: string;
  facts: FactLedger;
  provider: LlmProvider | null;
}): Promise<SiteBriefResult> {
  const { domain, facts, provider } = opts;

  if (!provider || facts.length === 0) {
    return { brief: buildFallbackBrief(domain, facts), costUsd: 0 };
  }

  const factList = facts.map((f) => `- [${f.id}] (${f.kind}) ${f.text}`).join("\n");
  const system =
    "You summarize a marketing website from a list of facts scraped off its pages. " +
    "You never invent claims: every fact you reference must be one of the given fact ids. " +
    "Output JSON only, matching the schema described in the prompt.";
  const prompt = `Site: ${domain}

FACTS:
${factList}

Return a JSON object with exactly these fields:
- productName: string, the product/company name (guess from the domain/facts)
- summary: string, one sentence describing what this product is
- audience: string, who it's for, in a few words
- differentiator: string, one sentence on what makes it different, grounded in the facts above
- strongestClaimFactId: the id (string) of the single most compelling fact above, or null if none stand out`;

  try {
    const result = await provider.generateJson({ system, prompt, schema: LlmSiteBriefShape, maxOutputTokens: 500 });
    const factIdSet = new Set(facts.map((f) => f.id));
    const strongestClaimFactId =
      result.data.strongestClaimFactId && factIdSet.has(result.data.strongestClaimFactId)
        ? result.data.strongestClaimFactId
        : null;

    return {
      brief: {
        ...result.data,
        strongestClaimFactId,
        factIds: facts.map((f) => f.id),
        source: "llm",
      },
      costUsd: result.costUsd,
    };
  } catch {
    // Any LLM failure (timeout, invalid JSON after retry, quota) falls back
    // rather than failing the whole crawl — a crawl with a plain-heuristic
    // brief is still useful; a crawl that dies on a flaky LLM call is not.
    return { brief: buildFallbackBrief(domain, facts), costUsd: 0 };
  }
}
