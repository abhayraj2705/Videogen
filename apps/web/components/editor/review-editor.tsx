"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Redo2, Save, Undo2, Wand2 } from "lucide-react";
import type { AspectFormat, Storyboard } from "@sitereel/shared";
import { getJob, withAuthToken } from "@/lib/api/client";
import {
  approveVersion,
  getStoryboard,
  isStoryboardInvalid,
  isVersionConflict,
  listBrandKits,
  redesignScene,
  revoiceScene,
  saveStoryboard,
  type StoryboardValidation,
} from "@/lib/api/phase6";
import { createEditorStore, canRedo, canUndo } from "@/lib/editor/history-store";
import { buildPreviewManifest, DEFAULT_PREVIEW_BRAND, type PreviewBrand } from "@/lib/editor/preview-manifest";
import { templateLabel } from "@/lib/editor/templates";
import { useJobEvents } from "@/hooks/use-job-events";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState } from "@/components/states/error-state";
import { FilmPreview, type FilmPreviewHandle } from "@/components/editor/film-preview";
import { SceneList } from "@/components/editor/scene-list";
import { SceneInspector } from "@/components/editor/scene-inspector";
import { ValidationBanner } from "@/components/editor/validation-banner";
import { cn } from "@/lib/utils";

const EDITABLE = new Set(["review", "done", "failed"]);
const PREVIEW_DEBOUNCE_MS = 350;
const REVOICE_TIMEOUT_MS = 90_000;
const REDESIGN_TIMEOUT_MS = 120_000;

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

let copySeq = 0;
function copyId(id: string, existing: Set<string>): string {
  let next: string;
  do next = `${id}-copy${++copySeq}`;
  while (existing.has(next));
  return next;
}

export function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading script editor">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr_20rem]">
        <div className="hidden flex-col gap-2 lg:flex">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="aspect-video rounded-lg" />
        <div className="hidden flex-col gap-3 lg:flex">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}

export function ReviewEditor({ jobId }: { jobId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);
  const [store] = useState(createEditorStore);
  const present = useStore(store, (s) => s.present);
  const dirty = useStore(store, (s) => s.dirty);
  const baseVersion = useStore(store, (s) => s.baseVersion);
  const saved = useStore(store, (s) => s.saved);
  const selectedId = useStore(store, (s) => s.selectedSceneId);
  const undoable = useStore(store, canUndo);
  const redoable = useStore(store, canRedo);

  const [validation, setValidation] = useState<StoryboardValidation | null>(null);
  const [conflict, setConflict] = useState(false);
  const [mobileTab, setMobileTab] = useState<"scenes" | "preview" | "edit">("preview");
  const [format, setFormat] = useState<AspectFormat | null>(null);
  const [playingSceneId, setPlayingSceneId] = useState<string | null>(null);
  /** The designed scene element being edited (outlined in the preview). */
  const [selectedEl, setSelectedEl] = useState<string | null>(null);
  const [revoicing, setRevoicing] = useState<Record<string, { since: number; baseline: string }>>({});
  /** A scene the worker is redesigning, and when it was asked (older events for the same scene are ignored). */
  const [redesigning, setRedesigning] = useState<{ sceneId: string; since: number } | null>(null);
  const previewRef = useRef<FilmPreviewHandle>(null);
  const loadedRef = useRef(false);

  const jobQuery = useQuery({ queryKey: ["job", jobId], queryFn: () => getJob(jobId) });
  const sbQuery = useQuery({
    queryKey: ["storyboard", jobId],
    queryFn: () => getStoryboard(jobId),
    refetchOnWindowFocus: false,
    refetchInterval: Object.keys(revoicing).length > 0 ? 2500 : false,
  });
  const kitsQuery = useQuery({ queryKey: ["brand-kits"], queryFn: listBrandKits, retry: false, staleTime: 60_000 });

  // First load (and explicit reloads) seed the draft; background refetches only refresh audio.
  useEffect(() => {
    if (sbQuery.data && !loadedRef.current) {
      loadedRef.current = true;
      store.getState().load(sbQuery.data.storyboard, sbQuery.data.version);
      setValidation(sbQuery.data.validation);
    }
  }, [sbQuery.data, store]);

  const reloadLatest = useCallback(async () => {
    loadedRef.current = false;
    setConflict(false);
    await queryClient.invalidateQueries({ queryKey: ["storyboard", jobId] });
  }, [queryClient, jobId]);

  // Re-voice completion: the worker emits a `voice` event carrying the sceneId.
  const job = jobQuery.data;
  const { events } = useJobEvents(Object.keys(revoicing).length > 0 || redesigning ? jobId : undefined);
  const lastEvent = events.at(-1);
  useEffect(() => {
    if (lastEvent?.stage === "voice") void queryClient.invalidateQueries({ queryKey: ["storyboard", jobId] });
  }, [lastEvent, queryClient, jobId]);

  // Redesign completion: the worker saved the next version (or couldn't); load it into the editor.
  useEffect(() => {
    if (!redesigning) return;
    const done = events.findLast((e) => {
      const r = (e.payload as { redesign?: { sceneId?: string } } | undefined)?.redesign;
      return e.stage === "plan" && r?.sceneId === redesigning.sceneId && Date.parse(e.at) >= redesigning.since - 2000;
    });
    if (done) {
      const r = (done.payload as { redesign: { ok: boolean; reason?: string } }).redesign;
      setRedesigning(null);
      if (r.ok) {
        toast.success("Scene redesigned — saved as a new version");
        void reloadLatest();
      } else toast.error(`Couldn't redesign that scene${r.reason ? `: ${r.reason.slice(0, 160)}` : ""}`);
      return;
    }
    const timer = setTimeout(() => {
      setRedesigning(null);
      toast.error("The redesign is taking longer than expected — reload to see it when it's ready.");
    }, Math.max(0, redesigning.since + REDESIGN_TIMEOUT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [events, redesigning, reloadLatest]);

  const audio = useMemo(() => sbQuery.data?.audio ?? [], [sbQuery.data]);
  useEffect(() => {
    setRevoicing((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [sceneId, r] of Object.entries(prev)) {
        const a = audio.find((x) => x.sceneId === sceneId);
        const sig = a ? `${a.url}|${a.durationMs}` : "";
        if (sig !== r.baseline) {
          delete next[sceneId];
          changed = true;
          toast.success("Line re-voiced");
        } else if (Date.now() - r.since > REVOICE_TIMEOUT_MS) {
          delete next[sceneId];
          changed = true;
          toast.error("Re-voicing is taking longer than expected — the new line will appear when it's ready.");
        }
      }
      return changed ? next : prev;
    });
  }, [audio]);

  // Auth-resolved narration URLs (media routes take ?token=, like renders).
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      audio.map(async (a) => [a.sceneId, /^https?:\/\//i.test(a.url) ? a.url : await withAuthToken(a.url)] as const),
    ).then((pairs) => {
      if (!cancelled) setAudioUrls(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [audio]);

  const brand: PreviewBrand = useMemo(() => {
    const kit = kitsQuery.data?.find((k) => k.isDefault);
    if (!kit) return DEFAULT_PREVIEW_BRAND;
    return {
      bg: kit.colors.background,
      fg: kit.colors.foreground,
      accent: kit.colors.accent ?? kit.colors.primary,
      fontDisplay: kit.fonts.heading,
      fontBody: kit.fonts.body,
      logoUrl: kit.logoUrl,
    };
  }, [kitsQuery.data]);

  const activeFormat: AspectFormat = format ?? job?.options.formats[0] ?? "16:9";
  const debouncedPresent = useDebouncedValue(present, PREVIEW_DEBOUNCE_MS);
  const manifest = useMemo(
    () => (debouncedPresent ? buildPreviewManifest(debouncedPresent, { format: activeFormat, brand, audio }) : null),
    [debouncedPresent, activeFormat, brand, audio],
  );

  const saveMutation = useMutation({
    mutationFn: async (sb: Storyboard) => {
      const base = store.getState().baseVersion;
      if (base === null) throw new Error("Nothing loaded");
      return { sb, res: await saveStoryboard(jobId, base, sb) };
    },
    onSuccess: ({ sb, res }) => {
      store.getState().markSaved(res.version, sb);
      setValidation(res.validation);
      queryClient.setQueryData(["storyboard", jobId], (old: Awaited<ReturnType<typeof getStoryboard>> | undefined) =>
        old ? { ...old, version: res.version, storyboard: sb, validation: res.validation } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ["storyboard-versions", jobId] });
    },
    onError: (err) => {
      if (isVersionConflict(err)) setConflict(true);
      else toast.error(`Couldn't save: ${err instanceof Error ? err.message : "unknown error"}`);
    },
  });

  const save = useCallback(async (): Promise<{ version: number | null; validation: StoryboardValidation | null }> => {
    const sb = store.getState().present;
    if (!sb || !store.getState().dirty) return { version: store.getState().baseVersion, validation: null };
    const { res } = await saveMutation.mutateAsync(sb);
    toast.success(`Saved as version ${res.version}`);
    return res;
  }, [store, saveMutation]);

  const approveMutation = useMutation({
    mutationFn: save,
    onSuccess: async ({ version, validation: fresh }) => {
      if (store.getState().dirty) return;
      if (fresh && (!fresh.ok || fresh.errors.length > 0)) {
        toast.error("Saved — fix the highlighted issues before rendering.");
        return;
      }
      try {
        await approveVersion(jobId, version ?? undefined);
        toast.success("Approved — recording the voiceover and rendering…");
        void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
        router.push(`/videos/${jobId}`);
      } catch (err) {
        if (isStoryboardInvalid(err)) toast.error("Fix the highlighted issues before rendering.");
        else toast.error(`Couldn't approve: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    },
  });

  // Validation must be clean for the *saved* version before approve; any unsaved edit is saved first.
  const hasErrors = !!validation && (!validation.ok || validation.errors.length > 0);
  const approveBlocked = !dirty && hasErrors;

  // Keyboard: undo/redo/save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) store.getState().redo();
        else store.getState().undo();
      } else if (k === "y" && !e.metaKey) {
        e.preventDefault();
        store.getState().redo();
      } else if (k === "s") {
        e.preventDefault();
        void save().catch(() => undefined);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, save]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const scenes = useMemo(() => present?.scenes ?? [], [present]);
  const sceneIndex = useMemo(() => Object.fromEntries(scenes.map((s, i) => [s.id, i])), [scenes]);
  const errorCounts = useMemo(() => {
    const c: Record<string, number> = {};
    if (!dirty) for (const e of validation?.errors ?? []) if (e.sceneId) c[e.sceneId] = (c[e.sceneId] ?? 0) + 1;
    return c;
  }, [validation, dirty]);
  const voiced = useMemo(() => new Set(audio.map((a) => a.sceneId)), [audio]);
  const sceneLabels = useMemo(() => Object.fromEntries(scenes.map((s) => [s.id, templateLabel(s.templateId)])), [scenes]);
  const selected = scenes.find((s) => s.id === selectedId) ?? null;

  const selectScene = useCallback(
    (id: string, opts: { seek?: boolean; tab?: boolean } = {}) => {
      if (store.getState().selectedSceneId !== id) setSelectedEl(null);
      store.getState().select(id);
      if (opts.seek !== false && manifest) {
        const s = manifest.scenes.find((x) => x.id === id);
        if (s) previewRef.current?.seek(s.start + Math.min(1.2, (s.end - s.start) / 2));
      }
      if (opts.tab && !isDesktop) setMobileTab("edit");
    },
    [store, manifest, isDesktop],
  );

  const onTimeChange = useCallback((_t: number, sceneId: string | null) => setPlayingSceneId(sceneId), []);

  async function onRedesign(sceneId: string, instruction: string) {
    try {
      await redesignScene(jobId, sceneId, instruction);
      setRedesigning({ sceneId, since: Date.now() });
      toast("Designing this scene…");
    } catch (err) {
      toast.error(`Couldn't start the redesign: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  async function onRevoice(sceneId: string) {
    const a = audio.find((x) => x.sceneId === sceneId);
    try {
      await revoiceScene(jobId, sceneId);
      setRevoicing((p) => ({ ...p, [sceneId]: { since: Date.now(), baseline: a ? `${a.url}|${a.durationMs}` : "" } }));
      toast("Re-voicing this line…");
    } catch (err) {
      toast.error(`Couldn't re-voice: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  // ---- render ---------------------------------------------------------------

  if (jobQuery.isPending || sbQuery.isPending) return <EditorSkeleton />;
  if (jobQuery.isError || sbQuery.isError || !job) {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState
          error={jobQuery.error ?? sbQuery.error}
          title={sbQuery.isError ? "Couldn't load the script" : undefined}
          onRetry={() => {
            void jobQuery.refetch();
            void sbQuery.refetch();
          }}
          action={
            <Link href={`/videos/${jobId}`} className={buttonVariants({ variant: "ghost" })}>
              Back to video
            </Link>
          }
        />
      </div>
    );
  }
  if (!present) return <EditorSkeleton />;

  const editable = EDITABLE.has(job.status);
  const totalSec = manifest?.duration ?? scenes.reduce((n, s) => n + s.durationSec, 0);
  const savedScene = saved?.scenes.find((s) => s.id === selected?.id);
  const canRevoice = !selected
    ? { ok: false }
    : !savedScene
      ? { ok: false, reason: "Save this new scene before voicing it." }
      : (savedScene.narration ?? "") !== (selected.narration ?? "")
        ? { ok: false, reason: "Save your narration edit first — re-voice uses the saved line." }
        : { ok: true };

  const patchSelected = (patch: Parameters<ReturnType<typeof store.getState>["updateScene"]>[1], opts?: { coalesceKey?: string }) => {
    if (selected && editable) store.getState().updateScene(selected.id, patch, opts);
  };

  const listEl = (
    <SceneList
      scenes={scenes}
      selectedId={selectedId}
      playingId={playingSceneId}
      errorCounts={errorCounts}
      voiced={voiced}
      onSelect={(id) => selectScene(id, { tab: true })}
      onMove={(id, dir) =>
        editable &&
        store.getState().edit((sb) => {
          const i = sb.scenes.findIndex((s) => s.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= sb.scenes.length) return sb;
          const next = [...sb.scenes];
          [next[i], next[j]] = [next[j]!, next[i]!];
          return { ...sb, scenes: next };
        })
      }
      onDuplicate={(id) =>
        editable &&
        store.getState().edit((sb) => {
          const i = sb.scenes.findIndex((s) => s.id === id);
          if (i < 0) return sb;
          const copy = { ...structuredClone(sb.scenes[i]!), id: copyId(id, new Set(sb.scenes.map((s) => s.id))) };
          const next = [...sb.scenes];
          next.splice(i + 1, 0, copy);
          queueMicrotask(() => store.getState().select(copy.id));
          return { ...sb, scenes: next };
        })
      }
      onDelete={(id) =>
        editable &&
        store.getState().edit((sb) => {
          if (sb.scenes.length <= 1) return sb;
          const i = sb.scenes.findIndex((s) => s.id === id);
          const next = sb.scenes.filter((s) => s.id !== id);
          queueMicrotask(() => store.getState().select(next[Math.max(0, i - 1)]?.id ?? null));
          return { ...sb, scenes: next };
        })
      }
    />
  );

  const previewEl = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
        {job.options.formats.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Preview format">
            {job.options.formats.map((f) => (
              <Button key={f} size="xs" variant={f === activeFormat ? "secondary" : "ghost"} onClick={() => setFormat(f)} aria-pressed={f === activeFormat}>
                {f}
              </Button>
            ))}
          </div>
        )}
      </div>
      <FilmPreview
        ref={previewRef}
        manifest={manifest}
        audioUrls={audioUrls}
        sceneLabels={sceneLabels}
        onTimeChange={onTimeChange}
        onSceneClick={(id) => selectScene(id)}
        highlight={selected && selectedEl ? { sceneId: selected.id, el: selectedEl } : null}
        onPick={(sceneId, el) => {
          if (!sceneId) return;
          selectScene(sceneId, { seek: false, tab: true });
          setSelectedEl(el);
        }}
        className="min-h-0 flex-1"
      />
      <ValidationBanner validation={validation} dirty={dirty} sceneIndex={sceneIndex} onSelectScene={(id) => selectScene(id, { tab: true })} />
      <p className="text-[11px] text-muted-foreground">
        Preview uses placeholder screenshots and estimated timing; the render uses your crawled pages and the final voice timing.
      </p>
    </div>
  );

  const inspectorEl = selected ? (
    <fieldset disabled={!editable} className="min-w-0">
      <SceneInspector
        key={selected.id}
        scene={selected}
        index={sceneIndex[selected.id] ?? 0}
        facts={sbQuery.data?.facts ?? []}
        errors={dirty ? [] : (validation?.errors ?? []).filter((e) => e.sceneId === selected.id)}
        audioUrl={audioUrls[selected.id]}
        audioDurationMs={audio.find((a) => a.sceneId === selected.id)?.durationMs}
        revoicing={!!revoicing[selected.id]}
        canRevoice={canRevoice}
        onPatch={patchSelected}
        onRevoice={() => onRevoice(selected.id)}
        selectedEl={selectedEl}
        onSelectEl={setSelectedEl}
        redesigning={redesigning?.sceneId === selected.id}
        canRedesign={dirty ? { ok: false, reason: "Save your edits first — the redesign starts from the saved version." } : redesigning ? { ok: false, reason: "Another scene is being designed." } : { ok: true }}
        onRedesign={(instruction) => onRedesign(selected.id, instruction)}
      />
    </fieldset>
  ) : (
    <p className="text-sm text-muted-foreground">Select a scene to edit it.</p>
  );

  const captionEl = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <label htmlFor="share-caption" className="shrink-0 text-xs text-muted-foreground">
        Share caption
      </label>
      <Input
        id="share-caption"
        value={present.shareCaption}
        disabled={!editable}
        onChange={(e) => store.getState().edit((sb) => ({ ...sb, shareCaption: e.target.value }), { coalesceKey: "shareCaption" })}
        className="h-8 text-sm"
      />
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-3", isDesktop && "h-[calc(100dvh-3.5rem-4rem)]")}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href={`/videos/${jobId}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Back to video">
          <ArrowLeft />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight">
            {job.domain} <span className="font-normal text-muted-foreground">· Review script</span>
          </h1>
          <p className="font-mono text-[11px] text-muted-foreground">
            {totalSec.toFixed(1)}s · {scenes.length} scenes · v{baseVersion}
            {dirty ? " · unsaved" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => store.getState().undo()} disabled={!undoable} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl/⌘+Z)">
            <Undo2 />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => store.getState().redo()} disabled={!redoable} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl/⌘+Shift+Z)">
            <Redo2 />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void save().catch(() => undefined)} disabled={!dirty || !editable || saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Save />} Save
          </Button>
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={!editable || approveBlocked || approveMutation.isPending || saveMutation.isPending}
            title={approveBlocked ? "Fix the validation issues first" : undefined}
          >
            {approveMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Wand2 />}
            {dirty ? "Save, approve & render" : "Approve & render"}
          </Button>
        </div>
      </div>

      {!editable && (
        <p role="status" className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          This video is <Badge variant="secondary">{job.status}</Badge> — the script is read-only until it finishes.
        </p>
      )}

      {isDesktop ? (
        <>
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-xl border border-border">
            <ResizablePanel defaultSize="20" minSize="14" maxSize="32">
              <div className="flex h-full flex-col">
                <p className="px-3 pb-2 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenes</p>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{listEl}</div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="52" minSize="30">
              <div className="h-full p-3">{previewEl}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="28" minSize="20" maxSize="45">
              <div className="h-full overflow-y-auto p-3">{inspectorEl}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
          <div className="flex items-center gap-3">{captionEl}</div>
        </>
      ) : (
        <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as typeof mobileTab)} className="flex flex-col gap-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="scenes">Scenes</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
          </TabsList>
          <TabsContent value="scenes" forceMount className="data-[state=inactive]:hidden">
            {listEl}
          </TabsContent>
          <TabsContent value="preview" forceMount className="data-[state=inactive]:hidden">
            <div className="flex flex-col gap-3">{previewEl}</div>
          </TabsContent>
          <TabsContent value="edit" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
            {inspectorEl}
            <div className="flex flex-col gap-2 border-t border-border pt-3">{captionEl}</div>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={conflict} onOpenChange={setConflict}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This script changed somewhere else</DialogTitle>
            <DialogDescription>
              A newer version was saved (another tab, or a quick change) after you started editing. Reload the latest version to continue — your unsaved
              edits here will be discarded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConflict(false)}>
              Keep my edits for now
            </Button>
            <Button onClick={() => void reloadLatest()}>Reload latest</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
