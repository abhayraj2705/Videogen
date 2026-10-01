"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface AnimatedGridProps {
  className?: string;
  /** Grid cell size in px. */
  cellSize?: number;
  /** How many cells are lit at once. */
  numSquares?: number;
  maxOpacity?: number;
  /** Seconds per fade in/out cycle. */
  duration?: number;
}

type Square = { id: number; pos: [number, number] };

/**
 * Ambient grid background for the landing hero (§3.3). Some cells softly
 * fade in and out at random positions. Under prefers-reduced-motion only the
 * static grid lines render — no animated cells.
 */
export function AnimatedGrid({ className, cellSize = 40, numSquares = 24, maxOpacity = 0.25, duration = 4 }: AnimatedGridProps) {
  const id = useId().replace(/:/g, "");
  const reduceMotion = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [squares, setSquares] = useState<Square[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduceMotion || !dims.width || !dims.height) return;
    const cols = Math.max(1, Math.floor(dims.width / cellSize));
    const rows = Math.max(1, Math.floor(dims.height / cellSize));
    const randomPos = (): [number, number] => [Math.floor(Math.random() * cols), Math.floor(Math.random() * rows)];
    setSquares(Array.from({ length: numSquares }, (_, i) => ({ id: i, pos: randomPos() })));
  }, [dims, cellSize, numSquares, reduceMotion]);

  function relocate(squareId: number) {
    const cols = Math.max(1, Math.floor(dims.width / cellSize));
    const rows = Math.max(1, Math.floor(dims.height / cellSize));
    setSquares((prev) =>
      prev.map((s) =>
        s.id === squareId ? { ...s, pos: [Math.floor(Math.random() * cols), Math.floor(Math.random() * rows)] } : s,
      ),
    );
  }

  return (
    <svg
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full fill-primary/30 stroke-white/[0.06]",
        className,
      )}
    >
      <defs>
        <pattern id={`grid-${id}`} width={cellSize} height={cellSize} patternUnits="userSpaceOnUse">
          <path d={`M.5 ${cellSize}V.5H${cellSize}`} fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#grid-${id})`} />
      {!reduceMotion &&
        squares.map(({ id: sid, pos: [x, y] }, index) => (
          <motion.rect
            key={`${sid}-${x}-${y}`}
            width={cellSize - 1}
            height={cellSize - 1}
            x={x * cellSize + 1}
            y={y * cellSize + 1}
            strokeWidth="0"
            initial={{ opacity: 0 }}
            animate={{ opacity: maxOpacity }}
            transition={{ duration, repeat: 1, delay: index * 0.1, repeatType: "reverse" }}
            onAnimationComplete={() => relocate(sid)}
          />
        ))}
    </svg>
  );
}
