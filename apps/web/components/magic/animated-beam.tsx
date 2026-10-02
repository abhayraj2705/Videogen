"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface AnimatedBeamProps {
  className?: string;
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  /** Vertical bow of the beam in px (positive bows upward). */
  curvature?: number;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
}

/**
 * Magic UI-style animated beam: an SVG path drawn between two elements inside
 * a positioned container, with a gradient "pulse" travelling along it.
 * Under prefers-reduced-motion the pulse is dropped and only the static path
 * is drawn (§3.9).
 */
export function AnimatedBeam({
  className,
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 4,
  delay = 0,
  pathColor = "var(--muted-foreground)",
  pathWidth = 2,
  pathOpacity = 0.2,
  gradientStartColor = "var(--primary)",
  gradientStopColor = "var(--chart-2)",
}: AnimatedBeamProps) {
  const id = useId().replace(/:/g, "");
  const reduceMotion = useReducedMotion();
  const [path, setPath] = useState("");
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    function update() {
      const container = containerRef.current;
      const from = fromRef.current;
      const to = toRef.current;
      if (!container || !from || !to) return;
      const c = container.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      setBox({ width: c.width, height: c.height });
      const sx = a.left - c.left + a.width / 2;
      const sy = a.top - c.top + a.height / 2;
      const ex = b.left - c.left + b.width / 2;
      const ey = b.top - c.top + b.height / 2;
      const cx = (sx + ex) / 2;
      const cy = (sy + ey) / 2 - curvature;
      setPath(`M ${sx},${sy} Q ${cx},${cy} ${ex},${ey}`);
    }
    update();
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerRef, fromRef, toRef, curvature]);

  const gradient = reverse
    ? { x1: ["90%", "-10%"], x2: ["100%", "0%"] }
    : { x1: ["10%", "110%"], x2: ["0%", "100%"] };

  return (
    <svg
      fill="none"
      width={box.width}
      height={box.height}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("pointer-events-none absolute left-0 top-0", className)}
      viewBox={`0 0 ${box.width} ${box.height}`}
    >
      <path d={path} stroke={pathColor} strokeWidth={pathWidth} strokeOpacity={pathOpacity} strokeLinecap="round" />
      {!reduceMotion && (
        <>
          <path d={path} strokeWidth={pathWidth} stroke={`url(#beam-${id})`} strokeOpacity="1" strokeLinecap="round" />
          <defs>
            <motion.linearGradient
              id={`beam-${id}`}
              gradientUnits="userSpaceOnUse"
              initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
              animate={{ x1: gradient.x1, x2: gradient.x2, y1: ["0%", "0%"], y2: ["0%", "0%"] }}
              transition={{ delay, duration, ease: [0.16, 1, 0.3, 1], repeat: Infinity, repeatDelay: 0 }}
            >
              <stop stopColor={gradientStartColor} stopOpacity="0" />
              <stop stopColor={gradientStartColor} />
              <stop offset="32.5%" stopColor={gradientStopColor} />
              <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
            </motion.linearGradient>
          </defs>
        </>
      )}
    </svg>
  );
}
