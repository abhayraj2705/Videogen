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

function src(...values: (string | undefined | false)[]): string {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].join(" ");
}

/**
 * §8.1 "CSP on the app". Next.js injects inline bootstrap scripts, so
 * script-src needs 'unsafe-inline' until we move to nonce-based CSP in
 * middleware; 'unsafe-eval' is dev-only (React Refresh).
 */
const csp = [
  `default-src 'self'`,
  `script-src ${src("'self'", "'unsafe-inline'", isDev && "'unsafe-eval'")}`,
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
  )}`,
  `worker-src 'self' blob:`,
  // Billing (Razorpay / Stripe checkout) will need its hosts added to script-src / frame-src / connect-src.
  `frame-src 'self'`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  !isDev && "upgrade-insecure-requests",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sitereel/shared"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
