// islands/ChatIsland.tsx
// ###############
// ### IMPORTS ###
// ###############

// The ChatIsland component is responsible for managing the chat messages and audio playback.
import ChatTemplate from "../components/ChatTemplate.tsx";

// Buttons separated from ChatTemplate to avoid circular dependencies
import { ChatSubmitButton } from "../components/ChatSubmitButton.tsx";
import ImageUploadButton from "../components/ImageUploadButton.tsx";
import VoiceRecordButton from "../components/VoiceRecordButton.tsx";
import {
  MIN_TTS_WORDS,
  MIN_TTS_WORDS_FOLLOWUP,
  splitIntoSmartChunks,
  takeSpeechChunk,
} from "../utils/ttsChunks.ts";
import { DEFAULT_TTS_PROMPT } from "../utils/openrouter.ts";
import { PdfUploadButton, PdfFile } from "../components/PdfUploadButton.tsx";

// Necessary for streaming service
import {
  EventSourceMessage,
  fetchEventSource,
} from "https://esm.sh/@microsoft/fetch-event-source@2.0.1";
import { useEffect, useRef, useState } from "preact/hooks";

// Internalization
import {
  chatIslandContent,
  mailSyncContent,
  docsContent,
  notebookContent,
} from "../internalization/content.ts";

// Generated/uploaded images are offloaded to IndexedDB so that base64 payloads
// don't blow the localStorage quota.
import {
  IDB_PLACEHOLDER,
  rehydrateImages,
  stripImagesForStorage,
} from "../utils/imageStore.ts";

// Optional sync of the whole local state through an IMAP mailbox the user owns.
import MailSyncModal from "../components/MailSyncModal.tsx";
import NotebookModal from "../components/NotebookModal.tsx";
import DocsModal from "../components/DocsModal.tsx";
import LearningModal from "../components/LearningModal.tsx";
import { schedulePythonBoot } from "../utils/pythonKernel.ts";
import { learningContent } from "../internalization/learning-content.ts";

// Tools the assistant may use once the user grants the matching permission.
import {
  applyDocsAction,
  type DocsAction,
  isDocsAssistantAllowed,
} from "../utils/docsTools.ts";
import { type DocMeta, listDocs } from "../utils/docStore.ts";
import {
  applyNotebookAction,
  isAssistantAllowed as isNotebookAssistantAllowed,
} from "../utils/notebookTools.ts";
import { listNotebooks, type Notebook } from "../utils/notebookStore.ts";
import {
  isMailAllowed,
  loadMailLimits,
  runMailAction,
} from "../utils/mailAssistant.ts";
import {
  applySnapshot,
  AUTO_LABEL,
  clearDirty,
  collectSnapshot,
  DEFAULT_MAIL_ACCOUNT,
  getLastSync,
  guessDeviceName,
  isDirty,
  isMailSyncConfigured,
  KEEP_AUTO_SNAPSHOTS,
  loadMailAccount,
  type MailAccount,
  mailsyncDelete,
  mailsyncDownload,
  mailsyncList,
  mailsyncUpload,
  markDirty,
  saveMailAccount,
  setLastSync,
} from "../utils/mailsyncClient.ts";

// // Import necessary types from Preact
// import { JSX } from 'preact';
import Settings from "../components/Settings.tsx";

// ###############
// ## / IMPORTS ##
// ###############

class RetriableError extends Error {}
class FatalError extends Error {}

// No frontend default for image generation on purpose: when no model is named
// explicitly, the request omits the field and the API uses its own default.

interface Message {
  role: string;
  // deno-lint-ignore no-explicit-any
  content: string | any[];
}

// ---- API result types (kept minimal & safe) ----
interface WikipediaResult {
  Title: string;
  URL: string;
  content: string;
  score: number;
}
interface BildungsplanHit {
  text: string;
  score: number;
}
interface BildungsplanResponse {
  results: BildungsplanHit[];
}
interface PapersItem {
  title: string;
  authors?: string[];
  subjects?: string[];
  abstract?: string;
  doi?: string;
}
interface PapersResponse {
  payload?: { items?: PapersItem[] };
}

// Define the AudioItem interface if not already defined
interface AudioItem {
  audio: HTMLAudioElement & { __text?: string }; // store text for regeneration checks
  played: boolean;
}

// Simple non-streaming JSON-stripper (used in cleanForTTS & elsewhere if needed)
const stripJsonLikeBlocks = (text: string): string => {
  let result = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) result += ch;
  }
  return result;
};

// Define the AudioFileDict type if not already defined
type AudioFileDict = Record<number, Record<number, AudioItem>>;

export default function ChatIsland({ lang }: { lang: string }) {
  // Necessary to load the chat messages from localStorage only once
  const [firstLoad, setFirstLoad] = useState(true);

  // Multiple chats can be stored in localStorage, each chat is identified by a unique suffix
  const [query, setQuery] = useState("");
  const [currentChatSuffix, setCurrentChatSuffix] = useState("0");
  const [localStorageKeys, setLocalStorageKeys] = useState([] as string[]);

  // ---------- DEBUG helper (sendet Logs an den Server) ----------
  const DEBUG = true;
  const serverLog = async (stage: string, detail?: unknown) => {
    if (!DEBUG) return;
    try {
      await fetch("/api/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          chat: currentChatSuffix,
          detail,
        }),
      });
    } catch {
      // debug darf niemals den Flow stören
    }
  };
  // -------------------------------------------------------------

  // dictionary containing audio files for each groupIndex for the current chat
  const [audioFileDict, setAudioFileDict] = useState<AudioFileDict>({});
  const audioFileDictRef = useRef<AudioFileDict>({});

  const playSessionRef = useRef(0);

  // used for STT in VoiceRecordButton
  const [resetTranscript, setResetTranscript] = useState(0);

  // General settings
  const [readAlways, setReadAlways] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [skipCurlyBraces, setSkipCurlyBraces] = useState(false); // NEW: skip { ... } blocks for TTS

  // The concrete “Image” type depends on your uploader; keep as any[] to avoid collisions with DOM Image
  const [images, setImages] = useState([] as any[]);
  const [pdfs, setPdfs] = useState([] as PdfFile[]);

  const [isStreamComplete, setIsStreamComplete] = useState(true);
  /**
   * Seconds a reasoning model has been thinking without producing text yet.
   *
   * Null while nothing is pending. Reasoning models can take a minute on a
   * long prompt before the first character appears, and without this the
   * screen simply sat there and looked broken.
   */
  const [thinkingSince, setThinkingSince] = useState<number | null>(null);
  const [stopList, setStopList] = useState([] as number[]);
  const [currentEditIndex, setCurrentEditIndex] = useState(
    -1 as number | undefined,
  );

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: [chatIslandContent[lang]["welcomeMessage"]],
    },
  ] as Message[]);

  // handy ref for async closures
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /**
   * The TTS code runs long after the render that created it: a fetch takes a
   * second or more, and by then its closure holds the state of a render that
   * is several updates old. Reading these values through refs instead is what
   * keeps manual playback working - the speaker button sets a flag and the
   * arriving chunk has to see it.
   */
  const stopListRef = useRef<number[]>(stopList);
  useEffect(() => {
    stopListRef.current = stopList;
  }, [stopList]);

  // Ein fertiges Lied startet von selbst, wenn der Browser es zulaesst.
  // Umschaltbar, weil ungefragt losspielende Musik im Unterricht stoert.
  /**
   * Transcript between the two correction phases.
   *
   * A ref, not state: a class set of transcripts is megabytes, and putting it
   * in the message list would push it into localStorage where it does not fit.
   */
  const gradingRef = useRef<
    { docs: any[]; pages: any[]; papers: any[] } | null
  >(null);

  const [songAutoplay, setSongAutoplay] = useState(
    () => localStorage.getItem("bud-e-song-autoplay") !== "0",
  );
  const [showSettings, setShowSettings] = useState(false);

  // ---------- Mailbox sync ----------
  const [mailAccount, setMailAccount] = useState<MailAccount>(
    DEFAULT_MAIL_ACCOUNT,
  );
  const [showMailSync, setShowMailSync] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  // Set when a learning path sent the reader here, so the notebook can open
  // at the right example and the path can be picked up again afterwards.
  const [notebookJump, setNotebookJump] = useState<
    { example: string; cell?: number } | null
  >(null);
  const [showLearning, setShowLearning] = useState(false);

  // Permissions are read once per render; both default to off.
  const [notebookToolsAllowed, setNotebookToolsAllowed] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [docsToolsAllowed, setDocsToolsAllowed] = useState(false);
  const [docsRevision, setDocsRevision] = useState(0);
  const [docList, setDocList] = useState<DocMeta[]>([]);
  const activeDocRef = useRef<DocMeta | null>(null);
  /** A .docx from the chat, on its way into the editor. */
  const [incomingDoc, setIncomingDoc] = useState<
    { name: string; bytes: Uint8Array } | null
  >(null);
  const [openDocId, setOpenDocId] = useState<string | undefined>(undefined);

  // The names of the documents travel with every request, so they have to be
  // known before the first one - and they are re-read whenever the window
  // closes or a tool call changed something.
  useEffect(() => {
    setDocsToolsAllowed(isDocsAssistantAllowed());
    listDocs().then(setDocList).catch(() => setDocList([]));
  }, [docsRevision]);
  const [mailToolsAllowed, setMailToolsAllowed] = useState(false);
  /** The notebook the assistant edits: whatever the window last had open. */
  const activeNotebookRef = useRef<Notebook | null>(null);
  /** Bumped when a tool changed a notebook, so the window redraws. */
  const [notebookRevision, setNotebookRevision] = useState(0);

  useEffect(() => {
    setNotebookToolsAllowed(isNotebookAssistantAllowed());
    setMailToolsAllowed(isMailAllowed());
  }, []);
  const [mailSyncStatus, setMailSyncStatus] = useState("");

  // Abort controller for streaming cancel
  const abortRef = useRef<AbortController | null>(null);

  const [settings, setSettings] = useState({
    universalApiKey: localStorage.getItem("bud-e-universal-api-key") || "",
    apiUrl: localStorage.getItem("bud-e-api-url") || "",
    apiKey: localStorage.getItem("bud-e-api-key") || "",
    apiModel: localStorage.getItem("bud-e-model") || "",
    ttsUrl: localStorage.getItem("bud-e-tts-url") || "",
    ttsKey: localStorage.getItem("bud-e-tts-key") || "",
    ttsModel: localStorage.getItem("bud-e-tts-model") || "tts-1",
    sttUrl: localStorage.getItem("bud-e-stt-url") || "",
    sttKey: localStorage.getItem("bud-e-stt-key") || "",
    sttModel: localStorage.getItem("bud-e-stt-model") || "",
    systemPrompt: localStorage.getItem("bud-e-system-prompt") || "",
    vlmUrl: localStorage.getItem("bud-e-vlm-url") || "",
    vlmKey: localStorage.getItem("bud-e-vlm-key") || "",
    vlmModel: localStorage.getItem("bud-e-vlm-model") || "",
    vlmCorrectionModel: localStorage.getItem("bud-e-vlm-correction-model") ||
      "",
    // Per-task model overrides for OpenRouter. Empty means "use the default
    // the server picks", which is what almost everyone will want.
    orLlmModel: localStorage.getItem("bud-e-or-llm-model") || "",
    orVlmModel: localStorage.getItem("bud-e-or-vlm-model") || "",
    orAsrModel: localStorage.getItem("bud-e-or-asr-model") || "",
    orTtsModel: localStorage.getItem("bud-e-or-tts-model") || "",
    orImageModel: localStorage.getItem("bud-e-or-image-model") || "",
    // Stimme, Format und Sprechstil in einem Feld - siehe DEFAULT_TTS_PROMPT.
    ttsPrompt: localStorage.getItem("bud-e-tts-prompt") ?? DEFAULT_TTS_PROMPT,
    orMusicModel: localStorage.getItem("bud-e-or-music-model") || "",
  });

  // NEW: pending manual speak groups (autostart when first chunk arrives)
  const [pendingManualSpeak, setPendingManualSpeak] = useState<Set<number>>(
    new Set(),
  );
  /**
   * Groups the user asked to hear by pressing the speaker. Read through a ref
   * because the flag is set immediately before the TTS requests go out, while
   * the check happens when the first clip comes back - far too late for the
   * state captured in that closure.
   */
  const pendingManualSpeakRef = useRef<Set<number>>(new Set());
  const markManualSpeak = (groupIndex: number) => {
    pendingManualSpeakRef.current = new Set(pendingManualSpeakRef.current).add(
      groupIndex,
    );
    setPendingManualSpeak(new Set(pendingManualSpeakRef.current));
  };
  const clearManualSpeak = (groupIndex: number) => {
    const next = new Set(pendingManualSpeakRef.current);
    next.delete(groupIndex);
    pendingManualSpeakRef.current = next;
    setPendingManualSpeak(new Set(next));
  };

  /** Same reasoning for the read-aloud toggle. */
  const readAlwaysRef = useRef(readAlways);
  useEffect(() => {
    readAlwaysRef.current = readAlways;
  }, [readAlways]);

  /** And for the audio itself, so handlers never work on a stale snapshot. */
  useEffect(() => {
    audioFileDictRef.current = audioFileDict;
  }, [audioFileDict]);

  // ---------- TTS concurrency pool ----------
  // Drei statt zwei: bei den groesseren Folge-Chunks liefert das Modell rund
  // 1,9-fache Echtzeit, drei gleichzeitige Anfragen halten die Wiedergabe
  // damit sicher versorgt, auch wenn eine einmal haengt.
  const TTS_POOL_LIMIT = 3;
  // Hard ceiling for a single /api/tts request. Without it a hanging upstream
  // would occupy a pool slot forever and starve every following chunk.
  const TTS_REQUEST_TIMEOUT_MS = 90_000;
  const ttsActiveRef = useRef(0);
  const ttsQueueRef = useRef<(() => Promise<void>)[]>([]);
  // Bumped whenever the pool runs dry. Nothing pending + nothing active means
  // any still-missing audio index will never arrive, which lets the playback
  // effect safely skip over it instead of waiting forever.
  const [ttsIdleTick, setTtsIdleTick] = useState(0);
  const ttsPoolIdle = () =>
    ttsActiveRef.current === 0 && ttsQueueRef.current.length === 0;
  const pumpTtsQueue = () => {
    while (ttsActiveRef.current < TTS_POOL_LIMIT && ttsQueueRef.current.length) {
      const job = ttsQueueRef.current.shift()!;
      ttsActiveRef.current++;
      job()
        .catch((e) => console.error("TTS job error:", e))
        .finally(() => {
          ttsActiveRef.current--;
          pumpTtsQueue();
          if (ttsPoolIdle()) setTtsIdleTick((n) => n + 1);
        });
    }
  };
  const scheduleTTSJob = (fn: () => Promise<void>) => {
    ttsQueueRef.current.push(fn);
    pumpTtsQueue();
  };

  // ---------- Persistence helper ----------
  const writeChatToStorage = (msgs: Message[], suffix: string) => {
    try {
      const key = "bude-chat-" + suffix;
      localStorage.setItem(key, JSON.stringify(msgs));
      if (!localStorageKeys.includes(key)) {
        setLocalStorageKeys((prev) => [...new Set([...prev, key])]);
      }
    } catch (e: any) {
      if (e?.name === "QuotaExceededError") {
        console.warn("localStorage quota exceeded while saving chat.");
      } else {
        console.warn("Failed to persist messages:", e);
      }
    }
  };

  /** True if any message still carries an inline base64 image payload. */
  const hasInlineImages = (msgs: Message[]) =>
    msgs.some((m) =>
      Array.isArray(m.content) &&
      (m.content as any[]).some((p) =>
        p?.type === "image_url" && p?.id &&
        typeof p?.image_url?.url === "string" &&
        p.image_url.url.startsWith("data:")
      )
    );

  const safePersist = (msgs: Message[], suffix: string) => {
    if (!hasInlineImages(msgs)) {
      writeChatToStorage(msgs, suffix);
      return;
    }
    // Base64 images go to IndexedDB; localStorage only keeps idb:// placeholders.
    stripImagesForStorage(msgs, suffix)
      .then((stripped) => writeChatToStorage(stripped, suffix))
      .catch((e) => {
        console.warn("Failed to offload images to IndexedDB:", e);
        writeChatToStorage(msgs, suffix);
      });
  };

  /** Reads a chat from localStorage (images may still be idb:// placeholders). */
  const loadChatMessages = (suffix: string): Message[] => {
    let parsed: Message[] | null = null;
    try {
      const raw = localStorage.getItem("bude-chat-" + suffix);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("Failed to read chat from localStorage:", e);
    }
    return parsed || [
      {
        role: "assistant",
        content: [chatIslandContent[lang]["welcomeMessage"]],
      },
    ];
  };

  // Guards against out-of-order rehydration when chats are switched quickly.
  const hydrationTokenRef = useRef(0);

  /** Shows messages immediately, then swaps in images loaded from IndexedDB. */
  const applyChatMessages = (msgs: Message[], suffix: string) => {
    const token = ++hydrationTokenRef.current;
    setMessages(msgs);

    const needsHydration = msgs.some((m) =>
      Array.isArray(m.content) &&
      (m.content as any[]).some((p) =>
        p?.type === "image_url" &&
        typeof p?.image_url?.url === "string" &&
        p.image_url.url.startsWith(IDB_PLACEHOLDER)
      )
    );
    if (!needsHydration) return;

    rehydrateImages(msgs, suffix)
      .then((restored) => {
        if (hydrationTokenRef.current === token) setMessages(restored);
      })
      .catch((e) => console.warn("Failed to rehydrate images:", e));
  };
  const persistThrottleRef = useRef<{
    timer?: number;
    pending?: { msgs: Message[]; suffix: string };
  }>({});
  const safePersistThrottled = (msgs: Message[], suffix: string) => {
    persistThrottleRef.current.pending = { msgs, suffix };
    if (persistThrottleRef.current.timer) return;
    persistThrottleRef.current.timer = window.setTimeout(() => {
      const p = persistThrottleRef.current.pending;
      if (p) safePersist(p.msgs, p.suffix);
      if (persistThrottleRef.current.timer) {
        clearTimeout(persistThrottleRef.current.timer);
      }
      persistThrottleRef.current.timer = undefined;
      persistThrottleRef.current.pending = undefined;
    }, 250);
  };
  const flushPersistThrottle = () => {
    const p = persistThrottleRef.current.pending;
    if (p) safePersist(p.msgs, p.suffix);
    if (persistThrottleRef.current.timer) {
      clearTimeout(persistThrottleRef.current.timer);
    }
    persistThrottleRef.current.timer = undefined;
    persistThrottleRef.current.pending = undefined;
  };

  // Fixed-height composer helpers
  const resetComposerHeight = () => {
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) {
      textarea.style.height = ""; // ensure default height from CSS applies
      textarea.scrollTop = 0;
    }
  };
  const handleComposerChange = (val: string) => setQuery(val);

  /**
   * Re-reads the credentials from localStorage. Used on mount and after a key
   * set was pulled out of the mailbox, so the running app picks it up without
   * a page reload.
   */
  const reloadSettingsFromStorage = () => {
    setSettings({
      universalApiKey: localStorage.getItem("bud-e-universal-api-key") || "",
      apiUrl: localStorage.getItem("bud-e-api-url") || "",
      apiKey: localStorage.getItem("bud-e-api-key") || "",
      apiModel: localStorage.getItem("bud-e-model") || "",
      ttsUrl: localStorage.getItem("bud-e-tts-url") || "",
      ttsKey: localStorage.getItem("bud-e-tts-key") || "",
      ttsModel: localStorage.getItem("bud-e-tts-model") || "",
      sttUrl: localStorage.getItem("bud-e-stt-url") || "",
      sttKey: localStorage.getItem("bud-e-stt-key") || "",
      sttModel: localStorage.getItem("bud-e-stt-model") || "",
      systemPrompt: localStorage.getItem("bud-e-system-prompt") || "",
      vlmUrl: localStorage.getItem("bud-e-vlm-url") || "",
      vlmKey: localStorage.getItem("bud-e-vlm-key") || "",
      vlmModel: localStorage.getItem("bud-e-vlm-model") || "",
      vlmCorrectionModel: localStorage.getItem("bud-e-vlm-correction-model") ||
        "",
      orLlmModel: localStorage.getItem("bud-e-or-llm-model") || "",
      orVlmModel: localStorage.getItem("bud-e-or-vlm-model") || "",
      orAsrModel: localStorage.getItem("bud-e-or-asr-model") || "",
      orTtsModel: localStorage.getItem("bud-e-or-tts-model") || "",
      orImageModel: localStorage.getItem("bud-e-or-image-model") || "",
      ttsPrompt: localStorage.getItem("bud-e-tts-prompt") ?? DEFAULT_TTS_PROMPT,
      orMusicModel: localStorage.getItem("bud-e-or-music-model") || "",
    });
  };

  // Load settings on mount
  useEffect(() => {
    const savedSettings = {
      universalApiKey: localStorage.getItem("bud-e-universal-api-key") || "",
      apiUrl: localStorage.getItem("bud-e-api-url") || "",
      apiKey: localStorage.getItem("bud-e-api-key") || "",
      apiModel: localStorage.getItem("bud-e-model") || "",
      ttsUrl: localStorage.getItem("bud-e-tts-url") || "",
      ttsKey: localStorage.getItem("bud-e-tts-key") || "",
      ttsModel: localStorage.getItem("bud-e-tts-model") || "",
      sttUrl: localStorage.getItem("bud-e-stt-url") || "",
      sttKey: localStorage.getItem("bud-e-stt-key") || "",
      sttModel: localStorage.getItem("bud-e-stt-model") || "",
      systemPrompt: localStorage.getItem("bud-e-system-prompt") || "",
      vlmUrl: localStorage.getItem("bud-e-vlm-url") || "",
      vlmKey: localStorage.getItem("bud-e-vlm-key") || "",
      vlmModel: localStorage.getItem("bud-e-vlm-model") || "",
      vlmCorrectionModel: localStorage.getItem("bud-e-vlm-correction-model") ||
        "",
      orLlmModel: localStorage.getItem("bud-e-or-llm-model") || "",
      orVlmModel: localStorage.getItem("bud-e-or-vlm-model") || "",
      orAsrModel: localStorage.getItem("bud-e-or-asr-model") || "",
      orTtsModel: localStorage.getItem("bud-e-or-tts-model") || "",
      orImageModel: localStorage.getItem("bud-e-or-image-model") || "",
      ttsPrompt: localStorage.getItem("bud-e-tts-prompt") ?? DEFAULT_TTS_PROMPT,
      orMusicModel: localStorage.getItem("bud-e-or-music-model") || "",
    };
    setSettings(savedSettings);
  }, []);

  const handleSaveSettings = (newSettings: typeof settings) => {
    setSettings(newSettings);
    localStorage.setItem("bud-e-universal-api-key", newSettings.universalApiKey);
    localStorage.setItem("bud-e-api-url", newSettings.apiUrl);
    localStorage.setItem("bud-e-api-key", newSettings.apiKey);
    localStorage.setItem("bud-e-model", newSettings.apiModel);
    localStorage.setItem("bud-e-tts-url", newSettings.ttsUrl);
    localStorage.setItem("bud-e-tts-key", newSettings.ttsKey);
    localStorage.setItem("bud-e-tts-model", newSettings.ttsModel);
    localStorage.setItem("bud-e-stt-url", newSettings.sttUrl);
    localStorage.setItem("bud-e-stt-key", newSettings.sttKey);
    localStorage.setItem("bud-e-stt-model", newSettings.sttModel);
    localStorage.setItem("bud-e-system-prompt", newSettings.systemPrompt);
    localStorage.setItem("bud-e-vlm-url", newSettings.vlmUrl);
    localStorage.setItem("bud-e-vlm-key", newSettings.vlmKey);
    localStorage.setItem("bud-e-vlm-model", newSettings.vlmModel);
    localStorage.setItem(
      "bud-e-vlm-correction-model",
      newSettings.vlmCorrectionModel,
    );
    localStorage.setItem("bud-e-or-llm-model", newSettings.orLlmModel ?? "");
    localStorage.setItem("bud-e-or-vlm-model", newSettings.orVlmModel ?? "");
    localStorage.setItem("bud-e-or-asr-model", newSettings.orAsrModel ?? "");
    localStorage.setItem("bud-e-or-tts-model", newSettings.orTtsModel ?? "");
    localStorage.setItem("bud-e-or-image-model", newSettings.orImageModel ?? "");
    localStorage.setItem("bud-e-tts-prompt", newSettings.ttsPrompt ?? "");
    localStorage.setItem("bud-e-or-music-model", newSettings.orMusicModel ?? "");
    setShowSettings(false);
    setMailToolsAllowed(isMailAllowed());
  };

  // ---------- Mailbox sync ----------
  const ms = (key: string) =>
    (mailSyncContent[lang]?.[key] ?? mailSyncContent.en[key] ?? key) as string;

  // Boot Python quietly once the page is idle. Warming the cache alone was
  // not enough - the compile and the interpreter start still had to be paid
  // when the window opened. Booting up front means it is simply ready.
  useEffect(() => {
    schedulePythonBoot();
  }, []);

  // Load the mail account once, same as the other settings.
  useEffect(() => {
    const account = loadMailAccount();
    if (!account.deviceName) account.deviceName = guessDeviceName();
    setMailAccount(account);
  }, []);

  const handleSaveMailAccount = (account: MailAccount) => {
    setMailAccount(account);
    saveMailAccount(account);
  };

  /** Rebuilds the chat list after a snapshot was written into localStorage. */
  const handleSnapshotRestored = (firstSuffix: string) => {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("bude-chat-")
    );
    setLocalStorageKeys(keys);
    // Stay on the current chat if the snapshot still contains it.
    const suffix = keys.includes("bude-chat-" + currentChatSuffix)
      ? currentChatSuffix
      : firstSuffix;
    setCurrentChatSuffix(suffix);
    applyChatMessages(loadChatMessages(suffix), suffix);
    stopAndResetAudio();
    clearDirty();
  };

  const flashStatus = (text: string, durationMs = 5000) => {
    setMailSyncStatus(text);
    if (durationMs > 0) {
      window.setTimeout(() => setMailSyncStatus(""), durationMs);
    }
  };

  // --- automatic download of a newer snapshot, once per page load ---
  const autoDownloadDoneRef = useRef(false);
  useEffect(() => {
    if (autoDownloadDoneRef.current) return;
    if (!mailAccount.autoDownload || !isMailSyncConfigured(mailAccount)) return;
    autoDownloadDoneRef.current = true;

    (async () => {
      try {
        setMailSyncStatus(ms("autoChecking"));
        const list = await mailsyncList(mailAccount);
        const newest = list.find((s) => s.complete);
        const last = getLastSync();
        if (!newest || (last && newest.created <= last)) {
          setMailSyncStatus("");
          return;
        }
        // Never silently overwrite work that has not been backed up yet.
        if (isDirty()) {
          const question = ms("autoDownloadPrompt")
            .replace("{when}", new Date(newest.created).toLocaleString())
            .replace("{device}", newest.device || "?");
          if (!confirm(question)) {
            setMailSyncStatus("");
            return;
          }
        }
        const json = await mailsyncDownload(mailAccount, newest.uids);
        const result = await applySnapshot(json, { restorePrefs: true });
        setLastSync(newest.created);
        handleSnapshotRestored(result.firstSuffix);
        flashStatus(`${ms("autoRestored")} (${result.chats})`);
      } catch (e) {
        flashStatus(
          `${ms("syncError")}: ${e instanceof Error ? e.message : String(e)}`,
          8000,
        );
      }
    })();
  }, [mailAccount]);

  // --- automatic upload after changes ---
  const AUTO_UPLOAD_DEBOUNCE_MS = 60_000;
  const AUTO_UPLOAD_MIN_INTERVAL_MS = 10 * 60_000;
  const lastAutoUploadRef = useRef(0);
  const autoUploadRunningRef = useRef(false);

  const runAutoUpload = async () => {
    if (autoUploadRunningRef.current || !isDirty()) return;
    autoUploadRunningRef.current = true;
    try {
      setMailSyncStatus(ms("autoUploading"));
      const json = await collectSnapshot(mailAccount.deviceName);
      const result = await mailsyncUpload(mailAccount, json, AUTO_LABEL);
      lastAutoUploadRef.current = Date.now();
      setLastSync(result.created);
      clearDirty();
      await pruneAutoSnapshots();
      flashStatus(ms("autoUploaded"));
    } catch (e) {
      flashStatus(
        `${ms("syncError")}: ${e instanceof Error ? e.message : String(e)}`,
        8000,
      );
    } finally {
      autoUploadRunningRef.current = false;
    }
  };

  /** Keeps the mailbox from filling up with background backups. */
  const pruneAutoSnapshots = async () => {
    try {
      const list = await mailsyncList(mailAccount);
      const stale = list
        .filter((s) => s.label === AUTO_LABEL)
        .slice(KEEP_AUTO_SNAPSHOTS);
      if (stale.length === 0) return;
      await mailsyncDelete(mailAccount, stale.flatMap((s) => s.uids));
    } catch (e) {
      console.warn("[mailsync] pruning old auto snapshots failed:", e);
    }
  };

  /**
   * Cheap change signal. Serialising the messages would mean stringifying
   * multi-megabyte base64 images on every streamed token; lengths and image
   * ids are enough to notice an edit.
   */
  const fingerprint = (msgs: Message[]): string =>
    msgs
      .map((m) =>
        Array.isArray(m.content)
          // deno-lint-ignore no-explicit-any
          ? (m.content as any[])
            .map((c) =>
              typeof c === "string"
                ? c.length
                : c?.type === "image_url"
                ? c.id ?? "img"
                : String(c?.text ?? "").length
            )
            .join(",")
          : String(m.content).length
      )
      .join("|");

  // Switching chats replaces `messages` without anything having changed, so
  // remember what we last saw per chat and only treat real edits as dirty.
  const lastSeenRef = useRef<{ suffix: string; print: string }>({
    suffix: "",
    print: "",
  });

  useEffect(() => {
    if (firstLoad) return;
    if (!mailAccount.autoUpload || !isMailSyncConfigured(mailAccount)) return;

    const print = fingerprint(messages);
    const previous = lastSeenRef.current;
    lastSeenRef.current = { suffix: currentChatSuffix, print };
    if (previous.suffix !== currentChatSuffix || previous.print === print) return;
    markDirty();

    // Restarts on every change, so the upload only happens once the user has
    // been quiet for a while - and never more often than the minimum interval.
    const sinceLast = Date.now() - lastAutoUploadRef.current;
    const wait = lastAutoUploadRef.current === 0
      ? AUTO_UPLOAD_DEBOUNCE_MS
      : Math.max(AUTO_UPLOAD_DEBOUNCE_MS, AUTO_UPLOAD_MIN_INTERVAL_MS - sinceLast);
    const timer = window.setTimeout(() => void runAutoUpload(), wait);
    return () => clearTimeout(timer);
  }, [messages, currentChatSuffix, mailAccount]);

  // #################
  // ### useEffect ###
  // #################

  // 1) First load from localStorage
  useEffect(() => {
    let lsKeys: string[] = Object.keys(localStorage).filter((key) =>
      key.startsWith("bude-chat-")
    );
    lsKeys = lsKeys.length > 0 ? lsKeys : ["bude-chat-0"];
    lsKeys.sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)));
    const currSuffix = lsKeys.length > 0 ? String(lsKeys[0].slice(10)) : "0";
    setLocalStorageKeys(lsKeys);
    applyChatMessages(loadChatMessages(currSuffix), currSuffix);
    setCurrentChatSuffix(currSuffix);
  }, []);

  // 2) Persist last assistant message when stream completes
  useEffect(() => {
    if (isStreamComplete) {
      if ("content" in messages[messages.length - 1]) {
        let lastMessageFromBuddy: string;
        const lastMessageContent = messages[messages.length - 1]["content"];
        // Multimodal content (e.g. generated images) must stay an object array –
        // joining it would turn the images into "[object Object]".
        const isMultimodal = Array.isArray(lastMessageContent) &&
          lastMessageContent.some((p: any) => p !== null && typeof p === "object");

        if (typeof lastMessageContent === "string") {
          lastMessageFromBuddy = lastMessageContent;
        } else if (isMultimodal) {
          lastMessageFromBuddy = (lastMessageContent as any[])
            .filter((p: any) => p?.type === "text")
            .map((p: any) => p.text ?? "")
            .join("");
        } else {
          lastMessageFromBuddy = (lastMessageContent as string[]).join("");
        }

        if (lastMessageFromBuddy !== "" && messages.length > 1) {
          if (!isMultimodal) {
            messages[messages.length - 1]["content"] = lastMessageFromBuddy;
          }
          safePersist(messages, currentChatSuffix);

          if (!localStorageKeys.includes("bude-chat-" + currentChatSuffix)) {
            setLocalStorageKeys([
              ...localStorageKeys,
              "bude-chat-" + currentChatSuffix,
            ]);
          }
        }
        if (lastMessageFromBuddy !== "") {
          const groupIndex = messages.length - 1;
          if (groupIndex === 0) {
            getTTS(lastMessageFromBuddy, groupIndex, "stream");
          }
        }
      }
    }
  }, [isStreamComplete]);

  // 3) Auto-scroll & persist messages on change
  useEffect(() => {
    if (autoScroll) {
      const chatContainer = document.querySelector(".chat-history");
      if (chatContainer) {
        (chatContainer as HTMLElement).scrollTo({
          top: (chatContainer as HTMLElement).scrollHeight,
          behavior: "smooth",
        });
      }
    }
    if (!firstLoad) {
      safePersist(messages, currentChatSuffix);
      setLocalStorageKeys(
        Object.keys(localStorage).filter((key) =>
          key.startsWith("bude-chat-")
        ),
      );
    }
    if (firstLoad) setFirstLoad(false);
  }, [messages, autoScroll]);

  // 4) Switch chat
  useEffect(() => {
    const lsMsgs = loadChatMessages(currentChatSuffix);
    if (lsMsgs.length === 1 && Array.isArray(lsMsgs[0].content)) {
      if (lsMsgs[0].content[0] !== chatIslandContent[lang]["welcomeMessage"]) {
        (lsMsgs[0].content as any[])[0] =
          chatIslandContent[lang]["welcomeMessage"];
      }
    }
    applyChatMessages(lsMsgs, currentChatSuffix);
    stopAndResetAudio();
    setStopList([]);
    resetComposerHeight();
  }, [currentChatSuffix]);

  // 5) Auto-Play queue if readAlways
  useEffect(() => {
    if (!readAlways) return;
    Object.entries(audioFileDict).forEach(([groupIndex, groupAudios]) => {
      const nextUnplayedIndex = findNextUnplayedAudio(groupAudios);
      if (nextUnplayedIndex === null) return;

      const isLatestGroup =
        Math.max(...Object.keys(audioFileDict).map(Number)) <=
        Number(groupIndex);

      if (
        isLatestGroup &&
        canPlayAudio(
          Number(groupIndex),
          nextUnplayedIndex,
          groupAudios,
          stopList,
          ttsPoolIdle(),
        )
      ) {
        playAudio(
          groupAudios[nextUnplayedIndex].audio,
          Number(groupIndex),
          nextUnplayedIndex,
        );
      }

      if (stopList.includes(Number(groupIndex))) {
        (Object.values(groupAudios) as AudioItem[]).forEach((item) => {
          if (!item.audio.paused) {
            (item as AudioItem).audio.pause();
            (item as AudioItem).audio.currentTime = 0;
          }
        });
      }
    });
  }, [audioFileDict, readAlways, stopList, ttsIdleTick]);

  // 6) Flush throttled persist on unload/hidden
  useEffect(() => {
    const flush = () => {
      flushPersistThrottle();
      safePersist(messages, currentChatSuffix);
    };
    const vis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [messages, currentChatSuffix]);

  // ---------- Audio helpers ----------
  const findNextUnplayedAudio = (
    groupAudios: Record<number, AudioItem>,
  ): number | null => {
    const [nextUnplayed] = Object.entries(groupAudios)
      .sort(([a], [b]) => Number(a) - Number(b))
      .find(([_, item]) => !item.played) || [];
    return nextUnplayed !== undefined ? Number(nextUnplayed) : null;
  };

  /**
   * A clip is "done" when it finished playing – or when it is a dead slot that
   * will never play (failed TTS request, empty after filters, unplayable blob).
   */
  const isClipDone = (item: AudioItem): boolean => {
    const el = item.audio as HTMLAudioElement & { __skipped?: boolean };
    if (el.__skipped) return true;
    return item.played && el.ended === true;
  };

  const canPlayAudio = (
    groupIndex: number,
    audioIndex: number,
    groupAudios: Record<number, AudioItem>,
    stopList_: number[],
    // True when no TTS request is pending or in flight. Missing indices can
    // then never show up anymore, so gaps may be skipped instead of blocking.
    allowSkipGaps = false,
  ): boolean => {
    if (stopList_.includes(Number(groupIndex))) return false;

    // Never start a new clip if any clip in this group is currently playing.
    const anyPlaying = Object.values(groupAudios).some(
      (it) => !it.audio.paused && !it.audio.ended,
    );
    if (anyPlaying) return false;

    // First clip: only start when nothing else is playing (handled above).
    if (audioIndex === 0) return true;

    const prev = groupAudios[audioIndex - 1];
    if (prev) {
      // Normal case: the immediate predecessor must have actually ENDED.
      // A dead clip (failed request, filtered-out text, unplayable audio)
      // counts as done – waiting for it would stall the rest of the group.
      return isClipDone(prev);
    }

    // The predecessor slot does not exist. While TTS work is still pending it
    // may just be in flight – waiting keeps the clips in order. Once the pool
    // is idle the gap is permanent (failed or filtered-out chunk), so we skip
    // it as long as every clip that DOES exist before us is finished.
    if (!allowSkipGaps) return false;
    return Object.entries(groupAudios).every(([k, it]) =>
      Number(k) >= audioIndex || isClipDone(it)
    );
  };

  /**
   * Placeholder entry for a chunk that produced no audio (request failed, or
   * nothing was left after the TTS text filters). It occupies the index so the
   * sequential playback chain does not stall on the missing predecessor.
   */
  const makeSkippedAudioItem = (text: string): AudioItem => {
    const stub = {
      __text: text,
      __session: playSessionRef.current,
      __skipped: true,
      paused: true,
      ended: true,
      currentTime: 0,
      src: "",
      play: () => Promise.resolve(),
      pause: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      onended: null,
    };
    return {
      audio: stub as unknown as AudioItem["audio"],
      played: true,
    };
  };

  const markChunkSkipped = (
    groupIndex: number,
    idx: number,
    text: string,
    reason: string,
  ) => {
    console.warn(`[TTS] chunk ${groupIndex}/${idx} skipped (${reason})`);
    setAudioFileDict((prev) => {
      const next = { ...prev };
      const group = { ...(next[groupIndex] || {}) };
      if (group[idx]) return prev; // real audio already arrived – keep it
      group[idx] = makeSkippedAudioItem(text);
      next[groupIndex] = group;
      return next;
    });
  };

  // play() rejections per clip. Without a cap the playback effect would retry
  // the same unplayable clip forever and never reach the following ones.
  const playFailuresRef = useRef<Record<string, number>>({});
  const MAX_PLAY_ATTEMPTS = 3;

  const markItemPlayed = (groupIndex: number, audioIndex: number) => {
    setAudioFileDict((prev) => {
      const next = { ...prev };
      const group = { ...(next[groupIndex] || {}) };
      const item = { ...(group[audioIndex] || {}) } as AudioItem;
      item.played = true;
      group[audioIndex] = item;
      next[groupIndex] = group;
      return next;
    });
  };

  const playAudio = async (
    audio: HTMLAudioElement,
    groupIndex: number,
    audioIndex: number,
  ) => {
    const key = `${groupIndex}:${audioIndex}`;
    try {
      await audio.play();
      delete playFailuresRef.current[key];
      markItemPlayed(groupIndex, audioIndex);
    } catch (err) {
      const attempts = (playFailuresRef.current[key] ?? 0) + 1;
      playFailuresRef.current[key] = attempts;
      console.warn(
        `Audio play() rejected (${attempts}/${MAX_PLAY_ATTEMPTS}):`,
        err,
      );
      if (attempts >= MAX_PLAY_ATTEMPTS) {
        // Give up on this clip and let the chain continue with the next one.
        try {
          (audio as HTMLAudioElement & { __skipped?: boolean }).__skipped = true;
        } catch { /* stub objects may be frozen */ }
        markItemPlayed(groupIndex, audioIndex);
      }
    }
  };

  // ---------- Smart Chunking ----------
  // Lives in utils/ttsChunks.ts so the rules can be tested on their own.

  // ordered playback starter
  const startOrderedPlaybackForGroup = (groupIndex: number) => {
    // Pause all other groups and mark them as stopped to avoid overlaps
    const newStopList = stopListRef.current.slice();
    Object.entries(audioFileDictRef.current).forEach(([gStr, group]) => {
      const gi = Number(gStr);
      if (gi !== groupIndex) {
        Object.values(group).forEach((item) => {
          if (!item.audio.paused) {
            item.audio.pause();
            item.audio.currentTime = 0;
          }
        });
        if (!newStopList.includes(gi)) newStopList.push(gi);
      }
    });
    setStopList(newStopList);

    // Play first (or next-unplayed) and attach chaining
    const group = audioFileDictRef.current[groupIndex];
    if (!group) return;
    const nextIdx = findNextUnplayedAudio(group);
    const first = (nextIdx !== null ? group[nextIdx]?.audio : group[0]?.audio);
    if (!first) return;

    first.play().catch((err) =>
      console.warn("Audio play() rejected on start:", err)
    );
  };

  // REPLACE the whole function:
  /**
   * Nearest real (non-skipped) audio element before `idx`. Walks over
   * placeholders and gaps so a failed chunk cannot break the manual chain.
   */
  const findPrevRealAudio = (
    group: Record<number, AudioItem>,
    idx: number,
  ): HTMLAudioElement | undefined => {
    for (let i = idx - 1; i >= 0; i--) {
      const el = group[i]?.audio as (HTMLAudioElement & { __skipped?: boolean }) | undefined;
      if (el && !el.__skipped) return el;
    }
    return undefined;
  };

  const wireNeighborChaining = (groupIndex: number, idx: number) => {
    const group = audioFileDict[groupIndex] || {};
    const prevEl = findPrevRealAudio(group, idx);
    const currEl = group[idx]?.audio;
    if (!currEl) return;

    const session = playSessionRef.current;

    // Always clean up this blob after this element ends + mark played is already added in getTTS
    const src = currEl.src;
    currEl.addEventListener(
      "ended",
      () => {
        try {
          if (src && src.startsWith("blob:")) URL.revokeObjectURL(src);
        } catch {}
      },
      { once: true },
    );

    // With read-aloud on, the effect below orchestrates playback. Manual
    // playback has no such driver and is chained clip by clip instead.
    if (readAlwaysRef.current) return;

    // Chain only if both prev and current belong to THIS session
    if (prevEl && (prevEl as any).__session === (currEl as any).__session) {
      const playNextOnce = () => {
        // Ignore if another regenerate started
        if (session !== playSessionRef.current) return;
        currEl.play().catch((err) =>
          console.warn("Audio play() rejected in chain:", err),
        );
      };
      prevEl.addEventListener("ended", playNextOnce, { once: true });

      // Manual fast-path: if prev already finished when current arrives
      if ((prevEl as any).ended && !stopListRef.current.includes(groupIndex)) {
        currEl.play().catch((err) =>
          console.warn("Audio play() rejected (prev already ended):", err),
        );
      }
    }
  };

  // ---------- Trigger helpers (legacy hashtags for USER only) ----------
  const normalizeForTrigger = (raw: string) =>
    raw
      .replace(/[`]/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  type AutoTrigger =
    | {
      kind: "wikipedia";
      q: string;
      n?: number;
      collection?: string;
      autoSummarize?: boolean;
    }
    | { kind: "papers"; q: string; n?: number; autoSummarize?: boolean }
    | { kind: "bildungsplan"; q: string; n?: number; autoSummarize?: boolean }
    | {
      kind: "imagegen";
      prompt: string;
      model?: string;
      n?: number;
      size?: string;
      aspectRatio?: string;
      inputImages?: string[];
    }
    | {
      kind: "imageedit";
      prompt: string;
      model?: string;
      n?: number; // Number of output images
      inputImages?: string[]; // Explicit base64 image data
      useLastImage?: boolean; // Use the last image in the conversation
      imageId?: string; // Reference a specific image by unique ID
      imageIds?: string[]; // Reference multiple images by ID
    }
    | { kind: "song"; prompt: string; model?: string }
    | { kind: "grade"; criteria?: string }
    // Both only reachable while the matching permission is switched on.
    | { kind: "notebook"; payload: Record<string, unknown> }
    | { kind: "mail"; payload: Record<string, unknown> }
    | { kind: "docs"; payload: Record<string, unknown> };

  const isImageTrigger = (
    t: AutoTrigger,
  ): t is Extract<AutoTrigger, { kind: "imagegen" | "imageedit" }> =>
    t.kind === "imagegen" || t.kind === "imageedit";

  // Legacy hashtag parsing – kept for USER requests only (no !! support)
  const findHashtagTriggersInUserText = (raw: string): AutoTrigger[] => {
    const t = normalizeForTrigger(raw);

    const rxWiki =
      /#\s*wikipedia(?:_(de|en))?\s*:\s*([^:\n]+?)(?:\s*:\s*(\d+))?(?=$|\s)/i;
    const rxPapers = /#\s*papers\s*:\s*([^:\n]+?)(?:\s*:\s*(\d+))?(?=$|\s)/i;
    const rxBP =
      /#\s*bildungsplan\s*:\s*([^:\n]+?)(?:\s*:\s*(\d+))?(?=$|\s)/i;
    // #imagegen:model:prompt or #imagegen:prompt (model is optional and
    // recognised because model names never contain spaces)
    const rxImageGen = /#\s*imagegen\s*:\s*(?:([a-zA-Z0-9_.-]+)\s*:\s*)?(.+?)(?=$|\n|#)/i;

    const triggers: AutoTrigger[] = [];

    const mW = t.match(rxWiki);
    if (mW) {
      const langSuffix = (mW[1] || "").toLowerCase();
      let collection =
        lang === "en"
          ? "English-ConcatX-Abstract"
          : "German-ConcatX-Abstract";
      if (langSuffix === "de") collection = "German-ConcatX-Abstract";
      if (langSuffix === "en") collection = "English-ConcatX-Abstract";
      const q = (mW[2] || "").trim();
      const n = mW[3] ? parseInt(mW[3], 10) : undefined;
      if (q) {
        triggers.push({
          kind: "wikipedia",
          q,
          n,
          collection,
          autoSummarize: false,
        });
      }
    }

    const mP = t.match(rxPapers);
    if (mP) {
      const q = (mP[1] || "").trim();
      const n = mP[2] ? parseInt(mP[2], 10) : undefined;
      if (q) triggers.push({ kind: "papers", q, n, autoSummarize: false });
    }

    const mB = t.match(rxBP);
    if (mB) {
      const q = (mB[1] || "").trim();
      const n = mB[2] ? parseInt(mB[2], 10) : undefined;
      if (q) {
        triggers.push({ kind: "bildungsplan", q, n, autoSummarize: false });
      }
    }

    // Image generation: #imagegen:prompt  or  #imagegen:model:prompt
    const mImg = t.match(rxImageGen);
    if (mImg) {
      const modelOrPrompt = (mImg[1] || "").trim();
      const promptAfterModel = (mImg[2] || "").trim();

      let model: string | undefined;
      let prompt: string;
      if (modelOrPrompt && promptAfterModel) {
        model = modelOrPrompt;
        prompt = promptAfterModel;
      } else {
        prompt = promptAfterModel || modelOrPrompt;
        model = undefined;
      }
      if (prompt) triggers.push({ kind: "imagegen", prompt, model });
    }

    // DEBUG
    serverLog("hashtag.detect.done", { raw, triggers });

    return triggers;
  };

  // ---------- NEW: JSON-based trigger extraction (user & assistant) ----------

  // Findet nur TOP-LEVEL JSON-Objekte, deren Klammern *balanciert* sind.
  const extractCompletedJsonSearchBlocks = (s: string): string[] => {
    const blocks: string[] = [];
    let depth = 0,
      start = -1;
    let inString = false,
      quote: string | null = null,
      escape = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === quote) {
          inString = false;
          quote = null;
          continue;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        if (depth > 0) depth--;
        if (depth === 0 && start !== -1) {
          const block = s.slice(start, i + 1);
          if (/^\s*{\s*./.test(block) && /}\s*$/.test(block)) {
            blocks.push(block);
            // DEBUG für jedes abgeschlossene Objekt
            serverLog("json.block.closed", { block });
          }
          start = -1;
        }
      }
    }
    return blocks;
  };

  const isValidSearchJson = (obj: any): boolean => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    const allowed = new Set([
      "wikipedia",
      "wikipedia_de",
      "wikipedia_en",
      "papers",
      "bildungsplan",
      "imagegen",
      "imageedit",
      "notebook",
      "mail",
      "song",
      "grade",
      "docs",
    ]);
    const keys = Object.keys(obj);
    if (keys.length !== 1) return false;
    const key = keys[0].toLowerCase();
    if (!allowed.has(key)) return false;

    const v = obj[keys[0]];

    // The two permission-gated tools carry a free-form object; the modules
    // that execute them validate the details.
    if (key === "notebook") {
      return notebookToolsAllowed && !!v && typeof v === "object" &&
        typeof (v as any).action === "string";
    }
    if (key === "mail") {
      return mailToolsAllowed && !!v && typeof v === "object" &&
        typeof (v as any).action === "string";
    }
    if (key === "docs") {
      return docsToolsAllowed && !!v && typeof v === "object" &&
        typeof (v as any).action === "string";
    }

    // Correcting starts with the uploaded pages alone - the marking scheme is
    // asked for afterwards - so an empty value is legitimate here.
    if (key === "grade") {
      return typeof v === "string" || (!!v && typeof v === "object") || v === true;
    }

    // A song brief is a single block of prose plus lyrics - long, with line
    // breaks, and no "q" field, so it needs its own check rather than falling
    // through to the search branch below.
    if (key === "song") {
      if (typeof v === "string") return v.trim().length > 0;
      if (v && typeof v === "object") {
        return String((v as any).prompt ?? "").trim().length > 0;
      }
      return false;
    }

    // imagegen / imageedit use "prompt" instead of "q"
    if (key === "imagegen" || key === "imageedit") {
      if (typeof v === "string") return v.trim().length > 0;
      if (v && typeof v === "object") {
        const prompt = (v.prompt ?? v.p ?? "").toString().trim();
        const hasInputImages = Array.isArray(v.input_images) &&
          v.input_images.length > 0;
        const useLastImage = v.use_last_image === true ||
          v.useLastImage === true;
        const hasIdRef = !!(v.image_id ?? v.imageId) ||
          (Array.isArray(v.image_ids ?? v.imageIds) &&
            (v.image_ids ?? v.imageIds).length > 0);
        return prompt.length > 0 || hasInputImages || useLastImage || hasIdRef;
      }
      return false;
    }

    if (typeof v === "string") return v.trim().length > 0;

    if (v && typeof v === "object") {
      const q = (v.q ?? v.query ?? v.text ?? "").toString().trim();
      if (!q) return false;
      if ("n" in v || "limit" in v || "top_n" in v) {
        const n = Number(v.n ?? v.limit ?? v.top_n);
        if (!Number.isFinite(n) || n <= 0) return false;
      }
      return true;
    }
    return false;
  };

  // JSON-Trigger Finder
  const findJsonTriggersInText = (raw: string): AutoTrigger[] => {
    // DEBUG: Start
    serverLog("json.detect.start", { sampleTail: raw.slice(-250) });

    const blocks = extractCompletedJsonSearchBlocks(raw);
    const all: AutoTrigger[] = [];

    for (const b of blocks) {
      let obj: any = null;
      try {
        obj = JSON.parse(b);
      } catch {
        obj = null;
      }
      if (!obj) {
        const normalized = b
          .replace(/([{,\s])'([^']+?)'\s*:/g, '$1"$2":')
          .replace(/:\s*'([^']*?)'/g, ':"$1"')
          .replace(/,(\s*[}\]])/g, "$1");
        try {
          obj = JSON.parse(normalized);
        } catch {
          obj = null;
        }
      }
      if (!obj || !isValidSearchJson(obj)) continue;
      all.push(...jsonObjToTriggers(obj));
    }

    // DEBUG: Done
    serverLog("json.detect.done", { triggers: all });

    return all;
  };

  // Lenient JSON parse (unused externally but kept)
  const tryParseJsonLenient = (raw: string): any | null => {
    try {
      return JSON.parse(raw);
    } catch {}
    let s = raw.trim();
    s = s.replace(/([{,\s])'([^']+?)'\s*:/g, '$1"$2":').replace(
      /:\s*'([^']*?)'/g,
      ':"$1"',
    );
    s = s.replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const jsonObjToTriggers = (obj: any): AutoTrigger[] => {
    const triggers: AutoTrigger[] = [];
    if (!obj || typeof obj !== "object") return triggers;

    const normQ = (v: any) => {
      if (typeof v === "string") return v.trim();
      if (v && typeof v === "object") {
        return (v.q ?? v.query ?? v.text ?? "").toString().trim();
      }
      return "";
    };
    const normN = (v: any) => {
      if (v && typeof v === "object") {
        const n = v.n ?? v.limit ?? v.top_n;
        const nn = Number(n);
        return Number.isFinite(nn) && nn > 0 ? nn : undefined;
      }
      return undefined;
    };

    const keys = Object.keys(obj);
    for (const key of keys) {
      const k = key.toLowerCase();
      const val = obj[key];

      // ----- Notebook and mailbox: passed through as given -----
      if (k === "notebook" && notebookToolsAllowed) {
        if (val && typeof val === "object") {
          triggers.push({ kind: "notebook", payload: val });
        }
        continue;
      }
      if (k === "mail" && mailToolsAllowed) {
        if (val && typeof val === "object") {
          triggers.push({ kind: "mail", payload: val });
        }
        continue;
      }
      if (k === "docs" && docsToolsAllowed) {
        if (val && typeof val === "object") {
          triggers.push({ kind: "docs", payload: val });
        }
        continue;
      }

      // ----- Image generation -----
      if (k === "grade") {
        const criteria = typeof val === "string"
          ? val
          : String((val as any)?.criteria ?? "");
        triggers.push({ kind: "grade", criteria: criteria.trim() || undefined });
        continue;
      }

      if (k === "song") {
        // {"song": "brief"} oder {"song": {"prompt": "...", "model": "..."}}
        const prompt = typeof val === "string"
          ? val
          : String((val as any)?.prompt ?? "");
        const model = typeof val === "object" && val
          ? String((val as any).model ?? "") || undefined
          : undefined;
        if (prompt.trim()) triggers.push({ kind: "song", prompt: prompt.trim(), model });
        continue;
      }

      if (k === "imagegen") {
        let prompt = "";
        let model: string | undefined;
        let n: number | undefined;
        let size: string | undefined;
        let aspectRatio: string | undefined;
        let inputImages: string[] | undefined;

        if (typeof val === "string") {
          prompt = val.trim();
        } else if (val && typeof val === "object") {
          prompt = (val.prompt ?? val.p ?? "").toString().trim();
          model = val.model ? String(val.model).trim() : undefined;
          const nVal = val.n ?? val.count;
          n = nVal ? Number(nVal) : undefined;
          if (n !== undefined && (!Number.isFinite(n) || n <= 0)) n = undefined;
          size = val.size ? String(val.size).trim() : undefined;
          const ar = val.aspectRatio ?? val.aspect_ratio ?? val.ratio;
          aspectRatio = ar ? String(ar).trim() : undefined;
          const imgs = val.input_images ?? val.inputImages ??
            val.reference_images;
          if (Array.isArray(imgs)) {
            inputImages = imgs.filter((img: any) =>
              typeof img === "string" && img.length > 0
            );
          }
        }

        if (prompt) {
          triggers.push({
            kind: "imagegen",
            prompt,
            model,
            n,
            size,
            aspectRatio,
            inputImages,
          });
        }
        continue;
      }

      // ----- Image editing (reference images → character consistency) -----
      if (k === "imageedit") {
        let prompt = "";
        let model: string | undefined;
        let n: number | undefined;
        let inputImages: string[] | undefined;
        let useLastImage = false;
        let imageId: string | undefined;
        let imageIds: string[] | undefined;

        if (typeof val === "string") {
          prompt = val.trim();
          useLastImage = true; // plain string → edit the last image
        } else if (val && typeof val === "object") {
          prompt = (val.prompt ?? val.p ?? "").toString().trim();
          model = val.model ? String(val.model).trim() : undefined;

          const nVal = val.n ?? val.count;
          n = nVal ? Number(nVal) : undefined;
          if (n !== undefined && (!Number.isFinite(n) || n <= 0)) n = undefined;

          const imgs = val.input_images ?? val.inputImages ??
            val.reference_images;
          if (Array.isArray(imgs)) {
            inputImages = imgs.filter((img: any) =>
              typeof img === "string" && img.length > 0
            );
          }

          if (val.image_id || val.imageId) {
            imageId = String(val.image_id ?? val.imageId).trim();
          }
          const idList = val.image_ids ?? val.imageIds;
          if (Array.isArray(idList)) {
            imageIds = idList.filter((id: any) =>
              typeof id === "string" && id.length > 0
            );
          }

          const explicitUseLast = val.use_last_image ?? val.useLastImage;
          if (explicitUseLast === true) {
            useLastImage = true;
          } else if (explicitUseLast === false) {
            useLastImage = false;
          } else {
            // Auto-detect: no explicit image source → fall back to last image
            const hasExplicitImages = (inputImages && inputImages.length > 0) ||
              imageId || (imageIds && imageIds.length > 0);
            if (!hasExplicitImages && prompt) useLastImage = true;
          }
        }

        if (
          prompt || (inputImages && inputImages.length > 0) || useLastImage ||
          imageId || (imageIds && imageIds.length > 0)
        ) {
          triggers.push({
            kind: "imageedit",
            prompt,
            model,
            n,
            inputImages,
            useLastImage,
            imageId,
            imageIds,
          });
        }
        continue;
      }

      if (
        [
          "wikipedia",
          "wikipedia_de",
          "wikipedia_en",
          "papers",
          "bildungsplan",
        ].includes(k)
      ) {
        const q = normQ(val);
        const n = normN(val);
        if (!q) continue;

        if (k === "wikipedia" || k === "wikipedia_de" || k === "wikipedia_en") {
          let collection =
            lang === "en"
              ? "English-ConcatX-Abstract"
              : "German-ConcatX-Abstract";
          if (k.endsWith("_de")) collection = "German-ConcatX-Abstract";
          if (k.endsWith("_en")) collection = "English-ConcatX-Abstract";
          triggers.push({
            kind: "wikipedia",
            q,
            n,
            collection,
            autoSummarize: true,
          });
        } else if (k === "papers") {
          triggers.push({ kind: "papers", q, n, autoSummarize: true });
        } else if (k === "bildungsplan") {
          triggers.push({ kind: "bildungsplan", q, n, autoSummarize: true });
        }
      }
    }
    return triggers;
  };

  // Build a summarization prompt (with i18n + safe encoding + local overrides)
  const buildAutoSummaryPrompt = (trigs: AutoTrigger[]) => {
    const topics = trigs.map((t) => {
      if (isImageTrigger(t)) return `${t.kind}: "${t.prompt}"`;
      // A song shows its own player and lyrics, so there is nothing to
      // summarise afterwards - but it still needs a label here.
      if (t.kind === "song") return `${t.kind}: "${t.prompt}"`;
      if (t.kind === "grade") return "grade";
      if (t.kind === "notebook" || t.kind === "mail" || t.kind === "docs") return t.kind;
      return `${t.kind}: "${t.q}"`;
    }).join(", ");

    // 1) Optional per-language localStorage override (no UI needed):
    //    Put "{topics}" where you want the joined topics.
    const overrideKey =
      lang === "de" ? "bud-e-summary-template-de" : "bud-e-summary-template-en";
    const override = (typeof localStorage !== "undefined")
      ? localStorage.getItem(overrideKey)
      : null;
    if (override && override.includes("{topics}")) {
      return override.replaceAll("{topics}", topics);
    }

    // 2) Defaults (ASCII-safe via \u escapes to avoid mojibake on non-UTF-8 builds)
    if (lang === "de") {
      return (
        `Bitte fasse die oben angezeigten Suchergebnisse (${topics}) pr\u00E4gnant zusammen:
  - Nenne die Kernaussagen in klaren Stichpunkten.
  - Hebe ggf. Relevanz f\u00FCr Unterricht/Kontext hervor.
  - F\u00FCge am Ende 3\u20135 kurze Bulletpoints mit Quellen/URLs und falls vorhanden auch Setienangaben aus den gezeigten Ergebnissen an.
  Sei absolut faktengetreu und nutze nur die sichtbaren Ergebnisse als Grundlage.`
      );
    }

    // English default
    return (
      `Please summarize the search results shown above (${topics}) concisely:
  - Provide key takeaways in clear bullet points.
  - Highlight relevance to the user's context if applicable.
  - Add 3\u20135 short bullets with sources/URLs and if available also page numbers from the shown results. Be absolutely factual-
  Use only the visible results as your basis.`
    );
  };

  const clearGroupAudio = (gi: number) => {
    const group = audioFileDict[gi];
    if (!group) return;
    Object.values(group).forEach(({ audio }) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
      try {
        if (audio.src?.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      } catch {}
      audio.onended = null;
      audio.src = "";
    });
    setAudioFileDict((prev) => {
      const next = { ...prev };
      delete next[gi];
      return next;
    });
  };

  // ---------- Chat list actions ----------
  const handleRefreshAction = (groupIndex: number) => {
    if (!(groupIndex >= 0 && groupIndex < messages.length)) return;

    // Cancel any running stream
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreamComplete(true);
    setThinkingSince(null);

    playSessionRef.current += 1;
    stopAndResetAudio();

    // We want to re-run from this assistant turn’s *preceding user* turn (if present)
    let sliceStart = groupIndex;
    if (messages[groupIndex - 1]?.role === "user") {
      sliceStart = groupIndex - 1;
    }

    const prev = messages.slice(0, sliceStart) as Message[];

    // NEW: isolate this run and nuke stale audio ONLY for the upcoming assistant group
    const upcomingAssistantGroup = prev.length;
    playSessionRef.current += 1;
    clearGroupAudio(upcomingAssistantGroup);

    // Extract the most recent user text to re-send
    const userMsg = messages[sliceStart];
    let userText = "";
    if (userMsg?.role === "user") {
      if (typeof userMsg.content === "string") userText = userMsg.content;
      else if (Array.isArray(userMsg.content)) {
        const t = userMsg.content.find((p: any) => p?.type === "text");
        userText = t?.text ?? "";
      }
    }
    if (!userText.trim()) return;

    setStopList([]);
    setMessages(prev);
    safePersist(prev, currentChatSuffix);
    startStream(userText, prev);
  };

  const handleEditAction = (groupIndex: number) => {
    const message = messages[groupIndex];
    let contentToEdit = "";

    if (typeof message.content === "string") {
      contentToEdit = message.content;
    } else if (Array.isArray(message.content)) {
      if (typeof message.content[0] === "string") {
        contentToEdit = message.content.join("");
      } else {
        contentToEdit = message.content
          // deno-lint-ignore no-explicit-any
          .filter((item: any) => item.type === "text")
          // deno-lint-ignore no-explicit-any
          .map((item: any) => item.text)
          .join("");
      }
    }

    setQuery(contentToEdit);
    setStopList([]);
    setCurrentEditIndex(groupIndex);

    const textarea = document.querySelector("textarea");
    textarea?.focus();
  };

  // helper – parse index from "streamN" or "manual_streamN"
  const indexFromSourceFunction = (sourceFunction: string): number => {
    const m = sourceFunction.match(/(?:^|_)stream(\d+)/);
    return m ? Math.max(0, Number(m[1]) - 1) : 0;
  };

  // send smart chunks in parallel
  const speakMessageInSmartChunks = (groupIndex: number, fullText: string) => {
    const chunks = splitIntoSmartChunks(fullText);
    if (chunks.length === 0) return;

    // Drop the old audio for this group - both in state and in the ref the
    // async handlers read from.
    audioFileDictRef.current = { ...audioFileDictRef.current, [groupIndex]: {} };
    setAudioFileDict((prev) => {
      const next = { ...prev };
      next[groupIndex] = {};
      return next;
    });

    // Remember that this group was asked for, so the first arriving chunk
    // starts playing by itself.
    markManualSpeak(groupIndex);

    // fire *all* chunks concurrently (queued in TTS pool)
    chunks.forEach((chunk, i) => {
      getTTS(chunk, groupIndex, `manual_stream${i + 1}`);
    });
  };

  /**
   * The speaker button next to a message.
   *
   * Three cases, in this order:
   *   1. this group is playing  -> stop it
   *   2. the clips are already here and still match the text -> replay them
   *      in order, without asking the TTS service again
   *   3. otherwise -> synthesise the text in chunks and start as soon as the
   *      first one arrives
   *
   * Works regardless of the read-aloud toggle: pressing the speaker is an
   * explicit request and overrides it.
   */
  const handleOnSpeakAtGroupIndexAction = (groupIndex: number) => {
    if (groupIndex < 0 || groupIndex >= messages.length) return;

    const message = messages[groupIndex];
    const currentText = Array.isArray(message?.content)
      ? message.content
        .filter((c: any) => c?.type === "text" || typeof c === "string")
        .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
        .join("")
      : (message?.content ?? "");

    const text = String(currentText || "").trim();
    if (!text) return;

    const group = audioFileDictRef.current[groupIndex];
    const clips = group ? Object.values(group) : [];

    // 1) Playing right now -> this press means stop.
    if (clips.some((item) => !item.audio.paused)) {
      stopAllAudio();
      if (!stopListRef.current.includes(groupIndex)) {
        setStopList([...stopListRef.current, groupIndex]);
      }
      return;
    }

    // Everything below is a start, so this group must not count as stopped.
    setStopList(stopListRef.current.filter((g) => g !== groupIndex));
    stopAllAudio();

    // 2) Reuse what is already in the browser, but only if it still belongs
    //    to this text - an edited or regenerated message needs fresh audio.
    const cachedText = String(group?.[0]?.audio?.__text ?? "").trim();
    const usable = clips.length > 0 &&
      clips.some((item) => !!item.audio.src) &&
      cachedText === text;

    if (usable) {
      replayGroupFromStart(groupIndex);
      return;
    }

    // 3) Nothing usable cached - synthesise it.
    speakMessageInSmartChunks(groupIndex, text);
  };

  /** Pauses and rewinds every clip in every group. */
  const stopAllAudio = () => {
    Object.values(audioFileDictRef.current).forEach((group) => {
      Object.values(group).forEach((item) => {
        if (!item.audio.paused) item.audio.pause();
        try {
          item.audio.currentTime = 0;
        } catch {
          // A clip that never loaded rejects the seek; nothing to rewind.
        }
      });
    });
  };

  /**
   * Plays a group that is already in memory from the beginning: rewinds every
   * clip, re-chains them so one starts the next, and begins with the first.
   */
  const replayGroupFromStart = (groupIndex: number) => {
    const group = audioFileDictRef.current[groupIndex];
    if (!group) return;

    const order = Object.keys(group)
      .map(Number)
      .sort((a, b) => a - b)
      .filter((idx) => !!group[idx]?.audio?.src);
    if (order.length === 0) return;

    const session = ++playSessionRef.current;

    // Rewind and re-arm. The clips were played before, so their one-shot
    // "ended" handlers are spent and have to be attached again.
    order.forEach((idx, position) => {
      const el = group[idx].audio as HTMLAudioElement & { __chain?: () => void };
      try {
        el.currentTime = 0;
      } catch {
        // not loaded yet - it will start at zero anyway
      }
      if (el.__chain) el.removeEventListener("ended", el.__chain);

      const nextIdx = order[position + 1];
      if (nextIdx === undefined) {
        el.__chain = undefined;
        return;
      }
      const chain = () => {
        if (session !== playSessionRef.current) return;
        if (stopListRef.current.includes(groupIndex)) return;
        group[nextIdx].audio.play().catch((err) =>
          console.warn("Audio play() rejected in replay chain:", err)
        );
      };
      el.__chain = chain;
      el.addEventListener("ended", chain, { once: true });
    });

    // Mark them unplayed so the read-aloud effect does not skip ahead.
    setAudioFileDict((prev) => {
      const next = { ...prev };
      const copy = { ...(next[groupIndex] ?? {}) };
      for (const idx of order) copy[idx] = { ...copy[idx], played: false };
      next[groupIndex] = copy;
      return next;
    });

    group[order[0]].audio.play().catch((err) =>
      console.warn("Audio play() rejected on replay:", err)
    );
  };

  const handleUploadActionToMessages = (uploadedMessages: Message[]) => {
    const newMessages = uploadedMessages.map((msg) => [msg]).flat();
    setMessages(newMessages);
    safePersist(newMessages, currentChatSuffix);
    const textarea = document.querySelector("textarea");
    textarea?.focus();
  };

  const handleImagesUploaded = (newImages: any[]) => {
    setImages((prevImages) => [...prevImages, ...newImages]);
  };

  const handlePdfsUploaded = (newPdfs: PdfFile[]) => {
    setPdfs((prevPdfs) => [...prevPdfs, ...newPdfs]);
  };

  const handleImageChange = (images_: any[]) => {
    setImages(images_);
  };

  // ======= TTS CLEANING & CURLY-BRACE STRIPPER =======

  /**
   * Remove everything inside *balanced* { ... } blocks, including nested ones.
   * Example:
   *   "Hello { \"a\": {\"b\": 1} } world" -> "Hello  world"
   */
  const stripCurlyBraceBlocks = (s: string): string => {
    let out = "";
    let depth = 0;
    let inString = false;
    let quote: string | null = null;
    let escape = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === quote) {
          inString = false;
          quote = null;
          continue;
        }
        if (depth === 0) out += ch; // string outside { } should still be kept
        continue;
      }

      if (ch === '"' || ch === "'") {
        if (depth === 0) out += ch;
        inString = true;
        quote = ch;
        continue;
      }

      if (ch === "{") {
        depth++;
        // do not include "{" nor content while depth > 0
        continue;
      }
      if (ch === "}") {
        if (depth > 0) {
          depth--;
          continue;
        }
        // stray } outside a block
        out += ch;
        continue;
      }

      if (depth === 0) out += ch;
      // else inside { ... } -> skip
    }

    return out;
  };

  const cleanForTTS = (s: string) =>
    stripJsonLikeBlocks(String(s))
      .replace(/\*/g, "")
      .replace(
        /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u2600-\u26FF\u2700-\u27BF\uFE0F\u200D]/gu,
        "",
      )
      .replace(/\s{2,}/g, " ")
      .trim();

  // ======= THINK TAG STREAM FILTER =======
  type ThinkState = { inThink: boolean; carry: string };
  const makeThinkFilter = () => {
    const CARRY_OPEN = 16;
    const CARRY_CLOSE = 16;
    const state: ThinkState = { inThink: false, carry: "" };

    const consume = (chunk: string): string => {
      let s = state.carry + chunk;
      let out = "";
      let i = 0;

      const lowerAt = (from: number) => s.slice(from).toLowerCase();

      while (i < s.length) {
        if (!state.inThink) {
          const L = lowerAt(i);
          const rel = L.indexOf("<think");
          if (rel === -1) {
            const keepTail = Math.max(0, s.length - CARRY_OPEN);
            out += s.slice(i, keepTail);
            state.carry = s.slice(keepTail);
            break;
          } else {
            const j = i + rel;
            out += s.slice(i, j);
            const end = s.indexOf(">", j);
            if (end === -1) {
              state.carry = s.slice(j);
              break;
            }
            state.inThink = true;
            i = end + 1;
          }
        } else {
          const L = lowerAt(i);
          const rel = L.indexOf("</think");
          if (rel === -1) {
            const keepTail = Math.max(0, s.length - CARRY_CLOSE);
            state.carry = s.slice(i >= s.length ? s.length : keepTail);
            break;
          } else {
            const j = i + rel;
            const end = s.indexOf(">", j);
            if (end === -1) {
              state.carry = s.slice(j);
              break;
            }
            state.inThink = false;
            i = end + 1;
          }
        }
      }
      return out;
    };

    const flush = (): string => {
      if (!state.inThink && state.carry) {
        const tail = state.carry;
        state.carry = "";
        return tail;
      }
      state.carry = "";
      return "";
    };

    return { consume, flush };
  };

  // ======= STREAMING JSON SUPPRESSOR FOR TTS =======
  type JsonTtsFilterState = { depth: number };
  const makeJsonTtsFilter = () => {
    const state: JsonTtsFilterState = { depth: 0 };

    /**
     * Streaming filter:
     * - as soon as we see '{', we start "muting" until the matching '}' (depth back to 0)
     * - everything inside the braces is *never* emitted to TTS
     * - braces themselves are also not emitted
     * - depth is kept across chunks
     */
    const consume = (chunk: string): string => {
      let out = "";
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (ch === "{") {
          state.depth++;
          continue;
        }
        if (ch === "}") {
          if (state.depth > 0) {
            state.depth--;
            continue;
          }
          // stray closing brace outside a block → keep
          out += ch;
          continue;
        }
        if (state.depth === 0) out += ch;
      }
      return out;
    };

    return { consume };
  };

  // ---- API helpers ----
  const fetchBildungsplan = async (query_: string, top_n: number) => {
    try {
      // DEBUG req
      await serverLog("api.fetch.bildungsplan.req", { query: query_, top_n });

      const response = await fetch("/api/bildungsplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query_,
          top_n,
          universalApiKey: settings.universalApiKey,
        }),
      });

      await serverLog("api.fetch.bildungsplan.rsp", {
        ok: response.ok,
        status: response.status,
      });

      if (!response.ok) {
        console.error(
          "bildungsplan API HTTP",
          response.status,
          await response.text().catch(() => ""),
        );
        return { results: [] as { text: string; score: number }[] };
      }

      const data = (await response.json()) as BildungsplanResponse | null;

      await serverLog("api.fetch.bildungsplan.parsed", {
        count: data?.results?.length ?? 0,
      });

      return data ?? { results: [] };
    } catch (error) {
      console.error("Error in bildungsplan API:", error);
      await serverLog("api.fetch.bildungsplan.error", {
        error: String(error),
      });
      return { results: [] };
    }
  };

  const fetchWikipedia = async (text: string, collection: string, n: number) => {
    try {
      // DEBUG req
      await serverLog("api.fetch.wikipedia.req", { text, collection, n });

      const response = await fetch("/api/wikipedia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          collection,
          n,
          universalApiKey: settings.universalApiKey,
        }),
      });

      await serverLog("api.fetch.wikipedia.rsp", {
        ok: response.ok,
        status: response.status,
      });

      if (!response.ok) {
        console.error(
          "wikipedia API HTTP",
          response.status,
          await response.text().catch(() => ""),
        );
        return [] as WikipediaResult[];
      }

      const data = (await response.json()) as WikipediaResult[] | null;

      await serverLog("api.fetch.wikipedia.parsed", {
        count: data?.length ?? 0,
      });

      return data ?? [];
    } catch (error) {
      console.error("Error in wikipedia API:", error);
      await serverLog("api.fetch.wikipedia.error", { error: String(error) });
      return [] as WikipediaResult[];
    }
  };

  const fetchPapers = async (query_: string, limit: number) => {
    try {
      // DEBUG req
      await serverLog("api.fetch.papers.req", { query: query_, limit });

      const response = await fetch("/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query_,
          limit,
          universalApiKey: settings.universalApiKey,
        }),
      });

      await serverLog("api.fetch.papers.rsp", {
        ok: response.ok,
        status: response.status,
      });

      if (!response.ok) {
        console.error(
          "papers API HTTP",
          response.status,
          await response.text().catch(() => ""),
        );
        return {
          payload: { items: [] as PapersItem[] },
        } as PapersResponse;
      }

      const data = (await response.json()) as PapersResponse | null;

      await serverLog("api.fetch.papers.parsed", {
        count: data?.payload?.items?.length ?? 0,
      });

      return data ?? { payload: { items: [] } };
    } catch (error) {
      console.error("Error in papers API:", error);
      await serverLog("api.fetch.papers.error", { error: String(error) });
      return {
        payload: { items: [] },
      } as PapersResponse;
    }
  };

  // ---------- Image generation / editing ----------

  interface ImageGenResult {
    images: string[];
    model?: string;
    error?: string;
  }

  /** Calls /api/imagegen. `inputImages` turns the call into an edit request. */
  const fetchImageGen = async (
    prompt: string,
    options?: {
      model?: string;
      n?: number;
      size?: string;
      aspectRatio?: string;
      inputImages?: string[];
    },
  ): Promise<ImageGenResult> => {
    // No model unless one was explicitly requested – the server/API then falls
    // back to whatever model it has configured as its default.
    const model = (options?.model ?? "").trim();
    try {
      await serverLog("api.fetch.imagegen.req", {
        prompt,
        model: model || "(api default)",
        n: options?.n,
        size: options?.size,
        aspectRatio: options?.aspectRatio,
        inputImageCount: options?.inputImages?.length ?? 0,
      });

      const requestBody: Record<string, any> = {
        prompt,
        n: options?.n || 1,
        size: options?.size || "1024x1024",
        aspectRatio: options?.aspectRatio || "1:1",
        universalApiKey: settings.universalApiKey,
        orModel: settings.orImageModel,
      };
      if (model) requestBody.model = model;
      if (options?.inputImages && options.inputImages.length > 0) {
        requestBody.input_images = options.inputImages;
      }

      const response = await fetch("/api/imagegen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      await serverLog("api.fetch.imagegen.rsp", {
        ok: response.ok,
        status: response.status,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error("imagegen API HTTP", response.status, errorText);
        return { images: [], error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = (await response.json()) as ImageGenResult | null;
      await serverLog("api.fetch.imagegen.parsed", {
        count: data?.images?.length ?? 0,
        model: data?.model,
      });
      return data ?? { images: [], error: "Empty response" };
    } catch (error) {
      console.error("Error in imagegen API:", error);
      await serverLog("api.fetch.imagegen.error", { error: String(error) });
      return { images: [], error: String(error) };
    }
  };

  /** Highest numeric suffix used by image IDs of a given prefix. */
  const findHighestImageIdForPrefix = (
    msgs: Message[],
    prefix: "gen" | "upl" | "img",
  ): number => {
    let maxId = 0;
    const pattern = new RegExp(`^${prefix}_(\\d+)$`);
    for (const msg of msgs) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content as any[]) {
        if (part?.type === "image_url" && part?.id) {
          const match = String(part.id).match(pattern);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxId) maxId = num;
          }
        }
      }
    }
    return maxId;
  };

  const nextGeneratedImageBaseId = (msgs: Message[]): number =>
    Math.max(
      findHighestImageIdForPrefix(msgs, "gen"),
      findHighestImageIdForPrefix(msgs, "upl"),
      findHighestImageIdForPrefix(msgs, "img"),
    );

  /** Looks up an image data URL by its ID (gen_/upl_/img_) in the history. */
  const findImageByIdInMessages = (
    msgs: Message[],
    targetId: string,
  ): string | null => {
    for (const msg of msgs) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content as any[]) {
        if (
          part?.type === "image_url" && part?.id === targetId &&
          part?.image_url?.url
        ) {
          return part.image_url.url;
        }
      }
    }
    return null;
  };

  /** Returns the last `count` images of the conversation, oldest first. */
  const findLastImagesInMessages = (
    msgs: Message[],
    count: number = 1,
  ): string[] => {
    const found: string[] = [];
    for (let i = msgs.length - 1; i >= 0 && found.length < count; i--) {
      const msg = msgs[i];
      if (!Array.isArray(msg.content)) continue;
      const parts = msg.content as any[];
      for (let j = parts.length - 1; j >= 0 && found.length < count; j--) {
        const part = parts[j];
        if (part?.type === "image_url" && part?.image_url?.url) {
          found.unshift(part.image_url.url);
        }
      }
    }
    return found;
  };

  const formatImageGenResults = (
    result: ImageGenResult,
    prompt: string,
  ): { text: string; images: string[] } => {
    const c = chatIslandContent[lang];
    if (result.error) {
      return {
        text: `**${c.imageGenError ?? "Image generation error"}**: ${result.error}`,
        images: [],
      };
    }
    if (!result.images || result.images.length === 0) {
      return {
        text: `**${c.imageGenNoImages ?? "No images were generated"}**`,
        images: [],
      };
    }
    // The model line is only shown when the API reported which model it used.
    const modelLine = result.model
      ? `\n**${c.imageGenModel ?? "Model"}**: ${result.model}`
      : "";
    const text = `**${c.imageGenGenerated ?? "Generated image"}** (${
      result.images.length
    })\n**${c.imageGenPrompt ?? "Prompt"}**: ${prompt}${modelLine}`;
    return { text, images: result.images };
  };

  /**
   * Executes an imagegen/imageedit trigger and appends the resulting message.
   * Returns the new message array plus whether images were produced.
   */
  /**
   * What the server needs to compose the tool instructions: which permissions
   * are on, and a couple of facts about what is open.
   *
   * Deliberately no prose - the wording lives on the server, so nothing the
   * browser sends can end up as an instruction in the system prompt.
   */
  const buildToolFlags = () => {
    const nb = activeNotebookRef.current;
    const mailOn = mailToolsAllowed && isMailSyncConfigured(mailAccount);
    return {
      notebook: notebookToolsAllowed,
      mail: mailOn,
      // Lieder gibt es nur ueber OpenRouter; ohne solchen Schluessel bekommt
      // das Modell die Anleitung gar nicht erst zu sehen.
      music: /^sk-or-v1-[A-Za-z0-9]/.test((settings.universalApiKey ?? "").trim()),
      grading: /^sk-or-v1-[A-Za-z0-9]/.test((settings.universalApiKey ?? "").trim()),
      docCount: images.length + pdfs.length,
      notebookName: notebookToolsAllowed && nb ? nb.name : "",
      notebookCells: notebookToolsAllowed && nb ? nb.cells.length : 0,
      mailFolders: mailOn ? loadMailLimits().folders : [],
      docs: docsToolsAllowed,
      // Names only, and only with permission. The server strips them again
      // before they go anywhere near the system prompt.
      docNames: docsToolsAllowed ? docList.map((d) => d.name) : [],
    };
  };

  /**
   * Runs a notebook or mailbox request from the assistant.
   *
   * Both are gated behind a permission the user sets themselves, and both
   * answer with plain text that is appended to the conversation - so the
   * model sees the result of its own action and can react to it.
   */
  const runToolTrigger = async (
    trig: Extract<AutoTrigger, { kind: "notebook" | "mail" | "docs" }>,
    accumulated: Message[],
  ): Promise<{ accumulated: Message[]; success: boolean }> => {
    const say = (text: string, extra?: Record<string, unknown>[]) => {
      const content = extra && extra.length
        ? [{ type: "text", text }, ...extra]
        : text;
      const next = [...accumulated, { role: "assistant", content } as Message];
      setMessages(next);
      safePersist(next, currentChatSuffix);
      return next;
    };

    try {
      if (trig.kind === "notebook") {
        if (!notebookToolsAllowed) {
          return {
            accumulated: say(chatIslandContent[lang]["toolNotebookDenied"]),
            success: false,
          };
        }
        await serverLog("tool.notebook", { action: trig.payload.action });

        const current = activeNotebookRef.current ?? listNotebooks()[0] ?? null;
        const result = applyNotebookAction(trig.payload, current);

        if (result.notebook) {
          // Keep the open window in step with what was just changed.
          activeNotebookRef.current = result.notebook;
          setNotebookRevision((n) => n + 1);
        }
        const text = result.snapshot
          ? `${result.message}

${result.snapshot}`
          : result.message;
        return { accumulated: say(text), success: result.ok };
      }

      // ----- word processor -----
      if (trig.kind === "docs") {
        if (!docsToolsAllowed) {
          return {
            accumulated: say(chatIslandContent[lang]["toolDocsDenied"]),
            success: false,
          };
        }
        await serverLog("tool.docs", { action: trig.payload.action });

        // The shape was checked when the trigger was accepted; the module
        // itself validates the details and refuses what it cannot use.
        const result = await applyDocsAction(
          trig.payload as unknown as DocsAction,
          activeDocRef.current?.id,
        );
        if (result.openId) {
          // Show what was just written, and keep an open window in step.
          setOpenDocId(result.openId);
          setDocsRevision((n) => n + 1);
          setDocList(await listDocs());
        }
        const text = result.snapshot
          ? `${result.message}\n\n${result.snapshot}`
          : result.message;
        return { accumulated: say(text), success: result.ok };
      }

      // ----- mailbox -----
      if (!mailToolsAllowed) {
        return {
          accumulated: say(chatIslandContent[lang]["toolMailDenied"]),
          success: false,
        };
      }
      if (!isMailSyncConfigured(mailAccount)) {
        return {
          accumulated: say(chatIslandContent[lang]["toolMailNoAccount"]),
          success: false,
        };
      }
      await serverLog("tool.mail", { action: trig.payload.action });

      const result = await runMailAction(mailAccount, trig.payload);
      if (result.attachment) {
        // Hand the file to the UI as a download chip rather than dropping the
        // bytes into the conversation text.
        return {
          accumulated: say(result.text, [{
            type: "file",
            name: result.attachment.filename,
            mimeType: result.attachment.contentType,
            size: result.attachment.size,
            dataUrl: result.attachment.dataUrl,
          }]),
          success: true,
        };
      }
      return { accumulated: say(result.text), success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await serverLog("tool.error", { kind: trig.kind, message });
      return { accumulated: say(`Fehler: ${message}`), success: false };
    }
  };

  const runImageTrigger = async (
    trig: Extract<AutoTrigger, { kind: "imagegen" | "imageedit" }>,
    accumulated: Message[],
  ): Promise<{ accumulated: Message[]; success: boolean }> => {
    let inputImages: string[] = [...(trig.inputImages ?? [])];

    if (trig.kind === "imageedit") {
      await serverLog("imageedit.call", {
        prompt: trig.prompt,
        model: trig.model,
        n: trig.n,
        hasInputImages: inputImages.length > 0,
        useLastImage: trig.useLastImage,
        imageId: trig.imageId,
        imageIds: trig.imageIds,
      });

      // Priority 1: single explicit ID
      if (trig.imageId && inputImages.length === 0) {
        const found = findImageByIdInMessages(accumulated, trig.imageId);
        if (found) {
          inputImages = [found];
          await serverLog("imageedit.foundById", { imageId: trig.imageId });
        }
      }

      // Priority 2: multiple explicit IDs
      if (trig.imageIds?.length && inputImages.length === 0) {
        for (const id of trig.imageIds) {
          const found = findImageByIdInMessages(accumulated, id);
          if (found) inputImages.push(found);
        }
        await serverLog("imageedit.foundByIds", {
          requestedIds: trig.imageIds,
          foundCount: inputImages.length,
        });
      }

      // Priority 3: last image in the conversation
      if (trig.useLastImage && inputImages.length === 0) {
        inputImages = findLastImagesInMessages(accumulated, 1);
        await serverLog("imageedit.usingLastImage", {
          found: inputImages.length > 0,
        });
      }

      if (inputImages.length === 0) {
        const noImageMsg = lang === "de"
          ? `Kein Bild zum Bearbeiten gefunden.${
            trig.imageId ? ` Bild-ID "${trig.imageId}" existiert nicht.` : ""
          } Bitte lade ein Bild hoch oder generiere zuerst eines.`
          : `No image found to edit.${
            trig.imageId
              ? ` Image ID "${trig.imageId}" does not exist.`
              : ""
          } Please upload an image or generate one first.`;
        const next = [
          ...accumulated,
          { role: "assistant", content: noImageMsg },
        ];
        setMessages(next);
        safePersist(next, currentChatSuffix);
        return { accumulated: next, success: false };
      }
    } else {
      await serverLog("imagegen.call", {
        prompt: trig.prompt,
        model: trig.model,
        n: trig.n,
        size: trig.size,
        aspectRatio: trig.aspectRatio,
        hasInputImages: inputImages.length > 0,
      });
    }

    const res = await fetchImageGen(
      trig.prompt || (trig.kind === "imageedit" ? "Edit this image" : ""),
      {
        model: trig.model,
        n: trig.n,
        size: trig.kind === "imagegen" ? trig.size : undefined,
        aspectRatio: trig.kind === "imagegen" ? trig.aspectRatio : undefined,
        inputImages: inputImages.length > 0 ? inputImages : undefined,
      },
    );

    const formatted = formatImageGenResults(
      res,
      trig.prompt || (trig.kind === "imageedit" ? "Image edit" : ""),
    );

    await serverLog(`${trig.kind}.result`, {
      imageCount: res.images?.length ?? 0,
      hasError: !!res.error,
    });

    const fallbackMsg = trig.kind === "imageedit"
      ? (lang === "de"
        ? "Entschuldigung, die Bildbearbeitung ist fehlgeschlagen."
        : "Sorry, the image editing failed.")
      : (lang === "de"
        ? "Entschuldigung, die Bildgenerierung ist fehlgeschlagen."
        : "Sorry, the image generation failed.");

    let messageContent: string | any[];
    if (formatted.images.length > 0) {
      const contentParts: any[] = [{ type: "text", text: formatted.text }];
      const baseId = nextGeneratedImageBaseId(accumulated);
      for (let i = 0; i < formatted.images.length; i++) {
        contentParts.push({
          type: "image_url",
          image_url: { url: formatted.images[i] },
          id: `gen_${String(baseId + 1 + i).padStart(5, "0")}`,
          source: "generated",
          timestamp: Date.now(),
        });
      }
      messageContent = contentParts;
    } else {
      messageContent = formatted.text || fallbackMsg;
    }

    const next = [
      ...accumulated,
      { role: "assistant", content: messageContent },
    ];
    setMessages(next);
    safePersist(next, currentChatSuffix);
    return { accumulated: next, success: formatted.images.length > 0 };
  };

  /**
   * Generates a song with Lyria and puts a player in the chat.
   *
   * Lyria hands back the lyrics about twenty seconds before the audio, so the
   * message is written twice: once with the words and a spinner, and again
   * when the MP3 arrives. That is as close to streaming as this model gets -
   * the audio itself comes in a single piece, not progressively.
   */
  const runSongTrigger = async (
    trig: Extract<AutoTrigger, { kind: "song" }>,
    accumulated: Message[],
  ): Promise<{ accumulated: Message[]; success: boolean }> => {
    await serverLog("song.call", { prompt: trig.prompt.slice(0, 120), model: trig.model });

    const songId = `song_${String(Date.now()).slice(-8)}`;
    const draftIndex = accumulated.length;
    let current: Message[] = [
      ...accumulated,
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          {
            type: "audio_url",
            audio_url: { url: "" },
            id: songId,
            source: "song",
            pending: true,
            prompt: trig.prompt,
            timestamp: Date.now(),
          },
        ],
      },
    ];
    setMessages(current);

    /** Replaces the placeholder part in place. */
    const patch = (fields: Record<string, unknown>) => {
      const next = current.map((m, i) => {
        if (i !== draftIndex || !Array.isArray(m.content)) return m;
        return {
          ...m,
          content: m.content.map((part: any) =>
            part?.id === songId ? { ...part, ...fields } : part
          ),
        };
      });
      current = next;
      setMessages(next);
      return next;
    };

    try {
      const resp = await fetch("/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trig.prompt,
          orModel: trig.model ?? settings.orMusicModel ?? "",
          universalApiKey: settings.universalApiKey,
        }),
      });
      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        throw new Error(detail || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let event = "message";
      let ok = false;
      let failure = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.trimEnd();
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith("data:")) continue;
          let data: any;
          try {
            data = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          if (event === "lyrics") {
            patch({ lyrics: data.lyrics });
          } else if (event === "audio") {
            patch({
              audio_url: { url: `data:${data.mime ?? "audio/mpeg"};base64,${data.audio}` },
              lyrics: data.lyrics ?? undefined,
              pending: false,
              model: data.model,
            });
            ok = true;
          } else if (event === "error") {
            failure = String(data?.message ?? "");
          }
          event = "message";
        }
      }

      if (!ok) throw new Error(failure || "no audio");
      const finished = current;
      safePersist(finished, currentChatSuffix);
      return { accumulated: finished, success: true };
    } catch (err) {
      await serverLog("song.error", { error: String(err) });
      // Drop the placeholder and say what happened instead of leaving a
      // spinner that never stops.
      const failed = [
        ...accumulated,
        {
          role: "assistant",
          content: lang === "de"
            ? "Das Lied konnte nicht erzeugt werden."
            : "The song could not be generated.",
        },
      ];
      setMessages(failed);
      safePersist(failed, currentChatSuffix);
      return { accumulated: failed, success: false };
    }
  };

  /**
   * Runs the correction agent over the uploaded pages.
   *
   * Two phases with a question in between. The first reads and sorts the
   * pages and hands back a transcript; the assistant then asks the teacher how
   * to mark, and the answer starts the second. State between the two lives in
   * a ref rather than in the message list, because the transcripts of a whole
   * class set are far too large to keep in localStorage.
   */
  const runGradeTrigger = async (
    trig: Extract<AutoTrigger, { kind: "grade" }>,
    accumulated: Message[],
  ): Promise<{ accumulated: Message[]; success: boolean }> => {
    const de = lang === "de";
    const pending = gradingRef.current;
    const phase = trig.criteria && pending ? "mark" : "transcribe";

    // Phase 1 needs pages; phase 2 needs the transcript from phase 1.
    const docs: any[] = [];
    if (phase === "transcribe") {
      let i = 0;
      for (const img of images) {
        const url = img?.image_url?.url;
        if (typeof url === "string" && url) {
          docs.push({ index: ++i, name: img.name ?? `bild_${i}.png`, kind: "image", content: url });
        }
      }
      for (const pdf of pdfs) {
        docs.push({
          index: ++i,
          name: pdf.name ?? `datei_${i}.pdf`,
          kind: "pdf",
          content: `data:${pdf.mime_type || "application/pdf"};base64,${pdf.data}`,
        });
      }
      if (docs.length === 0) {
        const msg = de
          ? "Für die Korrektur brauche ich zuerst die Arbeiten - lade die Fotos oder PDFs hoch."
          : "To correct anything I need the papers first - upload the photos or PDFs.";
        const next = [...accumulated, { role: "assistant", content: msg }];
        setMessages(next);
        safePersist(next, currentChatSuffix);
        return { accumulated: next, success: false };
      }
    } else if (!pending) {
      return { accumulated, success: false };
    }

    const draftIndex = accumulated.length;
    let current: Message[] = [...accumulated, {
      role: "assistant",
      content: [{
        type: "agent_steps",
        id: `grade_${Date.now()}`,
        title: phase === "transcribe"
          ? (de ? "Arbeiten werden gelesen" : "Reading the papers")
          : (de ? "Arbeiten werden korrigiert" : "Marking the papers"),
        steps: [] as { step: string; detail?: string }[],
        running: true,
      }],
    }];
    setMessages(current);

    const patch = (fields: Record<string, unknown>) => {
      current = current.map((m, i) => {
        if (i !== draftIndex || !Array.isArray(m.content)) return m;
        return {
          ...m,
          content: m.content.map((part: any) =>
            part?.type === "agent_steps" ? { ...part, ...fields } : part
          ),
        };
      });
      setMessages(current);
    };
    const steps: { step: string; detail?: string }[] = [];

    try {
      const resp = await fetch("/api/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase,
          lang,
          universalApiKey: settings.universalApiKey,
          ...(phase === "transcribe" ? { docs } : {
            docs: pending!.docs,
            pages: pending!.pages,
            papers: pending!.papers,
            criteria: trig.criteria,
          }),
        }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error(await resp.text().catch(() => `HTTP ${resp.status}`));
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let event = "message";
      let done: any = null;
      let failure = "";

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trimEnd();
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith("data:")) continue;
          let data: any;
          try {
            data = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (event === "step") {
            steps.push(data);
            patch({ steps: [...steps] });
          } else if (event === "done") done = data;
          else if (event === "error") failure = String(data?.message ?? "");
          event = "message";
        }
      }
      if (!done) throw new Error(failure || "no result");

      patch({ running: false, steps: [...steps] });

      const file = {
        type: "file_download",
        id: `dl_${Date.now()}`,
        name: done.filename,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: done.docx,
      };

      if (done.phase === "transcribe") {
        gradingRef.current = { docs, pages: done.pages, papers: done.papers };
        const names = (done.papers ?? []).map((p: any) =>
          `${p.student} (${p.pages.length} ${de ? "Seiten" : "pages"})`
        ).join(", ");
        current = [...current, {
          role: "assistant",
          content: [
            {
              type: "text",
              text: de
                ? `Ich habe ${done.pages.length} Seiten gelesen und ${done.papers.length} Arbeiten erkannt: ${names}.\n\n` +
                  "Die Abschrift kannst du herunterladen und gegenlesen. Damit ich korrigieren kann, " +
                  "sag mir bitte den Erwartungshorizont: Wie viele Rohpunkte gibt es je Aufgabe, was wird " +
                  "erwartet, soll ich streng oder wohlwollend bewerten, und zählen Rechtschreibung und " +
                  "Grammatik mit oder werden sie nur kommentiert? Wenn du einen eigenen Notenschlüssel " +
                  "hast, nenn ihn - sonst nehme ich die übliche Hamburger Tabelle."
                : `I read ${done.pages.length} pages and found ${done.papers.length} papers: ${names}.\n\n` +
                  "You can download the transcript and check it. To mark the work, tell me the marking " +
                  "scheme: how many raw points per task, what is expected, should I be strict or lenient, " +
                  "and do spelling and grammar count or are they only commented on? If you have your own " +
                  "grade table, name it - otherwise I use the usual Hamburg one.",
            },
            file,
          ],
        }];
      } else {
        gradingRef.current = null;
        current = [...current, {
          role: "assistant",
          content: [
            {
              type: "text",
              text: de
                ? "Die Korrekturvorschläge sind fertig. Die Punktzahlen sind ein Vorschlag - bitte prüfe sie, bevor du sie weitergibst."
                : "The correction proposals are ready. The points are a proposal - please check them before passing them on.",
            },
            file,
          ],
        }];
      }
      setMessages(current);
      safePersist(current, currentChatSuffix);
      return { accumulated: current, success: true };
    } catch (err) {
      await serverLog("grade.error", { error: String(err) });
      patch({ running: false, failed: true });
      const failed = [...current, {
        role: "assistant",
        content: de
          ? `Die Korrektur ist fehlgeschlagen: ${String(err).slice(0, 200)}`
          : `Correcting failed: ${String(err).slice(0, 200)}`,
      }];
      setMessages(failed);
      safePersist(failed, currentChatSuffix);
      return { accumulated: failed, success: false };
    }
  };

  // ---------- PRIMARY: startStream ----------
  const startStream = async (transcript: string, prevMessages?: Message[]) => {
    // If we're editing a previous user message
    if (currentEditIndex !== undefined && currentEditIndex !== -1) {
      const updated = [...messages];
      updated[currentEditIndex] = {
        ...updated[currentEditIndex],
        content: query,
      };
      setMessages(updated);
      safePersist(updated, currentChatSuffix);
      setQuery("");
      setCurrentEditIndex(-1);
      return;
    }

    // Stop any ongoing audio and reset players
    (Object.values(audioFileDict) as Record<number, AudioItem>[]).forEach(
      (group) => {
        (Object.values(group) as AudioItem[]).forEach((item) => {
          if (!item.audio.paused) item.audio.pause();
          item.audio.currentTime = 0;
        });
      },
    );
    setAudioFileDict({ ...audioFileDict });

    if (!isStreamComplete) return;

    // Cancel previous stream
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsStreamComplete(false);
    // From the moment the question goes out, not from the first sign of life
    // upstream - a model that thinks for ten seconds before saying anything
    // would otherwise leave the screen looking dead for those ten seconds.
    setThinkingSince(Date.now());
    setResetTranscript((n) => n + 1);

    // Build outbound user content
    const userText = transcript && transcript.trim() !== "" ? transcript : query;
    let previousMessages = prevMessages || messages;

    previousMessages = previousMessages.map((m) => {
      if (typeof m.content === "string") return m;
      if (Array.isArray(m.content) && typeof m.content[0] === "string") {
        return { role: m.role, content: (m.content as string[]).join("") };
      }
      return m;
    });

    // Tell the LLM which image IDs are attached so it can reference them later
    // (e.g. {"imageedit": {"image_id": "upl_00001", ...}} for consistency).
    const imageHints = images
      .map((img: any) =>
        img?.id
          ? `[Attached image: ${img.id}${
            img.filename ? ` (${img.filename})` : ""
          }]`
          : ""
      )
      .filter((h: string) => h !== "")
      .join("\n");

    const contentPayload: any[] = [{
      type: "text",
      text: imageHints ? `${userText}\n\n${imageHints}` : userText,
    }];
    if (images.length > 0) for (const img of images) contentPayload.push(img);
    if (pdfs.length > 0) for (const pdf of pdfs) contentPayload.push(pdf);

    const newMessagesArr: Message[] = [
      ...previousMessages,
      { role: "user", content: contentPayload },
    ];

    // Clear composer state
    setImages([]);
    setPdfs([]);
    setMessages(newMessagesArr);
    safePersist(newMessagesArr, currentChatSuffix);
    setQuery("");
    resetComposerHeight();

    // DEBUG: Beginn des Flows
    serverLog("stream.begin", {
      userText,
      prevCount: previousMessages.length,
      images: images.length,
      pdfs: pdfs.length,
    });

    // ======= SHORT-CIRCUITS for USER input =======

    // (A) JSON triggers in USER message — with auto-summary
    const jsonUserTriggers = findJsonTriggersInText(userText);
    if (jsonUserTriggers.length) {
      serverLog("json.user.detect", { triggers: jsonUserTriggers });

      let accumulated: Message[] = [...newMessagesArr];
      let anyResults = false;
      // Notebook and mailbox actions answer with text the assistant should
      // react to, but they must not go through the search summary.
      let toolFollowUp = false;
      const successTrigs: AutoTrigger[] = [];
      for (const trig of jsonUserTriggers) {
        if (trig.kind === "wikipedia") {
          serverLog("wikipedia.call", {
            q: trig.q,
            n: trig.n ?? 5,
            collection: trig.collection,
          });
          const n = trig.n ?? 5;
          const collection =
            trig.collection ??
            (lang === "en"
              ? "English-ConcatX-Abstract"
              : "German-ConcatX-Abstract");
          const res = await fetchWikipedia(trig.q, collection, n);
          const out = (res || []).map((r: WikipediaResult, i: number) =>
            `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${(res || []).length}**\n**${
              chatIslandContent[lang].wikipediaTitle
            }**: ${r.Title}\n**${
              chatIslandContent[lang].wikipediaURL
            }**: ${r.URL}\n**${
              chatIslandContent[lang].wikipediaContent
            }**: ${r.content}\n**${
              chatIslandContent[lang].wikipediaScore
            }**: ${r.score}`,
          ).join("\n\n");
          serverLog("wikipedia.result", {
            length: out.length,
            empty: !out.trim(),
          });
          if (out.trim()) {
            anyResults = true;
            successTrigs.push(trig);
          }
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
          setMessages(accumulated);
          safePersist(accumulated, currentChatSuffix);
        } else if (trig.kind === "papers") {
          serverLog("papers.call", { q: trig.q, n: trig.n ?? 5 });
          const limit = trig.n ?? 5;
          const res = await fetchPapers(trig.q, limit);
          const items = res?.payload?.items || [];
          const out = items.map((it: PapersItem, i: number) => {
            const authors = it.authors?.join(", ") || "";
            const subjs = it.subjects?.join(", ") || "";
            const T = chatIslandContent[lang].papersTitle ?? "Title";
            const A = chatIslandContent[lang].papersAuthors ?? "Authors";
            const S = chatIslandContent[lang].papersSubjects ?? "Subjects";
            const AB = chatIslandContent[lang].papersAbstract ?? "Abstract";
            const doiLabel = "DOI";
            return `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${items.length}**\n**${T}**: ${it.title}\n**${A}**: ${
              authors
            }\n**${S}**: ${subjs}\n**${doiLabel}**: ${it.doi}\n**${AB}**: ${
              it.abstract
            }`;
          }).join("\n\n");
          serverLog("papers.result", {
            length: out.length,
            empty: !out.trim(),
          });
          if (out.trim()) {
            anyResults = true;
            successTrigs.push(trig);
          }
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
          setMessages(accumulated);
          safePersist(accumulated, currentChatSuffix);
        } else if (trig.kind === "bildungsplan") {
          serverLog("bildungsplan.call", { q: trig.q, n: trig.n ?? 5 });
          const top_n = trig.n ?? 5;
          const res = await fetchBildungsplan(trig.q, top_n);
          const results = res?.results || [];
          const out = results.map((r, i) =>
            `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${results.length}**\n${r.text}\n\n**Score**: ${r.score}`,
          ).join("\n\n");
          serverLog("bildungsplan.result", {
            length: out.length,
            empty: !out.trim(),
          });
          if (out.trim()) {
            anyResults = true;
            successTrigs.push(trig);
          }
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
          setMessages(accumulated);
          safePersist(accumulated, currentChatSuffix);
        } else if (isImageTrigger(trig)) {
          // Image generation/editing needs no auto-summary, so the trigger is
          // deliberately not pushed to successTrigs.
          const out = await runImageTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "grade") {
          const out = await runGradeTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "song") {
          const out = await runSongTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "notebook" || trig.kind === "mail" ||
          trig.kind === "docs") {
          // The assistant should see what came back, so these do continue the
          // conversation - but through their own follow-up, not the search
          // summary.
          const out = await runToolTrigger(trig, accumulated);
          accumulated = out.accumulated;
          if (out.success) toolFollowUp = true;
        }
      }
      setIsStreamComplete(true);
    setThinkingSince(null);
      serverLog("triggers.summary.maybe", {
        anyResults,
        successCount: successTrigs.length,
      });
      if (anyResults && successTrigs.length) {
        const summaryPrompt = buildAutoSummaryPrompt(successTrigs);
        startStream(summaryPrompt, accumulated);
      } else if (toolFollowUp) {
        // The tool answered; let the assistant read that answer and carry on -
        // that is what makes a chain like "search, then read, then summarise"
        // possible without the user prompting each step.
        startStream(chatIslandContent[lang]["toolFollowUp"], accumulated);
      }
      return;
    }

    // (B) Legacy hashtags in USER message
    const hashUserTriggers = findHashtagTriggersInUserText(userText);
    if (hashUserTriggers.length) {
      serverLog("hashtag.user.detect", { triggers: hashUserTriggers });

      let accumulated: Message[] = [...newMessagesArr];
      for (const trig of hashUserTriggers) {
        if (trig.kind === "wikipedia") {
          serverLog("wikipedia.call", {
            q: trig.q,
            n: trig.n ?? 5,
            collection: trig.collection,
          });
          const n = trig.n ?? 5;
          const collection =
            trig.collection ??
            (lang === "en"
              ? "English-ConcatX-Abstract"
              : "German-ConcatX-Abstract");
          const res = await fetchWikipedia(trig.q, collection, n);
          const out = (res || []).map((r: WikipediaResult, i: number) =>
            `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${(res || []).length}**\n**${
              chatIslandContent[lang].wikipediaTitle
            }**: ${r.Title}\n**${
              chatIslandContent[lang].wikipediaURL
            }**: ${r.URL}\n**${
              chatIslandContent[lang].wikipediaContent
            }**: ${r.content}\n**${
              chatIslandContent[lang].wikipediaScore
            }**: ${r.score}`,
          ).join("\n\n");
          serverLog("wikipedia.result", {
            length: out.length,
            empty: !out.trim(),
          });
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
        } else if (trig.kind === "papers") {
          serverLog("papers.call", { q: trig.q, n: trig.n ?? 5 });
          const limit = trig.n ?? 5;
          const res = await fetchPapers(trig.q, limit);
          const items = res?.payload?.items || [];
          const out = items.map((it: PapersItem, i: number) => {
            const authors = it.authors?.join(", ") || "";
            const subjs = it.subjects?.join(", ") || "";
            const T = chatIslandContent[lang].papersTitle ?? "Title";
            const A = chatIslandContent[lang].papersAuthors ?? "Authors";
            const S = chatIslandContent[lang].papersSubjects ?? "Subjects";
            const AB = chatIslandContent[lang].papersAbstract ?? "Abstract";
            const doiLabel = "DOI";
            return `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${items.length}**\n**${T}**: ${it.title}\n**${A}**: ${
              authors
            }\n**${S}**: ${subjs}\n**${doiLabel}**: ${it.doi}\n**${AB}**: ${
              it.abstract
            }`;
          }).join("\n\n");
          serverLog("papers.result", {
            length: out.length,
            empty: !out.trim(),
          });
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
        } else if (trig.kind === "bildungsplan") {
          serverLog("bildungsplan.call", { q: trig.q, n: trig.n ?? 5 });
          const top_n = trig.n ?? 5;
          const res = await fetchBildungsplan(trig.q, top_n);
          const results = res?.results || [];
          const out = results.map((r, i) =>
            `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${results.length}**\n${r.text}\n\n**Score**: ${r.score}`,
          ).join("\n\n");
          serverLog("bildungsplan.result", {
            length: out.length,
            empty: !out.trim(),
          });
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
        } else if (isImageTrigger(trig)) {
          const out = await runImageTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "grade") {
          const out = await runGradeTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "song") {
          const out = await runSongTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "notebook" || trig.kind === "mail" ||
          trig.kind === "docs") {
          // This path has no follow-up round; the result is shown as it is.
          const out = await runToolTrigger(trig, accumulated);
          accumulated = out.accumulated;
        }
      }
      setMessages(accumulated);
      safePersist(accumulated, currentChatSuffix);
      setIsStreamComplete(true);
    setThinkingSince(null);
      return;
    }

    // ======= Streaming path (LLM) =======
    let assistantDraftIndex = -1;
    const ongoingStream: string[] = [];
    let currentAudioIndex = 1;

    let assistantAccum = "";
    let gotAnyText = false;

    const seenTriggerKeys = new Set<string>();
    let endFinalized = false;
    let interruptedForTrigger = false;
    let pendingInstreamTriggers: AutoTrigger[] = [];

    const filterThink = makeThinkFilter();
    const jsonTtsFilter = makeJsonTtsFilter();

    const ensureDraft = () => {
      if (assistantDraftIndex !== -1) return;
      setMessages((prev) => {
        assistantDraftIndex = prev.length;
        const next = [...prev, { role: "assistant", content: "" }];
        safePersist(next, currentChatSuffix);
        return next;
      });
    };

    const appendToAssistant = (txt: string) => {
      if (!txt) return;
      setMessages((prev) => {
        if (assistantDraftIndex === -1) {
          assistantDraftIndex = prev.length;
          const next = [...prev, { role: "assistant", content: txt }];
          safePersist(next, currentChatSuffix);
          return next;
        }
        const idx = assistantDraftIndex;
        const last = prev[idx];
        const prevText =
          typeof last.content === "string"
            ? last.content
            : Array.isArray(last.content)
            ? (last.content as string[]).join("")
            : "";
        const updated = { ...last, content: prevText + txt };
        const next = [...prev];
        next[idx] = updated;
        safePersistThrottled(next, currentChatSuffix);
        return next;
      });
    };

    const keyOf = (t: AutoTrigger) => {
      if (t.kind === "notebook" || t.kind === "mail" || t.kind === "docs") {
        return `${t.kind}|${JSON.stringify(t.payload)}`;
      }
      if (t.kind === "imagegen") {
        return `imagegen|${t.prompt}|${t.model ?? ""}|${t.n ?? ""}`;
      }
      if (t.kind === "imageedit") {
        const imgHash = t.inputImages?.length
          ? String(t.inputImages.length)
          : "";
        return `imageedit|${t.prompt}|${t.model ?? ""}|${imgHash}|${
          t.imageId ?? ""
        }|${(t.imageIds ?? []).join(",")}|${t.useLastImage ?? ""}`;
      }
      if (t.kind === "song") return `song|${t.prompt}|${t.model ?? ""}`;
      if (t.kind === "grade") return `grade|${t.criteria ?? ""}`;
      return `${t.kind}|${t.q}|${
        t.kind === "wikipedia" ? (t as any).collection ?? "" : ""
      }|${t.n ?? ""}`;
    };

    // Triggers ausführen und (nur bei Erfolg) später zusammenfassen
    const handleTriggers = async (
      trigs: AutoTrigger[],
    ): Promise<{
      anyResults: boolean;
      accumulated: Message[];
      successTrigs: AutoTrigger[];
    }> => {
      if (!trigs.length) {
        return {
          anyResults: false,
          accumulated: messagesRef.current,
          successTrigs: [],
        };
      }

      // Dedupe
      const fresh: AutoTrigger[] = [];
      for (const t of trigs) {
        const k = keyOf(t);
        if (!seenTriggerKeys.has(k)) {
          seenTriggerKeys.add(k);
          fresh.push(t);
        }
      }
      if (!fresh.length) {
        return {
          anyResults: false,
          accumulated: messagesRef.current,
          successTrigs: [],
        };
      }

      await serverLog("triggers.begin", {
        requested: trigs,
        deduped: fresh,
      });

      let accumulated: Message[] = messagesRef.current;
      let anyResults = false;
      // Notebook and mailbox actions answer with text the assistant should
      // react to, but they must not go through the search summary.
      let toolFollowUp = false;
      const successTrigs: AutoTrigger[] = [];

      for (const trig of fresh) {
        if (trig.kind === "wikipedia") {
          await serverLog("wikipedia.call", {
            q: trig.q,
            n: trig.n ?? 5,
            collection: trig.collection,
          });
          const n = trig.n ?? 5;
          const collection =
            trig.collection ??
            (lang === "en"
              ? "English-ConcatX-Abstract"
              : "German-ConcatX-Abstract");
          const res = await fetchWikipedia(trig.q, collection, n);
          const out = (res || []).map((r: WikipediaResult, i: number) =>
            `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${(res || []).length}**\n**${
              chatIslandContent[lang].wikipediaTitle
            }**: ${r.Title}\n**${
              chatIslandContent[lang].wikipediaURL
            }**: ${r.URL}\n**${
              chatIslandContent[lang].wikipediaContent
            }**: ${r.content}\n**${
              chatIslandContent[lang].wikipediaScore
            }**: ${r.score}`,
          ).join("\n\n");
          await serverLog("wikipedia.result", {
            length: out.length,
            empty: !out.trim(),
          });
          if (out.trim()) {
            anyResults = true;
            successTrigs.push(trig);
          }
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
          setMessages(accumulated);
          safePersist(accumulated, currentChatSuffix);
        } else if (trig.kind === "papers") {
          await serverLog("papers.call", { q: trig.q, n: trig.n ?? 5 });
          const limit = trig.n ?? 5;
          const res = await fetchPapers(trig.q, limit);
          const items = res?.payload?.items || [];
          const out = items.map((it: PapersItem, i: number) => {
            const authors = it.authors?.join(", ") || "";
            const subjs = it.subjects?.join(", ") || "";
            const T = chatIslandContent[lang].papersTitle ?? "Title";
            const A = chatIslandContent[lang].papersAuthors ?? "Authors";
            const S = chatIslandContent[lang].papersSubjects ?? "Subjects";
            const AB = chatIslandContent[lang].papersAbstract ?? "Abstract";
            const doiLabel = "DOI";
            return `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${items.length}**\n**${T}**: ${it.title}\n**${A}**: ${
              authors
            }\n**${S}**: ${subjs}\n**${doiLabel}**: ${it.doi}\n**${AB}**: ${
              it.abstract
            }`;
          }).join("\n\n");
          await serverLog("papers.result", {
            length: out.length,
            empty: !out.trim(),
          });
          if (out.trim()) {
            anyResults = true;
            successTrigs.push(trig);
          }
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
          setMessages(accumulated);
          safePersist(accumulated, currentChatSuffix);
        } else if (trig.kind === "bildungsplan") {
          await serverLog("bildungsplan.call", {
            q: trig.q,
            n: trig.n ?? 5,
          });
          const top_n = trig.n ?? 5;
          const res = await fetchBildungsplan(trig.q, top_n);
          const results = res?.results || [];
          const out = results.map((r, i) =>
            `**${chatIslandContent[lang].result} ${i + 1} ${
              chatIslandContent[lang].of
            } ${results.length}**\n${r.text}\n\n**Score**: ${r.score}`,
          ).join("\n\n");
          await serverLog("bildungsplan.result", {
            length: out.length,
            empty: !out.trim(),
          });
          if (out.trim()) {
            anyResults = true;
            successTrigs.push(trig);
          }
          accumulated = [
            ...accumulated,
            {
              role: "assistant",
              content: out.trim() ||
                (lang === "de"
                  ? "Entschuldigung, die Suche hat keine Ergebnisse geliefert oder ist fehlgeschlagen."
                  : "Sorry, the search returned no results or failed."),
            },
          ];
          setMessages(accumulated);
          safePersist(accumulated, currentChatSuffix);
        } else if (isImageTrigger(trig)) {
          // Images are shown directly; no auto-summary run afterwards.
          const out = await runImageTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "grade") {
          const out = await runGradeTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "song") {
          const out = await runSongTrigger(trig, accumulated);
          accumulated = out.accumulated;
        } else if (trig.kind === "notebook" || trig.kind === "mail" ||
          trig.kind === "docs") {
          const out = await runToolTrigger(trig, accumulated);
          accumulated = out.accumulated;
          if (out.success) toolFollowUp = true;
        }
      }

      return { anyResults, accumulated, successTrigs };
    };

    // Zusammenfassung nach Triggern (nur bei Erfolg)
    const runTriggersAndMaybeSummarize = async (trigs: AutoTrigger[]) => {
      await serverLog("triggers.summary.maybe", { requested: trigs.length });
      const { anyResults, accumulated, successTrigs } = await handleTriggers(
        trigs,
      );
      setIsStreamComplete(true);
    setThinkingSince(null);
      await serverLog("triggers.summary.result", {
        anyResults,
        successCount: successTrigs.length,
      });
      if (anyResults && successTrigs.length) {
        const summaryPrompt = buildAutoSummaryPrompt(successTrigs);
        startStream(summaryPrompt, accumulated);
      }
    };

    const finalizeStream = async () => {
      if (endFinalized) return;
      endFinalized = true;

      setIsStreamComplete(true);
    setThinkingSince(null);
      setQuery("");

      const flushed = filterThink.flush();
      if (flushed) {
        appendToAssistant(flushed);
        assistantAccum += flushed;
        const ttsTail = jsonTtsFilter.consume(flushed);
        if (ttsTail) {
          ongoingStream.push(ttsTail);
        }
      }

      flushPersistThrottle();

      if (!gotAnyText) {
        setMessages((prev) => {
          if (!prev.length) return prev;
          const idx =
            assistantDraftIndex === -1 ? prev.length - 1 : assistantDraftIndex;
          const last = prev[idx];
          const txt =
            typeof last?.content === "string"
              ? last.content
              : Array.isArray(last?.content)
              ? (last.content as string[]).join("")
              : "";
          if (last?.role === "assistant" && (!txt || txt.trim() === "")) {
            const next = [...prev];
            next.splice(idx, 1);
            safePersist(next, currentChatSuffix);
            return next;
          }
          return prev;
        });
      } else {
        // Whatever is left when the stream ends. This is the one place a chunk
        // may fall below MIN_TTS_WORDS: there is no next sentence to merge it
        // into, and the chunks before it are already synthesised. Dropping it
        // would swallow the end of the answer, so a short tail is spoken.
        const remaining = ongoingStream.join("").trim();
        if (remaining) {
          const groupIndex =
            assistantDraftIndex === -1
              ? messagesRef.current.length - 1
              : assistantDraftIndex;
          getTTS(remaining, groupIndex, `stream${currentAudioIndex}`);
        }
      }

      // Nach regulärem Stream-Ende: Trigger (falls vorhanden) ausführen und ggf. zusammenfassen
      const finalTriggers = findJsonTriggersInText(assistantAccum);
      await serverLog("stream.finalize", {
        gotAnyText,
        assistantAccumLen: assistantAccum.length,
        triggersFound: finalTriggers.length,
      });
      if (finalTriggers.length) {
        await serverLog("json.poststream.detect", {
          triggers: finalTriggers,
        });
        await runTriggersAndMaybeSummarize(finalTriggers);
      }

      abortRef.current = null;
    };

    await serverLog("sse.request", {
      url: "/api/chat",
      model: settings.apiModel,
      apiUrl: settings.apiUrl,
      images: images.length,
      pdfs: pdfs.length,
    });

    await fetchEventSource("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang,
        messages: newMessagesArr,
        universalApiKey: settings.universalApiKey,
        llmApiUrl: settings.apiUrl,
        llmApiKey: settings.apiKey,
        llmApiModel: settings.apiModel,
        vlmApiUrl: settings.vlmUrl,
        vlmApiKey: settings.vlmKey,
        vlmApiModel: settings.vlmModel,
        vlmCorrectionModel: settings.vlmCorrectionModel,
        // Overrides that only apply when the key is an OpenRouter key.
        orLlmModel: settings.orLlmModel,
        orVlmModel: settings.orVlmModel,
        systemPrompt: settings.systemPrompt,
        // Only the flags travel; the instructions themselves are assembled
        // on the server.
        toolFlags: buildToolFlags(),
      }),
      signal: abortRef.current?.signal,

      async onopen(response: Response) {
        await serverLog("sse.open", {
          ok: response.ok,
          status: response.status,
        });
        if (response.ok) return;
        if (response.status !== 200) {
          const errorText = await response.text().catch(() => "");
          ensureDraft();
          appendToAssistant(
            `\n\n**BACKEND ERROR**\nStatuscode: ${response.status}\nMessage: ${
              errorText || response.statusText
            }`,
          );
          throw new FatalError(errorText || response.statusText);
        }
        throw new RetriableError();
      },

      onmessage(ev: EventSourceMessage) {
        if (ev.event === "error") {
          const err = (() => {
            try {
              return JSON.parse(ev.data);
            } catch {
              return { message: ev.data };
            }
          })();
          ensureDraft();
          appendToAssistant(
            `\n\n**BACKEND ERROR**\nStatuscode: ${
              err?.status ?? ""
            }\nMessage: ${err?.message ?? ""}`,
          );
          return;
        }
        if (ev.event === "thinking") {
          // Either a keep-alive or a piece of the model's reasoning. Both mean
          // the same thing here: it is working, it just has nothing to show.
          setThinkingSince((t) => t ?? Date.now());
          return;
        }
        if (ev.event === "no_content") {
          return;
        }

        let rawChunk = "";
        try {
          rawChunk = JSON.parse(ev.data) as string;
        } catch {
          return;
        }
        if (!rawChunk) return;

        // DEBUG: chunklen
        serverLog("sse.chunk", { len: rawChunk.length });

        // Early end marker
        if (rawChunk === "[DONE]") {
          setTimeout(() => abortRef.current?.abort(), 0);
          finalizeStream();
          return;
        }

        // THINK filter
        const chunk = filterThink.consume(rawChunk);
        if (!chunk) return;

        gotAnyText = true;
        setThinkingSince(null);
        ensureDraft();

        // full text (inkl. JSON) für Trigger-Erkennung
        assistantAccum += chunk;

        // Nur JSON-bereinigten Text in den TTS-Puffer schieben
        const ttsChunk = jsonTtsFilter.consume(chunk);

        if (ttsChunk) {
          // TTS buffer (nur Text außerhalb von { ... })
          ongoingStream.push(ttsChunk);
          // Keep pulling: one arriving delta can complete more than one chunk.
          // A sentence shorter than MIN_TTS_WORDS stays in the buffer and is
          // spoken together with the next one, instead of becoming a clipped
          // one-word clip of its own.
          for (;;) {
            const combined = ongoingStream.join("");
            // Erster Chunk klein (schneller Sprechbeginn), danach groesser -
            // eine Anfrage kostet rund 1,3 s Fixaufwand, siehe ttsChunks.ts.
            const next = takeSpeechChunk(
              combined,
              currentAudioIndex === 0 ? MIN_TTS_WORDS : MIN_TTS_WORDS_FOLLOWUP,
            );
            if (!next) break;
            const groupIndex = assistantDraftIndex === -1
              ? newMessagesArr.length
              : assistantDraftIndex;
            getTTS(next.speak, groupIndex, `stream${currentAudioIndex}`);
            currentAudioIndex++;
            ongoingStream.length = 0;
            if (next.rest.trim()) ongoingStream.push(next.rest);
          }
        }

        // Append to chat (volle Antwort inkl. JSON)
        appendToAssistant(chunk);

        // -------- HARTER In-Stream-Stop bei vollständigem JSON-Trigger ----------
        if (chunk.includes("}")) {
          const maybeTriggers = findJsonTriggersInText(assistantAccum);
          const fresh: AutoTrigger[] = [];
          for (const t of maybeTriggers) {
            const k = keyOf(t);
            if (!seenTriggerKeys.has(k)) fresh.push(t);
          }
          if (fresh.length) {
            // DEBUG
            serverLog("json.instream.detect", {
              braceSeen: true,
              accLen: assistantAccum.length,
              triggers: fresh,
            });

            // Stop the stream *after* the closing brace is visible
            interruptedForTrigger = true;
            pendingInstreamTriggers = fresh;
            setTimeout(() => abortRef.current?.abort(), 0);
            return;
          }
        }
      },

      async onerror(err: FatalError) {
        await serverLog("sse.error", { message: String(err?.message || err) });
        setIsStreamComplete(true);
    setThinkingSince(null);
        ensureDraft();
        appendToAssistant(`\n\n${String(err?.message || err)}`);
        throw err;
      },

      onclose() {
        serverLog("sse.close", { interruptedForTrigger });
        // Wenn wir bewusst gestoppt haben, führe erst die Recherche aus und ggf. danach Zusammenfassung.
        if (interruptedForTrigger) {
          runTriggersAndMaybeSummarize(pendingInstreamTriggers);
          abortRef.current = null;
          return;
        }
        // Sonst normal finalisieren
        finalizeStream();
      },
    });
  };

  // ---------- 2) getTTS ----------
  const getTTS = async (
    text: string,
    groupIndex: number,
    sourceFunction: string,
  ) => {
    // Chunks produced while streaming are only wanted when read-aloud is on.
    // A manual request (manual_stream*) always goes through, so the speaker
    // button works even with read-aloud switched off.
    if (!readAlwaysRef.current && /^stream\d+$/.test(sourceFunction)) return;

    // Special case: static welcome audio
    if (text === chatIslandContent[lang]["welcomeMessage"]) {
      const audioFile = text === chatIslandContent["de"]["welcomeMessage"]
        ? "./intro.mp3"
        : "./intro-en.mp3";

      const audio = new Audio(audioFile) as HTMLAudioElement & {
        __text?: string;
        __session?: number;
      };
      audio.__text = text;
      audio.__session = playSessionRef.current;

      const sourceFunctionIndex = indexFromSourceFunction(sourceFunction);

      setAudioFileDict((prev) => {
        const next = { ...prev };
        const group = { ...(next[groupIndex] || {}) };
        group[sourceFunctionIndex] = { audio, played: false };
        next[groupIndex] = group;
        return next;
      });

      // pause other groups for intro as well
      const newStopList = stopList.slice();
      for (let i = 0; i < groupIndex; i++) {
        const g = audioFileDict[i];
        if (g) {
          (Object.values(g) as AudioItem[]).forEach((item) => {
            if (!item.audio.paused) {
              item.audio.pause();
              item.audio.currentTime = 0;
              if (!newStopList.includes(i)) newStopList.push(i);
            }
          });
        }
      }
      setStopList(newStopList);

      return;
    }

    // Optionally strip JSON / { ... }-blocks before cleaning for TTS
    const baseText = skipCurlyBraces ? stripCurlyBraceBlocks(text) : text;
    const ttsText = cleanForTTS(baseText);

    const slotIdx = indexFromSourceFunction(sourceFunction);

    // Nothing left to speak (e.g. the chunk was only JSON, markup or emoji).
    // The index is already spoken for, so it gets a placeholder instead of a
    // silent return – otherwise every later chunk would wait for it forever.
    if (!ttsText.trim()) {
      markChunkSkipped(groupIndex, slotIdx, text, "empty after TTS filters");
      return;
    }

    // Queue the TTS fetch
    scheduleTTSJob(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        TTS_REQUEST_TIMEOUT_MS,
      );
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: ttsText,
            textPosition: sourceFunction,
            voice: lang === "en" ? "Stefanie" : "Florian",
            ttsKey: settings.ttsKey,
            ttsUrl: settings.ttsUrl,
            ttsModel: settings.ttsModel,
            orModel: settings.orTtsModel,
            ttsPrompt: settings.ttsPrompt,
            universalApiKey: settings.universalApiKey,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType =
          response.headers.get("Content-Type") || "audio/mpeg";
        const audioData = await response.arrayBuffer();
        if (audioData.byteLength === 0) {
          throw new Error("TTS returned an empty audio body");
        }
        const audioBlob = new Blob([audioData], { type: contentType });
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl) as HTMLAudioElement & {
          __text?: string;
          __session?: number;
        };
        audio.__text = text;
        (audio as any).__session = playSessionRef.current;

        // ensure group slot
        const idx = slotIdx;
        setAudioFileDict((prev) => {
          const next = { ...prev };
          const group = { ...(next[groupIndex] || {}) };
          group[idx] = { audio, played: false };
          next[groupIndex] = group;
          return next;
        });

        // dynamic chaining for manual playback
        wireNeighborChaining(groupIndex, idx);

        audio.addEventListener("ended", () => {
          setAudioFileDict((prev) => {
            const next = { ...prev };
            const group = { ...(next[groupIndex] || {}) };
            const item = { ...(group[idx] || {}) } as AudioItem;
            item.played = true;
            group[idx] = item;
            next[groupIndex] = group;
            return next;
          });
        });

        // Autostart for manual speak once the first chunk is ready. Both the
        // flag and the toggle come from refs - the state captured in this
        // closure predates the button press that started the request.
        if (
          !readAlwaysRef.current &&
          pendingManualSpeakRef.current.has(groupIndex) &&
          idx === 0
        ) {
          startOrderedPlaybackForGroup(groupIndex);
          clearManualSpeak(groupIndex);
        }
      } catch (error) {
        console.error("Error fetching TTS:", error);
        // Reserve the index with a placeholder so the following chunks keep
        // playing instead of waiting on a clip that will never exist.
        markChunkSkipped(
          groupIndex,
          slotIdx,
          text,
          error instanceof Error && error.name === "AbortError"
            ? "request timed out"
            : String(error),
        );
      } finally {
        clearTimeout(timeoutId);
      }
    });
  };

  // ---------- General toggles ----------
  const toggleAutoScroll = (value: boolean) => {
    setAutoScroll(value);
  };

  const toggleReadAlways = (value: boolean) => {
    setReadAlways(value);
    if (!value) {
      (Object.values(audioFileDict) as Record<number, AudioItem>[]).forEach(
        (group) => {
          (Object.values(group) as AudioItem[]).forEach((item: AudioItem) => {
            if (!item.audio.paused) {
              item.audio.pause();
              item.audio.currentTime = 0;
            }
          });
        },
      );
      setStopList(Object.keys(audioFileDict).map(Number));
    }
  };

  const stopAndResetAudio = () => {
    try {
      Object.values(audioFileDict as any).forEach((group: any) => {
        Object.values(group || {}).forEach((item: any) => {
          const a: HTMLAudioElement | undefined = item?.audio;
          if (!a) return;
          try {
            a.pause();
          } catch {}
          try {
            a.currentTime = 0;
          } catch {}
          try {
            const src = a.src;
            if (src && src.startsWith("blob:")) URL.revokeObjectURL(src);
          } catch {}
          a.onended = null;
          a.src = ""; // detach source so it can't re-fire
        });
      });
    } catch {}
    setAudioFileDict({});
    setStopList([]);
    setPendingManualSpeak(new Set());
  };

  // ---------- Chat management ----------
  const startNewChat = () => {
    const maxValueInChatSuffix = Math.max(
      ...localStorageKeys.map((key) => Number(key.slice(10))),
    );
    const newChatSuffix = String(Number(maxValueInChatSuffix) + 1);

    const welcome = [
      {
        role: "assistant",
        content: [chatIslandContent[lang]["welcomeMessage"]],
      },
    ] as Message[];

    setMessages(welcome);
    setCurrentChatSuffix(newChatSuffix);
    safePersist(welcome, newChatSuffix);
    resetComposerHeight();
  };

  const deleteCurrentChat = () => {
    if (localStorageKeys.length > 1) {
      localStorage.removeItem("bude-chat-" + currentChatSuffix);

      const nextChatSuffix = localStorageKeys
        .filter((key: string) => key !== "bude-chat-" + currentChatSuffix)
        .sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)))[0]
        .slice(10);

      applyChatMessages(loadChatMessages(nextChatSuffix), nextChatSuffix);
      setCurrentChatSuffix(nextChatSuffix);
    } else {
      const welcome = [
        {
          role: "assistant",
          content: [chatIslandContent[lang]["welcomeMessage"]],
        },
      ] as Message[];
      setMessages(welcome);
      safePersist(welcome, "0");
    }
    stopAndResetAudio();
  };

  const deleteAllChats = () => {
    localStorage.clear();
    const welcome = [
      {
        role: "assistant",
        content: [chatIslandContent[lang]["welcomeMessage"]],
      },
    ] as Message[];
    setMessages(welcome);
    setLocalStorageKeys([]);
    setCurrentChatSuffix("0");
    safePersist(welcome, "0");
    stopAndResetAudio();
  };

  const saveChatsToLocalFile = () => {
    // deno-lint-ignore no-explicit-any
    const chats = {} as any;
    for (const key of localStorageKeys) {
      chats[key] = JSON.parse(String(localStorage.getItem(key)));
    }
    const chatsString = JSON.stringify(chats);
    const blob = new Blob([chatsString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const currentDate = new Date();
    a.download = `chats-${currentDate.toISOString()}.json`;
    a.click();
  };

  // deno-lint-ignore no-explicit-any
  const restoreChatsFromLocalFile = (e: any) => {
    const file = e.target.files[0];
    if (!file) {
      console.error("No file selected");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const chats = JSON.parse(event.target?.result as string);

        // Restore chats to localStorage
        for (const [key, value] of Object.entries(chats)) {
          localStorage.setItem(key, JSON.stringify(value));
        }

        const newChatSuffix = chats
          ? Object.keys(chats).sort((a, b) =>
              Number(a.slice(10)) - Number(b.slice(10))
            )[0].slice(10)
          : "0";
        setLocalStorageKeys(
          Object.keys(localStorage).filter((key) =>
            key.startsWith("bude-chat-")
          ),
        );
        setCurrentChatSuffix(newChatSuffix);
        const nextMsgs = chats["bude-chat-" + newChatSuffix] as Message[];
        applyChatMessages(nextMsgs, newChatSuffix);
        safePersist(nextMsgs, newChatSuffix);
      } catch (error) {
        console.error("Error parsing JSON file:", error);
      }
    };

    reader.onerror = (error) => {
      console.error("Error reading file:", error);
    };

    reader.readAsText(file);
  };

  // ---------- RENDER ----------
  return (
    <div class="w-full">
       <div class="flex items-center justify-center mb-4 flex-wrap w-full">
        {/* Add settings button next to existing chat buttons */}
        <button
          class="rounded-full bg-slate-200 px-4 py-2 mx-2 mb-2"
          onClick={() => setShowSettings(true)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="24"
            viewBox="0 -960 960 960"
            width="24"
          >
            <path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-58 0-99 41t-41 99q0 58 41 99t99 41Z" />
          </svg>
        </button>

        {isMailSyncConfigured(mailAccount) && (
          <button
            class="rounded-full bg-slate-200 px-4 py-2 mx-2 mb-2"
            title={mailSyncContent[lang]?.title ?? "Snapshots"}
            onClick={() => setShowMailSync(true)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="24"
              viewBox="0 -960 960 960"
              width="24"
            >
              <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280 320-200v-80L480-520 160-720v80l320 200Z" />
            </svg>
          </button>
        )}

        {/*
          Named rather than drawn. A compass and a pair of angle brackets both
          left people guessing what they would open; the word does not.
        */}
        <button
          class="rounded-full bg-indigo-100 text-indigo-900 hover:bg-indigo-200
                 font-semibold text-sm px-4 py-2 mx-2 mb-2 flex items-center gap-1.5
                 transition-colors"
          title={learningContent[lang]?.title ?? "Lernpfade"}
          onClick={() => setShowLearning(true)}
        >
          <span class="text-base leading-none">🧭</span>
          {learningContent[lang]?.title ?? "Lernpfade"}
        </button>

        <button
          class="rounded-full bg-amber-100 text-amber-900 hover:bg-amber-200
                 font-semibold text-sm px-4 py-2 mx-2 mb-2 flex items-center gap-1.5
                 transition-colors"
          title={notebookContent[lang]?.title ?? "Python"}
          onClick={() => setShowNotebook(true)}
        >
          <span class="text-base leading-none">🐍</span>
          Python
        </button>

        <button
          class="rounded-full bg-sky-100 text-sky-900 hover:bg-sky-200
                 font-semibold text-sm px-4 py-2 mx-2 mb-2 flex items-center gap-1.5
                 transition-colors"
          title={docsContent[lang]?.subtitle ?? "Docs"}
          onClick={() => setShowDocs(true)}
        >
          <span class="text-base leading-none">📄</span>
          Docs
        </button>

        {[...localStorageKeys]
          .sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)))
          .map((key) => {
            const chatSuffix = key.substring(10);
            return (
              <button
                className={`rounded-full ${
                  chatSuffix === currentChatSuffix
                    ? "bg-slate-400 text-white font-bold"
                    : "bg-slate-200"
                } px-4 py-2 mx-2 mb-2`}
                onClick={() => setCurrentChatSuffix(chatSuffix)}
              >
                {Number(chatSuffix) + 1}
              </button>
            );
          })}

        <button
          class="rounded-full bg-slate-200 px-4 py-2 mx-2 mb-2"
          onClick={() => startNewChat()}
        >
          +
        </button>

        {Object.keys(localStorageKeys).length > 0 && (
          <button
            class="rounded-full bg-red-200 font-bold px-4 py-2 mx-2 mb-2"
            onClick={() => deleteCurrentChat()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="inline-block"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="#000000"
            >
              <path d="M240-800v200-200 640-9.5 9.5-640Zm0 720q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v174q-19-7-39-10.5t-41-3.5v-120H520v-200H240v640h254q8 23 20 43t28 37H240Zm396-20-56-56 84-84-84-84 56-56 84 84 84-84 56 56-83 84 83 84-56 56-84-83-84 83Z" />
            </svg>
            {chatIslandContent[lang]["deleteCurrentChat"]}
          </button>
        )}

        {Object.keys(localStorageKeys).length > 0 && (
          <button
            class="rounded-full bg-red-200 font-bold px-4 py-2 mx-2 mb-2"
            onClick={() => deleteAllChats()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="inline-block"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="#000000"
            >
              <path d="M240-800v200-200 640-9.5 9.5-640Zm0 720q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v174q-19-7-39-10.5t-41-3.5v-120H520v-200H240v640h254q8 23 20 43t28 37H240Zm396-20-56-56 84-84-84-84 56-56 84 84 84-84 56 56-83 84 83 84-56 56-84-83-84 83Z" />
            </svg>
            {chatIslandContent[lang]["deleteAllChats"]}
          </button>
        )}

        {Object.keys(localStorageKeys).length > 0 && (
          <button
            class="rounded-full bg-green-200 font-bold px-4 py-2 mx-2 mb-2"
            onClick={() => saveChatsToLocalFile()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="inline"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="#000000"
            >
              <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-160 160-160-160ZM240-160q-33 0-56.5-23.5T160-240v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-160H240Zm280-520v-200H240v640h480v-440H520ZM240-800v-200 200-640-640Z" />
            </svg>
          </button>
        )}

        <input
          type="file"
          id="restoreChatFromLocalFile"
          style="display: none;"
          onChange={(e) => restoreChatsFromLocalFile(e)}
        />
        <button
          class="rounded-full bg-green-200 font-bold px-4 py-2 mx-2 mb-2"
          onClick={() =>
            document.getElementById("restoreChatFromLocalFile")?.click()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="inline"
            height="24px"
            viewBox="0 -960 960 960"
            width="24px"
            fill="#000000"
          >
            <path d="M440-200h80v-167l64 64 56-57-160-160-160 160 57 56 63-63v167ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v-200 200-640-640Z" />
          </svg>
        </button>
      </div>

      {mailSyncStatus && (
        <div class="text-center text-xs text-gray-500 mb-2 break-words">
          {mailSyncStatus}
        </div>
      )}

      <ChatTemplate
        lang={lang}
        songAutoplay={songAutoplay}
        thinkingSince={thinkingSince}
        onOpenInEditor={(name, base64) => {
          // Straight from a message into the word processor: the file is
          // decoded here, so the editor only ever sees bytes.
          try {
            const bin = atob(base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            setIncomingDoc({ name, bytes });
            setOpenDocId(undefined);
            setShowDocs(true);
          } catch (err) {
            console.warn("[docs] could not decode the attachment:", err);
          }
        }}
        parentImages={images}
        parentPdfs={pdfs}
        messages={messages}
        isComplete={isStreamComplete}
        onCancelAction={() => {
          abortRef.current?.abort();
          abortRef.current = null;
          setIsStreamComplete(true);
    setThinkingSince(null);
        }}
        readAlways={readAlways}
        autoScroll={autoScroll}
        skipCurlyBraces={skipCurlyBraces} // NEW
        audioFileDict={audioFileDict}
        currentEditIndex={currentEditIndex!}
        onSpeakAtGroupIndexAction={handleOnSpeakAtGroupIndexAction}
        onToggleReadAlwaysAction={() => toggleReadAlways(!readAlways)}
        onToggleAutoScrollAction={() => toggleAutoScroll(!autoScroll)}
        onToggleSkipCurlyBracesAction={() =>
          setSkipCurlyBraces((v) => !v)
        } // NEW
        onRefreshAction={handleRefreshAction}
        onEditAction={handleEditAction}
        onUploadActionToMessages={handleUploadActionToMessages}
        onImageChange={handleImageChange}
        onTrashAction={() => setMessages([])}
      />

      {showSettings && (
        <Settings
          settings={settings}
          songAutoplay={songAutoplay}
          onSongAutoplayChange={(v: boolean) => {
            setSongAutoplay(v);
            localStorage.setItem("bud-e-song-autoplay", v ? "1" : "0");
          }}
          mailAccount={mailAccount}
          onSave={handleSaveSettings}
          onSaveMailAccount={handleSaveMailAccount}
          onOpenMailSync={(account) => {
            handleSaveMailAccount(account);
            setShowSettings(false);
            setShowMailSync(true);
          }}
          onClose={() => {
            setShowSettings(false);
            setMailToolsAllowed(isMailAllowed());
          }}
          lang={lang}
        />
      )}

      {showLearning && (
        <LearningModal
          lang={lang}
          onClose={() => setShowLearning(false)}
          onOpenNotebook={(example, cell) => {
            // Two overlays on top of each other help nobody: step out of the
            // path, into the notebook, and back again when it closes.
            setNotebookJump({ example, cell });
            setShowLearning(false);
            setShowNotebook(true);
          }}
        />
      )}

      {showNotebook && (
        <NotebookModal
          lang={lang}
          revision={notebookRevision}
          openExample={notebookJump?.example}
          focusCell={notebookJump?.cell}
          onNotebookOpen={(nb) => {
            activeNotebookRef.current = nb;
          }}
          onClose={() => {
            setShowNotebook(false);
            // Came from a learning path - go back to where the reader was.
            if (notebookJump) {
              setNotebookJump(null);
              setShowLearning(true);
            }
            // The permission may have been toggled while the window was open.
            setNotebookToolsAllowed(isNotebookAssistantAllowed());
          }}
        />
      )}

      {showDocs && (
        <DocsModal
          lang={lang}
          revision={docsRevision}
          incoming={incomingDoc}
          openId={openDocId}
          onDocOpen={(meta) => {
            activeDocRef.current = meta;
          }}
          onClose={() => {
            setShowDocs(false);
            setIncomingDoc(null);
            setOpenDocId(undefined);
            // The permission may have been toggled while the window was open.
            setDocsToolsAllowed(isDocsAssistantAllowed());
            listDocs().then(setDocList);
          }}
        />
      )}

      {showMailSync && (
        <MailSyncModal
          account={mailAccount}
          lang={lang}
          settings={settings}
          onClose={() => setShowMailSync(false)}
          onRestored={handleSnapshotRestored}
          onKeysApplied={reloadSettingsFromStorage}
        />
      )}

      {settings.universalApiKey ||
          (settings.apiKey && settings.apiModel && settings.apiUrl)
        ? (
          <div class="relative mt-4 mb-12 w-full">
            <textarea
              value={query}
              placeholder={chatIslandContent[lang]["placeholderText"]}
              onInput={(e) => handleComposerChange(e.currentTarget.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  startStream("");
                }
              }}
              class="h-52 w-full py-4 pl-4 pr-16 border border-gray-300 rounded-lg focus:outline-none cursor-text focus:border-orange-200 focus:ring-1 focus:ring-orange-300 shadow-sm resize-none placeholder-gray-400 text-base font-medium"
            />

            <ImageUploadButton
              onImagesUploaded={handleImagesUploaded}
              /* Pending composer images count too, otherwise a second upload
                 before sending would reuse the same upl_ IDs. */
              messages={[...messages, { role: "user", content: images }]}
            />

            <PdfUploadButton onPdfsUploaded={handlePdfsUploaded} />

            <VoiceRecordButton
              resetTranscript={resetTranscript}
              sttUrl={settings.sttUrl}
              sttKey={settings.sttKey}
              sttModel={settings.sttModel}
              orModel={settings.orAsrModel}
              universalApiKey={settings.universalApiKey}
              onFinishRecording={(finalTranscript) => {
                startStream(finalTranscript);
              }}
              onInterimTranscript={(interimTranscript) => {
                setQuery((q) => (q ? q + " " : "") + interimTranscript);
              }}
            />

            <ChatSubmitButton
              onClick={() => startStream("")}
              disabled={!query && images.length === 0 && pdfs.length === 0}
            />
          </div>
        )
        : (
          <div className="relative mt-4 mb-12 bg-gray-700 rounded-md">
            <div className="text-center text-md p-4 text-white">
              {chatIslandContent[lang]["noSettings"]}
            </div>
          </div>
        )}
    </div>
  );
}
