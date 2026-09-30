import dns from "node:dns/promises";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

interface V4Range {
  base: number;
  bits: number;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inV4Range(ip: string, range: V4Range): boolean {
  const ipInt = ipv4ToInt(ip);
  const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0;
  return (ipInt & mask) === (range.base & mask);
}

// Private, loopback, link-local and cloud-metadata ranges — everything a crawler
// or the URL-preview endpoint must never be allowed to reach (§8.1 security checklist).
const BLOCKED_V4_RANGES: V4Range[] = [
  { base: ipv4ToInt("0.0.0.0"), bits: 8 },
  { base: ipv4ToInt("10.0.0.0"), bits: 8 },
  { base: ipv4ToInt("100.64.0.0"), bits: 10 }, // CGNAT
  { base: ipv4ToInt("127.0.0.0"), bits: 8 },
  { base: ipv4ToInt("169.254.0.0"), bits: 16 }, // link-local; covers 169.254.169.254 (cloud metadata)
  { base: ipv4ToInt("172.16.0.0"), bits: 12 },
  { base: ipv4ToInt("192.168.0.0"), bits: 16 },
  { base: ipv4ToInt("192.0.0.0"), bits: 24 },
  { base: ipv4ToInt("198.18.0.0"), bits: 15 },
  { base: ipv4ToInt("224.0.0.0"), bits: 4 }, // multicast
  { base: ipv4ToInt("240.0.0.0"), bits: 4 }, // reserved
];

function isBlockedV6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.slice("::ffff:".length);
    if (net.isIPv4(v4)) return isBlockedIp(v4);
  }
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return BLOCKED_V4_RANGES.some((r) => inV4Range(ip, r));
  if (net.isIPv6(ip)) return isBlockedV6(ip);
  return true; // unparseable — refuse rather than guess
}

/** Resolves every A/AAAA record for a hostname and rejects if any one of them is blocked. */
export async function assertResolvesToPublicIp(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SsrfBlockedError(`Blocked literal IP: ${hostname}`);
    return [hostname];
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}: ${(err as Error).message}`);
  }
  if (records.length === 0) throw new SsrfBlockedError(`No DNS records for ${hostname}`);

  const blocked = records.filter((r) => isBlockedIp(r.address));
  if (blocked.length > 0) {
    throw new SsrfBlockedError(`${hostname} resolves to a blocked address: ${blocked.map((b) => b.address).join(", ")}`);
  }
  return records.map((r) => r.address);
}

export interface SsrfSafeFetchOptions extends RequestInit {
  maxRedirects?: number;
  timeoutMs?: number;
}

/**
 * Fetches a URL after verifying it (and every hostname in its redirect chain)
 * resolves only to public IPs. Redirects are followed manually — `fetch`'s
 * built-in redirect following would skip this check on every hop after the first.
 */
export async function ssrfSafeFetch(url: string, opts: SsrfSafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = 5, timeoutMs = 10_000, ...init } = opts;

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SsrfBlockedError(`Unsupported protocol: ${parsed.protocol}`);
    }
    await assertResolvesToPublicIp(parsed.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, { ...init, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      const next = new URL(res.headers.get("location")!, currentUrl).toString();
      currentUrl = next;
      continue;
    }
    return res;
  }
  throw new SsrfBlockedError(`Too many redirects fetching ${url}`);
}
