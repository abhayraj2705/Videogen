"use client";

import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Trash2, Volume2 } from "lucide-react";
import type { StoryboardScene } from "@sitereel/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { templateLabel } from "@/lib/editor/templates";

export function SceneList({
  scenes,
  selectedId,
  playingId,
  errorCounts,
  voiced,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: {
  scenes: StoryboardScene[];
  selectedId: string | null;
  playingId: string | null;
  errorCounts: Record<string, number>;
  voiced: Set<string>;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2" aria-label="Scenes">
        {scenes.map((scene, i) => {
          const selected = scene.id === selectedId;
          const errors = errorCounts[scene.id] ?? 0;
          return (
            <motion.li
              key={scene.id}
              layout={!reduced}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className={cn(
                "group rounded-lg border bg-card text-left transition-colors",
                selected ? "border-primary/70 ring-1 ring-primary/40" : "border-border hover:border-foreground/20",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(scene.id)}
                aria-current={selected ? "true" : undefined}
                className="flex w-full flex-col gap-1 rounded-lg px-3 pb-1 pt-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2 text-xs">
                  <span className={cn("font-mono", playingId === scene.id ? "text-primary" : "text-muted-foreground")}>{i + 1}</span>
                  <span className="truncate font-medium">{templateLabel(scene.templateId)}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{scene.durationSec.toFixed(1)}s</span>
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {scene.narration ? `“${scene.narration}”` : scene.onScreenText.join(" · ") || "No text"}
                </span>
                <span className="flex items-center gap-2 text-[11px]">
                  {errors > 0 && (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertTriangle className="size-3" aria-hidden /> {errors} issue{errors === 1 ? "" : "s"}
                    </span>
                  )}
                  {voiced.has(scene.id) && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Volume2 className="size-3" aria-hidden /> voiced
                    </span>
                  )}
                </span>
              </button>
              {selected && (
                <div className="flex items-center gap-0.5 border-t border-border px-1.5 py-1">
                  <Button size="icon-xs" variant="ghost" onClick={() => onMove(scene.id, -1)} disabled={i === 0} aria-label="Move scene up">
                    <ArrowUp />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => onMove(scene.id, 1)} disabled={i === scenes.length - 1} aria-label="Move scene down">
                    <ArrowDown />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => onDuplicate(scene.id)} aria-label="Duplicate scene">
                    <Copy />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(scene.id)}
                    disabled={scenes.length <= 1}
                    aria-label="Delete scene"
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
