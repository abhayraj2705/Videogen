"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { presignMediaUploads, uploadToPresignedUrl } from "@/lib/api/jobs";
import { cn } from "@/lib/utils";

/** Mirrors the backend's upload limits (apps/backend/src/lib/uploads.ts) and JOB_MEDIA_MAX in @sitereel/shared. */
const MAX_FILES = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

export interface UploadedMedia {
  /** Storage key once the upload has finished; empty while it is in flight. */
  key: string;
  caption: string;
  name: string;
  preview: string;
  progress: number;
  error?: string;
}

/**
 * Screenshots or photos of the product, uploaded as soon as they are picked
 * (straight to storage via presigned URLs) and shown in the video in this
 * order. Each can carry a caption — the user's own words for what it shows.
 */
export function MediaUploader({ value, onChange, disabled }: { value: UploadedMedia[]; onChange: (next: UploadedMedia[] | ((prev: UploadedMedia[]) => UploadedMedia[])) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function add(list: FileList | File[]) {
    const room = MAX_FILES - value.length;
    const picked = Array.from(list);
    const ok = picked.filter((f) => ACCEPT.includes(f.type) && f.size <= MAX_BYTES).slice(0, Math.max(0, room));
    const skipped = picked.length - ok.length;
    setNotice(skipped > 0 ? `${skipped} file${skipped > 1 ? "s were" : " was"} skipped — PNG, JPEG or WebP, up to 10 MB each, ${MAX_FILES} in total.` : null);
    if (ok.length === 0) return;

    const fresh: UploadedMedia[] = ok.map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { key: "", caption: "", name: file.name, preview, progress: 0 };
    });
    onChange((prev) => [...prev, ...fresh]);
    const patch = (preview: string, change: Partial<UploadedMedia>) => onChange((prev) => prev.map((m) => (m.preview === preview ? { ...m, ...change } : m)));

    try {
      const uploads = await presignMediaUploads(ok.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      await Promise.all(
        ok.map((file, i) =>
          uploadToPresignedUrl(uploads[i]!, file, (fraction) => patch(fresh[i]!.preview, { progress: fraction }))
            .then(() => patch(fresh[i]!.preview, { key: uploads[i]!.key, progress: 1 }))
            .catch((err) => patch(fresh[i]!.preview, { error: err instanceof Error ? err.message : "Upload failed." })),
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      for (const m of fresh) patch(m.preview, { error: message });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) void add(e.dataTransfer.files);
        }}
        className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground", dragging && "border-primary bg-accent")}
      >
        <ImagePlus className="size-5" aria-hidden />
        <p>
          Drop screenshots or photos of your product here, or{" "}
          <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => input.current?.click()} disabled={disabled}>
            choose files
          </button>
          .
        </p>
        <p className="text-xs">They appear in the video in this order. Good for screens behind a login.</p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {notice && <p className="text-xs text-destructive">{notice}</p>}

      {value.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.map((m, i) => (
            <li key={m.preview} className="flex items-center gap-3 rounded-md border p-2">
              <span className="w-5 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL preview */}
              <img src={m.preview} alt="" className="h-12 w-20 rounded object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Input
                  value={m.caption}
                  maxLength={160}
                  placeholder={`What does this show? (optional) — ${m.name}`}
                  onChange={(e) => onChange((prev) => prev.map((x) => (x.preview === m.preview ? { ...x, caption: e.target.value } : x)))}
                  disabled={disabled}
                />
                {m.error ? (
                  <span className="text-xs text-destructive">{m.error}</span>
                ) : !m.key ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden /> Uploading… {Math.round(m.progress * 100)}%
                  </span>
                ) : null}
              </div>
              <button type="button" aria-label={`Remove ${m.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => onChange((prev) => prev.filter((x) => x.preview !== m.preview))} disabled={disabled}>
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
