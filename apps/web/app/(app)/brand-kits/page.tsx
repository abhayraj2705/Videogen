"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Palette, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState } from "@/components/states/error-state";
import { KitFormDialog } from "@/components/brand-kits/kit-form-dialog";
import { deleteBrandKit, listBrandKits, setDefaultBrandKit, type BrandKit } from "@/lib/api/phase6";

function Swatch({ color, label }: { color?: string; label: string }) {
  if (!color) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-4 rounded-full border border-border" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

function KitCard({ kit, onEdit, onDelete }: { kit: BrandKit; onEdit: () => void; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const makeDefault = useMutation({
    mutationFn: () => setDefaultBrandKit(kit.id),
    onSuccess: () => {
      toast.success(`“${kit.name}” is now your default kit`);
      void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
    },
    onError: (err) => toast.error(`Couldn't set default: ${err instanceof Error ? err.message : "unknown error"}`),
  });
  let host: string | null = null;
  try {
    host = kit.sourceUrl ? new URL(kit.sourceUrl).hostname : null;
  } catch {
    host = null;
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex h-20 items-center gap-3 px-5" style={{ background: kit.colors.background, color: kit.colors.foreground }}>
        {kit.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={kit.logoUrl} alt="" className="max-h-10 max-w-20 object-contain" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-lg text-sm font-bold" style={{ background: kit.colors.primary, color: kit.colors.background }} aria-hidden>
            {kit.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="truncate text-lg font-semibold" style={{ fontFamily: `${kit.fonts.heading}, system-ui, sans-serif` }}>
          {kit.name}
        </span>
        <span className="ml-auto h-2 w-12 rounded-full" style={{ background: kit.colors.accent ?? kit.colors.primary }} aria-hidden />
      </div>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">{kit.name}</h2>
          {kit.isDefault && <Badge variant="success">Default</Badge>}
          {host && <span className="text-xs text-muted-foreground">auto from {host}</span>}
        </div>
        <div className="flex flex-wrap gap-3">
          <Swatch color={kit.colors.background} label="bg" />
          <Swatch color={kit.colors.foreground} label="text" />
          <Swatch color={kit.colors.primary} label="primary" />
          <Swatch color={kit.colors.accent} label="accent" />
        </div>
        <p className="text-xs text-muted-foreground">
          Fonts: {kit.fonts.heading} / {kit.fonts.body}
        </p>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit ${kit.name}`}>
            <Pencil /> Edit
          </Button>
          {!kit.isDefault && (
            <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate()} disabled={makeDefault.isPending}>
              <Star /> Set default
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label={`Delete ${kit.name}`}>
            <Trash2 />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BrandKitsPage() {
  const queryClient = useQueryClient();
  const kits = useQuery({ queryKey: ["brand-kits"], queryFn: listBrandKits });
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<BrandKit | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteBrandKit(id),
    onSuccess: () => {
      toast.success("Brand kit deleted");
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
    },
    onError: (err) => toast.error(`Couldn't delete: ${err instanceof Error ? err.message : "unknown error"}`),
  });

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Brand kits</h1>
          <p className="text-sm text-muted-foreground">Colors, fonts and logo for your videos. We create one automatically for each site you turn into a video.</p>
        </div>
        <Button onClick={openNew}>
          <Plus /> New kit
        </Button>
      </div>

      {kits.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading brand kits">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      )}
      {kits.isError && <ErrorState error={kits.error} title="Couldn't load your brand kits" onRetry={() => kits.refetch()} />}
      {kits.data && kits.data.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Palette className="size-5" aria-hidden />
          </span>
          <p className="font-medium">No brand kits yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Make a video and we&apos;ll save the site&apos;s brand here, or create one yourself.</p>
          <Button onClick={openNew}>
            <Plus /> Create a kit
          </Button>
        </div>
      )}
      {kits.data && kits.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits.data.map((kit) => (
            <KitCard
              key={kit.id}
              kit={kit}
              onEdit={() => {
                setEditing(kit);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(kit)}
            />
          ))}
        </div>
      )}

      <KitFormDialog open={formOpen} onOpenChange={setFormOpen} kit={editing} />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>Videos already made keep their look. New videos won&apos;t be able to use this kit.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep it</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting.id)} disabled={remove.isPending}>
              Delete kit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
