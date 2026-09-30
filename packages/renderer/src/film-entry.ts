import { mountFilm } from "@sitereel/film-runtime";
import type { FilmManifest } from "@sitereel/film-runtime";

/**
 * Browser-side entry bundled by esbuild into film-bundle.js and loaded by
 * film.html. Fetches the manifest named in ?manifest=, mounts it, and
 * publishes the window.__film contract both the preview scrubber and the
 * renderer's capture loop drive.
 */
async function boot(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const manifestUrl = params.get("manifest");
  if (!manifestUrl) throw new Error("film.html requires ?manifest=<url>");

  const res = await fetch(manifestUrl);
  const manifest = (await res.json()) as FilmManifest;

  const stage = document.getElementById("stage");
  if (!stage) throw new Error("film.html is missing #stage");

  const handle = await mountFilm(stage, manifest);
  handle.seek(0);

  window.__film = {
    ready: true,
    duration: handle.duration,
    fps: manifest.fps,
    seek: handle.seek,
    marks: handle.marks,
  };

  window.dispatchEvent(new CustomEvent("film:ready"));
}

boot().catch((err) => {
  console.error("[film-entry] boot failed", err);
  // Surface a visible error so a human scrubbing the preview sees it immediately.
  document.body.innerHTML = `<pre style="color:#f55;background:#111;padding:16px;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`;
});
