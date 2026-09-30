/**
 * Reading-time constants, shared by the planner's validators (packages/shared)
 * and film-runtime's templates — one number, enforced in two places, must
 * never drift apart (§4.6 "Plan": reading floor 0.3s/word, <= 8 words on screen).
 */

export const READING_SECONDS_PER_WORD = 0.3;
export const MAX_WORDS_ON_SCREEN = 8;

export function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

export function minReadSeconds(text: string): number {
  return wordCount(text) * READING_SECONDS_PER_WORD;
}

export function exceedsWordLimit(text: string, limit = MAX_WORDS_ON_SCREEN): boolean {
  return wordCount(text) > limit;
}
