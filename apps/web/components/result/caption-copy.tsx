"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { withAuthToken } from "@/lib/api/client";
import { vttToPlainText } from "@/lib/vtt";
import { copyText } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";

async function fetchCaptionText(captionsUrl: string): Promise<string> {
  const res = await fetch(await withAuthToken(captionsUrl));
  if (!res.ok) throw new Error(`captions ${res.status}`);
  return vttToPlainText(await res.text());
}

/** W7 "Share caption": the narration as plain text (from the VTT), with a copy button. */
export function CaptionCopy({ captionsUrl }: { captionsUrl: string }) {
  const q = useQuery({ queryKey: ["caption-text", captionsUrl], queryFn: () => fetchCaptionText(captionsUrl), staleTime: Infinity, retry: 1 });

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Caption text</p>
        <Button
          size="sm"
          variant="secondary"
          disabled={!q.data}
          onClick={async () => {
            if (q.data && (await copyText(q.data))) toast.success("Caption copied");
            else toast.error("Couldn't copy the caption");
          }}
        >
          <Copy aria-hidden /> Copy
        </Button>
      </div>
      {q.isPending && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading captions…
        </p>
      )}
      {q.isError && (
        <p className="text-sm text-muted-foreground">
          Captions aren&apos;t available for this video.{" "}
          <button type="button" className="text-primary underline underline-offset-4" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      )}
      {q.data !== undefined && (
        <p className="max-h-32 overflow-y-auto text-sm text-muted-foreground">{q.data || "This video has no narration (music + captions only)."}</p>
      )}
    </div>
  );
}
