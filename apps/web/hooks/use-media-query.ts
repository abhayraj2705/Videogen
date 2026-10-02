"use client";

import { useSyncExternalStore } from "react";

/** SSR-safe media query subscription (server snapshot = `serverDefault`). */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}
