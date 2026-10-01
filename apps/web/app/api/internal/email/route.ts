import { timingSafeEqual } from "node:crypto";
import { createElement } from "react";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sendEmail } from "@/lib/email/send";
import VideoReadyEmail from "@/emails/video-ready";
import NeedsInputEmail from "@/emails/needs-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Worker → web: render and send a transactional email.
 * Auth: `x-internal-secret: $INTERNAL_API_SECRET` (or `Authorization: Bearer …`).
 * Body: { template: "video-ready" | "needs-input", to, jobId, domain, … }.
 * Links are built here from NEXT_PUBLIC_SITE_URL so the worker doesn't need to know web routes.
 */
const Body = z.discriminatedUnion("template", [
  z.object({
    template: z.literal("video-ready"),
    to: z.string().email(),
    jobId: z.string().uuid(),
    domain: z.string().min(1).max(253),
    posterUrl: z.string().url().optional(),
  }),
  z.object({
    template: z.literal("needs-input"),
    to: z.string().email(),
    jobId: z.string().uuid(),
    domain: z.string().min(1).max(253),
    reason: z.string().max(64).optional(),
  }),
]);

function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("x-internal-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!authorized(req, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  const body = parsed.data;

  const result =
    body.template === "video-ready"
      ? await sendEmail({
          to: body.to,
          subject: `Your ${body.domain} video is ready`,
          react: createElement(VideoReadyEmail, { domain: body.domain, videoUrl: `${SITE_URL}/videos/${body.jobId}`, posterUrl: body.posterUrl, siteUrl: SITE_URL }),
        })
      : await sendEmail({
          to: body.to,
          subject: `We need your help to finish your ${body.domain} video`,
          react: createElement(NeedsInputEmail, { domain: body.domain, actionUrl: `${SITE_URL}/videos/${body.jobId}/needs-input`, reason: body.reason, siteUrl: SITE_URL }),
        });

  if (result.sent) return NextResponse.json({ ok: true, id: result.id });
  if (result.reason === "not_configured") return NextResponse.json({ ok: true, skipped: "resend_not_configured" }, { status: 202 });
  return NextResponse.json({ error: "send_failed", detail: result.error }, { status: 502 });
}
