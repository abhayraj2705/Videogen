import type { EmailTemplate, InternalEmailRequest, UserSettings } from "./phase6-contracts.js";

export interface EmailConfig {
  /** Base URL of the web app (WEB_URL, falling back to WEB_ORIGIN). */
  webUrl?: string | null;
  internalSecret?: string | null;
}

export type EmailSkipReason = "no_secret" | "no_web_url" | "no_recipient" | "opted_out";

/**
 * Contract "Emails": sent on `done` and `needs_input` unless the user turned
 * emailNotifications off. Unconfigured environments (no INTERNAL_API_SECRET /
 * WEB_URL) skip silently — local dev and CI never send mail.
 */
export function emailSkipReason(config: EmailConfig, to: string | null | undefined, settings: UserSettings | null | undefined): EmailSkipReason | null {
  if (!config.internalSecret) return "no_secret";
  if (!config.webUrl) return "no_web_url";
  if (!to) return "no_recipient";
  if (settings?.emailNotifications === false) return "opted_out";
  return null;
}

export type SendEmailResult = { sent: true } | { sent: false; skipped: EmailSkipReason } | { sent: false; error: string };

/**
 * POSTs to the web app's internal email route. Never throws: an email outage
 * must not fail (or retry) the pipeline job that triggered it.
 */
export async function sendJobEmail(
  config: EmailConfig,
  input: { template: EmailTemplate; to: string | null | undefined; settings: UserSettings | null | undefined; data: InternalEmailRequest["data"] },
  fetchImpl: typeof fetch = fetch,
): Promise<SendEmailResult> {
  const skipped = emailSkipReason(config, input.to, input.settings);
  if (skipped) return { sent: false, skipped };
  const body: InternalEmailRequest = { template: input.template, to: input.to!, data: input.data };
  try {
    const res = await fetchImpl(`${config.webUrl!.replace(/\/+$/, "")}/api/internal/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": config.internalSecret! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { sent: false, error: `HTTP ${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
