"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { API_BASE } from "@/lib/api/client";
import type { JobEvent } from "@sitereel/shared";

export type JobEventsConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** No bytes (not even a heartbeat — the server pings every 15 s) for this long ⇒ treat the stream as dead. */
const STALL_TIMEOUT_MS = 45_000;

function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return exp / 2 + Math.random() * (exp / 2); // "equal jitter"
}

class NonRetryableError extends Error {}

/**
 * Browser EventSource can't attach an Authorization header, and the backend
 * requires one (§4.3 "owner" auth on every job route) — so this hook drives
 * the SSE stream manually over fetch + ReadableStream.
 *
 * Reconnect/replay (§3.7 StageTracker): every job-event frame carries a
 * per-job monotonic `id`. On disconnect the hook reconnects with exponential
 * backoff + jitter, sending `Last-Event-ID` so the backend replays only what
 * was missed; events are deduped by id. 401s re-read the Supabase session
 * (it refreshes tokens) and retry; 403/404 stop for good.
 *
 * Return shape is backwards compatible: `{ events, connected }` plus
 * `connectionState` and `lastEventId`.
 */
export function useJobEvents(jobId: string | undefined) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [connectionState, setConnectionState] = useState<JobEventsConnectionState>("idle");
  const [lastEventId, setLastEventId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!jobId) {
      setConnectionState("idle");
      return;
    }
    setEvents([]);
    setLastEventId(undefined);

    const controller = new AbortController();
    let lastId: number | undefined;
    let attempt = 0;
    let stopped = false;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });

    function handleFrame(frame: string) {
      let id: number | undefined;
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith(":")) continue; // comment / heartbeat
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "id" && /^\d+$/.test(value)) id = Number(value);
        else if (field === "event") eventName = value;
        else if (field === "data") dataLines.push(value);
      }
      if (eventName !== "job-event" || dataLines.length === 0) return;
      if (id !== undefined) {
        if (lastId !== undefined && id <= lastId) return; // duplicate from replay overlap
        lastId = id;
        setLastEventId(id);
      }
      try {
        const parsed = JSON.parse(dataLines.join("\n"));
        if (parsed && typeof parsed === "object" && "jobId" in parsed && "stage" in parsed) {
          setEvents((prev) => [...prev, parsed as JobEvent]);
        }
      } catch {
        // ignore malformed frame
      }
    }

    async function connectOnce(): Promise<void> {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new NonRetryableError("no session");

      const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}`, Accept: "text/event-stream" };
      if (lastId !== undefined) headers["Last-Event-ID"] = String(lastId);

      const res = await fetch(`${API_BASE}/api/jobs/${jobId}/events`, { headers, signal: controller.signal, cache: "no-store" });
      if (res.status === 403 || res.status === 404) throw new NonRetryableError(`events ${res.status}`);
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`);

      setConnectionState("open");
      attempt = 0;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => reader.cancel().catch(() => undefined), STALL_TIMEOUT_MS);
      };
      armStall();

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          armStall();
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) handleFrame(frame);
        }
      } finally {
        clearTimeout(stallTimer);
      }
    }

    (async () => {
      while (!stopped && !controller.signal.aborted) {
        setConnectionState(attempt === 0 && lastId === undefined ? "connecting" : "reconnecting");
        try {
          await connectOnce();
          // Server closed the stream cleanly (deploy, proxy timeout) — reconnect promptly.
        } catch (err) {
          if (controller.signal.aborted) break;
          if (err instanceof NonRetryableError) {
            stopped = true;
            break;
          }
        }
        if (controller.signal.aborted) break;
        setConnectionState("reconnecting");
        await sleep(backoffDelay(attempt));
        attempt += 1;
      }
      if (!controller.signal.aborted) setConnectionState("closed");
    })();

    return () => {
      stopped = true;
      controller.abort();
      setConnectionState("idle");
    };
  }, [jobId]);

  return { events, connected: connectionState === "open", connectionState, lastEventId };
}
