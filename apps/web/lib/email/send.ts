import "server-only";
import type { ReactElement } from "react";
import { render } from "@react-email/render";
import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  react: ReactElement;
}

export type SendEmailResult = { sent: true; id: string | null } | { sent: false; reason: "not_configured" | "error"; error?: string };

let client: Resend | null = null;
function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client ??= new Resend(key);
  return client;
}

/**
 * Renders a React Email template and sends it through Resend. Without
 * RESEND_API_KEY it's a logged no-op (local dev / CI), so callers never need
 * to special-case missing credentials.
 */
export async function sendEmail({ to, subject, react }: SendEmailInput): Promise<SendEmailResult> {
  const r = resend();
  if (!r) {
    console.info(`[email] RESEND_API_KEY unset — not sending "${subject}" to ${to}`);
    return { sent: false, reason: "not_configured" };
  }
  try {
    const [html, text] = await Promise.all([render(react), render(react, { plainText: true })]);
    const from = process.env.EMAIL_FROM ?? "SiteReel <hello@sitereel.app>";
    const { data, error } = await r.emails.send({ from, to, subject, html, text });
    if (error) {
      console.error(`[email] Resend rejected "${subject}":`, error.message);
      return { sent: false, reason: "error", error: error.message };
    }
    return { sent: true, id: data?.id ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] failed to send "${subject}":`, message);
    return { sent: false, reason: "error", error: message };
  }
}
