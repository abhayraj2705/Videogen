import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { materialFromHtml, crawlWithPlainFetch, isSufficient, MIN_VISIBLE_WORDS, EXTRA_PAGES_LIMIT } from "../stages/crawl.js";
import { mapToKnownFont, normalizeFamily, googleFontsFromLinks, extractBrandFromHtml, GOOGLE_FONT_FAMILIES } from "./brand-extract.js";
import { rankSameOriginLinks } from "./page-prep.js";
import { buildHostResolverRules, hostTwins } from "./ssrf-route-guard.js";

const MARKETING_HTML = `<!doctype html><html><head>
<title>Acme — docs that ship</title>
<meta name="theme-color" content="#5b3df5">
<meta property="og:image" content="/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&family=Inter&display=swap" rel="stylesheet">
<script>window.__DATA__ = { lots: "of json that should never become a fact" }</script>
</head><body>
<nav><a href="/">Home</a><a href="/pricing">Pricing</a><h3>Nav heading</h3></nav>
<header><a href="/"><img src="/img/acme-logo.svg" alt="Acme logo"></a></header>
<main>
  <section class="hero"><h1>Ship docs 4x faster</h1><p>Acme turns your codebase into living documentation your whole team can trust.</p><a href="/signup">Get started</a></section>
  <section class="grid">
    <div class="card"><h3>Realtime collaboration</h3><p>Edit together with presence and comments.</p></div>
    <div class="card"><h3>Version history</h3><p>Every change, forever, with one-click restore.</p></div>
    <div class="card"><h3>Offline mode</h3><p>Keep writing on planes and trains.</p></div>
  </section>
  <section><strong>10,000+ teams</strong><blockquote>"Acme cut our release time in half." — Dana, CTO</blockquote></section>
</main>
<footer><h3>Footer heading</h3></footer>
</body></html>`;

const SPA_SHELL = `<!doctype html><html><head><title>App</title><script src="/main.js"></script></head>
<body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div></body></html>`;

describe("plain-fetch HTML extraction", () => {
  it("extracts hero, card-grid features, stats, testimonials and CTAs from static HTML", () => {
    const m = materialFromHtml(MARKETING_HTML, "https://acme.test/");
    const byKind = (k: string) => m.facts.filter((f) => f.kind === k).map((f) => f.text);
    expect(byKind("hero")).toContain("Ship docs 4x faster");
    expect(byKind("feature")).toEqual(expect.arrayContaining(["Realtime collaboration", "Version history", "Offline mode"]));
    expect(byKind("feature").length).toBeGreaterThanOrEqual(3);
    expect(byKind("stat")).toContain("10,000+ teams");
    expect(byKind("testimonial")[0]).toContain("Acme cut our release time in half.");
    expect(byKind("cta")).toContain("Get started");
    // nav/footer chrome and script contents never become facts
    expect(m.facts.map((f) => f.text).join(" ")).not.toMatch(/Nav heading|Footer heading|__DATA__/);
    expect(m.facts.every((f) => f.sourceUrl === "https://acme.test/" && f.selector.length > 0)).toBe(true);
    expect(m.pages).toEqual([{ url: "https://acme.test/", screenshotKey: "" }]);
    expect(m.mode).toBe("plain-fetch");
    expect(isSufficient(m.facts, m.words)).toBe(true);
  });

  it("derives brand tokens from theme-color, Google Fonts links and the header logo", () => {
    const brand = extractBrandFromHtml(parse(MARKETING_HTML), "https://acme.test/");
    expect(brand.accent).toBe("#5b3df5");
    expect(brand.fontDisplay).toBe("Space Grotesk");
    expect(brand.logoUrl).toBe("https://acme.test/img/acme-logo.svg");
  });

  it("treats an empty SPA shell as insufficient (min word count)", () => {
    const m = materialFromHtml(SPA_SHELL, "https://spa.test/");
    expect(m.words).toBeLessThan(MIN_VISIBLE_WORDS);
    expect(isSufficient(m.facts, m.words)).toBe(false);
  });

  it("returns no facts for a bot-challenge page", () => {
    const m = materialFromHtml("<html><head><title>Just a moment...</title></head><body><h1>Checking your browser</h1><h2>a</h2><h2>b</h2></body></html>", "https://cf.test/");
    expect(m.facts).toEqual([]);
  });
});

describe("crawlWithPlainFetch", () => {
  const resolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

  it("parses a fetched page through ssrfSafeFetch", async () => {
    const fetchImpl = async () => new Response(MARKETING_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const r = await crawlWithPlainFetch("https://acme.test/", 5_000, { resolver, fetchImpl });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.material.facts.length).toBeGreaterThan(3);
  });

  it("maps 403 to blocked and refuses private targets", async () => {
    const fetchImpl = async () => new Response("no", { status: 403 });
    expect(await crawlWithPlainFetch("https://acme.test/", 5_000, { resolver, fetchImpl })).toMatchObject({ kind: "failed", reason: "blocked" });
    const privateResolver = async () => [{ address: "10.0.0.5", family: 4 as const }];
    expect(await crawlWithPlainFetch("https://acme.test/", 5_000, { resolver: privateResolver, fetchImpl })).toMatchObject({ kind: "failed", reason: "blocked" });
  });

  it("rejects non-HTML responses", async () => {
    const fetchImpl = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    expect(await crawlWithPlainFetch("https://acme.test/", 5_000, { resolver, fetchImpl })).toMatchObject({ kind: "failed", reason: "empty" });
  });
});

describe("font mapping", () => {
  it("has a broad static Google Fonts list", () => {
    expect(GOOGLE_FONT_FAMILIES.length).toBeGreaterThanOrEqual(100);
  });
  it("maps stacks, next/font mangled names and loaded faces", () => {
    expect(mapToKnownFont('"Plus Jakarta Sans", sans-serif')).toBe("Plus Jakarta Sans");
    expect(normalizeFamily("__Inter_d65c78")).toBe("Inter");
    expect(mapToKnownFont("__Plus_Jakarta_Sans_3a1b2c, __Plus_Jakarta_Sans_Fallback_3a1b2c")).toBe("Plus Jakarta Sans");
    expect(mapToKnownFont("InterVariable, system-ui")).toBe("Inter");
    expect(mapToKnownFont("Brand Sans, sans-serif", ["Brand Sans", "Roboto"])).toBe("Roboto");
    // unloaded stack fallbacks and code fonts aren't the brand font
    expect(mapToKnownFont("sohne-var, 'Source Code Pro', monospace", ["sohne-var", "Source Code Pro"])).toBe("Inter");
    expect(mapToKnownFont("-apple-system, BlinkMacSystemFont")).toBe("Inter");
    expect(mapToKnownFont("Roboto Serif")).toBe("Roboto"); // longest known prefix
  });
  it("reads Google Fonts link families", () => {
    expect(googleFontsFromLinks(["https://fonts.googleapis.com/css2?family=DM+Sans:wght@400&family=Fraunces"])).toEqual(["DM Sans", "Fraunces"]);
  });
});

describe("same-origin page discovery", () => {
  it("prefers pricing/features/about/docs, skips auth/legal/assets, caps at the limit", () => {
    const hrefs = ["/", "/login", "/pricing", "/features", "/about", "/docs", "/blog/post-1", "/terms", "/brochure.pdf", "https://other.test/x", "/random", "/careers", "#top", "mailto:x@y.z"];
    const out = rankSameOriginLinks(hrefs, "https://acme.test/", "https://acme.test", "/", EXTRA_PAGES_LIMIT);
    expect(EXTRA_PAGES_LIMIT).toBe(4);
    expect(out).toEqual(["https://acme.test/pricing", "https://acme.test/features", "https://acme.test/about", "https://acme.test/docs"]);
  });
});

describe("Chromium DNS pinning rules", () => {
  it("builds host-resolver-rules for literal public IPs and skips nothing silently", async () => {
    expect(hostTwins("acme.test")).toEqual(["acme.test", "www.acme.test"]);
    expect(hostTwins("www.acme.test")).toEqual(["www.acme.test", "acme.test"]);
    const { arg } = await buildHostResolverRules(["8.8.8.8"]);
    expect(arg).toBeNull(); // IP literal needs no mapping
    await expect(buildHostResolverRules(["127.0.0.1"])).resolves.toMatchObject({ arg: null });
  });
});
