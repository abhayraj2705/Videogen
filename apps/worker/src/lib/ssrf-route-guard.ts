import type { BrowserContext } from "playwright";
import { resolvePublicAddresses, SsrfBlockedError, type ResolvedAddress } from "@sitereel/shared";

const DECISION_TTL_MS = 30_000;

/**
 * DNS pinning for Chromium. Chromium does its own DNS resolution, so we can't
 * hand it an undici dispatcher the way ssrfSafeFetch pins plain fetches.
 * Instead the crawl pre-resolves + validates the hosts it will navigate
 * (target host, its www/apex twin) and passes `--host-resolver-rules` at
 * launch: Chromium then dials exactly those validated IPs for those
 * hostnames, keeping SNI/Host intact, so a rebinding DNS answer can't swap in
 * a private address between our check and Chromium's connect.
 *
 * Returns the launch flag (or null if nothing could be pinned) and the
 * resolved addresses per host.
 */
export async function buildHostResolverRules(
  hosts: string[],
): Promise<{ arg: string | null; pinned: Map<string, ResolvedAddress[]> }> {
  const pinned = new Map<string, ResolvedAddress[]>();
  for (const host of new Set(hosts)) {
    try {
      pinned.set(host, await resolvePublicAddresses(host));
    } catch (err) {
      // A twin host that doesn't resolve is fine; a blocked one is simply not pinned (the route guard will refuse it).
      if (!(err instanceof SsrfBlockedError)) throw err;
    }
  }
  const rules = Array.from(pinned.entries())
    .filter(([host]) => !/^[\d.]+$|:/.test(host)) // IP literals need no mapping
    .map(([host, addrs]) => {
      const a = addrs[0]!;
      return `MAP ${host} ${a.family === 6 ? `[${a.address}]` : a.address}`;
    });
  return { arg: rules.length > 0 ? `--host-resolver-rules=${rules.join(", ")}` : null, pinned };
}

/** The apex/www twin of a hostname (redirects between the two are the most common first hop). */
export function hostTwins(hostname: string): string[] {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return [hostname];
  return hostname.startsWith("www.") ? [hostname, hostname.slice(4)] : [hostname, `www.${hostname}`];
}

/**
 * `ssrfSafeFetch` protects plain HTTP calls, but Playwright's browser does its
 * own DNS resolution and redirect-following — neither goes through our fetch.
 * This route handler re-validates every request's scheme and hostname
 * (navigations, redirects, subresources) before Chromium may open the
 * connection. Hosts pinned via --host-resolver-rules are trusted as
 * validated; for other (third-party) hosts the check is per-host with a short
 * TTL — Chromium still resolves those itself, so a residual rebinding window
 * remains for third-party subresources only (the crawl never reads their
 * responses back as facts).
 */
export async function installSsrfGuard(context: BrowserContext, opts: { pinnedHosts?: Iterable<string> } = {}): Promise<void> {
  const pinnedHosts = new Set(opts.pinnedHosts ?? []);
  const decisions = new Map<string, { safe: boolean; at: number }>();

  await context.route("**/*", async (route) => {
    let url: URL;
    try {
      url = new URL(route.request().url());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      // data:/blob: never hit the network; anything else (file:, ftp:, chrome:) is refused.
      if (url.protocol === "data:" || url.protocol === "blob:") await route.continue();
      else await route.abort("blockedbyclient");
      return;
    }
    if (url.username || url.password) {
      await route.abort("blockedbyclient");
      return;
    }

    const hostname = url.hostname;
    if (pinnedHosts.has(hostname)) {
      await route.continue();
      return;
    }

    const cached = decisions.get(hostname);
    let safe: boolean;
    if (cached && Date.now() - cached.at < DECISION_TTL_MS) {
      safe = cached.safe;
    } else {
      try {
        await resolvePublicAddresses(hostname);
        safe = true;
      } catch (err) {
        safe = false;
        if (!(err instanceof SsrfBlockedError)) {
          await route.abort("failed").catch(() => undefined);
          return;
        }
      }
      decisions.set(hostname, { safe, at: Date.now() });
    }

    if (safe) await route.continue();
    else await route.abort("blockedbyclient");
  });
}
