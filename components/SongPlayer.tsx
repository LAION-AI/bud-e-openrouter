// components/SongPlayer.tsx
/**
 * Player for a song Lyria wrote.
 *
 * Lyria does not stream its audio: measured against the live API, the lyrics
 * sheet arrives after about 7 seconds and the finished MP3 lands in one piece
 * at around 29 seconds. There is therefore nothing to play along with while it
 * works - what this does instead is put the words on screen as soon as they
 * exist, so the wait has something in it, and start the moment the audio is
 * there (unless the user turned autoplay off).
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { chatTemplateContent } from "../internalization/content.ts";

export interface SongData {
  /** Data URL of the MP3, or an idb:// placeholder before rehydration. */
  url: string;
  /** The lyrics sheet with section markers and timestamps. */
  lyrics?: string;
  title?: string;
  model?: string;
  /** Set while the song is still being generated. */
  pending?: boolean;
}

/** One line of the sheet: "[12.3:] text" or a "[[B1]]" section marker. */
interface SheetLine {
  time?: number;
  text: string;
  section?: string;
}

/**
 * Parses Lyria's lyrics sheet.
 *
 * The format is its own: `[[A0]]`, `[[B1]]`, `[[C2]]` mark sections (intro,
 * verse, chorus, outro in order of appearance), `[12.3:]` starts a line at that
 * second, and a bare `[:]` continues the previous one.
 */
export function parseLyricsSheet(sheet: string): SheetLine[] {
  const out: SheetLine[] = [];
  let last = 0;
  for (const raw of (sheet ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const section = line.match(/^\[\[([A-Z])(\d+)\]\]$/);
    if (section) {
      out.push({ section: section[1], text: "" });
      continue;
    }
    const timed = line.match(/^\[(\d+(?:\.\d+)?):\]\s*(.*)$/);
    if (timed) {
      last = parseFloat(timed[1]);
      out.push({ time: last, text: timed[2] });
      continue;
    }
    const cont = line.match(/^\[:\]\s*(.*)$/);
    if (cont) {
      out.push({ time: last, text: cont[1] });
      continue;
    }
    out.push({ text: line });
  }
  return out.filter((l) => l.text || l.section);
}

/** Human name for Lyria's single-letter section markers. */
function sectionName(letter: string, lang: string): string {
  const de: Record<string, string> = {
    A: "Intro", B: "Strophe", C: "Refrain", D: "Outro", E: "Bridge",
  };
  const en: Record<string, string> = {
    A: "Intro", B: "Verse", C: "Chorus", D: "Outro", E: "Bridge",
  };
  return (lang === "de" ? de : en)[letter] ?? letter;
}

export default function SongPlayer({
  song,
  autoplay,
  lang = "en",
}: {
  song: SongData;
  autoplay: boolean;
  lang?: string;
}) {
  const t = (k: string) =>
    (chatTemplateContent[lang]?.[k] ?? chatTemplateContent.en[k]) as string;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [now, setNow] = useState(0);
  const [showLyrics, setShowLyrics] = useState(true);
  const startedRef = useRef(false);

  const lines = parseLyricsSheet(song.lyrics ?? "");
  const ready = !song.pending && !!song.url && !song.url.startsWith("idb://");

  // Start once, and only once: re-running this on every render would restart
  // the song each time the parent re-renders during streaming.
  useEffect(() => {
    if (!autoplay || !ready || startedRef.current) return;
    const el = audioRef.current;
    if (!el) return;
    startedRef.current = true;
    el.play().catch(() => {
      // Browsers block autoplay without a prior interaction. Nothing to
      // repair here - the play button is right there.
    });
  }, [autoplay, ready]);

  /** The line being sung, for highlighting. */
  const activeIndex = (() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const time = lines[i].time;
      if (time != null && time <= now + 0.15) idx = i;
    }
    return idx;
  })();

  const download = () => {
    const a = document.createElement("a");
    a.href = song.url;
    const name = (song.title ?? "song").replace(/[^\p{L}\p{N} _-]/gu, "").trim();
    a.download = `${name || "song"}.mp3`;
    a.click();
  };

  return (
    <div class="my-3 rounded-xl border border-purple-200 bg-purple-50/70 overflow-hidden">
      <div class="flex items-center justify-between gap-2 px-3 py-2 bg-purple-100/80">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-lg leading-none shrink-0">🎵</span>
          <span class="font-medium text-purple-900 text-sm truncate">
            {song.title || t("songTitle")}
          </span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {lines.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLyrics((v) => !v)}
              class="text-xs px-2 py-0.5 rounded border border-purple-300 text-purple-800 bg-white hover:bg-purple-100"
            >
              {showLyrics ? t("songHideLyrics") : t("songShowLyrics")}
            </button>
          )}
          {ready && (
            <button
              type="button"
              onClick={download}
              title={t("songDownload")}
              class="text-xs px-2 py-0.5 rounded border border-purple-300 text-purple-800 bg-white hover:bg-purple-100"
            >
              ⬇ MP3
            </button>
          )}
        </div>
      </div>

      <div class="px-3 py-2">
        {ready
          ? (
            <audio
              ref={audioRef}
              src={song.url}
              controls
              preload="auto"
              class="w-full"
              onTimeUpdate={(e) => setNow((e.target as HTMLAudioElement).currentTime)}
            />
          )
          : (
            <div class="flex items-center gap-2 text-sm text-purple-800 py-1">
              <span class="inline-block w-3 h-3 rounded-full bg-purple-400 animate-pulse" />
              {t("songGenerating")}
            </div>
          )}
      </div>

      {showLyrics && lines.length > 0 && (
        <div class="px-3 pb-3 max-h-64 overflow-y-auto text-sm">
          {lines.map((l, i) =>
            l.section
              ? (
                <div
                  key={i}
                  class="mt-2 mb-1 text-[11px] uppercase tracking-wide text-purple-500 font-semibold"
                >
                  {sectionName(l.section, lang)}
                </div>
              )
              : (
                <div
                  key={i}
                  class={`leading-relaxed transition-colors ${
                    i === activeIndex
                      ? "text-purple-900 font-medium"
                      : "text-slate-600"
                  }`}
                >
                  {l.text}
                </div>
              )
          )}
        </div>
      )}
    </div>
  );
}
