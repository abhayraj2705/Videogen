"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";

/** Credits used per day (single series → no legend; the card title names it). */
export function UsageChart({ data }: { data: { day: string; label: string; used: number }[] }) {
  const reduced = useReducedMotion();
  const total = data.reduce((n, d) => n + d.used, 0);
  return (
    <figure className="flex flex-col gap-2">
      <div className="h-40 w-full" role="img" aria-label={`Credits used per day over the last ${data.length} days: ${total} in total`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={6} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip
              cursor={{ fill: "var(--accent)", opacity: 0.5 }}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              formatter={(v: number) => [`${v} credit${v === 1 ? "" : "s"}`, "Used"]}
            />
            <Bar dataKey="used" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={!reduced} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {total} credit{total === 1 ? "" : "s"} used in the last {data.length} days
      </figcaption>
    </figure>
  );
}
