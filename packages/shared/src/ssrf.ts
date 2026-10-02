import dns from "node:dns/promises";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

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

function intToIpv4(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
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
  { base: ipv4ToInt("192.0.2.0"), bits: 24 }, // TEST-NET-1
  { base: ipv4ToInt("198.18.0.0"), bits: 15 },
  { base: ipv4ToInt("198.51.100.0"), bits: 24 }, // TEST-NET-2
  { base: ipv4ToInt("203.0.113.0"), bits: 24 }, // TEST-NET-3
  { base: ipv4ToInt("224.0.0.0"), bits: 4 }, // multicast
  { base: ipv4ToInt("240.0.0.0"), bits: 4 }, // reserved + broadcast
];

/** Expands any valid IPv6 literal (including embedded dotted-quad forms) into 8 16-bit groups. */
function parseIpv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);

  // Trailing embedded IPv4 ("::ffff:1.2.3.4", "64:ff9b::1.2.3.4") -> two hex groups.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!net.isIPv4(tail)) return null;
    const v = ipv4ToInt(tail);
    addr = `${addr.slice(0, lastColon + 1)}${((v >>> 16) & 0xffff).toString(16)}:${(v & 0xffff).toString(16)}`;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

function embeddedV4(groups: number[], hiIndex: number): string {
  return intToIpv4(((groups[hiIndex]! << 16) | groups[hiIndex + 1]!) >>> 0);
}

function isBlockedV6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return true;
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (allZeroUntil(8)) return true; // :: unspecified
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1 loopback
  // ::ffff:a.b.c.d (IPv4-mapped) — judge by the wrapped v4 address.
  if (allZeroUntil(5) && g[5] === 0xffff) return isBlockedIp(embeddedV4(g, 6));
  // ::a.b.c.d (deprecated IPv4-compatible) — same.
  if (allZeroUntil(6)) return isBlockedIp(embeddedV4(g, 6));
  // 64:ff9b::/96 NAT64 — a public-looking v6 address that tunnels to a v4 one.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIp(embeddedV4(g, 6));
  // 2002::/16 6to4 — embedded v4 in groups 1..2.
  if (g[0] === 0x2002) return isBlockedIp(embeddedV4(g, 1));
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  if (net.isIPv4(bare)) return BLOCKED_V4_RANGES.some((r) => inV4Range(bare, r));
  if (net.isIPv6(bare)) return isBlockedV6(bare);
  return true; // unparseable — refuse rather than guess
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Overridable resolver — production uses the OS resolver; tests inject a fake one. */
export type SsrfResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultResolver: SsrfResolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Resolves every A/AAAA record for a hostname ONCE and rejects if any one of
 * them is blocked. The returned list is what the caller must connect to —
 * resolving again later (e.g. letting the HTTP client do its own lookup)
 * re-opens the DNS-rebinding window this check exists to close.
 */
export async function resolvePublicAddresses(hostname: string, resolver: SsrfResolver = defaultResolver): Promise<ResolvedAddress[]> {
  const host = stripBrackets(hostname);
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError(`Blocked literal IP: ${host}`);
    return [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  }
  if (host.length === 0) throw new SsrfBlockedError("Empty hostname");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) {
    throw new SsrfBlockedError(`Blocked internal hostname: ${host}`);
  }

  let records: ResolvedAddress[];
  try {
    records = await resolver(host);
  } catch (err) {
    throw new SsrfBlockedError(`DNS resolution failed for ${host}: ${(err as Error).message}`);
  }
  if (records.length === 0) throw new SsrfBlockedError(`No DNS records for ${host}`);

  const blocked = records.filter((r) => isBlockedIp(r.address));
  if (blocked.length > 0) {
    throw new SsrfBlockedError(`${host} resolves to a blocked address: ${blocked.map((b) => b.address).join(", ")}`);
  }
  return records;
}

/** Back-compat wrapper: validates and returns the bare address list. */
export async function assertResolvesToPublicIp(hostname: string): Promise<string[]> {
  const records = await resolvePublicAddresses(hostname);
  return records.map((r) => r.address);
}

/**
 * A `net.connect`-compatible lookup that ignores the hostname it's asked about
 * and answers with the pre-validated addresses. Because the socket still
 * connects *to the hostname* (from undici's point of view), TLS SNI and the
 * Host header are unchanged — only the IP the socket dials is pinned.
 */
export function createPinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  if (addresses.length === 0) throw new SsrfBlockedError("No validated addresses to pin");
  const pinned = addresses.filter((a) => !isBlockedIp(a.address));
  if (pinned.length !== addresses.length) throw new SsrfBlockedError("Refusing to pin a blocked address");
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    const opts = (typeof options === "object" && options !== null ? options : {}) as { all?: boolean; family?: number };
    const candidates = opts.family === 4 || opts.family === 6 ? pinned.filter((a) => a.family === opts.family) : pinned;
    const list = candidates.length > 0 ? candidates : pinned;
    if (opts.all) cb(null, list.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, list[0]!.address, list[0]!.family);
  }) as LookupFunction;
}

/** An undici dispatcher whose every connection dials only the pinned, validated IPs. */
export function createPinnedAgent(addresses: ResolvedAddress[]): Agent {
  return new Agent({
    connect: { lookup: createPinnedLookup(addresses) },
    keepAliveTimeout: 1_000,
    keepAliveMaxTimeout: 1_000,
  });
}

export type SsrfFetchImpl = (url: string, init: Record<string, unknown>) => Promise<Response>;

export interface SsrfSafeFetchOptions extends RequestInit {
  maxRedirects?: number;
  timeoutMs?: number;
  /** Test seam: replaces the DNS resolver. */
  resolver?: SsrfResolver;
  /** Test seam: replaces undici's fetch. Receives `dispatcher` (the pinned Agent) in init. */
  fetchImpl?: SsrfFetchImpl;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Fetches a URL after verifying it (and every hostname in its redirect chain)
 * resolves only to public IPs, then dials exactly the validated IPs (DNS
 * pinning) so a second, attacker-controlled DNS answer can't swap in a private
 * address between the check and the connect. Redirects are followed manually —
 * built-in redirect following would skip this check on every hop after the first.
 */
export async function ssrfSafeFetch(url: string, opts: SsrfSafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = 5, timeoutMs = 10_000, resolver, fetchImpl, signal: outerSignal, ...init } = opts;
  const doFetch: SsrfFetchImpl = fetchImpl ?? ((u, i) => undiciFetch(u, i as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`ssrfSafeFetch timed out after ${timeoutMs}ms`)), timeoutMs);
  outerSignal?.addEventListener("abort", () => controller.abort(outerSignal.reason), { once: true });

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        throw new SsrfBlockedError(`Invalid URL: ${currentUrl}`);
      }
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        throw new SsrfBlockedError(`Unsupported protocol: ${parsed.protocol}`);
      }
      if (parsed.username || parsed.password) {
        throw new SsrfBlockedError("URLs with embedded credentials are not allowed");
      }
      const addresses = await resolvePublicAddresses(parsed.hostname, resolver);
      const dispatcher = createPinnedAgent(addresses);

      const res = await doFetch(currentUrl, { ...init, redirect: "manual", signal: controller.signal, dispatcher });

      if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        await res.body?.cancel().catch(() => undefined);
        currentUrl = new URL(res.headers.get("location")!, currentUrl).toString();
        continue;
      }
      return res;
    }
    throw new SsrfBlockedError(`Too many redirects (> ${maxRedirects}) fetching ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads at most `maxBytes` of a response body as text, cancelling the stream
 * past that point — a hostile or huge page can't balloon server memory.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    if (value.byteLength >= remaining) {
      chunks.push(value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated };
}
