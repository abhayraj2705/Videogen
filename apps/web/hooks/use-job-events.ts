"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { API_BASE } from "@/lib/api/client";
import type { JobEvent } from "@sitereel/shared";

/**
 * Browser EventSource can't attach an Authorization header, and the backend
 * requires one (§4.3 "owner" auth on every job route) — so this hook drives
 * the SSE stream manually over fetch + ReadableStream instead of new EventSource().
 * Falls back to nothing fancy on error; StageTracker-style reconnect/replay
 * (§3.7) is a Phase 2+ item once jobs run long enough to disconnect mid-job.
 */
export function useJobEvents(jobId: string | undefined) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setEvents([]);

    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${API_BASE}/api/jobs/${jobId}/events`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      setConnected(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine.slice("data: ".length));
            if ("jobId" in parsed && "stage" in parsed) {
              setEvents((prev) => [...prev, parsed as JobEvent]);
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    })().catch(() => setConnected(false));

    return () => {
      controller.abort();
      setConnected(false);
    };
  }, [jobId]);

  return { events, connected };
}
