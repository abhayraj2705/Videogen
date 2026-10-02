/**
 * Reading-time and line-fit helpers for templates. film-runtime runs in the
 * browser (it must stay free of Node built-ins), so these constants are a
 * deliberate, small duplication of @sitereel/shared's reading.ts (which the
 * planner's validators use) rather than a package dependency — pulling in the
 * shared barrel would drag ssrf.ts/env.ts's node:dns, node:net imports into a
 * browser bundle. Keep the two values in sync by hand; they change rarely.
 */

export const READING_SECONDS_PER_WORD = 0.3;
export const MAX_WORDS_ON_SCREEN = 8;

export function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

export function minReadSeconds(text: string): number {
  return wordCount(text) * READING_SECONDS_PER_WORD;
}

export function exceedsWordLimit(text: string, limit = MAX_WORDS_ON_SCREEN): boolean {
  return wordCount(text) > limit;
}

/**
 * Greedy word-wrap into at most maxLines lines of at most maxCharsPerLine each.
 * Used by templates to lay out on-screen text deterministically (no browser reflow
 * dependency at capture time beyond what's already measured here).
 */
export function wrapText(text: string, maxCharsPerLine: number, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const [index, word] of words.entries()) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) {
        // fold the remainder into the last allowed line (by position: a repeated word must not rewind the text)
        const rest = words.slice(index).join(" ");
        lines.push(rest.length > maxCharsPerLine ? `${rest.slice(0, maxCharsPerLine - 1)}…` : rest);
        return lines;
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
