import type { BrowserContext } from "playwright";
import { assertResolvesToPublicIp, SsrfBlockedError } from "@sitereel/shared";

/**
 * `ssrfSafeFetch` protects plain HTTP calls, but Playwright's browser does its
 * own DNS resolution and redirect-following — neither goes through our fetch.
 * This installs a route handler that re-validates every request's hostname
 * (including same-page redirects and subresource loads) before Chromium is
 * allowed to actually open the connection, so the crawl worker gets the same
 * private-IP/metadata-endpoint protection as `/api/url/preview` (§8.1).
 */
export async function installSsrfGuard(context: BrowserContext): Promise<void> {
  const checked = new Map<string, boolean>();

  await context.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;

    let safe = checked.get(hostname);
    if (safe === undefined) {
      try {
        await assertResolvesToPublicIp(hostname);
        safe = true;
      } catch (err) {
        safe = false;
        if (!(err instanceof SsrfBlockedError)) throw err;
      }
      checked.set(hostname, safe);
    }

    if (safe) await route.continue();
    else await route.abort("blockedbyclient");
  });
}
