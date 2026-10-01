"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

export interface NumberTickerProps {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number;
  decimalPlaces?: number;
  className?: string;
}

/** Counts up to `value` once when scrolled into view. Reduced motion: renders the final value immediately. */
export function NumberTicker({ value, startValue = 0, direction = "up", delay = 0, decimalPlaces = 0, className }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(direction === "down" ? value : startValue);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const format = (n: number) =>
    Intl.NumberFormat("en-US", { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces }).format(
      Number(n.toFixed(decimalPlaces)),
    );

  useEffect(() => {
    if (reduceMotion) {
      if (ref.current) ref.current.textContent = format(direction === "down" ? startValue : value);
      return;
    }
    if (!isInView) return;
    const timer = setTimeout(() => motionValue.set(direction === "down" ? startValue : value), delay * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- format is pure on decimalPlaces
  }, [motionValue, isInView, delay, value, direction, startValue, reduceMotion]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- format is pure on decimalPlaces
    [springValue, decimalPlaces],
  );

  return (
    <span ref={ref} className={cn("inline-block tabular-nums tracking-tight", className)}>
      {format(direction === "down" ? value : startValue)}
    </span>
  );
}
