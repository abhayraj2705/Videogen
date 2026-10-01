import type { FilmManifest } from "@sitereel/film-runtime";

function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/** Builds a WebVTT file from the manifest's captions (one cue per scene). */
export function buildVtt(manifest: FilmManifest): string {
  const lines = ["WEBVTT", ""];
  manifest.captions.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${formatTimestamp(cue.t0)} --> ${formatTimestamp(cue.t1)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}
