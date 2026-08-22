/**
 * @file ttsChunks.ts
 * @description Cuts text into pieces worth sending to a speech synthesiser.
 *
 *              Reading a long answer aloud works by pseudo-streaming: split the
 *              text, synthesise the pieces in parallel, play them strictly in
 *              order. The split is what decides how it sounds. Cutting at every
 *              full stop meant "Ja." became a request of its own - a clipped
 *              little clip with no room for intonation, and one round trip
 *              spent on one word. So a piece must carry at least a handful of
 *              words; anything shorter is merged into the sentence after it.
 */

/**
 * Shortest chunk worth a request of its own.
 *
 * Below this the clip sounds clipped, because the model has no context to put
 * an intonation on, and the round trip is mostly overhead anyway.
 */
export const MIN_TTS_WORDS = 5;

/**
 * Minimum for every chunk after the first.
 *
 * Measured against Gemini 3.1 Flash TTS: a request costs about 1.3 s of fixed
 * overhead on top of roughly 0.12 s per word. Five words therefore return only
 * 1.24 seconds of speech per second spent, while twelve return 1.69 and
 * twenty-eight return 1.88. The first chunk stays small so the voice starts
 * quickly; the ones after it are allowed to grow, which is what lets synthesis
 * outrun playback and keeps the seams inaudible.
 */
export const MIN_TTS_WORDS_FOLLOWUP = 12;

export function countWords(s: string): number {
  return (s.trim().match(/[^\s]+/g) ?? []).length;
}

/**
 * Whether the dot at `dotIdx` really ends a sentence.
 *
 * Numbered lists ("1.") and initials ("A.") carry dots that end nothing, and
 * cutting there produces fragments mid-thought.
 */
export function isValidDot(text: string, dotIdx: number): boolean {
  const left = text.slice(0, dotIdx).trimEnd();
  const m = left.match(/([\p{L}\p{N}]+)\s*$/u);
  if (!m) return false;
  const token = m[1];
  if (/^[A-Za-zÄÖÜäöüß]$/.test(token)) return false; // A. / B.
  if (/^\d+([.)])?$/.test(token)) return false; // 1. / 2)
  return /[\p{L}]{2,}/u.test(token); // needs >=2 letters somewhere
}

/** Index just past every sentence end in `text`. */
export function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (text.slice(i, i + 3) === "...") {
      ends.push(i + 3);
      i += 2;
      continue;
    }
    if (/[!?]/.test(ch) || (ch === "." && isValidDot(text, i))) {
      // Closing quotes and brackets belong to the sentence they end.
      let j = i + 1;
      while (j < text.length && /["'»)\]]/.test(text[j])) j++;
      ends.push(j);
    }
  }
  return ends;
}

/**
 * Splits a finished text into chunks of at least MIN_TTS_WORDS words.
 *
 * Sentence boundaries are kept wherever possible; a sentence too short to stand
 * on its own is merged forwards into the next one. Only the final chunk may
 * fall below the minimum - there is nothing left to merge it with, and dropping
 * it would lose the end of the answer.
 */
export function splitIntoSmartChunks(text: string): string[] {
  const t = text.trim();
  if (!t) return [];

  const chunks: string[] = [];
  let start = 0;

  for (const end of sentenceEnds(t)) {
    if (end <= start) continue;
    const candidate = t.slice(start, end);
    // The first chunk may be short so speaking starts early; later ones are
    // held to a larger size, where a request pays for itself far better.
    const min = chunks.length === 0 ? MIN_TTS_WORDS : MIN_TTS_WORDS_FOLLOWUP;
    if (countWords(candidate) < min) continue; // too short: keep going
    chunks.push(candidate.trim());
    start = end;
  }

  const tail = t.slice(start).trim();
  if (tail) {
    if (chunks.length && countWords(tail) < MIN_TTS_WORDS) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${tail}`;
    } else {
      chunks.push(tail);
    }
  }
  return chunks.filter(Boolean);
}

/**
 * Pulls the first speakable chunk off a growing stream buffer.
 *
 * Returns null while the buffer holds no complete sentence of at least
 * MIN_TTS_WORDS words, so the caller keeps accumulating. Takes the *earliest*
 * valid sentence end rather than the last: speaking then starts as soon as
 * there is enough to say, instead of waiting for the whole paragraph.
 */
export function takeSpeechChunk(
  buffer: string,
  minWords: number = MIN_TTS_WORDS,
): { speak: string; rest: string } | null {
  for (const end of sentenceEnds(buffer)) {
    const candidate = buffer.slice(0, end);
    if (countWords(candidate) >= minWords) {
      return { speak: candidate.trim(), rest: buffer.slice(end) };
    }
  }
  return null;
}
