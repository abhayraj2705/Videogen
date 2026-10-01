"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface BorderBeamProps {
  className?: string;
  /** Length of the travelling beam in px. */
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
  /** Play once instead of looping (W7: "border beam once, then calm"). */
  once?: boolean;
}

/**
 * A light beam that travels around the border of its (relative, rounded) parent.
 * Renders nothing under prefers-reduced-motion — it's purely ambient (§3.3 effects budget).
 */
export function BorderBeam({
  className,
  size = 80,
  duration = 8,
  delay = 0,
  colorFrom = "var(--primary)",
  colorTo = "var(--chart-2)",
  borderWidth = 1.5,
  once = false,
}: BorderBeamProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  return (
    // Outer box clips the beam's layout box so it never causes page overflow;
    // the inner masked box paints only within the border ring.
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
    <div
      className="absolute inset-0 rounded-[inherit] border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
      style={{ borderWidth, borderStyle: "solid" }}
    >
      <motion.div
        className={cn("absolute aspect-square", className)}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
        }}
        initial={{ offsetDistance: "0%", opacity: once ? 1 : undefined }}
        animate={once ? { offsetDistance: "100%", opacity: [1, 1, 0] } : { offsetDistance: ["0%", "100%"] }}
        transition={{ repeat: once ? 0 : Infinity, ease: "linear", duration, delay }}
      />
    </div>
    </div>
  );
}
