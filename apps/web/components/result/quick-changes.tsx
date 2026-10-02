"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coins, Loader2, Sparkles } from "lucide-react";
import type { Job } from "@sitereel/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { getCreditBalance } from "@/lib/api/jobs";
import { isApiError } from "@/lib/api/http";
import { quickChange, quickChangeCost, type QuickChangeBody, type QuickChangeLength, type QuickChangeTone } from "@/lib/api/phase6";
import { VOICES } from "@/lib/voices";
import { BILLING_ENABLED } from "@/lib/features";

const TONES: { value: QuickChangeTone; label: string }[] = [
  { value: "clean", label: "Clean" },
  { value: "playful", label: "Playful" },
  { value: "cinematic", label: "Cinematic" },
  { value: "app-store", label: "App Store" },
];
const LENGTHS: QuickChangeLength[] = [15, 30, 45, 60];

/**
 * W7 quick changes: voice (free — re-voice + re-render the same script),
 * tone or length (1 credit — re-plans the script, then auto-approves).
 */
export function QuickChanges({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const [voiceId, setVoiceId] = useState(job.options.voiceId);
  const [tone, setTone] = useState<QuickChangeTone>(job.options.tone);
  const [length, setLength] = useState<string>("");
  const credits = useQuery({ queryKey: ["credits"], queryFn: getCreditBalance, staleTime: 30_000, retry: false });

  const body: QuickChangeBody = {
    ...(voiceId !== job.options.voiceId ? { voiceId } : {}),
    ...(tone !== job.options.tone ? { tone } : {}),
    ...(length ? { lengthSec: Number(length) as QuickChangeLength } : {}),
  };
  const changed = Object.keys(body).length > 0;
  const cost = quickChangeCost(body);
  const short = typeof credits.data === "number" && credits.data < cost;

  const mutation = useMutation({
    mutationFn: () => quickChange(job.id, body),
    onSuccess: () => {
      toast.success(cost > 0 ? "Re-planning your video with the new settings…" : "Re-voicing and re-rendering…");
      void queryClient.invalidateQueries({ queryKey: ["job", job.id] });
      void queryClient.invalidateQueries({ queryKey: ["credits"] });
      setLength("");
    },
    onError: (err) => {
      if (isApiError(err) && (err.status === 402 || err.code === "insufficient_credits")) toast.error("Not enough credits for this change.");
      else toast.error(`Couldn't apply the change: ${err instanceof Error ? err.message : "unknown error"}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" aria-hidden /> Quick changes
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="qc-voice" className="text-xs text-muted-foreground">
              Voice <span className="text-success">· free</span>
            </label>
            <Select id="qc-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={job.options.noVoiceover}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.description}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="qc-tone" className="text-xs text-muted-foreground">
              Tone <span>· 1 credit</span>
            </label>
            <Select id="qc-tone" value={tone} onChange={(e) => setTone(e.target.value as QuickChangeTone)}>
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="qc-length" className="text-xs text-muted-foreground">
              Length <span>· 1 credit</span>
            </label>
            <Select id="qc-length" value={length} onChange={(e) => setLength(e.target.value)}>
              <option value="">Keep {job.options.lengthSec}s</option>
              {LENGTHS.filter((l) => l !== job.options.lengthSec).map((l) => (
                <option key={l} value={l}>
                  {l} seconds
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
            <Coins className="size-4 text-primary" aria-hidden />
            {!changed ? "Pick a change to see its cost." : cost === 0 ? "Free — same script, new voice." : `Costs ${cost} credit — the script is re-planned.`}
            {typeof credits.data === "number" && <span className="font-mono text-xs">({credits.data} left)</span>}
          </p>
          <div className="flex items-center gap-2">
            {short && BILLING_ENABLED && (
              <Link href="/billing" className="text-sm text-primary underline-offset-4 hover:underline">
                Buy credits
              </Link>
            )}
            <Button onClick={() => mutation.mutate()} disabled={!changed || short || mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
              Apply change
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
