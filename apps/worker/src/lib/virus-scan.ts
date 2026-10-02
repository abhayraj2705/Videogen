import net from "node:net";

/**
 * Upload virus scanning (§8.1 "virus scan for user uploads") against a clamd
 * daemon over its INSTREAM protocol: the file is streamed as length-prefixed
 * chunks and clamd answers "stream: OK" or "stream: <signature> FOUND".
 * No dependency beyond node:net; clamd runs as its own container
 * (infra/docker/compose.prod.yml).
 */

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface VirusScanner {
  scan(data: Buffer): Promise<ScanResult>;
}

const CHUNK_BYTES = 64 * 1024;

/** Parses clamd's reply line. Anything that is neither OK nor FOUND (e.g. "INSTREAM size limit exceeded") is an error. */
export function parseClamdReply(reply: string): ScanResult {
  const line = reply.replace(/\0/g, "").trim();
  if (/^stream: OK$/i.test(line)) return { clean: true };
  const found = /^stream: (.+) FOUND$/i.exec(line);
  if (found) return { clean: false, signature: found[1]! };
  throw new Error(`clamd: unexpected reply "${line.slice(0, 200)}"`);
}

export function createClamdScanner(opts: { host: string; port?: number; timeoutMs?: number }): VirusScanner {
  const port = opts.port ?? 3310;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return {
    scan(data) {
      return new Promise<ScanResult>((resolve, reject) => {
        const socket = net.createConnection({ host: opts.host, port });
        const chunks: Buffer[] = [];
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          fn();
        };
        socket.setTimeout(timeoutMs, () => finish(() => reject(new Error(`clamd: timed out after ${timeoutMs} ms`))));
        socket.on("error", (err) => finish(() => reject(new Error(`clamd: ${err.message}`))));
        socket.on("data", (d) => chunks.push(d));
        socket.on("end", () =>
          finish(() => {
            try {
              resolve(parseClamdReply(Buffer.concat(chunks).toString("utf8")));
            } catch (err) {
              reject(err as Error);
            }
          }),
        );
        socket.on("connect", () => {
          socket.write("zINSTREAM\0");
          for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
            const chunk = data.subarray(offset, offset + CHUNK_BYTES);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(chunk.length, 0);
            socket.write(size);
            socket.write(chunk);
          }
          // A zero-length chunk ends the stream; clamd then replies and closes.
          socket.write(Buffer.alloc(4));
        });
      });
    },
  };
}

/** Scanner from CLAMAV_HOST/CLAMAV_PORT, or null when scanning isn't configured. */
export function getVirusScannerFromEnv(env: { CLAMAV_HOST?: string; CLAMAV_PORT?: number }): VirusScanner | null {
  return env.CLAMAV_HOST ? createClamdScanner({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT }) : null;
}

/**
 * Scans each uploaded object and returns the keys that are safe to use.
 * Infected files are dropped (and reported); a scanner that can't be reached
 * throws, so the queue retries instead of letting unscanned uploads through.
 */
export async function filterCleanUploads(
  keys: readonly string[],
  read: (key: string) => Promise<Buffer>,
  scanner: VirusScanner,
): Promise<{ clean: string[]; infected: { key: string; signature: string }[] }> {
  const clean: string[] = [];
  const infected: { key: string; signature: string }[] = [];
  for (const key of keys) {
    const result = await scanner.scan(await read(key));
    if (result.clean) clean.push(key);
    else infected.push({ key, signature: result.signature });
  }
  return { clean, infected };
}
