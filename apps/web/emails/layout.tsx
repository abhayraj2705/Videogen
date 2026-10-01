import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

/** Shared shell for transactional emails. Email clients need inline styles — no Tailwind here. */
export const colors = {
  bg: "#0f1014",
  card: "#17181d",
  text: "#f2f2f5",
  muted: "#a3a4ad",
  primary: "#9b7bff",
  primaryText: "#140f24",
  border: "#2a2b31",
};

export function EmailLayout({ preview, children, siteUrl }: { preview: string; children: ReactNode; siteUrl: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.bg, margin: 0, padding: "32px 0", fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" }}>
        <Container style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px" }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>
            <span style={{ color: colors.primary }}>◧</span> SiteReel
          </Text>
          <Section style={{ backgroundColor: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 28 }}>{children}</Section>
          <Hr style={{ borderColor: colors.border, margin: "24px 0 12px" }} />
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: "18px", margin: 0 }}>
            You&apos;re getting this because you made a video on SiteReel.{" "}
            <Link href={`${siteUrl}/settings`} style={{ color: colors.muted, textDecoration: "underline" }}>
              Email settings
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const buttonStyle = {
  backgroundColor: colors.primary,
  color: colors.primaryText,
  borderRadius: 8,
  padding: "12px 20px",
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
} as const;
