import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

export interface FilmServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Serves packages/renderer/public (film.html, preview.html, film-bundle.js)
 * plus one extra root (manifest.json + scene assets for the job being rendered).
 * This is the local stand-in for FILM_HOST (§4.7 of the plan) in Phase 0.
 */
export function startFilmServer(extraRoot: string, port = 4100): Promise<FilmServer> {
  const publicRoot = path.join(__dirname, "..", "public");

  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const candidates = [path.join(publicRoot, reqPath), path.join(extraRoot, reqPath)];

    for (const filePath of candidates) {
      const resolved = path.resolve(filePath);
      const allowedRoots = [path.resolve(publicRoot), path.resolve(extraRoot)];
      if (!allowedRoots.some((root) => resolved.startsWith(root))) continue;
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        const ext = path.extname(resolved);
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        fs.createReadStream(resolved).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
