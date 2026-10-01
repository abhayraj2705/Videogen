"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { createJob, previewUrl } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OptionCardGroup } from "@/components/ui/option-card-group";
import type { AspectFormat, JobOptions, Tone } from "@sitereel/shared";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

const FORMAT_OPTIONS: { value: AspectFormat; label: string; description: string }[] = [
  { value: "16:9", label: "16:9", description: "YouTube, landing page" },
  { value: "9:16", label: "9:16", description: "Reels, Shorts, Stories" },
  { value: "1:1", label: "1:1", description: "Feed post" },
];

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "clean", label: "Clean" },
  { value: "playful", label: "Playful" },
  { value: "cinematic", label: "Cinematic" },
  { value: "app-store", label: "App Store" },
];

function NewVideoForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(searchParams.get("url") ?? "");
  const [primaryFormat, setPrimaryFormat] = useState<AspectFormat>("16:9");
  const [alsoOtherFormats, setAlsoOtherFormats] = useState(false);
  const [lengthSec, setLengthSec] = useState<JobOptions["lengthSec"]>(20);
  const [tone, setTone] = useState<Tone>("clean");
  const [voiceLanguage, setVoiceLanguage] = useState<"en" | "hi">("en");
  const [noVoiceover, setNoVoiceover] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const [reviewBeforeRender, setReviewBeforeRender] = useState(true);
  const [consent, setConsent] = useState(false);

  const normalized = normalizeUrl(url);
  const debouncedUrl = useDebounced(normalized, 600);

  const previewQuery = useQuery({
    queryKey: ["url-preview", debouncedUrl],
    queryFn: () => previewUrl(debouncedUrl!),
    enabled: !!debouncedUrl,
    retry: false,
  });

  const formats: AspectFormat[] = alsoOtherFormats
    ? ["16:9", "9:16", "1:1"]
    : [primaryFormat];

  const createJobMutation = useMutation({
    mutationFn: () => {
      const options: JobOptions = {
        formats,
        lengthSec,
        tone,
        voiceLanguage,
        voiceId: "default",
        noVoiceover,
        musicOn,
        musicMood: "upbeat",
        reviewBeforeRender,
      };
      return createJob({ url: normalized!, options });
    },
    onSuccess: (job) => {
      toast.success(`Started on ${job.domain}`);
      router.push(`/videos/${job.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit = !!normalized && consent && !createJobMutation.isPending;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New video</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Website</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="https://yourproduct.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={url.length > 0 && !normalized}
          />
          {url.length > 0 && !normalized && <p className="text-xs text-destructive">That doesn&apos;t look like a valid URL.</p>}
          {debouncedUrl && previewQuery.isLoading && <p className="text-xs text-muted-foreground">Checking…</p>}
          {debouncedUrl && previewQuery.data && (
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              {previewQuery.data.favicon && (
                // eslint-disable-next-line @next/next/no-img-element -- external favicon, arbitrary host
                <img src={previewQuery.data.favicon} alt="" className="h-8 w-8 rounded" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{previewQuery.data.title ?? debouncedUrl}</p>
                <p className="text-xs text-muted-foreground">
                  {previewQuery.data.reachable ? "✓ reachable" : `⚠ unreachable (${previewQuery.data.status ?? "network error"})`}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Format &amp; length</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Format</Label>
            <OptionCardGroup options={FORMAT_OPTIONS} value={primaryFormat} onChange={setPrimaryFormat} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={alsoOtherFormats} onChange={(e) => setAlsoOtherFormats(e.target.checked)} />
              Also make the other two formats (+1 credit each)
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Length</Label>
            <OptionCardGroup
              options={[
                { value: "15", label: "15s" },
                { value: "20", label: "20s" },
                { value: "30", label: "30s" },
              ]}
              value={String(lengthSec)}
              onChange={(v) => setLengthSec(Number(v) as JobOptions["lengthSec"])}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Tone &amp; voice</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Tone</Label>
            <OptionCardGroup options={TONE_OPTIONS} value={tone} onChange={setTone} columns={4} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="voice-language">Voice language</Label>
            <Select id="voice-language" value={voiceLanguage} onChange={(e) => setVoiceLanguage(e.target.value as "en" | "hi")} className="max-w-48">
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noVoiceover} onChange={(e) => setNoVoiceover(e.target.checked)} />
            No voiceover (music + captions only)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={musicOn} onChange={(e) => setMusicOn(e.target.checked)} />
            Background music
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advanced</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reviewBeforeRender} onChange={(e) => setReviewBeforeRender(e.target.checked)} />
            Review the script before rendering
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            I own this site or have permission to promote it.
          </label>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Cost: {formats.length} credit{formats.length > 1 ? "s" : ""}</span>
            <Button disabled={!canSubmit} onClick={() => createJobMutation.mutate()}>
              {createJobMutation.isPending ? "Starting…" : "Generate video"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewVideoPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-card" />}>
      <NewVideoForm />
    </Suspense>
  );
}
