"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AspectFormat } from "@sitereel/shared";
import { getMe, mePref } from "@/lib/api/phase6";
import { VOICES } from "@/lib/voices";

/** Applies the user's saved defaults (W12 Settings → Defaults) to the create form once, when /api/me loads. */
export function usePrefDefaults({ setPrimaryFormat, setVoiceId }: { setPrimaryFormat: (f: AspectFormat) => void; setVoiceId: (v: string) => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false, staleTime: 60_000 });
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !me.data) return;
    applied.current = true;
    const format = mePref(me.data, "defaultFormat");
    if (format === "16:9" || format === "9:16" || format === "1:1") setPrimaryFormat(format);
    const voice = mePref(me.data, "defaultVoiceId");
    if (voice && VOICES.some((v) => v.id === voice)) setVoiceId(voice);
  }, [me.data, setPrimaryFormat, setVoiceId]);
}
