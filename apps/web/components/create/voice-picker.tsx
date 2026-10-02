"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VOICES, voiceSamplePath, type VoiceLanguage } from "@/lib/voices";
import { cn } from "@/lib/utils";

/**
 * §3.7 VoicePicker — radio list of voices with a sample button each. Only one
 * sample plays at a time. Samples missing from public/voices render a
 * disabled play button with an explanatory tooltip.
 */
export function VoicePicker({
  language,
  value,
  onChange,
  availableSamples,
  disabled,
}: {
  language: VoiceLanguage;
  value: string;
  onChange: (id: string) => void;
  availableSamples: string[];
  disabled?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // Changing language stops any sample in flight.
  useEffect(() => {
    audioRef.current?.pause();
    setPlaying(null);
  }, [language]);

  function toggle(path: string) {
    if (playing === path) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(path);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    audio.onerror = () => {
      setPlaying(null);
      setBroken((prev) => new Set(prev).add(path));
    };
    audio.play().then(
      () => setPlaying(path),
      () => setPlaying(null),
    );
  }

  return (
    <div role="radiogroup" aria-label="Voice" className={cn("grid gap-2 sm:grid-cols-3", disabled && "pointer-events-none opacity-50")}>
      {VOICES.map((v) => {
        const path = voiceSamplePath(language, v.id);
        const hasSample = availableSamples.includes(path) && !broken.has(path);
        const selected = v.id === value;
        const inputId = `voice-${v.id}`;
        return (
          <div
            key={v.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
              selected ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
            )}
          >
            <input
              id={inputId}
              type="radio"
              name="voice"
              value={v.id}
              checked={selected}
              onChange={() => onChange(v.id)}
              disabled={disabled}
              className="peer sr-only"
            />
            <Label htmlFor={inputId} className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 peer-focus-visible:underline">
              <span className="text-sm font-medium">{v.name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{v.description}</span>
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span wrapper so the tooltip still works on a disabled button */}
                <span tabIndex={hasSample ? -1 : 0}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!hasSample || disabled}
                    onClick={() => toggle(path)}
                    aria-label={playing === path ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
                  >
                    {playing === path ? <Pause /> : <Play />}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{hasSample ? "Play a 3-second sample" : "Sample not available yet"}</TooltipContent>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
