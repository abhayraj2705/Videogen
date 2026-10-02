import Link from "next/link";
import { Clock, CreditCard, Layers } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import type { CreateJobBlock } from "@/lib/api/jobs";
import { BILLING_ENABLED } from "@/lib/features";

/** Dedicated UI for POST /api/jobs 402 / 429 responses on /new. */
export function CreateJobBlockAlert({ block }: { block: CreateJobBlock }) {
  if (block.kind === "insufficient_credits") {
    return (
      <Alert variant="destructive" role="alert">
        <CreditCard aria-hidden />
        <AlertTitle>You&apos;re out of credits</AlertTitle>
        <AlertDescription>
          <p>This video needs more credits than you have left. Top up or upgrade to keep going — your settings stay as they are.</p>
          {BILLING_ENABLED && (
            <Link href="/billing" className={buttonVariants({ size: "sm", className: "mt-2" })}>
              Get more credits
            </Link>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (block.kind === "too_many_active_jobs") {
    return (
      <Alert role="alert" className="border-warning/40 [&>svg]:text-warning">
        <Layers aria-hidden />
        <AlertTitle>Too many videos in progress</AlertTitle>
        <AlertDescription>
          <p>Wait for one of your current videos to finish (or cancel one), then try again.</p>
          <Link href="/dashboard?tab=in_progress" className={buttonVariants({ size: "sm", variant: "secondary", className: "mt-2" })}>
            See videos in progress
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  if (block.kind === "rate_limited") {
    return (
      <Alert role="alert" className="border-warning/40 [&>svg]:text-warning">
        <Clock aria-hidden />
        <AlertTitle>Slow down a little</AlertTitle>
        <AlertDescription>You&apos;ve started a lot of videos in a short time. Wait a minute and try again.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>Couldn&apos;t start your video</AlertTitle>
      <AlertDescription>{block.message}</AlertDescription>
    </Alert>
  );
}
