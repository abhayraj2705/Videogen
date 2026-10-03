"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Link2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { checkSceneDoc, sanitizeDeclarations, splitWords, FULL_LAYER, SAFE_LAYER, type SceneDoc, type SceneNode, type SceneNodeKind, type SceneTween } from "@sitereel/shared/scene-core";
import type { FactLedger, StoryboardScene } from "@sitereel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FactBadge } from "@/components/editor/fact-badge";
import { groundText, sourceLabel } from "@/lib/editor/grounding";
import { templateLabel } from "@/lib/editor/templates";
import type { EditOptions } from "@/lib/editor/history-store";
import {
  EASE_PICKS,
  ICON_CHOICES,
  NODE_KIND_LABELS,
  PRESET_CHOICES,
  SFX_CHOICES,
  addNode,
  addTween,
  anchorWords,
  duplicateTween,
  moveNode,
  nodeTree,
  removeNode,
  removeTween,
  tweenLength,
  updateNode,
  updateTween,
} from "@/lib/editor/html-scene";
import { cn } from "@/lib/utils";

/** Timeline snapping step (s). */
const SNAP = 0.05;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const round2 = (v: number) => Math.round(v * 100) / 100;

function partCount(doc: SceneDoc, t: SceneTween): number {
  const node = doc.nodes.find((n) => n.id === t.target);
  if (!node) return 1;
  if (t.part === "words" || (!t.part && t.preset && ["words", "mask-up"].includes(t.preset))) return splitWords(node.text ?? "").length;
  if (t.part === "chars" || (!t.part && t.preset === "type")) return splitWords(node.text ?? "").join("").length;
  if (t.part === "children" || (!t.part && t.preset === "cascade")) return doc.nodes.filter((n) => n.parent === node.id).length;
  return 1;
}

/**
 * The editor for a designed scene: its elements (tree, content, style) and its motion (a timeline of tweens
 * you can drag, and every tween's settings). Everything edits the scene's doc through onPatch, so it shares
 * undo/redo, saving and server validation with the rest of the storyboard.
 */
export function HtmlSceneEditor({
  scene,
  facts,
  sourcePages,
  selectedEl,
  onSelectEl,
  onPatch,
  idPrefix,
}: {
  scene: StoryboardScene;
  facts: FactLedger;
  sourcePages: string[];
  selectedEl: string | null;
  onSelectEl: (id: string | null) => void;
  onPatch: (patch: Partial<StoryboardScene>, opts?: EditOptions) => void;
  idPrefix: string;
}) {
  const props = scene.props as { doc: SceneDoc; concept?: string; fallback?: { templateId: string; props: Record<string, unknown> } };
  const doc = props.doc;
  const [selectedTween, setSelectedTween] = useState<number | null>(null);
  const setDoc = (next: SceneDoc, coalesceKey?: string) => onPatch({ props: { ...scene.props, doc: next } }, coalesceKey ? { coalesceKey: `${scene.id}:${coalesceKey}` } : undefined);

  const issues = useMemo(() => checkSceneDoc(doc, { durationSec: scene.durationSec, iconNames: ICON_CHOICES, factIds: scene.factIds }), [doc, scene.durationSec, scene.factIds]);
  const rows = useMemo(() => nodeTree(doc), [doc]);
  const node = doc.nodes.find((n) => n.id === selectedEl) ?? null;
  const tween = selectedTween !== null ? (doc.timeline[selectedTween] ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5">
        <span className="text-xs font-medium">Designed for this film</span>
        {props.concept && <p className="text-xs text-muted-foreground">{props.concept}</p>}
        {props.fallback && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="self-start"
            onClick={() => onPatch({ templateId: props.fallback!.templateId as StoryboardScene["templateId"], props: props.fallback!.props })}
            title="Replace this design with the template scene the planner picked (undo brings the design back)"
          >
            <RotateCcw /> Use the {templateLabel(props.fallback.templateId)} template instead
          </Button>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" role="status" aria-label="Problems in this design">
          {issues.slice(0, 6).map((i, n) => (
            <li key={n} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden /> {i.message}
            </li>
          ))}
          {issues.length > 6 && <li className="text-muted-foreground">…and {issues.length - 6} more</li>}
        </ul>
      )}

      <ElementList
        doc={doc}
        rows={rows}
        selectedEl={selectedEl}
        onSelect={(id) => {
          onSelectEl(id);
          setSelectedTween(null);
        }}
        onAdd={(kind) => {
          const parent = node?.kind === "box" ? node.id : (node?.parent ?? SAFE_LAYER);
          const added = addNode(doc, kind, parent, { page: sourcePages[0] });
          setDoc(added.doc);
          onSelectEl(added.id);
        }}
      />

      {node && (
        <NodeInspector
          key={node.id}
          node={node}
          doc={doc}
          scene={scene}
          facts={facts}
          sourcePages={sourcePages}
          idPrefix={`${idPrefix}-${node.id}`}
          onChange={(patch, field) => setDoc(updateNode(doc, node.id, patch), `node:${node.id}:${field}`)}
          onMove={(dir) => setDoc(moveNode(doc, node.id, dir))}
          onDelete={() => {
            setDoc(removeNode(doc, node.id));
            onSelectEl(null);
            setSelectedTween(null);
          }}
        />
      )}

      <Separator />

      <Timeline
        doc={doc}
        durationSec={scene.durationSec}
        selectedEl={selectedEl}
        selectedTween={selectedTween}
        onSelectTween={(i) => {
          setSelectedTween(i);
          const target = doc.timeline[i]?.target;
          if (target) onSelectEl(target);
        }}
        onDrag={(i, patch) => setDoc(updateTween(doc, i, patch), `tween:${i}:drag`)}
        onAdd={() => {
          const target = node?.id ?? doc.nodes.find((n) => n.kind !== "box")?.id ?? doc.nodes[0]?.id;
          if (!target) return;
          setDoc(addTween(doc, { target, preset: "fade-in", at: 0.3 }));
          setSelectedTween(doc.timeline.length);
        }}
      />

      {tween && selectedTween !== null && (
        <TweenInspector
          key={selectedTween}
          tween={tween}
          doc={doc}
          narration={scene.narration}
          idPrefix={`${idPrefix}-tw${selectedTween}`}
          onChange={(patch, field) => setDoc(updateTween(doc, selectedTween, patch), `tween:${selectedTween}:${field}`)}
          onDuplicate={() => {
            setDoc(duplicateTween(doc, selectedTween));
            setSelectedTween(selectedTween + 1);
          }}
          onDelete={() => {
            setDoc(removeTween(doc, selectedTween));
            setSelectedTween(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function nodeSummary(n: SceneNode): string {
  if (n.text) return `“${n.text}”`;
  if (n.value) return n.value;
  if (n.page) return sourceLabel(n.page);
  if (n.icon) return n.icon;
  return "";
}

function ElementList({ doc, rows, selectedEl, onSelect, onAdd }: { doc: SceneDoc; rows: { node: SceneNode; depth: number }[]; selectedEl: string | null; onSelect: (id: string) => void; onAdd: (kind: SceneNodeKind) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Elements</span>
        <Select aria-label="Add an element" value="" onChange={(e) => e.target.value && onAdd(e.target.value as SceneNodeKind)} className="h-7 w-auto text-xs">
          <option value="">Add…</option>
          {(Object.keys(NODE_KIND_LABELS) as SceneNodeKind[]).map((k) => (
            <option key={k} value={k}>
              {NODE_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-[11px] text-muted-foreground">Click an element here or in the preview to edit it.</p>
      <ul className="flex flex-col rounded-md border border-border" role="listbox" aria-label="Elements in this scene">
        {rows.map(({ node, depth }) => (
          <li key={node.id} role="option" aria-selected={node.id === selectedEl}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className={cn("flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-accent", node.id === selectedEl && "bg-primary/15 text-foreground")}
              style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
            >
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{node.parent === FULL_LAYER ? "bg" : NODE_KIND_LABELS[node.kind].split(" ")[0]}</span>
              <span className="shrink-0 font-medium">{node.id}</span>
              <span className="min-w-0 truncate text-muted-foreground">{nodeSummary(node)}</span>
              {doc.timeline.some((t) => t.target === node.id) && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary/70" title="Animated" aria-label="animated" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StyleField({ id, label, value, onChange }: { id: string; label: string; value: string | undefined; onChange: (v: string) => void }) {
  const dropped = sanitizeDeclarations(value).dropped.filter((d) => !d.endsWith("replaced by absolute"));
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Textarea id={id} value={value ?? ""} rows={3} spellCheck={false} className="font-mono text-[11px]" placeholder="e.g. font-size:96px; color:var(--accent-text)" onChange={(e) => onChange(e.target.value)} />
      {dropped.length > 0 && <p className="text-[11px] text-warning">Ignored: {dropped.join("; ")}</p>}
    </div>
  );
}

function NodeInspector({
  node,
  doc,
  scene,
  facts,
  sourcePages,
  idPrefix,
  onChange,
  onMove,
  onDelete,
}: {
  node: SceneNode;
  doc: SceneDoc;
  scene: StoryboardScene;
  facts: FactLedger;
  sourcePages: string[];
  idPrefix: string;
  onChange: (patch: Partial<SceneNode>, field: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const citedOnPage = facts.filter((f) => scene.factIds.includes(f.id) && f.sourceUrl === node.page);
  const parents = doc.nodes.filter((n) => n.kind === "box" && n.id !== node.id);
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {node.id} <span className="font-normal text-muted-foreground">· {NODE_KIND_LABELS[node.kind]}</span>
        </span>
        <Button size="icon-sm" variant="ghost" onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Delete element">
          <Trash2 />
        </Button>
      </div>

      {node.kind === "text" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${idPrefix}-text`} className="text-xs text-muted-foreground">
              Text
            </label>
            {node.text?.trim() && <FactBadge grounding={groundText(node.text, scene.factIds, facts)} />}
          </div>
          <Textarea id={`${idPrefix}-text`} rows={2} value={node.text ?? ""} onChange={(e) => onChange({ text: e.target.value }, "text")} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={node.role === "decor"} onChange={(e) => onChange({ role: e.target.checked ? "decor" : undefined }, "role")} />
            Decorative (texture, not read — exempt from reading time)
          </label>
        </div>
      )}
      {node.kind === "count" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-value`} className="text-xs text-muted-foreground">
            Figure (exactly as a cited fact writes it)
          </label>
          <Input id={`${idPrefix}-value`} value={node.value ?? ""} onChange={(e) => onChange({ value: e.target.value }, "value")} />
        </div>
      )}
      {(node.kind === "frame" || node.kind === "shot" || node.kind === "image") && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-page`} className="text-xs text-muted-foreground">
              Page or picture
            </label>
            <Select id={`${idPrefix}-page`} value={node.page ?? ""} onChange={(e) => onChange({ page: e.target.value, fact: undefined }, "page")}>
              <option value="">Choose…</option>
              {[...new Set([...(node.page ? [node.page] : []), ...sourcePages])].map((u) => (
                <option key={u} value={u}>
                  {sourceLabel(u)}
                </option>
              ))}
            </Select>
          </div>
          {node.kind !== "image" && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idPrefix}-fact`} className="text-xs text-muted-foreground">
                Camera target (a “focus” motion moves onto it)
              </label>
              <Select id={`${idPrefix}-fact`} value={node.fact ?? ""} onChange={(e) => onChange({ fact: e.target.value || undefined }, "fact")}>
                <option value="">First cited fact on this page</option>
                {citedOnPage.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} · {f.text.slice(0, 50)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </>
      )}
      {node.kind === "icon" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-icon`} className="text-xs text-muted-foreground">
            Icon
          </label>
          <Select id={`${idPrefix}-icon`} value={node.icon ?? ""} onChange={(e) => onChange({ icon: e.target.value }, "icon")}>
            {ICON_CHOICES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-parent`} className="text-xs text-muted-foreground">
          Inside
        </label>
        <Select
          id={`${idPrefix}-parent`}
          value={node.parent ?? SAFE_LAYER}
          onChange={(e) => onChange({ parent: e.target.value === SAFE_LAYER ? undefined : e.target.value }, "parent")}
        >
          <option value={SAFE_LAYER}>The frame (title-safe area)</option>
          <option value={FULL_LAYER}>The background (full frame, behind)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              Group “{p.id}”
            </option>
          ))}
        </Select>
      </div>
      <StyleField id={`${idPrefix}-style`} label="Style (CSS)" value={node.style} onChange={(v) => onChange({ style: v }, "style")} />
      <StyleField id={`${idPrefix}-narrow`} label="Portrait & square overrides" value={node.narrow} onChange={(v) => onChange({ narrow: v }, "narrow")} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

function Timeline({
  doc,
  durationSec,
  selectedEl,
  selectedTween,
  onSelectTween,
  onDrag,
  onAdd,
}: {
  doc: SceneDoc;
  durationSec: number;
  selectedEl: string | null;
  selectedTween: number | null;
  onSelectTween: (i: number) => void;
  onDrag: (i: number, patch: Partial<SceneTween>) => void;
  onAdd: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; mode: "move" | "resize"; x0: number; at0: number; dur0: number } | null>(null);
  const span = Math.max(durationSec, ...doc.timeline.map((t) => t.at + tweenLength(t, partCount(doc, t))), 1);
  const pct = (s: number) => `${(Math.max(0, s) / span) * 100}%`;

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const width = track.current?.getBoundingClientRect().width ?? 0;
    if (!d || width <= 0) return;
    const dt = ((e.clientX - d.x0) / width) * span;
    if (d.mode === "move") onDrag(d.i, { at: round2(Math.max(0, Math.min(durationSec, snap(d.at0 + dt)))) });
    else onDrag(d.i, { duration: round2(Math.max(SNAP, snap(d.dur0 + dt))) });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Motion</span>
        <Button size="xs" variant="secondary" onClick={onAdd}>
          <Plus /> Add motion
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Drag a bar to move it, its right edge to change its length. The dashed line is the scene&apos;s end.</p>
      <div className="relative flex flex-col gap-0.5 rounded-md border border-border p-1.5" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        <div className="relative ml-20 h-4 text-[9px] text-muted-foreground" aria-hidden>
          {Array.from({ length: Math.floor(span) + 1 }, (_, s) => (
            <span key={s} className="absolute -translate-x-1/2 font-mono" style={{ left: pct(s) }}>
              {s}s
            </span>
          ))}
        </div>
        {doc.timeline.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Nothing moves yet.</p>}
        {doc.timeline.map((t, i) => {
          const len = tweenLength(t, partCount(doc, t));
          const label = t.preset ?? (t.to ? "to" : "from");
          return (
            <div key={i} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelectTween(i)}
                className={cn("w-19 shrink-0 truncate text-left text-[10px]", t.target === selectedEl ? "text-foreground" : "text-muted-foreground")}
                title={`${t.target} · ${label}`}
              >
                {t.target}
              </button>
              <div ref={i === 0 ? track : undefined} className="relative h-5 min-w-0 flex-1 rounded-sm bg-secondary/60">
                <div className="absolute inset-y-0 border-r border-dashed border-muted-foreground/60" style={{ left: 0, width: pct(durationSec) }} aria-hidden />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={`${t.target} ${label}, starts at ${t.at.toFixed(2)}s`}
                  aria-valuemin={0}
                  aria-valuemax={durationSec}
                  aria-valuenow={t.at}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      onDrag(i, { at: round2(Math.max(0, Math.min(durationSec, t.at + (e.key === "ArrowLeft" ? -SNAP : SNAP)))) });
                    }
                  }}
                  onPointerDown={(e) => {
                    onSelectTween(i);
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    drag.current = { i, mode: (e.target as HTMLElement).dataset.handle ? "resize" : "move", x0: e.clientX, at0: t.at, dur0: t.duration ?? tweenLength({ ...t, repeat: 0, stagger: 0 }) };
                  }}
                  className={cn(
                    "absolute inset-y-0.5 flex min-w-2 cursor-grab items-center overflow-hidden rounded-sm px-1 text-[9px] text-white active:cursor-grabbing",
                    i === selectedTween ? "bg-primary ring-1 ring-primary-foreground/60" : t.target === selectedEl ? "bg-primary/70" : "bg-primary/40",
                  )}
                  style={{ left: pct(t.at), width: pct(len) }}
                >
                  {t.anchor && <Link2 className="mr-0.5 size-2.5 shrink-0" aria-label="synced" />}
                  <span className="truncate">{label}</span>
                  <span data-handle="1" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/30" aria-hidden />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NumberField({ id, label, value, step = 0.05, min, max, onChange }: { id: string; label: string; value: number | undefined; step?: number; min?: number; max?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ""}
        className="h-8 text-xs"
        onChange={(e) => onChange(e.target.value === "" ? undefined : round2(Number(e.target.value)))}
      />
    </div>
  );
}

function TweenInspector({
  tween,
  doc,
  narration,
  idPrefix,
  onChange,
  onDuplicate,
  onDelete,
}: {
  tween: SceneTween;
  doc: SceneDoc;
  narration: string | undefined;
  idPrefix: string;
  onChange: (patch: Partial<SceneTween>, field: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const target = doc.nodes.find((n) => n.id === tween.target);
  const words = anchorWords(narration);
  const anchorValue = tween.anchor ?? "";
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">Motion on {tween.target}</span>
        <Button size="icon-sm" variant="ghost" onClick={onDuplicate} aria-label="Duplicate motion">
          <Copy />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Delete motion">
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-target`} className="text-[11px] text-muted-foreground">
            Element
          </label>
          <Select id={`${idPrefix}-target`} value={tween.target} onChange={(e) => onChange({ target: e.target.value }, "target")} className="h-8 text-xs">
            {doc.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-part`} className="text-[11px] text-muted-foreground">
            Moves
          </label>
          <Select id={`${idPrefix}-part`} value={tween.part ?? ""} onChange={(e) => onChange({ part: (e.target.value || undefined) as SceneTween["part"] }, "part")} className="h-8 text-xs">
            <option value="">{tween.preset ? "As the preset says" : "The element"}</option>
            <option value="self">The element</option>
            {target?.kind === "text" && <option value="words">Each word</option>}
            {target?.kind === "text" && <option value="chars">Each letter</option>}
            {target?.kind === "box" && <option value="children">Each child, in turn</option>}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-preset`} className="text-[11px] text-muted-foreground">
            Motion
          </label>
          <Select id={`${idPrefix}-preset`} value={tween.preset ?? ""} onChange={(e) => onChange({ preset: e.target.value || undefined }, "preset")} className="h-8 text-xs">
            <option value="">Custom (from / to)</option>
            {PRESET_CHOICES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-ease`} className="text-[11px] text-muted-foreground">
            Ease
          </label>
          <Select id={`${idPrefix}-ease`} value={tween.ease ?? ""} onChange={(e) => onChange({ ease: e.target.value || undefined }, "ease")} className="h-8 text-xs">
            <option value="">{tween.preset ? "Preset's own" : "power2.out"}</option>
            {[...new Set([...(tween.ease ? [tween.ease] : []), ...EASE_PICKS])].map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        </div>
        <NumberField id={`${idPrefix}-at`} label="Starts at (s)" value={tween.at} min={0} onChange={(v) => onChange({ at: v ?? 0 }, "at")} />
        <NumberField id={`${idPrefix}-dur`} label="Length (s)" value={tween.duration} min={0} onChange={(v) => onChange({ duration: v }, "duration")} />
        <NumberField id={`${idPrefix}-stagger`} label="Stagger (s)" value={tween.stagger} min={0} onChange={(v) => onChange({ stagger: v }, "stagger")} />
        <NumberField id={`${idPrefix}-repeat`} label="Repeats" value={tween.repeat} step={1} min={0} max={12} onChange={(v) => onChange({ repeat: v }, "repeat")} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-from`} className="text-[11px] text-muted-foreground">
          From
        </label>
        <Input id={`${idPrefix}-from`} value={tween.from ?? ""} placeholder="opacity:0; y:40" className="h-8 font-mono text-[11px]" onChange={(e) => onChange({ from: e.target.value || undefined }, "from")} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-to`} className="text-[11px] text-muted-foreground">
          To
        </label>
        <Input id={`${idPrefix}-to`} value={tween.to ?? ""} placeholder="scale:1.1; color:var(--accent)" className="h-8 font-mono text-[11px]" onChange={(e) => onChange({ to: e.target.value || undefined }, "to")} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-anchor`} className="text-[11px] text-muted-foreground">
            Sync to
          </label>
          <Select id={`${idPrefix}-anchor`} value={anchorValue} onChange={(e) => onChange({ anchor: e.target.value || undefined }, "anchor")} className="h-8 text-xs">
            <option value="">Its start time</option>
            {anchorValue.startsWith("word:") && !words.some((w) => `word:${w}` === anchorValue) && <option value={anchorValue}>“{anchorValue.slice(5)}”</option>}
            {words.map((w) => (
              <option key={w} value={`word:${w}`}>
                The voice saying “{w}”
              </option>
            ))}
            <option value="beat">The next music beat</option>
            <option value="end">The end of the scene</option>
          </Select>
        </div>
        <NumberField id={`${idPrefix}-offset`} label="Offset from it (s)" value={tween.offset} onChange={(v) => onChange({ offset: v }, "offset")} />
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-sfx`} className="text-[11px] text-muted-foreground">
            Sound
          </label>
          <Select id={`${idPrefix}-sfx`} value={tween.sfx ?? ""} onChange={(e) => onChange({ sfx: e.target.value || undefined }, "sfx")} className="h-8 text-xs">
            <option value="">None</option>
            {SFX_CHOICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={!!tween.yoyo} onChange={(e) => onChange({ yoyo: e.target.checked || undefined }, "yoyo")} /> Back and forth
        </label>
      </div>
    </div>
  );
}
