import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, buttonStyle, colors } from "./layout";

export interface NeedsInputEmailProps {
  domain: string;
  /** Link to /videos/:id/needs-input */
  actionUrl: string;
  reason?: "blocked" | "timeout" | "empty" | string;
  siteUrl: string;
}

const REASONS: Record<string, string> = {
  blocked: "the site blocked our browser (common with bot protection)",
  timeout: "the site took too long to respond",
  empty: "we couldn't find enough content on the page",
};

/** "We need your help" (Phase 5 email) — sent when a job lands in needs_input. */
export default function NeedsInputEmail({ domain, actionUrl, reason, siteUrl }: NeedsInputEmailProps) {
  const why = (reason && REASONS[reason]) ?? "something stopped us from reading it";
  return (
    <EmailLayout preview={`We need a few screenshots to finish your ${domain} video`} siteUrl={siteUrl}>
      <Heading as="h1" style={{ color: colors.text, fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>
        We need your help with {domain}
      </Heading>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: "22px", margin: "0 0 12px" }}>
        We couldn&apos;t read your site automatically — {why}.
      </Text>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: "22px", margin: "0 0 20px" }}>
        Upload 2–6 screenshots and a short description, and we&apos;ll pick up right where we left off. No extra credits needed.
      </Text>
      <Button href={actionUrl} style={buttonStyle}>
        Upload screenshots
      </Button>
    </EmailLayout>
  );
}

NeedsInputEmail.PreviewProps = {
  domain: "notely.app",
  actionUrl: "http://localhost:3000/videos/00000000-0000-0000-0000-000000000000/needs-input",
  reason: "blocked",
  siteUrl: "http://localhost:3000",
} satisfies NeedsInputEmailProps;
