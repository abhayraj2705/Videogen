"use client";

import { forwardRef, useRef, type ComponentType } from "react";
import { Brain, Clapperboard, Download, Globe, Mic } from "lucide-react";
import { AnimatedBeam } from "@/components/magic/animated-beam";

const STEPS: { icon: ComponentType<{ className?: string }>; label: string; desc: string }[] = [
  { icon: Globe, label: "Your URL", desc: "Paste a link" },
  { icon: Brain, label: "Script", desc: "Grounded in your real content" },
  { icon: Mic, label: "Voice", desc: "English or Hindi" },
  { icon: Clapperboard, label: "Motion", desc: "On-brand scenes" },
  { icon: Download, label: "MP4", desc: "3 formats, ready to post" },
];

const Node = forwardRef<HTMLDivElement, { icon: ComponentType<{ className?: string }>; label: string; desc: string }>(
  ({ icon: Icon, label, desc }, ref) => (
    <div className="z-10 flex w-20 flex-col items-center gap-2 text-center sm:w-28">
      <div
        ref={ref}
        className="flex size-12 items-center justify-center rounded-full border border-border bg-card text-primary shadow-[0_0_30px_-12px_var(--primary)] sm:size-14"
      >
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-medium">{label}</p>
      <p className="hidden text-xs text-muted-foreground sm:block">{desc}</p>
    </div>
  ),
);
Node.displayName = "Node";

/** W1 "How it works": animated beams connect URL → Script → Voice → Motion → MP4. */
export function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);
  const r0 = useRef<HTMLDivElement>(null);
  const r1 = useRef<HTMLDivElement>(null);
  const r2 = useRef<HTMLDivElement>(null);
  const r3 = useRef<HTMLDivElement>(null);
  const r4 = useRef<HTMLDivElement>(null);
  const refs = [r0, r1, r2, r3, r4];

  return (
    <div ref={containerRef} className="relative mx-auto flex w-full max-w-4xl items-start justify-between">
      {STEPS.map((s, i) => (
        <Node key={s.label} ref={refs[i]} {...s} />
      ))}
      {refs.slice(0, -1).map((from, i) => (
        <AnimatedBeam
          key={i}
          containerRef={containerRef}
          fromRef={from}
          toRef={refs[i + 1]!}
          curvature={i % 2 === 0 ? 18 : -18}
          duration={3}
          delay={i * 0.6}
        />
      ))}
    </div>
  );
}
