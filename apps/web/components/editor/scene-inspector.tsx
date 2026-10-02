"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Mic, Pause, Play, Plus, X } from "lucide-react";
import type { FactLedger, StoryboardScene, TemplateId } from "@sitereel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FactBadge, FactChip } from "@/components/editor/fact-badge";
import { PropsEditor } from "@/components/editor/props-editor";
import { citedFacts, groundNarration, groundText, sourceLabel } from "@/lib/editor/grounding";
import { NARRATION_SOFT_LIMIT, TEMPLATE_IDS, templateLabel } from "@/lib/editor/templates";
import type { EditOptions } from "@/lib/editor/history-store";
import type { ValidationError } from "@/lib/api/phase6";
import { cn } from "@/lib/utils";

function SceneAudioButton({ url }: { url: string | undefined }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    return () => audio.current?.pause();
  }, [url]);
  if (!url) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => {
        if (!audio.current || audio.current.dataset.src !== url) {
          audio.current?.pause();
          audio.current = new Audio(url);
          audio.current.dataset.src = url;
          audio.current.onended = () => setPlaying(false);
          audio.current.onpause = () => setPlaying(false);
        }
        if (playing) {
          audio.current.pause();
        } else {
          audio.current.currentTime = 0;
          void audio.current.play().then(
            () => setPlaying(true),
            () => setPlaying(false),
          );
        }
      }}
      aria-label={playing ? "Stop this line" : "Play this line"}
    >
      {playing ? <Pause /> : <Play />} {playing ? "Stop" : "Play line"}
    </Button>
  );
}

export function SceneInspector({
  scene,
  index,
  facts,
  errors,
  audioUrl,
  audioDurationMs,
  revoicing,
  canRevoice,
  onPatch,
  onRevoice,
}: {
  scene: StoryboardScene;
  index: number;
  facts: FactLedger;
  errors: ValidationError[];
  audioUrl?: string;
  audioDurationMs?: number;
  revoicing: boolean;
  /** Re-voicing synthesizes the *saved* narration — disabled while it has unsaved edits. */
  canRevoice: { ok: boolean; reason?: string };
  onPatch: (patch: Partial<StoryboardScene>, opts?: EditOptions) => void;
  onRevoice: () => void;
}) {
  const key = (field: string) => ({ coalesceKey: `${scene.id}:${field}` });
  const sourcePages = Array.from(new Set(facts.map((f) => f.sourceUrl)));
  const cited = citedFacts(scene.factIds, facts);
  const uncited = facts.filter((f) => !scene.factIds.includes(f.id));
  const narration = scene.narration ?? "";
  const idp = `scene-${scene.id}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground">Scene {index + 1}</p>
        <h2 className="text-base font-semibold tracking-tight">{templateLabel(scene.templateId)}</h2>
      </div>

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs" role="alert">
          {errors.map((e, i) => (
            <li key={i} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" aria-hidden /> {e.message}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idp}-template`} className="text-xs text-muted-foreground">
            Template
          </label>
          <Select id={`${idp}-template`} value={scene.templateId} onChange={(e) => onPatch({ templateId: e.target.value as TemplateId })}>
            {TEMPLATE_IDS.map((t) => (
              <option key={t} value={t}>
                {templateLabel(t)} ({t})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idp}-dur`} className="text-xs text-muted-foreground">
            Seconds
          </label>
          <Input
            id={`${idp}-dur`}
            type="number"
            min={1}
            max={20}
            step={0.1}
            value={scene.durationSec}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) onPatch({ durationSec: Math.round(v * 10) / 10 }, key("duration"));
            }}
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${idp}-narration`} className="text-xs font-medium">
            Narration
          </label>
          {narration.trim() && <FactBadge grounding={groundNarration(narration, scene.factIds, facts)} />}
        </div>
        <Textarea
          id={`${idp}-narration`}
          value={narration}
          rows={4}
          placeholder="No voiceover for this scene"
          onChange={(e) => onPatch({ narration: e.target.value === "" ? undefined : e.target.value }, key("narration"))}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn("font-mono text-[11px]", narration.length > NARRATION_SOFT_LIMIT ? "text-warning" : "text-muted-foreground")}>
            {narration.length}/{NARRATION_SOFT_LIMIT} chars
            {audioDurationMs ? ` · voiced ${(audioDurationMs / 1000).toFixed(1)}s` : ""}
          </span>
          <span className="flex items-center gap-1">
            <SceneAudioButton url={audioUrl} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onRevoice}
              disabled={revoicing || !canRevoice.ok || !narration.trim()}
              title={canRevoice.ok ? undefined : canRevoice.reason}
            >
              {revoicing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Mic />}
              {revoicing ? "Re-voicing…" : "Re-voice line"}
            </Button>
          </span>
        </div>
        {!canRevoice.ok && canRevoice.reason && <p className="text-[11px] text-muted-foreground">{canRevoice.reason}</p>}
      </div>

      <Separator />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium">On-screen text</legend>
        {scene.onScreenText.map((text, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              aria-label={`On-screen text ${i + 1}`}
              value={text}
              onChange={(e) => onPatch({ onScreenText: scene.onScreenText.map((t, j) => (j === i ? e.target.value : t)) }, key(`ost${i}`))}
            />
            {text.trim() && <FactBadge grounding={groundText(text, scene.factIds, facts)} />}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove on-screen text ${i + 1}`}
              onClick={() => onPatch({ onScreenText: scene.onScreenText.filter((_, j) => j !== i) })}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="self-start" onClick={() => onPatch({ onScreenText: [...scene.onScreenText, "New text"] })}>
          <Plus /> Add text
        </Button>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Cited facts</span>
        <div className="flex flex-wrap gap-1.5">
          {scene.factIds.length === 0 && <span className="text-xs text-muted-foreground">None — fine for pure framing / CTA scenes.</span>}
          {scene.factIds.map((id) => (
            <FactChip key={id} id={id} fact={cited.find((f) => f.id === id)} onRemove={() => onPatch({ factIds: scene.factIds.filter((x) => x !== id) })} />
          ))}
        </div>
        {uncited.length > 0 && (
          <Select
            aria-label="Cite another fact"
            value=""
            onChange={(e) => e.target.value && onPatch({ factIds: [...scene.factIds, e.target.value] })}
            className="h-8 text-xs"
          >
            <option value="">Cite a fact…</option>
            {uncited.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id} · {f.text.slice(0, 60)}
                {f.text.length > 60 ? "…" : ""} ({sourceLabel(f.sourceUrl)})
              </option>
            ))}
          </Select>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium">Template text</span>
        <PropsEditor
          props={scene.props}
          factIds={scene.factIds}
          facts={facts}
          sourcePages={sourcePages}
          idPrefix={idp}
          onChange={(next, path) => onPatch({ props: next }, key(`props.${path}`))}
        />
      </div>
    </div>
  );
}
