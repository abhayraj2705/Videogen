import type { FactLedger, FactLedgerEntry } from "@sitereel/shared";

/**
 * Fact badges (§3.6 W6): every on-screen text chip shows "✓ fact" when it is
 * grounded in one of the facts the scene cites, or "⚠ unverified" otherwise
 * (user-typed claims are allowed but flagged). This is a UI hint only — the
 * server's validateStoryboard remains the gate (numbers, quotes, banned phrases).
 *
 * A text is grounded by a fact when, after normalizing case/punctuation:
 *  - it appears verbatim inside the fact (or the fact inside it), or
 *  - at least GROUNDING_OVERLAP of its content words appear in the fact,
 * and every number it contains also appears in that fact.
 */
export const GROUNDING_OVERLAP = 0.6;

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or our that the their this to with your you we us all more most just get".split(" "),
);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}%.]+/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentWords(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

function stem(w: string): string {
  return w.length > 4 ? w.replace(/(ing|ed|es|s)$/u, "") : w;
}

export function factGrounds(text: string, fact: Pick<FactLedgerEntry, "text">): boolean {
  const t = normalizeText(text);
  const f = normalizeText(fact.text);
  if (!t) return false;
  const factNumbers = new Set(numbersIn(fact.text));
  if (numbersIn(text).some((n) => !factNumbers.has(n))) return false;
  if (f.includes(t) || (f.length >= 8 && t.includes(f))) return true;
  const words = contentWords(text);
  if (words.length === 0) return false;
  const factWords = new Set(contentWords(fact.text).map(stem));
  const hits = words.filter((w) => factWords.has(stem(w))).length;
  return hits / words.length >= GROUNDING_OVERLAP;
}

export interface Grounding {
  status: "grounded" | "unverified";
  /** Cited facts that ground this text (empty when unverified). */
  facts: FactLedgerEntry[];
}

/** Grounds `text` against the facts this scene cites (`factIds`), looked up in the ledger. */
export function groundText(text: string, factIds: readonly string[], ledger: FactLedger): Grounding {
  const cited = citedFacts(factIds, ledger);
  const facts = cited.filter((f) => factGrounds(text, f));
  return { status: facts.length > 0 ? "grounded" : "unverified", facts };
}

/**
 * Narration usually weaves several facts into one line, so it's grounded
 * against the *union* of the cited facts; `facts` lists the ones that
 * contributed words.
 */
export function groundNarration(text: string, factIds: readonly string[], ledger: FactLedger): Grounding {
  const cited = citedFacts(factIds, ledger);
  if (cited.length === 0 || !text.trim()) return { status: "unverified", facts: [] };
  const union = { text: cited.map((f) => f.text).join(" ") };
  if (!factGrounds(text, union)) return { status: "unverified", facts: [] };
  const words = new Set(contentWords(text).map(stem));
  const facts = cited.filter((f) => contentWords(f.text).some((w) => words.has(stem(w))));
  return { status: "grounded", facts: facts.length ? facts : cited };
}

export function citedFacts(factIds: readonly string[], ledger: FactLedger): FactLedgerEntry[] {
  const byId = new Map(ledger.map((f) => [f.id, f]));
  return factIds.map((id) => byId.get(id)).filter((f): f is FactLedgerEntry => !!f);
}

/** Fact ids a scene cites that aren't in the ledger (the server rejects these as `unknown_fact_id`). */
export function unknownFactIds(factIds: readonly string[], ledger: FactLedger): string[] {
  const ids = new Set(ledger.map((f) => f.id));
  return factIds.filter((id) => !ids.has(id));
}

/** Short label for a fact's source page, e.g. "/features" or "notely.app". */
export function sourceLabel(sourceUrl: string): string {
  try {
    const u = new URL(sourceUrl);
    return u.pathname && u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : u.hostname;
  } catch {
    return sourceUrl;
  }
}
