import type { Page } from "playwright";
import { nanoid } from "nanoid";
import type { FactLedger, FactLedgerEntry, FactKind } from "@sitereel/shared";

interface RawFact {
  kind: FactKind;
  text: string;
  selector: string;
}

const CTA_WORDS = [
  "get started",
  "try",
  "sign up",
  "buy",
  "shop",
  "order",
  "download",
  "book",
  "contact",
  "start free",
  "learn more",
  "subscribe",
  "join",
  "request",
];

/**
 * DOM heuristics for the FactLedger (Appendix D): headings, hero copy, feature
 * blurbs, stats, testimonials and CTAs, each tagged with the selector it came
 * from so the planner (Phase 3) can cite a real source instead of inventing one.
 */
export async function extractFacts(page: Page, pageUrl: string): Promise<FactLedger> {
  const raw = await page.evaluate((ctaWords: string[]) => {
    // Arrow functions only — see the comment in brand-extract.ts's evaluate
    // callback for why nested `function` declarations break here (__name helper).
    const cssPath = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      const parts: string[] = [];
      let node: Element | null = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 5) {
        let selector = node.tagName.toLowerCase();
        if (node.className && typeof node.className === "string") {
          const cls = node.className.trim().split(/\s+/)[0];
          if (cls) selector += `.${cls}`;
        }
        parts.unshift(selector);
        node = node.parentElement;
        depth++;
      }
      return parts.join(" > ");
    };

    const cleanText = (text: string | null): string => (text ?? "").replace(/\s+/g, " ").trim();

    const results: { kind: string; text: string; selector: string }[] = [];
    const seen = new Set<string>();

    const push = (kind: string, text: string, el: Element): void => {
      const clean = cleanText(text);
      if (clean.length < 3 || clean.length > 200) return;
      const key = kind + ":" + clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ kind, text: clean, selector: cssPath(el) });
    };

    // Hero: first h1 plus its nearest following paragraph.
    const h1 = document.querySelector("h1");
    if (h1) {
      push("hero", h1.textContent ?? "", h1);
      const p = h1.parentElement?.querySelector("p");
      if (p) push("hero", p.textContent ?? "", p);
    }

    // Headings: every other heading on the page, a broad net the caller can filter.
    document.querySelectorAll("h2, h3").forEach((h) => push("heading", h.textContent ?? "", h));

    // Features: heading+paragraph pairs inside anything that looks like a feature/benefit block.
    document.querySelectorAll('[class*="feature" i], [class*="benefit" i]').forEach((block) => {
      const heading = block.querySelector("h2, h3, h4, strong");
      const text = block.querySelector("p");
      if (heading) push("feature", heading.textContent ?? "", heading);
      if (text) push("feature", text.textContent ?? "", text);
    });

    // Stats: short text nodes that look numeric ("10,000+", "99%", "24/7").
    const statPattern = /\b\d[\d,.]*\s?(%|\+|k\+?|m\+?|x)?\b/i;
    document.querySelectorAll("h2, h3, strong, b, [class*='stat' i]").forEach((el) => {
      const text = cleanText(el.textContent);
      if (statPattern.test(text) && text.length < 40 && /\d/.test(text)) {
        push("stat", text, el);
      }
    });

    // Testimonials: blockquotes or elements explicitly marked as testimonial/review.
    document.querySelectorAll('blockquote, [class*="testimonial" i], [class*="review" i]').forEach((el) => {
      push("testimonial", el.textContent ?? "", el);
    });

    // CTAs: buttons/links whose text matches a known call-to-action vocabulary.
    document.querySelectorAll("button, a").forEach((el) => {
      const text = cleanText(el.textContent).toLowerCase();
      if (text.length === 0 || text.length > 30) return;
      if (ctaWords.some((w) => text.includes(w))) {
        push("cta", el.textContent ?? "", el);
      }
    });

    return results;
  }, CTA_WORDS);

  return raw.map(
    (r): FactLedgerEntry => ({
      id: nanoid(10),
      kind: r.kind as FactKind,
      text: r.text,
      sourceUrl: pageUrl,
      selector: r.selector,
    }),
  );
}

/** Merges facts from multiple crawled pages, deduping near-identical text across pages. */
export function mergeFacts(pages: FactLedger[]): FactLedger {
  const seen = new Set<string>();
  const merged: FactLedgerEntry[] = [];
  for (const facts of pages) {
    for (const fact of facts) {
      const key = `${fact.kind}:${fact.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(fact);
    }
  }
  return merged;
}
