import { test, expect } from "@playwright/test";

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

async function getMagicLink(toEmail: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const list = (await listRes.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const match = list.messages.find((m) => m.To.some((to) => to.Address === toEmail));
    if (match) {
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const msg = (await msgRes.json()) as { Text: string };
      const linkMatch = /(http:\/\/[^\s)]+\/auth\/v1\/verify[^\s)]+)/.exec(msg.Text);
      if (linkMatch) return linkMatch[1]!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic-link email arrived for ${toEmail} within 10s`);
}

/**
 * The slow, full version: runs the real pipeline to a finished, playable
 * video — the plan's actual Phase 5 exit criterion ("a new user can go from
 * landing page to downloaded MP4 ... without help"). Kept separate from
 * signup-create-pipeline.spec.ts so a quick CI run can skip straight past
 * this one (grep -v) while a nightly/pre-release run exercises it in full.
 */
test("full journey: signup → create → approve → playable result", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `e2e-full-${Date.now()}@sitereel.dev`;

  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Send magic link" }).click();

  const magicLink = await getMagicLink(email);
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await page.goto("/new");
  await page.getByPlaceholder("https://yourproduct.com").fill("https://example.com");
  await page.getByLabel(/own this site/).check();
  await page.getByRole("button", { name: "Generate video" }).click();
  await expect(page).toHaveURL(/\/videos\/[0-9a-f-]+/, { timeout: 15_000 });

  // Review gate (reviewBeforeRender defaults on in the /new form).
  const approveButton = page.getByRole("button", { name: "Approve & render" });
  await expect(approveButton).toBeVisible({ timeout: 60_000 });
  await approveButton.click();

  // Voice -> build -> QA -> render -> encode, for real.
  await expect(page.locator("video")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Download MP4" })).toBeVisible();
});
