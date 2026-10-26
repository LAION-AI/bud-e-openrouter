/**
 * @file audioJoin.ts
 * @description Joins the spoken chunks of one answer into a single file.
 *
 *              MP3 frames may simply be laid end to end, which is what the
 *              download button always did. WAV may not: every chunk carries its
 *              own 44-byte RIFF header, so concatenating the bytes yields a file
 *              whose header claims the length of the first chunk only - players
 *              stop after it and the rest is silently lost. Since the OpenRouter
 *              route returns WAV (Gemini speaks PCM and nothing else), the
 *              chunks have to be unwrapped and rewrapped in one container.
 */

import { pcmToWav } from "./openrouter.ts";

const ascii = (b: Uint8Array, off: number) =>
  String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);

export interface WavParts {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Uint8Array;
}

/**
 * Reads the format and the samples out of a WAV file.
 *
 * Walks the chunk list rather than assuming a 44-byte header: recorders and
 * APIs like to insert LIST or fact chunks, and a fixed offset would then read
 * metadata as audio.
 */
export function parseWav(bytes: Uint8Array): WavParts | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 0, sampleRate = 0, bitsPerSample = 0;
  let data: Uint8Array | null = null;

  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (size > bytes.length - body) {
      // Truncated chunk: take what is actually there rather than throwing.
      if (id === "data") data = bytes.subarray(body);
      break;
    }
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      data = bytes.subarray(body, body + size);
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }

  if (!data || !channels || !sampleRate || !bitsPerSample) return null;
  return { channels, sampleRate, bitsPerSample, data };
}

/**
 * Joins several WAV files into one.
 *
 * Returns null when a part is not a WAV or the formats differ - splicing 24 kHz
 * mono onto 48 kHz stereo would play at the wrong speed, and a wrong-sounding
 * file is worse than falling back to the plain byte join.
 */
export function concatWav(parts: Uint8Array[]): Uint8Array | null {
  if (parts.length === 0) return null;
  const parsed: WavParts[] = [];
  for (const p of parts) {
    const w = parseWav(p);
    if (!w) return null;
    parsed.push(w);
  }
  const first = parsed[0];
  const same = parsed.every((w) =>
    w.channels === first.channels &&
    w.sampleRate === first.sampleRate &&
    w.bitsPerSample === first.bitsPerSample
  );
  if (!same) return null;

  const total = parsed.reduce((n, w) => n + w.data.length, 0);
  const pcm = new Uint8Array(total);
  let off = 0;
  for (const w of parsed) {
    pcm.set(w.data, off);
    off += w.data.length;
  }
  return pcmToWav(pcm, first.sampleRate, first.channels, first.bitsPerSample);
}

export interface JoinedAudio {
  bytes: Uint8Array;
  mime: string;
  /** File extension without the dot. */
  ext: string;
}

/**
 * Joins the chunks of one answer, picking the right method for the format.
 *
 * WAV parts are unwrapped and rewrapped; anything else (MP3, Ogg) is laid end
 * to end, which is how those formats work.
 */
export function joinAudio(parts: Uint8Array[]): JoinedAudio | null {
  const usable = parts.filter((p) => p && p.length > 0);
  if (usable.length === 0) return null;

  if (usable.length === 1) {
    const one = usable[0];
    const isWav = one.length >= 12 && ascii(one, 0) === "RIFF";
    return {
      bytes: one,
      mime: isWav ? "audio/wav" : "audio/mpeg",
      ext: isWav ? "wav" : "mp3",
    };
  }

  const wav = concatWav(usable);
  if (wav) return { bytes: wav, mime: "audio/wav", ext: "wav" };

  const total = usable.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of usable) {
    out.set(p, off);
    off += p.length;
  }
  return { bytes: out, mime: "audio/mpeg", ext: "mp3" };
}
