import { useEffect, useRef, useState } from "preact/hooks";

type FinishMode = "draft" | "send" | "discard";

export default function ClassroomRecorder(
  { disabled, onAudio, onError, onRecordingChange, submitSignal }: {
    disabled: boolean;
    onAudio: (file: File, send: boolean) => Promise<void>;
    onError: (message: string) => void;
    onRecordingChange: (recording: boolean) => void;
    submitSignal: number;
  },
) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const finishMode = useRef<FinishMode>("draft");
  const timer = useRef<number | undefined>(undefined);

  function release() {
    if (timer.current !== undefined) clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    setRecording(false);
    onRecordingChange(false);
  }

  useEffect(() => () => {
    finishMode.current = "discard";
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
  }, []);
  useEffect(() => {
    if (submitSignal > 0) stop("send");
  }, [submitSignal]);

  async function start() {
    if (disabled || starting || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      onError("Dieser Browser kann hier kein Mikrofon aufnehmen.");
      return;
    }
    setStarting(true);
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      stream.current = acquired;
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((type) =>
        MediaRecorder.isTypeSupported(type)
      );
      const current = new MediaRecorder(
        acquired,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = current;
      chunks.current = [];
      finishMode.current = "draft";
      current.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      current.onerror = () => onError("Die Aufnahme ist fehlgeschlagen.");
      current.onstop = () => {
        const mode = finishMode.current;
        const blob = new Blob(chunks.current, {
          type: current.mimeType || "audio/webm",
        });
        chunks.current = [];
        release();
        if (mode === "discard") return;
        if (!blob.size || blob.size > 2_000_000) {
          onError(
            "Die Aufnahme ist leer oder größer als 2 MB. Bitte kürzer sprechen.",
          );
          return;
        }
        const ext = blob.type.includes("mp4")
          ? "m4a"
          : blob.type.includes("ogg")
          ? "ogg"
          : "webm";
        void onAudio(
          new File([blob], `aufnahme.${ext}`, { type: blob.type }),
          mode === "send",
        );
      };
      current.start();
      setRecording(true);
      onRecordingChange(true);
      timer.current = globalThis.setTimeout(() => stop("draft"), 60_000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      onError("Mikrofon nicht verfügbar. Bitte die Browserfreigabe prüfen.");
    } finally {
      setStarting(false);
    }
  }

  function stop(mode: FinishMode) {
    const current = recorder.current;
    if (!current || current.state !== "recording") return;
    finishMode.current = mode;
    current.stop();
  }

  return (
    <div class="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || starting}
        onClick={() => recording ? stop("draft") : void start()}
        title={recording
          ? "Aufnahme stoppen und Text einfügen"
          : "Sprache aufnehmen"}
        aria-label={recording ? "Aufnahme stoppen" : "Sprache aufnehmen"}
        class={`rounded-md p-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          recording
            ? "animate-pulse bg-red-600 text-white"
            : "bg-gray-100 text-blue-600 hover:bg-gray-200"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
        </svg>
      </button>
      {recording && (
        <div class="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span class="font-semibold text-red-700">Aufnahme läuft</span>
          <button
            type="button"
            class="rounded-lg bg-gray-100 px-3 py-2 hover:bg-gray-200"
            onClick={() =>
              stop("draft")}
          >
            Stopp · Text einfügen
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700"
            onClick={() =>
              stop("send")}
          >
            Absenden
          </button>
          <button
            type="button"
            class="rounded-lg bg-gray-100 px-3 py-2 text-red-700 hover:bg-red-50"
            onClick={() => stop("discard")}
            aria-label="Aufnahme verwerfen"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
