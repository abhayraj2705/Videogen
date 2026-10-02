import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787");
// With STORAGE_DRIVER=s3 the backend 302s media to presigned R2/S3 URLs, so
// those hosts must be allowed for <video>/<img>/<track>. Comma-separated origins.
const mediaOrigins = (process.env.NEXT_PUBLIC_MEDIA_ORIGINS ?? "")
  .split(",")
  .map((s) => originOf(s.trim()))
  .filter((s): s is string => Boolean(s));

// Client-side analytics / error reporting endpoints (no-ops when unset).
const posthogOrigin = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? originOf(process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com")
  : undefined;
// The DSN's host is the ingest origin (https://<key>@oNNN.ingest.sentry.io/<project>).
const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);

// W11 billing: Razorpay Checkout.js (modal iframe + API calls) and Stripe
// (Checkout is a full-page redirect, but Stripe.js / its frames may be used).
const razorpayScript = "https://checkout.razorpay.com";
const razorpayFrames = ["https://api.razorpay.com", "https://checkout.razorpay.com"];
const razorpayConnect = ["https://api.razorpay.com", "https://lumberjack.razorpay.com"];
const stripeScript = "https://js.stripe.com";
const stripeFrames = ["https://js.stripe.com", "https://hooks.stripe.com", "https://checkout.stripe.com"];
const stripeConnect = ["https://api.stripe.com"];

function src(...values: (string | undefined | false)[]): string {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].join(" ");
}

/**
 * §8.1 "CSP on the app". Next.js injects inline bootstrap scripts, so
 * script-src needs 'unsafe-inline' until we move to nonce-based CSP in
 * middleware; 'unsafe-eval' is dev-only (React Refresh).
 */
function buildCsp({ embeddable }: { embeddable: boolean }): string {
  return [
    `default-src 'self'`,
    `script-src ${src("'self'", "'unsafe-inline'", isDev && "'unsafe-eval'", razorpayScript, stripeScript)}`,
    `style-src 'self' 'unsafe-inline'`,
    // URL preview shows arbitrary sites' favicons / OG images, hence https:.
    `img-src ${src("'self'", "data:", "blob:", "https:", apiOrigin, supabaseOrigin, ...mediaOrigins)}`,
    `media-src ${src("'self'", "blob:", apiOrigin, ...mediaOrigins)}`,
    `font-src 'self' data:`,
    `connect-src ${src(
      "'self'",
      apiOrigin,
      supabaseOrigin,
      supabaseOrigin?.replace(/^http/, "ws"),
      isDev && "ws://localhost:*",
      posthogOrigin,
      posthogOrigin?.replace("://", "://*."),
      sentryOrigin,
      ...razorpayConnect,
      ...stripeConnect,
    )}`,
    `worker-src 'self' blob:`,
    `frame-src ${src("'self'", ...razorpayFrames, ...stripeFrames)}`,
    // The share embed player (/v/:shareId/embed) is meant to be iframed anywhere.
    embeddable ? `frame-ancestors *` : `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // Razorpay Checkout may submit to its own origin (UPI / netbanking redirects).
    `form-action ${src("'self'", ...razorpayFrames)}`,
    !isDev && "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

const commonHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const EMBED_PATH = "/v/:shareId/embed";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sitereel/shared"],
  async headers() {
    return [
      {
        // Everything except the embed player: no framing at all.
        source: "/((?!v/[^/]+/embed$).*)",
        headers: [
          ...commonHeaders,
          { key: "Content-Security-Policy", value: buildCsp({ embeddable: false }) },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: EMBED_PATH,
        headers: [
          ...commonHeaders,
          { key: "Content-Security-Policy", value: buildCsp({ embeddable: true }) },
        ],
      },
    ];
  },
};

export default nextConfig;
