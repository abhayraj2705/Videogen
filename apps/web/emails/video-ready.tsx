import { Button, Heading, Img, Text } from "@react-email/components";
import { EmailLayout, buttonStyle, colors } from "./layout";

export interface VideoReadyEmailProps {
  domain: string;
  videoUrl: string;
  posterUrl?: string;
  siteUrl: string;
}

/** "Your video is ready" (Phase 5 email). */
export default function VideoReadyEmail({ domain, videoUrl, posterUrl, siteUrl }: VideoReadyEmailProps) {
  return (
    <EmailLayout preview={`Your ${domain} video is ready to watch and download`} siteUrl={siteUrl}>
      <Heading as="h1" style={{ color: colors.text, fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>
        Your video is ready 🎬
      </Heading>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: "22px", margin: "0 0 20px" }}>
        We turned <strong style={{ color: colors.text }}>{domain}</strong> into a launch video. Watch it, grab the MP4 in every format, and share
        a public link.
      </Text>
      {posterUrl && <Img src={posterUrl} alt={`Poster frame of your ${domain} video`} width="464" style={{ width: "100%", borderRadius: 8, margin: "0 0 20px" }} />}
      <Button href={videoUrl} style={buttonStyle}>
        Watch your video
      </Button>
    </EmailLayout>
  );
}

VideoReadyEmail.PreviewProps = {
  domain: "notely.app",
  videoUrl: "http://localhost:3000/videos/00000000-0000-0000-0000-000000000000",
  siteUrl: "http://localhost:3000",
} satisfies VideoReadyEmailProps;
