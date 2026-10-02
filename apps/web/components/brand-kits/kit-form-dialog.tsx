"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ImageUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createBrandKit,
  presignBrandKitLogo,
  putPresigned,
  updateBrandKit,
  type BrandKit,
  type BrandKitColors,
  type BrandKitInput,
} from "@/lib/api/phase6";
import { contrastLevel, contrastRatio, isHex, normalizeHex } from "@/lib/color";
import { BRAND_FONTS } from "@/lib/brand-fonts";
import { cn } from "@/lib/utils";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

const EMPTY: BrandKitInput = {
  name: "",
  colors: { primary: "#7c5cff", background: "#0f0f14", foreground: "#f5f5f7", accent: "#a78bfa", secondary: "#22d3ee" },
  fonts: { heading: "Inter", body: "Inter" },
};

const COLOR_FIELDS: { key: keyof BrandKitColors; label: string; optional?: boolean }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "primary", label: "Primary" },
  { key: "accent", label: "Accent", optional: true },
  { key: "secondary", label: "Secondary", optional: true },
];

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const valid = isHex(value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={valid ? normalizeHex(value) : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!valid} className="font-mono text-sm" maxLength={7} />
      </div>
    </div>
  );
}

function ContrastHint({ label, fg, bg, min = 4.5 }: { label: string; fg?: string; bg: string; min?: number }) {
  const ratio = fg ? contrastRatio(fg, bg) : null;
  if (ratio === null) return null;
  const ok = ratio >= min;
  return (
    <li className={cn("flex items-center gap-1.5", ok ? "text-success" : "text-warning")}>
      {ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
      <span className="text-foreground/90">{label}</span>
      <span className="font-mono">{ratio.toFixed(1)}:1</span>
      <span>· {contrastLevel(ratio)}</span>
      {!ok && <span className="text-muted-foreground">— the renderer will swap in a readable ink</span>}
    </li>
  );
}

/** Create / edit a brand kit. Logo uploads go straight to storage via a presigned PUT, then the kit is patched with the key. */
export function KitFormDialog({ open, onOpenChange, kit }: { open: boolean; onOpenChange: (o: boolean) => void; kit: BrandKit | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BrandKitInput>(EMPTY);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(kit ? { name: kit.name, colors: { ...kit.colors }, fonts: { ...kit.fonts }, sourceUrl: kit.sourceUrl ?? undefined } : EMPTY);
    setLogo(null);
  }, [open, kit]);

  useEffect(() => {
    if (!logo) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const setColor = (key: keyof BrandKitColors, v: string) => setForm((f) => ({ ...f, colors: { ...f.colors, [key]: v } }));
  const colorErrors = COLOR_FIELDS.filter((c) => {
    const v = form.colors[c.key];
    return c.optional ? !!v && !isHex(v) : !v || !isHex(v);
  });
  const valid = form.name.trim().length > 0 && colorErrors.length === 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const colors = Object.fromEntries(
        Object.entries(form.colors)
          .filter(([, v]) => !!v)
          .map(([k, v]) => [k, normalizeHex(v as string)]),
      ) as unknown as BrandKitColors;
      const body: BrandKitInput = { ...form, name: form.name.trim(), colors };
      let saved = kit ? await updateBrandKit(kit.id, body) : await createBrandKit(body);
      if (logo) {
        const presigned = await presignBrandKitLogo(saved.id, { type: logo.type, size: logo.size });
        await putPresigned(presigned, logo);
        saved = await updateBrandKit(saved.id, { logoKey: presigned.key });
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(kit ? `Saved “${saved.name}”` : `Created “${saved.name}”`);
      void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(`Couldn't save the brand kit: ${err instanceof Error ? err.message : "unknown error"}`),
  });

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return toast.error("Logo must be PNG, JPEG, WebP or SVG.");
    if (file.size > LOGO_MAX_BYTES) return toast.error("Logo must be 5 MB or smaller.");
    setLogo(file);
  }

  const bg = form.colors.background;
  const currentLogo = logoPreview ?? kit?.logoUrl ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{kit ? "Edit brand kit" : "New brand kit"}</DialogTitle>
          <DialogDescription>Colors, fonts and logo applied to every scene when you pick this kit on a new video.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="kit-name" className="text-xs text-muted-foreground">
              Name
            </label>
            <Input id="kit-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Acme" required />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">Colors</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {COLOR_FIELDS.map((c) => (
                <ColorField key={c.key} id={`kit-${c.key}`} label={c.label + (c.optional ? " (optional)" : "")} value={form.colors[c.key] ?? ""} onChange={(v) => setColor(c.key, v)} />
              ))}
            </div>
            {colorErrors.length > 0 && <p className="text-xs text-destructive">Use hex colors like #7c5cff ({colorErrors.map((c) => c.label).join(", ")}).</p>}
            <div
              className="flex items-center gap-3 rounded-lg border border-border p-3"
              style={{ background: isHex(bg) ? bg : undefined, color: isHex(form.colors.foreground) ? form.colors.foreground : undefined }}
              aria-hidden
            >
              <span className="text-lg font-semibold" style={{ fontFamily: `${form.fonts.heading}, system-ui, sans-serif` }}>
                {form.name || "Your product"}
              </span>
              <span
                className="ml-auto rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: isHex(form.colors.primary) ? form.colors.primary : undefined, color: isHex(bg) ? bg : undefined }}
              >
                Start free
              </span>
            </div>
            <ul className="flex flex-col gap-1 text-xs" aria-label="Contrast checks">
              <ContrastHint label="Text on background" fg={form.colors.foreground} bg={bg} />
              <ContrastHint label="Primary on background" fg={form.colors.primary} bg={bg} min={3} />
              {form.colors.accent && <ContrastHint label="Accent on background" fg={form.colors.accent} bg={bg} min={3} />}
            </ul>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Fonts</legend>
            <div className="flex flex-col gap-1">
              <label htmlFor="kit-heading" className="text-xs text-muted-foreground">
                Headings
              </label>
              <Select id="kit-heading" value={form.fonts.heading} onChange={(e) => setForm((f) => ({ ...f, fonts: { ...f.fonts, heading: e.target.value } }))}>
                {Array.from(new Set([form.fonts.heading, ...BRAND_FONTS])).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="kit-body" className="text-xs text-muted-foreground">
                Body
              </label>
              <Select id="kit-body" value={form.fonts.body} onChange={(e) => setForm((f) => ({ ...f, fonts: { ...f.fonts, body: e.target.value } }))}>
                {Array.from(new Set([form.fonts.body, ...BRAND_FONTS])).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Logo</span>
            <div className="flex items-center gap-3">
              <div className="flex size-14 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary">
                {currentLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentLogo} alt="Logo preview" className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImageUp className="size-5 text-muted-foreground" aria-hidden />
                )}
              </div>
              <label className="cursor-pointer rounded-md border border-input px-3 py-2 text-sm hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
                {currentLogo ? "Replace logo" : "Upload logo"}
                <input type="file" accept={LOGO_TYPES.join(",")} className="sr-only" onChange={(e) => pickLogo(e.target.files?.[0])} />
              </label>
              <span className="text-xs text-muted-foreground">PNG, JPEG, WebP or SVG · ≤ 5 MB</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
              {kit ? "Save changes" : "Create kit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
