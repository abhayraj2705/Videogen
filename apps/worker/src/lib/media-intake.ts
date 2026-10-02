import { z } from "zod";
import type { CrawlOutput, CrawledPage, FactLedgerEntry, JobMedia } from "@sitereel/shared";
import type { LlmProvider } from "@sitereel/llm";

/** What the vision model reports about one uploaded image. Coordinates are 0-1 fractions of the image's width and height. */
const VisionRead = z.object({
  title: z.string(),
  lines: z.array(z.string()).max(8),
  regions: z.array(z.object({ label: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() })).max(3),
});
type VisionRead = z.infer<typeof VisionRead>;

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Pixel size of a PNG, JPEG or WebP from its header; null for anything else (e.g. SVG). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    return null;
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // Walk the JPEG segments to the first start-of-frame marker.
    for (let at = 2; at + 9 < buf.length; ) {
      if (buf[at] !== 0xff) return null;
      const marker = buf[at + 1]!;
      const size = buf.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5) };
      at += 2 + size;
    }
  }
  return null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** The page URL an upload is filed under — a fragment of the job URL, so every fact about it still cites a real URL. */
export function uploadPageUrl(jobUrl: string, index: number): string {
  return `${jobUrl.replace(/#.*$/, "")}#upload-${index + 1}`;
}

export interface MediaIntakeResult {
  crawlOutput: CrawlOutput;
  costUsd: number;
  /** One entry per upload that was read: what the model saw (or why it wasn't asked). */
  notes: { key: string; title: string; facts: number; vision: "ok" | "skipped" | "failed" }[];
}

/**
 * Folds the user's own uploads into the crawl material, so the planner can
 * use them exactly like crawled screenshots: each upload becomes a page (in
 * the order given, right after the homepage) with its caption as a fact, and
 * — when the LLM can see images — the text the model reads off it as further
 * facts, and up to three regions worth a close-up as fact positions.
 *
 * A caption is the user's own claim and is trusted. Text read from an image
 * is grounded the same way crawled text is: scenes must cite it to use it.
 */
export async function ingestUserMedia(opts: {
  crawlOutput: CrawlOutput;
  jobUrl: string;
  media: JobMedia[];
  getObject: (key: string) => Promise<Buffer>;
  llm?: LlmProvider | null;
}): Promise<MediaIntakeResult> {
  const { crawlOutput, jobUrl, media } = opts;
  if (media.length === 0) return { crawlOutput, costUsd: 0, notes: [] };

  const pages: CrawledPage[] = [];
  const facts: FactLedgerEntry[] = [];
  const notes: MediaIntakeResult["notes"] = [];
  let costUsd = 0;

  const read = await Promise.all(
    media.map(async (item, i) => {
      const buf = await opts.getObject(item.key).catch(() => null);
      if (!buf) return null;
      const size = imageSize(buf);
      const mime = MIME[item.key.split(".").pop()?.toLowerCase() ?? ""];
      let vision: VisionRead | null = null;
      let status: "ok" | "skipped" | "failed" = "skipped";
      if (opts.llm?.supportsImages && size && mime) {
        try {
          const r = await opts.llm.generateJson({
            system: "You describe one screenshot or photo of a software product so a video editor can use it. Report only what is visibly there.",
            prompt:
              `${item.caption ? `The uploader's caption: "${item.caption}". ` : ""}Return: "title" — what this screen or photo shows, 2-6 words; ` +
              `"lines" — up to 8 short headings or labels copied EXACTLY as they appear in the image (no paraphrasing, no body paragraphs, skip anything you cannot read with certainty); ` +
              `"regions" — up to 3 areas worth a close-up (a headline, a key panel, a chart, a primary button), each with a 2-5 word "label" and x, y, w, h as fractions 0-1 of the image's width (x, w) and height (y, h), measured from the top-left.`,
            schema: VisionRead,
            schemaName: "upload_read",
            maxOutputTokens: 700,
            images: [{ mimeType: mime, base64: buf.toString("base64") }],
          });
          vision = r.data;
          costUsd += r.costUsd;
          status = "ok";
        } catch {
          status = "failed";
        }
      }
      return { item, i, size, vision, status };
    }),
  );

  for (const entry of read) {
    if (!entry) continue;
    const { item, i, size, vision, status } = entry;
    const url = uploadPageUrl(jobUrl, i);
    const title = clean(vision?.title || item.caption || `Uploaded ${item.role} ${i + 1}`, 60);
    pages.push({ url, screenshotKey: item.key, sectionScreenshotKeys: [item.key], origin: "upload", label: title });

    const before = facts.length;
    const push = (kind: FactLedgerEntry["kind"], text: string, selector: string, rect?: FactLedgerEntry["rect"]) => {
      const t = clean(text, 200);
      if (t.length < 3 || facts.some((f) => f.sourceUrl === url && f.text.toLowerCase() === t.toLowerCase())) return;
      facts.push({ id: `u${i + 1}-${facts.length - before + 1}`, kind, text: t, sourceUrl: url, selector, ...(rect ? { rect } : {}) });
    };
    if (item.caption) push("feature", item.caption, `upload:${i + 1}:caption`);
    if (vision) {
      // Regions first: they are the facts a close-up can point at. Rects are stored in page-width
      // fractions (see FactRect), so heights are scaled by the image's aspect.
      const aspect = size ? size.height / size.width : 1;
      for (const r of vision.regions) {
        const x = clamp01(r.x);
        const y = clamp01(r.y);
        const w = Math.min(clamp01(r.w), 1 - x);
        const h = Math.min(clamp01(r.h), 1 - y);
        if (w < 0.03 || h < 0.02) continue;
        push("heading", r.label, `upload:${i + 1}:region`, { x: round4(x), y: round4(y * aspect), w: round4(w), h: round4(h * aspect) });
      }
      vision.lines.forEach((line, n) => push("heading", line, `upload:${i + 1}:line[${n}]`));
      if (!item.caption) push("feature", vision.title, `upload:${i + 1}:title`);
    }
    notes.push({ key: item.key, title, facts: facts.length - before, vision: status });
  }

  if (pages.length === 0) return { crawlOutput, costUsd, notes };
  // Uploads go right after the homepage: the reveal still opens on the site, then the user's own screens lead.
  const [home, ...rest] = crawlOutput.pages;
  const homeHasShot = Boolean(home?.screenshotKey);
  return {
    crawlOutput: {
      ...crawlOutput,
      pages: home && homeHasShot ? [home, ...pages, ...rest] : [...pages, ...crawlOutput.pages.filter((p) => p.screenshotKey)],
      facts: [...crawlOutput.facts, ...facts],
    },
    costUsd,
    notes,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
