import type { AspectFormat } from "@sitereel/shared";

/**
 * Mirror of FORMAT_DIMENSIONS in packages/shared. The web app may only use
 * *type* imports from @sitereel/shared: its runtime barrel re-exports Node-only
 * modules (ffmpeg/child_process) and uses `.js` specifiers webpack can't map
 * to `.ts` without next.config changes.
 */
export const FORMAT_DIMENSIONS: Record<AspectFormat, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};
