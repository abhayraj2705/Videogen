"use client";

import { cn } from "@/lib/utils";

export interface OptionCardItem<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/** §3.7 OptionCardGroup — radio-style cards, used for format/tone pickers on /new. */
export function OptionCardGroup<T extends string>({
  options,
  value,
  onChange,
  columns = options.length,
}: {
  options: OptionCardItem<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <div role="radiogroup" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              selected ? "border-primary bg-accent text-foreground" : "border-border bg-transparent text-muted-foreground hover:bg-accent/50",
            )}
          >
            <div className="font-medium">{opt.label}</div>
            {opt.description && <div className="text-xs text-muted-foreground">{opt.description}</div>}
          </button>
        );
      })}
    </div>
  );
}
