"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import type { Job } from "@sitereel/shared";
import { presignUploads, resumeJob, uploadToPresignedUrl } from "@/lib/api/jobs";
import { isApiError } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const LOGO_ACCEPT = [...ACCEPT, "image/svg+xml"];
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_SHOTS = 2;
const MAX_SHOTS = 6;

interface Picked {
  id: string;
  file: File;
  preview: string;
  progress: number;
}

function validate(file: File, accept: string[]): string | null {
  if (!accept.includes(file.type)) return `${file.name}: use PNG, JPG or WebP${accept.includes("image/svg+xml") ? " (or SVG)" : ""}.`;
  if (file.size > MAX_BYTES) return `${file.name} is larger than 10 MB.`;
  return null;
}

function friendlyError(err: unknown): string {
  if (isApiError(err)) {
    if (err.status === 404) return "Uploads aren't available for this video yet. Please try again a little later.";
    if (err.status === 409) return "This video isn't waiting for input any more — refresh to see its status.";
    if (err.status === 413) return "One of the files is too large.";
    if (err.status === 0) return err.message;
    return err.message;
  }
  return err instanceof Error ? err.message : "Upload failed.";
}

/**
 * W8: direct-to-R2 uploads. Flow: POST /api/jobs/:id/uploads/presign {files}
 * → PUT each file to its presigned URL (with returned headers) → POST
 * /api/jobs/:id/resume {keys, description, features, brandColor}.
 */
export function NeedsInputForm({ job }: { job: Job }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [shots, setShots] = useState<Picked[]>([]);
  const [logo, setLogo] = useState<Picked | null>(null);
  const [description, setDescription] = useState("");
  const [features, setFeatures] = useState("");
  const [brandColor, setBrandColor] = useState("#7c5cff");
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "uploading" | "resuming">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const toPicked = (file: File): Picked => {
    const preview = URL.createObjectURL(file);
    urlsRef.current.push(preview);
    return { id: `${file.name}-${file.size}-${file.lastModified}`, file, preview, progress: 0 };
  };

  function addFiles(list: FileList | File[]) {
    const errs: string[] = [];
    const accepted: Picked[] = [];
    for (const f of Array.from(list)) {
      const e = validate(f, ACCEPT);
      if (e) errs.push(e);
      else if (!shots.some((p) => p.id === `${f.name}-${f.size}-${f.lastModified}`)) accepted.push(toPicked(f));
    }
    const merged = [...shots, ...accepted];
    if (merged.length > MAX_SHOTS) errs.push(`Up to ${MAX_SHOTS} screenshots — extra files were skipped.`);
    setShots(merged.slice(0, MAX_SHOTS));
    setErrors(errs);
  }

  const busy = phase !== "idle";
  const canSubmit = shots.length >= MIN_SHOTS && description.trim().length >= 20 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError(null);
    setPhase("uploading");
    const all = logo ? [...shots, logo] : shots;
    try {
      const uploads = await presignUploads(
        job.id,
        all.map((p) => ({ name: p.file.name, type: p.file.type, size: p.file.size })),
      );
      await Promise.all(
        all.map((p, i) =>
          uploadToPresignedUrl(uploads[i]!, p.file, (fraction) => {
            const update = (x: Picked) => (x.id === p.id ? { ...x, progress: fraction } : x);
            if (logo && p.id === logo.id) setLogo((l) => (l ? update(l) : l));
            else setShots((prev) => prev.map(update));
          }),
        ),
      );
      setPhase("resuming");
      await resumeJob(job.id, {
        keys: uploads.map((u) => u.key),
        description: description.trim(),
        features: features
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
        brandColor,
      });
      toast.success("Thanks! Picking up where we left off…");
      queryClient.invalidateQueries({ queryKey: ["job", job.id] });
      router.push(`/videos/${job.id}`);
    } catch (err) {
      setSubmitError(friendlyError(err));
      setPhase("idle");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div>
        <Label className="mb-2 block">Screenshots of your site ({MIN_SHOTS}–{MAX_SHOTS})</Label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-10 text-center transition-colors",
            dragging && "border-primary bg-accent/40",
          )}
        >
          <ImagePlus className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm">Drop 2–6 screenshots — hero, features, product.</p>
          <p className="text-xs text-muted-foreground">PNG, JPG or WebP · up to 10 MB each</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload aria-hidden /> Choose files
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT.join(",")}
            multiple
            className="sr-only"
            aria-label="Choose screenshots"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {errors.length > 0 && (
          <ul role="alert" className="mt-2 flex flex-col gap-1 text-xs text-destructive">
            {errors.map((er) => (
              <li key={er}>{er}</li>
            ))}
          </ul>
        )}
        {shots.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shots.map((s) => (
              <li key={s.id} className="relative overflow-hidden rounded-lg border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={s.preview} alt={s.file.name} className="aspect-video w-full object-cover" />
                {busy && <Progress value={Math.round(s.progress * 100)} className="absolute inset-x-0 bottom-0 h-1 rounded-none" aria-label={`Uploading ${s.file.name}`} />}
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setShots((prev) => prev.filter((p) => p.id !== s.id))}
                    className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-background/80 hover:bg-background"
                    aria-label={`Remove ${s.file.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ni-description">Describe your product in 2–3 sentences</Label>
        <Textarea
          id="ni-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={600}
          disabled={busy}
          placeholder="Notely is a note-taking app that sorts and summarises your notes automatically…"
        />
        <span className="text-xs text-muted-foreground">{description.trim().length < 20 ? "At least 20 characters." : `${description.length}/600`}</span>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ni-features">Key features (one per line)</Label>
        <Textarea id="ni-features" value={features} onChange={(e) => setFeatures(e.target.value)} rows={4} maxLength={800} disabled={busy} />
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ni-color">Brand color</Label>
          <div className="flex items-center gap-2">
            <input
              id="ni-color"
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              disabled={busy}
              className="size-9 cursor-pointer rounded-md border border-input bg-transparent p-1"
            />
            <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-28 font-mono" aria-label="Brand color hex" disabled={busy} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ni-logo">Logo (optional)</Label>
          <div className="flex items-center gap-2">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={logo.preview} alt="Logo preview" className="size-9 rounded border border-border bg-white object-contain p-0.5" />
            )}
            <Input
              id="ni-logo"
              type="file"
              accept={LOGO_ACCEPT.join(",")}
              disabled={busy}
              className="max-w-64"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return setLogo(null);
                const err = validate(f, LOGO_ACCEPT);
                if (err) {
                  setErrors([err]);
                  e.target.value = "";
                  return;
                }
                setLogo(toPicked(f));
              }}
            />
          </div>
        </div>
      </div>

      {submitError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t continue</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-end gap-3">
        {shots.length < MIN_SHOTS && <span className="text-xs text-muted-foreground">Add at least {MIN_SHOTS} screenshots.</span>}
        <Button type="submit" disabled={!canSubmit}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {phase === "uploading" ? "Uploading…" : phase === "resuming" ? "Continuing…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
