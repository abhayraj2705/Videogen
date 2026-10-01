import { test, expect } from "@playwright/test";

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Polls Mailpit (Supabase local's SMTP catch-all) for the magic-link email and extracts its link. */
async function getMagicLink(toEmail: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const list = (await listRes.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const match = list.messages.find((m) => m.To.some((to) => to.Address === toEmail));
    if (match) {
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const msg = (await msgRes.json()) as { Text: string };
      const linkMatch = /(http:\/\/[^\s)]+\/auth\/v1\/verify[^\s)]+)/.exec(msg.Text) ?? /(http:\/\/127\.0\.0\.1:3000[^\s)]+)/.exec(msg.Text);
      if (linkMatch) return linkMatch[1]!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic-link email arrived for ${toEmail} within 10s`);
}

/**
 * §5 Phase 5 deliverable: "Playwright e2e: signup → create → (mock pipeline)
 * → result." No mock pipeline exists yet (Phase 4's queues are the real
 * thing), so this exercises the real crawl/plan/voice/build/qa/render
 * pipeline through a cheap, fast-crawling site, stopping once the live
 * pipeline screen shows real SSE-driven progress rather than waiting for a
 * full render (minutes) on every CI run.
 */
test("sign in via magic link, create a video, see live pipeline progress", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `e2e-${Date.now()}@sitereel.dev`;

  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByText(/Link sent to/)).toBeVisible();

  const magicLink = await getMagicLink(email);
  await page.goto(magicLink);

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await page.goto("/new");
  await page.getByPlaceholder("https://yourproduct.com").fill("https://example.com");
  await page.getByLabel(/own this site/).check();
  await page.getByRole("button", { name: "Generate video" }).click();

  await expect(page).toHaveURL(/\/videos\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(page.getByText("Pipeline")).toBeVisible();
  await expect(page.getByText("Reading your site")).toBeVisible({ timeout: 20_000 });
});
