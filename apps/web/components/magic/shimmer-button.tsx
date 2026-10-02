import * as React from "react";
import { cn } from "@/lib/utils";

export interface ShimmerButtonProps extends React.ComponentProps<"button"> {
  shimmerColor?: string;
  shimmerSize?: string;
  shimmerDuration?: string;
  background?: string;
}

/**
 * Magic UI-style shimmer button: a spark sweeps around the edge. The spark is
 * hidden under prefers-reduced-motion (motion-reduce:hidden), leaving a plain
 * accent-glow button.
 */
export function ShimmerButton({
  className,
  children,
  shimmerColor = "oklch(0.96 0.005 270)",
  shimmerSize = "0.06em",
  shimmerDuration = "3s",
  background = "var(--primary)",
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      style={
        {
          "--spread": "90deg",
          "--shimmer-color": shimmerColor,
          "--cut": shimmerSize,
          "--shimmer-speed": shimmerDuration,
          "--bg": background,
        } as React.CSSProperties
      }
      className={cn(
        "group relative z-0 inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-white/10 px-6 py-3 font-medium text-primary-foreground [background:var(--bg)]",
        "shadow-[0_0_40px_-10px_var(--primary)] outline-none transition-transform duration-150 ease-out focus-visible:ring-[3px] focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {/* spark container */}
      <div className="-z-30 blur-[2px] motion-reduce:hidden [container-type:size] absolute inset-0 overflow-visible">
        <div className="animate-shimmer-slide absolute inset-0 h-[100cqh] [aspect-ratio:1] [border-radius:0] [mask:none]">
          <div className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))] [translate:0_0]" />
        </div>
      </div>
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      {/* backdrop */}
      <div className="absolute -z-20 [background:var(--bg)] [border-radius:inherit] [inset:var(--cut)]" />
    </button>
  );
}
