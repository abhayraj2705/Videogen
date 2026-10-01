import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicShare } from "@/lib/api/public-share";
import { PublicPlayer } from "@/components/share/public-player";

export const metadata: Metadata = { robots: { index: false } };

/** Bare player for the twitter:player card iframe. */
export default async function EmbedPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const result = await getPublicShare(shareId);
  if (result.kind !== "ok" || result.share.renders.length === 0) notFound();
  return (
    <main className="flex min-h-screen items-center justify-center bg-black">
      <PublicPlayer renders={result.share.renders} title={result.share.title} bare />
    </main>
  );
}
