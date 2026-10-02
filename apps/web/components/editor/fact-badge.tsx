"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { FactLedgerEntry } from "@sitereel/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sourceLabel, type Grounding } from "@/lib/editor/grounding";
import { cn } from "@/lib/utils";

export function FactSource({ fact }: { fact: FactLedgerEntry }) {
  return (
    <span className="block max-w-72 text-left">
      <span className="block font-medium">“{fact.text}”</span>
      <span className="mt-0.5 block font-mono text-[10px] opacity-75">
        {fact.id} · {fact.kind} · {sourceLabel(fact.sourceUrl)}
      </span>
    </span>
  );
}

/** ✓ fact (grounded — hover lists the source facts) or ⚠ unverified (§3.6 W6). Icon + text, never color alone. */
export function FactBadge({ grounding, className }: { grounding: Grounding; className?: string }) {
  const grounded = grounding.status === "grounded";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            grounded ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
            className,
          )}
          aria-label={grounded ? `Grounded in ${grounding.facts.map((f) => f.id).join(", ")}` : "Unverified — not found in the cited facts"}
        >
          {grounded ? <CheckCircle2 className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
          {grounded ? "fact" : "unverified"}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="flex max-w-80 flex-col gap-2">
        {grounded ? (
          grounding.facts.map((f) => <FactSource key={f.id} fact={f} />)
        ) : (
          <span className="max-w-64">Not found in this scene&apos;s cited facts. Custom claims are allowed, but they&apos;re your responsibility.</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Chip for a cited fact id; hover shows the fact text and its source page. */
export function FactChip({ fact, id, onRemove }: { fact?: FactLedgerEntry; id: string; onRemove?: () => void }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]", fact ? "border-border" : "border-destructive/50 text-destructive")}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="outline-none focus-visible:underline">
            {id}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{fact ? <FactSource fact={fact} /> : "Unknown fact id — the server will reject this."}</TooltipContent>
      </Tooltip>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground" aria-label={`Stop citing ${id}`}>
          ×
        </button>
      )}
    </span>
  );
}
