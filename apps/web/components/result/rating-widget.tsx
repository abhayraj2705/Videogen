"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { rateJob, type Thumbs } from "@/lib/api/share";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DOWN_REASONS = ["Wrong facts", "Off-brand look", "Voice sounds off", "Text hard to read", "Too generic"];

function storageKey(jobId: string) {
  return `sitereel:rated:${jobId}`;
}

/** W7 thumbs rating: POST /api/jobs/:id/rating {thumbs, reason?}. Remembers locally that you rated (per browser). */
export function RatingWidget({ jobId }: { jobId: string }) {
  const [thumbs, setThumbs] = useState<Thumbs | null>(null);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey(jobId))) setDone(true);
    } catch {
      // storage unavailable — just ask again
    }
  }, [jobId]);

  const submit = useMutation({
    mutationFn: (t: Thumbs) => rateJob(jobId, { thumbs: t, ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}) }),
    onSuccess: () => {
      setDone(true);
      try {
        localStorage.setItem(storageKey(jobId), "1");
      } catch {
        // ignore
      }
      toast.success("Thanks for the feedback");
    },
    onError: (err: Error) => toast.error(`Couldn't send your rating: ${err.message}`),
  });

  if (done) {
    return <p className="text-sm text-muted-foreground">Thanks — your rating helps us make better videos.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <p id={`rate-${jobId}`} className="text-sm font-medium">
          How did this video turn out?
        </p>
        <div role="group" aria-labelledby={`rate-${jobId}`} className="flex gap-1">
          {(["up", "down"] as const).map((t) => (
            <Button
              key={t}
              type="button"
              size="icon-sm"
              variant={thumbs === t ? "default" : "secondary"}
              aria-pressed={thumbs === t}
              aria-label={t === "up" ? "Good video" : "Needs work"}
              onClick={() => setThumbs(t)}
              className={cn(thumbs === t && "shadow-none")}
            >
              {t === "up" ? <ThumbsUp aria-hidden /> : <ThumbsDown aria-hidden />}
            </Button>
          ))}
        </div>
      </div>
      {thumbs && (
        <div className="flex flex-col gap-2">
          {thumbs === "down" && (
            <div className="flex flex-wrap gap-1.5">
              {DOWN_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason((prev) => (prev.includes(r) ? prev : prev ? `${prev}; ${r}` : r))}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          <Label htmlFor={`reason-${jobId}`} className="sr-only">
            Reason (optional)
          </Label>
          <Textarea
            id={`reason-${jobId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={thumbs === "up" ? "What did you like? (optional)" : "What should be better? (optional)"}
          />
          <Button size="sm" className="self-end" onClick={() => submit.mutate(thumbs)} disabled={submit.isPending}>
            {submit.isPending && <Loader2 className="animate-spin" aria-hidden />} Send feedback
          </Button>
        </div>
      )}
    </div>
  );
}
