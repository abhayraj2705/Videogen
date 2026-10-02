"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Globe, Link2Off, Loader2, Share2 } from "lucide-react";
import type { Job } from "@sitereel/shared";
import { createShare, revokeShare, shareUrlFor } from "@/lib/api/share";
import { copyText } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * W7 share link: creates a public /v/:shareId page (POST /api/jobs/:id/share),
 * copies the URL, and can revoke it (DELETE). Revocation is confirmed in a
 * dialog because the old link stops working for everyone.
 */
export function SharePanel({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const [shareId, setShareId] = useState<string | null>(job.shareId);
  const url = shareId ? shareUrlFor(shareId) : null;

  const create = useMutation({
    mutationFn: () => createShare(job.id),
    onSuccess: async (res) => {
      setShareId(res.shareId);
      queryClient.invalidateQueries({ queryKey: ["job", job.id] });
      const ok = await copyText(shareUrlFor(res.shareId));
      toast.success(ok ? "Public link created and copied" : "Public link created");
    },
    onError: (err: Error) => toast.error(`Couldn't create a share link: ${err.message}`),
  });

  const revoke = useMutation({
    mutationFn: () => revokeShare(job.id),
    onSuccess: () => {
      setShareId(null);
      queryClient.invalidateQueries({ queryKey: ["job", job.id] });
      toast.success("Public link revoked");
    },
    onError: (err: Error) => toast.error(`Couldn't revoke the link: ${err.message}`),
  });

  if (!url) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Share link</p>
        <p className="text-xs text-muted-foreground">Anyone with the link can watch — no sign-in needed.</p>
        <Button variant="secondary" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Share2 aria-hidden />}
          Create public link
        </Button>
      </div>
    );
  }

  const enc = encodeURIComponent(url);
  const socials = [
    { label: "X", href: `https://twitter.com/intent/tweet?url=${enc}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${enc}` },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Globe className="size-4 text-success" aria-hidden /> Public link
      </p>
      <div className="flex gap-2">
        <Input readOnly value={url} aria-label="Public share link" className="h-9 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          size="icon"
          variant="secondary"
          aria-label="Copy public link"
          onClick={async () => {
            if (await copyText(url)) toast.success("Link copied");
            else toast.error("Couldn't copy — select and copy it manually");
          }}
        >
          <Copy aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {socials.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {s.label}
          </a>
        ))}
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="self-start text-muted-foreground">
            <Link2Off aria-hidden /> Revoke link
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke the public link?</DialogTitle>
            <DialogDescription>Anyone who has the link will no longer be able to watch this video. You can create a new link later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Keep link</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button variant="destructive" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
                Revoke
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
