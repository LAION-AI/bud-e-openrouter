/**
 * @file audioNote.ts
 * @description Recording a narration for a slide, and making it small.
 *
 *              The browser records in whatever it likes - Opus in WebM on
 *              Chrome and Firefox, AAC in MP4 on Safari - and PowerPoint
 *              plays none of the former. So every recording is decoded once
 *              and encoded as MP3: mono, 22 kHz, 48 kbit/s, which is about
 *              360 KB per minute of speech, plays in every browser, in
 *              PowerPoint, Keynote and LibreOffice, and needs no second
 *              format for the file.
 *
 *              The encoder is lamejs, served from static/lame.min.js and
 *              loaded the first time it is needed. Not bundled: its build
 *              relies on globals that a bundler pulls apart ("Lame is not
 *              defined", and the whole page with it), and as a separate,
 *              replaceable file it also sits right with its LGPL licence.
 */

/** A narration as it lives on a slide. */
export interface AudioNote {
  /** data: URL, audio/mpeg unless it came from a file in another format. */
  src: string;
  seconds: number;
}

const SAMPLE_RATE = 22050;
const KBPS = 48;

interface LameLib {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
    encodeBuffer: (left: Int16Array) => Int8Array;
    flush: () => Int8Array;
  };
}

let lamePromise: Promise<LameLib> | null = null;

/**
 * The encoder, loaded once.
 *
 * In the browser it is a script tag; under Deno (the tests) the file is
 * read and evaluated in the global scope, which is what a script tag does.
 */
export function loadLame(): Promise<LameLib> {
  if (lamePromise) return lamePromise;
  const g = globalThis as unknown as { lamejs?: LameLib; document?: Document };
  if (g.lamejs) return (lamePromise = Promise.resolve(g.lamejs));
  lamePromise = (async () => {
    if (g.document) {
      await new Promise<void>((resolve, reject) => {
        const s = g.document!.createElement("script");
        s.src = "/lame.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("lame.min.js konnte nicht geladen werden"));
        g.document!.head.appendChild(s);
      });
    } else {
      const src = await (globalThis as unknown as { Deno: { readTextFile: (p: URL) => Promise<string> } }).Deno
        .readTextFile(new URL("../static/lame.min.js", import.meta.url));
      (0, eval)(src);
    }
    const lib = (globalThis as unknown as { lamejs?: LameLib }).lamejs;
    if (!lib) throw new Error("lamejs fehlt nach dem Laden");
    return lib;
  })();
  return lamePromise;
}

export interface Recorder {
  /** Stops and returns what was recorded, already as MP3. */
  stop: () => Promise<AudioNote>;
  /** Drops the recording. */
  cancel: () => void;
}

/** Whether this browser can record at all. */
export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Starts recording from the microphone.
 *
 * Asks for permission on the first call; the promise rejects when it is
 * refused, with the browser's own reason. The encoder starts loading at the
 * same time, so it is there by the time the recording stops.
 */
export async function startRecording(): Promise<Recorder> {
  loadLame().catch(() => {});
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", ""]
    .find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const started = performance.now();
  rec.start(250);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise<AudioNote>((resolve, reject) => {
        rec.onstop = async () => {
          release();
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
            resolve(await blobToMp3(blob, (performance.now() - started) / 1000));
          } catch (err) {
            reject(err);
          }
        };
        rec.stop();
      }),
    cancel: () => {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      release();
    },
  };
}

/** Decodes any recording the browser made and encodes it as MP3. */
export async function blobToMp3(blob: Blob, fallbackSeconds = 0): Promise<AudioNote> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close().catch(() => {});
  }
  // Mono at 22 kHz: speech needs no more, and the file halves twice.
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const mp3 = await encodeMp3(mono, SAMPLE_RATE);
  return { src: `data:audio/mpeg;base64,${toBase64(mp3)}`, seconds: Math.round((decoded.duration || fallbackSeconds) * 10) / 10 };
}

/** PCM floats to MP3 bytes. Also used by the tests, which have no microphone. */
export async function encodeMp3(samples: Float32Array, sampleRate: number): Promise<Uint8Array> {
  const lame = await loadLame();
  const enc = new lame.Mp3Encoder(1, sampleRate, KBPS);
  const block = 1152;
  const out: Uint8Array[] = [];
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  for (let i = 0; i < pcm.length; i += block) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + block));
    if (buf.length) out.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  }
  const tail = enc.flush();
  if (tail.length) out.push(new Uint8Array(tail.buffer, tail.byteOffset, tail.length));
  const total = out.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of out) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Bytes and mime out of a data: URL. */
export function dataUrlParts(src: string): { mime: string; bytes: Uint8Array } {
  const m = src.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) throw new Error("keine data:-URL");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

/** Kilobytes, for the label under the player. */
export function audioKb(note: AudioNote): number {
  return Math.round((note.src.length * 3) / 4 / 1024);
}
