"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, AlertTriangle, Coins } from "lucide-react";
import type { AspectFormat, JobOptions, Tone } from "@sitereel/shared";
import { previewUrl } from "@/lib/api/client";
import { classifyCreateJobError, createJobChecked, getCreditBalance, type CreateJobBlock } from "@/lib/api/jobs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { OptionCardGroup } from "@/components/ui/option-card-group";
import { VoicePicker } from "@/components/create/voice-picker";
import { CreateJobBlockAlert } from "@/components/create/create-job-block";
import type { VoiceLanguage } from "@/lib/voices";

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
    const u = new URL(candidate);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

const FORMAT_OPTIONS: { value: AspectFormat; label: string; description: string }[] = [
  { value: "16:9", label: "16:9", description: "YouTube, landing page" },
  { value: "9:16", label: "9:16", description: "Reels, Shorts, Stories" },
  { value: "1:1", label: "1:1", description: "Feed post" },
];

const TONE_OPTIONS: { value: Tone; label: string; description: string }[] = [
  { value: "clean", label: "Clean", description: "Calm, minimal" },
  { value: "playful", label: "Playful", description: "Bouncy, bright" },
  { value: "cinematic", label: "Cinematic", description: "Bold, dramatic" },
  { value: "app-store", label: "App Store", description: "Device-led" },
];

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-6 items-center justify-center rounded-full bg-accent font-mono text-xs text-primary">{n}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export function NewVideoForm({ availableSamples }: { availableSamples: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(searchParams.get("url") ?? "");
  const [primaryFormat, setPrimaryFormat] = useState<AspectFormat>("16:9");
  const [alsoOtherFormats, setAlsoOtherFormats] = useState(false);
  const [lengthSec, setLengthSec] = useState<JobOptions["lengthSec"]>(20);
  const [tone, setTone] = useState<Tone>("clean");
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>("en");
  const [voiceId, setVoiceId] = useState("default");
  const [noVoiceover, setNoVoiceover] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const [reviewBeforeRender, setReviewBeforeRender] = useState(true);
  const [focusPage, setFocusPage] = useState("");
  const [consent, setConsent] = useState(false);
  const [block, setBlock] = useState<CreateJobBlock | null>(null);

  const normalized = normalizeUrl(url);
  const debouncedUrl = useDebounced(normalized, 600);

  const previewQuery = useQuery({
    queryKey: ["url-preview", debouncedUrl],
    queryFn: () => previewUrl(debouncedUrl!),
    enabled: !!debouncedUrl,
    retry: false,
  });

  const creditsQuery = useQuery({ queryKey: ["credits"], queryFn: getCreditBalance, staleTime: 30_000, retry: false });
  const credits = creditsQuery.data ?? null;

  const formats: AspectFormat[] = alsoOtherFormats ? [primaryFormat, ...FORMAT_OPTIONS.map((f) => f.value).filter((f) => f !== primaryFormat)] : [primaryFormat];
  const cost = formats.length;
  const notEnoughCredits = credits !== null && credits < cost;

  const createJobMutation = useMutation({
    mutationFn: () => {
      const options: JobOptions = {
        formats,
        lengthSec,
        tone,
        voiceLanguage,
        voiceId,
        noVoiceover,
        musicOn,
        musicMood: "upbeat",
        reviewBeforeRender,
        ...(focusPage.trim() ? { focusPage: focusPage.trim() } : {}),
      };
      return createJobChecked({ url: normalized!, options });
    },
    onMutate: () => setBlock(null),
    onSuccess: (job) => {
      toast.success(`Started on ${job.domain}`);
      router.push(`/videos/${job.id}`);
    },
    onError: (err) => {
      const b = classifyCreateJobError(err);
      setBlock(b);
      if (b.kind === "insufficient_credits") creditsQuery.refetch();
    },
  });

  const canSubmit = !!normalized && consent && !createJobMutation.isPending && !notEnoughCredits;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New video</h1>
        {credits !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground" aria-live="polite">
            <Coins className="size-3.5 text-primary" aria-hidden /> {credits} credit{credits === 1 ? "" : "s"} left
          </span>
        )}
      </div>

      <Section n={1} title="Website">
        <div className="flex flex-col gap-2">
          <Label htmlFor="site-url" className="sr-only">
            Website URL
          </Label>
          <Input
            id="site-url"
            placeholder="https://yourproduct.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            aria-invalid={url.length > 0 && !normalized}
            aria-describedby="site-url-status"
          />
          <div id="site-url-status" aria-live="polite" className="text-xs">
            {url.length > 0 && !normalized && <p className="text-destructive">That doesn&apos;t look like a valid URL.</p>}
            {debouncedUrl && previewQuery.isFetching && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
              </p>
            )}
            {debouncedUrl && previewQuery.isError && !previewQuery.isFetching && (
              <p className="text-muted-foreground">Couldn&apos;t preview this site — you can still try generating.</p>
            )}
          </div>
        </div>
        {debouncedUrl && previewQuery.data && (
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            {previewQuery.data.favicon ? (
              // eslint-disable-next-line @next/next/no-img-element -- external favicon, arbitrary host
              <img src={previewQuery.data.favicon} alt="" className="size-10 rounded bg-muted object-contain" />
            ) : (
              <span className="size-10 rounded bg-muted" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{previewQuery.data.title ?? debouncedUrl}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {previewQuery.data.reachable ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-success" aria-hidden /> reachable
                  </>
                ) : (
                  <>
                    <AlertTriangle className="size-3.5 text-warning" aria-hidden /> unreachable ({previewQuery.data.status ?? "network error"})
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section n={2} title="Format & length">
        <div className="flex flex-col gap-2">
          <Label>Format</Label>
          <OptionCardGroup options={FORMAT_OPTIONS} value={primaryFormat} onChange={setPrimaryFormat} />
          <div className="flex items-center gap-2">
            <Switch id="also-formats" checked={alsoOtherFormats} onCheckedChange={setAlsoOtherFormats} />
            <Label htmlFor="also-formats" className="font-normal text-muted-foreground">
              Also make the other two formats (+1 credit each)
            </Label>
          </div>
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
      </Section>

      <Section n={3} title="Tone & voice">
        <div className="flex flex-col gap-2">
          <Label>Tone</Label>
          <OptionCardGroup options={TONE_OPTIONS} value={tone} onChange={setTone} columns={2} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="voice-language">Voice language</Label>
          <div className="max-w-48">
          <Select
            id="voice-language"
            value={voiceLanguage}
            onChange={(e) => setVoiceLanguage(e.target.value as VoiceLanguage)}
            disabled={noVoiceover}
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </Select>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Voice</Label>
          <VoicePicker language={voiceLanguage} value={voiceId} onChange={setVoiceId} availableSamples={availableSamples} disabled={noVoiceover} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="no-voiceover" checked={noVoiceover} onCheckedChange={setNoVoiceover} />
          <Label htmlFor="no-voiceover" className="font-normal">
            No voiceover (music + captions only)
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="music-on" checked={musicOn} onCheckedChange={setMusicOn} />
          <Label htmlFor="music-on" className="font-normal">
            Background music
          </Label>
        </div>
      </Section>

      <Card>
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border-b-0">
            <AccordionTrigger className="px-6 text-base">Advanced</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-4 px-6">
              <div className="flex items-center gap-2">
                <Switch id="review-first" checked={reviewBeforeRender} onCheckedChange={setReviewBeforeRender} />
                <Label htmlFor="review-first" className="font-normal">
                  Review the script before rendering
                </Label>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="focus-page">Focus page (optional)</Label>
                <Input id="focus-page" placeholder="/features" value={focusPage} onChange={(e) => setFocusPage(e.target.value)} className="max-w-xs" />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex items-start gap-2">
            <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
            <Label htmlFor="consent" className="font-normal leading-snug">
              I own this site or have permission to promote it.
            </Label>
          </div>
          {block && <CreateJobBlockAlert block={block} />}
          {notEnoughCredits && !block && <CreateJobBlockAlert block={{ kind: "insufficient_credits" }} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              Cost: {cost} credit{cost > 1 ? "s" : ""}
              {cost > 1 && " (1 + 1 per extra format)"}
            </span>
            <Button disabled={!canSubmit} onClick={() => createJobMutation.mutate()}>
              {createJobMutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> Starting…
                </>
              ) : (
                "Generate video"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
