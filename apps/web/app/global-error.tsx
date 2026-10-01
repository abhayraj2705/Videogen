"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Last-resort boundary (replaces the root layout when it throws), so it must
 * render its own <html>/<body> and can't rely on globals.css having loaded —
 * hence inline styles matching the dark tokens.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "oklch(0.14 0.005 270)",
          color: "oklch(0.96 0.005 270)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>SiteReel hit an unexpected error</h1>
          <p style={{ fontSize: 14, color: "oklch(0.7 0.01 270)", margin: "0 0 20px" }}>
            Please try again. If it keeps happening, reload the page.
            {error.digest ? <span style={{ display: "block", fontFamily: "monospace", fontSize: 12, marginTop: 6 }}>Ref: {error.digest}</span> : null}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "oklch(0.72 0.19 295)",
              color: "oklch(0.15 0.02 295)",
              border: 0,
              borderRadius: 8,
              padding: "10px 18px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
