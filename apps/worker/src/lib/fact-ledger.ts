import type { Page } from "playwright";
import { nanoid } from "nanoid";
import type { HTMLElement as ParsedElement } from "node-html-parser";
import type { FactLedger, FactLedgerEntry, FactKind, FactRect } from "@sitereel/shared";

export interface RawFact {
  kind: FactKind;
  text: string;
  selector: string;
  rect?: FactRect;
}

export const CTA_WORDS = [
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
  "get a demo",
  "start now",
];

/**
 * DOM heuristics for the FactLedger (Appendix D): headings, hero copy, feature
 * blurbs (explicit feature/benefit blocks AND repeated card grids), stats,
 * testimonials and CTAs, each tagged with the selector it came from so the
 * planner can cite a real source instead of inventing one.
 *
 * Runs in TWO environments: serialized into the page by Playwright (root =
 * `document`), and in Node over a node-html-parser tree for the plain-fetch
 * fallback (root = parsed HTML). So it only touches the DOM subset both
 * share — querySelector(All), parentNode, childNodes, nodeType, tagName,
 * getAttribute, textContent — and uses arrow functions only (tsx's __name
 * helper doesn't exist inside the page realm).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function collectRawFacts(input: { ctaWords: string[]; root?: any }): { kind: string; text: string; selector: string; rect?: { x: number; y: number; w: number; h: number } }[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type El = any;
  const root: El = input.root ?? document;
  const ctaWords = input.ctaWords;

  const all = (scope: El, sel: string): El[] => {
    try {
      return Array.from(scope.querySelectorAll(sel) as ArrayLike<El>);
    } catch {
      return [];
    }
  };
  const one = (scope: El, sel: string): El | null => {
    try {
      return scope.querySelector(sel);
    } catch {
      return null;
    }
  };
  const tag = (el: El): string => String(el?.tagName ?? "").toLowerCase();
  const elementChildren = (el: El): El[] => Array.from((el.childNodes ?? []) as ArrayLike<El>).filter((n: El) => n.nodeType === 1 && tag(n));
  const parentOf = (el: El): El | null => {
    const p = el?.parentNode;
    return p && p.nodeType === 1 && tag(p) ? p : null;
  };

  const cssPath = (el: El): string => {
    const id = el.getAttribute?.("id");
    if (id && /^[A-Za-z][\w-]*$/.test(id)) return `#${id}`;
    const parts: string[] = [];
    let node: El | null = el;
    let depth = 0;
    while (node && depth < 5) {
      let selector = tag(node);
      const cls = String(node.getAttribute?.("class") ?? "").trim().split(/\s+/)[0];
      if (cls && /^[A-Za-z_-][\w-]*$/.test(cls)) selector += `.${cls}`;
      parts.unshift(selector);
      node = parentOf(node);
      depth++;
    }
    return parts.join(" > ");
  };

  const cleanText = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();
  // In a real page innerText skips CSS-hidden nodes and turns block breaks into
  // whitespace — responsive sites (e.g. linear.app) put 2-3 copies of a headline
  // in one <h1> and hide all but one, which textContent glues into one string.
  // The node-html-parser fallback has no layout, so it uses textContent.
  const textOf = (el: El): string => {
    const inner = typeof document !== "undefined" && el && typeof el.innerText === "string" ? el.innerText : null;
    return inner ?? el?.textContent ?? "";
  };
  const insideChrome = (el: El): boolean => {
    let node: El | null = el;
    while (node) {
      const t = tag(node);
      if (t === "nav" || t === "footer" || t === "script" || t === "style" || t === "noscript" || t === "template") return true;
      node = parentOf(node);
    }
    return false;
  };

  const results: { kind: string; text: string; selector: string; rect?: { x: number; y: number; w: number; h: number } }[] = [];
  // Where the element sits on the page, as fractions of the page width — lets a screenshot
  // scene zoom to the thing its caption is about. Browser only (the parsed-HTML fallback has no layout).
  const rectOf = (el: El): { x: number; y: number; w: number; h: number } | undefined => {
    if (typeof window === "undefined" || typeof el?.getBoundingClientRect !== "function") return undefined;
    const r = el.getBoundingClientRect();
    const pageWidth = document.documentElement.clientWidth;
    if (!pageWidth || r.width < 8 || r.height < 8) return undefined;
    const round = (n: number) => Math.round((n / pageWidth) * 10000) / 10000;
    return { x: round(r.left + window.scrollX), y: round(r.top + window.scrollY), w: round(r.width), h: round(r.height) };
  };
  const seen = new Set<string>();
  // "X Y X Y" -> "X Y": responsive markup and screen-reader-only copies repeat a
  // headline inside one element, and innerText still includes visible-to-AT copies.
  const collapseRepeats = (text: string): string => {
    const words = text.split(" ");
    for (let k = 1; k <= words.length / 2; k++) {
      if (words.length % k !== 0) continue;
      const unit = words.slice(0, k).join(" ").toLowerCase();
      let repeated = true;
      for (let i = k; i < words.length && repeated; i += k) repeated = words.slice(i, i + k).join(" ").toLowerCase() === unit;
      if (repeated) return words.slice(0, k).join(" ");
    }
    return text;
  };
  const push = (kind: string, text: string, el: El): void => {
    const clean = collapseRepeats(cleanText(text));
    if (clean.length < 3 || clean.length > 200) return;
    const key = kind + ":" + clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const rect = rectOf(el);
    results.push({ kind, text: clean, selector: cssPath(el), ...(rect ? { rect } : {}) });
  };

  // Hero: first h1 plus its nearest following paragraph.
  const h1 = one(root, "h1");
  if (h1) {
    push("hero", textOf(h1), h1);
    const p = one(parentOf(h1) ?? root, "p");
    if (p) push("hero", textOf(p), p);
  }

  // Features (a): explicit feature/benefit blocks.
  all(root, '[class*="feature" i], [class*="benefit" i]').forEach((block: El) => {
    if (insideChrome(block)) return;
    const heading = one(block, "h2, h3, h4, strong");
    const text = one(block, "p");
    if (heading) push("feature", textOf(heading), heading);
    if (text) push("feature", textOf(text), text);
  });

  // Features (b): card grids — a container with >= 3 same-tag children that
  // each carry their own short heading. That's the shape of almost every
  // "what you get" section, whatever its class names are.
  let gridGroups = 0;
  all(root, "section, main, div, ul").forEach((container: El) => {
    if (gridGroups >= 8 || insideChrome(container)) return;
    const kids = elementChildren(container);
    if (kids.length < 3 || kids.length > 12) return;
    const firstTag = tag(kids[0]);
    if (!kids.every((k: El) => tag(k) === firstTag)) return;
    const headings = kids.map((k: El) => one(k, "h3, h4, h5, [class*='title' i]"));
    if (headings.some((h: El | null) => !h)) return;
    const labels = headings.map((h: El) => cleanText(textOf(h)));
    if (labels.some((l: string) => l.length < 3 || l.length > 80)) return;
    gridGroups++;
    kids.forEach((k: El, i: number) => {
      push("feature", labels[i]!, headings[i]);
      const body = one(k, "p");
      if (body) push("feature", textOf(body), body);
    });
  });

  // Headings: every other heading on the page, a broad net the caller can filter.
  all(root, "h2, h3").forEach((h: El) => {
    if (!insideChrome(h)) push("heading", textOf(h), h);
  });

  // Stats: short text that looks numeric ("10,000+", "99%", "24/7").
  const statPattern = /\b\d[\d,.]*\s?(%|\+|k\+?|m\+?|x)?\b/i;
  all(root, "h2, h3, strong, b, [class*='stat' i], [class*='metric' i], [class*='number' i]").forEach((el: El) => {
    const text = cleanText(textOf(el));
    if (statPattern.test(text) && text.length < 40 && /\d/.test(text) && !insideChrome(el)) push("stat", text, el);
  });

  // Testimonials: blockquotes or elements explicitly marked as testimonial/review/quote.
  all(root, 'blockquote, [class*="testimonial" i], [class*="review" i], [class*="quote" i]').forEach((el: El) => {
    if (!insideChrome(el)) push("testimonial", textOf(el), el);
  });

  // CTAs: buttons/links whose text matches a known call-to-action vocabulary.
  all(root, "button, a").forEach((el: El) => {
    const text = cleanText(textOf(el)).toLowerCase();
    if (text.length === 0 || text.length > 30) return;
    if (ctaWords.some((w) => text.includes(w))) push("cta", textOf(el), el);
  });

  return results;
}

function toLedger(raw: { kind: string; text: string; selector: string; rect?: FactRect }[], pageUrl: string): FactLedger {
  return raw.map(
    (r): FactLedgerEntry => ({
      id: nanoid(10),
      kind: r.kind as FactKind,
      text: r.text,
      sourceUrl: pageUrl,
      selector: r.selector,
      ...(r.rect ? { rect: r.rect } : {}),
    }),
  );
}

export async function extractFacts(page: Page, pageUrl: string): Promise<FactLedger> {
  const raw = await page.evaluate(collectRawFacts, { ctaWords: CTA_WORDS });
  return toLedger(raw, pageUrl);
}

/** Same heuristics over static HTML (plain-fetch fallback). Strip script/style/template before calling. */
export function extractFactsFromHtml(root: ParsedElement, pageUrl: string): FactLedger {
  return toLedger(collectRawFacts({ ctaWords: CTA_WORDS, root }), pageUrl);
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

export function countFeatureFacts(facts: FactLedger): number {
  return facts.filter((f) => f.kind === "feature").length;
}
