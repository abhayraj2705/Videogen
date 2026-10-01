/**
 * WebVTT → plain caption text for the "copy captions" action. Drops the
 * header, NOTE/STYLE/REGION blocks, cue identifiers, timing lines and inline
 * tags (<v Speaker>, <c.x>, <00:00:01.000>), decodes the basic entities, and
 * joins cue text into readable sentences (consecutive duplicate lines — common
 * with rolling captions — are collapsed).
 */
export function vttToPlainText(vtt: string): string {
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const lines: string[] = [];
  for (const block of blocks) {
    const rows = block.split("\n").filter((r) => r.trim().length > 0);
    if (rows.length === 0) continue;
    const first = rows[0]!.trim();
    if (/^WEBVTT\b/.test(first) || /^(NOTE|STYLE|REGION)\b/.test(first)) continue;
    const timingIdx = rows.findIndex((r) => r.includes("-->"));
    if (timingIdx === -1) continue;
    for (const row of rows.slice(timingIdx + 1)) {
      const text = row
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      if (text && lines[lines.length - 1] !== text) lines.push(text);
    }
  }
  return lines.join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
}
