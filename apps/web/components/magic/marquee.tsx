import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MarqueeProps {
  className?: string;
  children: ReactNode;
  reverse?: boolean;
  pauseOnHover?: boolean;
  vertical?: boolean;
  /** How many copies of the children to render back to back (≥ 2 for a seamless loop). */
  repeat?: number;
  /** Seconds per loop. */
  duration?: number;
  gap?: string;
}

/**
 * CSS-only infinite marquee (keyframes live in globals.css). Under
 * prefers-reduced-motion it stops animating and becomes a plain horizontally
 * scrollable strip showing a single copy, so content stays reachable.
 */
export function Marquee({
  className,
  children,
  reverse = false,
  pauseOnHover = true,
  vertical = false,
  repeat = 2,
  duration = 40,
  gap = "1rem",
}: MarqueeProps) {
  return (
    <div
      style={{ "--marquee-duration": `${duration}s`, "--marquee-gap": gap, gap } as CSSProperties}
      className={cn(
        "group flex overflow-hidden p-2 motion-reduce:overflow-x-auto",
        vertical ? "flex-col" : "flex-row",
        className,
      )}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 || undefined}
          style={{ gap }}
          className={cn(
            "flex shrink-0 justify-around motion-reduce:animate-none",
            vertical ? "animate-marquee-vertical flex-col" : "animate-marquee flex-row",
            pauseOnHover && "group-hover:[animation-play-state:paused]",
            reverse && "[animation-direction:reverse]",
            i > 0 && "motion-reduce:hidden",
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
