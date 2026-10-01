import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Clapperboard, ExternalLink } from "lucide-react";
import { FORMAT_DIMENSIONS } from "@/lib/formats";
import { getPublicShare, type PublicRender } from "@/lib/api/public-share";
import { SITE_URL } from "@/lib/api/base";
import { buttonVariants } from "@/components/ui/button";
import { PublicPlayer } from "@/components/share/public-player";

type Params = { params: Promise<{ shareId: string }> };

function primaryRender(renders: PublicRender[]): PublicRender | undefined {
  return renders.find((r) => r.format === "16:9") ?? renders[0];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** W9 rich previews: OG video + image, Twitter player card pointing at the bare /embed page. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shareId } = await params;
  const result = await getPublicShare(shareId);
  if (result.kind !== "ok") {
    return { title: "Video not available — SiteReel", robots: { index: false } };
  }
  const { share } = result;
  const r = primaryRender(share.renders);
  const pageUrl = `${SITE_URL}/v/${shareId}`;
  const title = `${share.title} — made with SiteReel`;
  const description = `A launch video for ${hostOf(share.sourceUrl)}, generated from the website in minutes.`;
  const dims = r ? FORMAT_DIMENSIONS[r.format] : { width: 1920, height: 1080 };

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      type: "video.other",
      url: pageUrl,
      title,
      description,
      siteName: "SiteReel",
      images: r ? [{ url: r.posterUrl, width: dims.width, height: dims.height, alt: share.title }] : undefined,
      videos: r ? [{ url: r.videoUrl, secureUrl: r.videoUrl.startsWith("https://") ? r.videoUrl : undefined, type: "video/mp4", width: dims.width, height: dims.height }] : undefined,
    },
    twitter: r
      ? {
          card: "player",
          title,
          description,
          images: [r.posterUrl],
          players: [{ playerUrl: `${pageUrl}/embed`, streamUrl: r.videoUrl, width: Math.min(dims.width, 1280), height: Math.round(Math.min(dims.width, 1280) * (dims.height / dims.width)) }],
        }
      : { card: "summary", title, description },
  };
}

export default async function PublicSharePage({ params }: Params) {
  const { shareId } = await params;
  const result = await getPublicShare(shareId);
  if (result.kind === "not_found") notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Clapperboard className="size-5 text-primary" aria-hidden /> SiteReel
          </Link>
          <Link href="/" className={buttonVariants({ size: "sm" })}>
            Make yours free
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        {result.kind === "error" ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-16 text-center">
            <p className="font-medium">This video can&apos;t be loaded right now</p>
            <p className="max-w-sm text-sm text-muted-foreground">It&apos;s probably temporary. Refresh the page in a moment.</p>
            <Link href={`/v/${shareId}`} className={buttonVariants({ variant: "secondary" })}>
              Try again
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{result.share.title}</h1>
              <a
                href={result.share.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                {hostOf(result.share.sourceUrl)} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
            {result.share.renders.length > 0 ? (
              <PublicPlayer renders={result.share.renders} title={result.share.title} />
            ) : (
              <p className="rounded-xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">This video is still being prepared.</p>
            )}
          </>
        )}

        <section className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Made with SiteReel</p>
          <p className="text-balance text-xl font-semibold tracking-tight">Turn your website into a launch video — in minutes.</p>
          <Link href="/" className={buttonVariants({ size: "lg" })}>
            Make yours <ArrowRight className="size-4" aria-hidden />
          </Link>
          <p className="text-xs text-muted-foreground">
            Seen something that shouldn&apos;t be here?{" "}
            <Link href="/legal/acceptable-use#takedown" className="underline underline-offset-4 hover:text-foreground">
              Request a takedown
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
