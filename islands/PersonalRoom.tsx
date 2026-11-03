import { useEffect, useRef, useState } from "preact/hooks";
import ClassroomCodeContent from "../components/ClassroomCodeContent.tsx";
import ClassroomRecorder from "./ClassroomRecorder.tsx";
import PersonalModelPicker from "../components/PersonalModelPicker.tsx";
import RoomGrading, {
  GradingReportDownload,
} from "../components/RoomGrading.tsx";
import { isRoomGradingRequest } from "../utils/roomGrading.ts";
import type { SourceDoc } from "../utils/grading.ts";
import { GRADING_MODEL_SYSTEM } from "../utils/gradingProtocol.ts";
import { readOpenRouterBalance } from "../utils/openrouterBalance.ts";
import {
  personalBranch,
  personalChatIndex,
  personalChatTree,
  personalGeneration,
  personalUnusedImages,
} from "../utils/personalConversation.ts";
import {
  encryptPersonal,
  PERSONAL_KDF_ITERATIONS,
  personalKeys,
  toBase64,
  toHex,
} from "../utils/personalCrypto.ts";
import {
  personalApi,
  PersonalApiError,
  type PersonalBranch,
  type PersonalChat,
  personalDefaults,
  type PersonalIndex,
  personalJpeg,
  type PersonalMessage,
  type PersonalRole,
  type PersonalSettings,
  PersonalVault,
} from "../utils/personalClient.ts";
import {
  personalComplete,
  personalGenerateImage,
  type PersonalModel,
  personalModels,
  personalSpeech,
  personalTranscribe,
  personalVoices,
} from "../utils/personalProviders.ts";

const input =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const button =
  "rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const roles: { id: PersonalRole; name: string; description: string }[] = [
  {
    id: "chat",
    name: "Chat & Bilder verstehen",
    description: "Dein Sprachmodell",
  },
  { id: "tts", name: "Vorlesen · TTS", description: "Antworten anhören" },
  {
    id: "asr",
    name: "Spracheingabe · ASR",
    description: "Audio in Text umwandeln",
  },
  {
    id: "image",
    name: "Bilder erzeugen",
    description: "Bilder aus deinen Ideen erstellen",
  },
];
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Das hat nicht funktioniert. Bitte erneut versuchen.";
const objectId = (kind: "chat" | "img") => `${kind}:${crypto.randomUUID()}`;

export default function PersonalRoom(
  { slug: initialSlug = "", registration = false, onOpened }: {
    slug?: string;
    registration?: boolean;
    onOpened?: () => void;
  },
) {
  const [mode, setMode] = useState<"register" | "login">(
    registration ? "register" : "login",
  );
  const [slug, setSlug] = useState(initialSlug),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [draftSettings, setDraftSettings] = useState<PersonalSettings>(
    personalDefaults,
  );
  const [vault, setVault] = useState<PersonalVault | null>(null),
    [index, setIndex] = useState<PersonalIndex | null>(null),
    [chat, setChat] = useState<PersonalChat | null>(null);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false),
    [remoteChanged, setRemoteChanged] = useState(false);
  const [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<PersonalModel[]>([]),
    [modelSearch, setModelSearch] = useState(""),
    [onlyFree, setOnlyFree] = useState(false),
    [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState(""),
    [pendingImages, setPendingImages] = useState<
      { id: string; value: string }[]
    >([]),
    [images, setImages] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState(""),
    [editingText, setEditingText] = useState("");
  const [gradingSources, setGradingSources] = useState<SourceDoc[] | null>(
    null,
  );
  const [imageMode, setImageMode] = useState(false),
    [referenceIds, setReferenceIds] = useState<string[]>([]),
    [recording, setRecording] = useState(false),
    [submitSignal, setSubmitSignal] = useState(0),
    [used, setUsed] = useState(0);
  const current = useRef<PersonalVault | null>(null),
    version = useRef(0),
    abort = useRef<AbortController | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    audioUrl = useRef("");
  const queuedTranscript = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    historyEnd = useRef<HTMLDivElement>(null);
  const pendingSave = useRef<
    {
      index: PersonalIndex;
      chat?: PersonalChat;
      assets: { id: string; value: string }[];
      remove: string[];
    } | null
  >(null);
  const state = useRef({
    index,
    chat,
    busy,
    saving,
    dirty,
    editingId,
    gradingSources,
  });
  state.current = {
    index,
    chat,
    busy,
    saving,
    dirty,
    editingId,
    gradingSources,
  };
  useEffect(() => {
    if (
      !index || busy || saving || dirty || queuedTranscript.current === null
    ) return;
    const text = queuedTranscript.current;
    queuedTranscript.current = null;
    void send(text);
  }, [index, busy, saving, dirty]);
  useEffect(() => {
    historyEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat?.messages.length]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        state.current.dirty || state.current.saving ||
        state.current.editingId || state.current.gradingSources
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => {
      globalThis.removeEventListener("beforeunload", warn);
      abort.current?.abort();
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);
  async function loadImages(v: PersonalVault, next: PersonalChat) {
    const ids = [
      ...new Set(next.messages.flatMap((message) => message.images)),
    ];
    const entries: Record<string, string> = {};
    for (const id of ids) {
      const record = await v.read<{ jpeg: string }>(id);
      if (!record.jpeg?.startsWith("data:image/jpeg;base64,")) {
        throw new Error("Ein gespeichertes Bild hat ein ungültiges Format.");
      }
      entries[id] = record.jpeg;
    }
    if (current.current === v) setImages(entries);
  }
  async function loadLatest(v: PersonalVault, preferred?: string) {
    await v.refresh();
    const next = await v.read<PersonalIndex>("index", true);
    if (next.version !== 1 || !next.settings || !Array.isArray(next.chats)) {
      throw new Error("Dieser Raum verwendet ein unbekanntes Speicherformat.");
    }
    const selected = next.chats.find((c) => c.id === preferred)?.id ||
      next.active || next.chats[0]?.id;
    const nextChat = selected
      ? await v.read<PersonalChat>(selected, true)
      : null;
    if (current.current !== v) return;
    setIndex(next);
    setDraftSettings(structuredClone(next.settings));
    if (next.settings.key) {
      void personalModels(next.settings).then((catalog) => {
        if (current.current === v) setModels(catalog);
      }).catch(() => {});
    }
    setChat(nextChat);
    setUsed(v.manifest.usedBytes);
    setRemoteChanged(false);
    setDirty(false);
    pendingSave.current = null;
    if (nextChat) await loadImages(v, nextChat);
    else setImages({});
  }
  useEffect(() => {
    if (!vault) return;
    const timer = setInterval(async () => {
      if (
        current.current !== vault || state.current.busy || state.current.saving
      ) return;
      try {
        const manifest = await personalApi(
          "?slug=" + encodeURIComponent(vault.slug),
        ) as unknown as typeof vault.manifest;
        if (current.current !== vault) return;
        const changed =
          manifest.records.length !== vault.manifest.records.length ||
          manifest.records.some((row) =>
            vault.revision(row.id) !== row.revision
          );
        if (changed) {
          if (
            state.current.dirty || state.current.editingId ||
            state.current.gradingSources
          ) {
            setRemoteChanged(true);
            return;
          }
          await loadLatest(vault, state.current.chat?.id);
          if (current.current === vault) {
            setStatus("Mit dem anderen Gerät abgeglichen.");
          }
        }
      } catch (cause) {
        if (
          current.current === vault && cause instanceof PersonalApiError &&
          cause.status === 401
        ) {
          setError(
            "Deine Anmeldung ist abgelaufen. Sichere nicht gespeicherte Inhalte und entsperre den Raum erneut.",
          );
        }
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [vault]);
  async function unlock(event: Event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    const epoch = ++version.current;
    try {
      const name = slug.trim().toLowerCase();
      if (!/^[a-z][a-z0-9]{2,23}$/.test(name)) {
        throw new Error(
          "Der Name braucht 3–24 Zeichen: zuerst a–z, danach a–z oder 0–9.",
        );
      }
      if (
        mode === "register" &&
        (!accepted || password !== repeat || password.length < 12 ||
          !/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
          !/[0-9]/.test(password) || !/[\W_]/.test(password))
      ) {
        throw new Error(
          "Bestätige die Hinweise und wähle dasselbe Passwort zweimal: mindestens 12 Zeichen mit Groß-/Kleinbuchstaben, Zahl und Sonderzeichen.",
        );
      }
      setStatus("Der Schlüssel wird auf deinem Gerät berechnet …");
      let salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      if (mode !== "register") {
        const metadata = await personalApi(
          "?action=public&slug=" + encodeURIComponent(name),
        );
        if (metadata.iterations !== PERSONAL_KDF_ITERATIONS) {
          throw new Error(
            "Dieser Raum verwendet ein unbekanntes Verschlüsselungsformat. Bitte die Seite aktualisieren.",
          );
        }
        salt = String(metadata.salt);
      }
      const keys = await personalKeys(password, name, salt);
      if (version.current !== epoch) return;
      if (mode === "register") {
        const initial: PersonalIndex = {
          version: 1,
          settings: draftSettings,
          chats: [],
          active: "",
        };
        const value = toBase64(
          await encryptPersonal(keys.key, name, "index", initial),
        );
        await personalApi("", {
          action: "register",
          slug: name,
          salt,
          auth: keys.auth,
          value,
        });
      } else {await personalApi("", {
          action: "login",
          slug: name,
          auth: keys.auth,
        });}
      if (version.current !== epoch) return;
      const opened = new PersonalVault(name, keys.key);
      current.current = opened;
      setVault(opened);
      setPassword("");
      setRepeat("");
      setSlug(name);
      setMode("login");
      await loadLatest(opened);
      setSettingsOpen(mode === "register");
      setStatus("Entsperrt · verschlüsselte Speicherung bereit");
      onOpened?.();
      if (location.pathname === "/my") {
        history.replaceState(null, "", `/${name}`);
      }
    } catch (cause) {
      setError(errorText(cause));
      setStatus("");
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function persist(
    next: PersonalIndex,
    nextChat?: PersonalChat,
    assets: { id: string; value: string }[] = [],
    remove: string[] = [],
  ) {
    const v = current.current;
    if (!v) throw new Error("Der Raum ist gesperrt.");
    pendingSave.current = { index: next, chat: nextChat, assets, remove };
    if (assets.length) {
      setImages((previous) => ({
        ...previous,
        ...Object.fromEntries(assets.map((asset) => [asset.id, asset.value])),
      }));
    }
    setDirty(true);
    setSaving(true);
    setIndex(next);
    if (nextChat) setChat(nextChat);
    try {
      await v.save([
        { id: "index", value: next },
        ...(nextChat ? [{ id: nextChat.id, value: nextChat }] : []),
        ...assets.map((asset) => ({
          id: asset.id,
          value: { jpeg: asset.value },
        })),
      ], remove);
      if (current.current !== v) return;
      pendingSave.current = null;
      setDirty(false);
      setRemoteChanged(false);
      setUsed(v.manifest.usedBytes);
      setStatus("Verschlüsselt gespeichert · auf deinen Geräten verfügbar");
    } catch (cause) {
      if (current.current === v) {
        setStatus("Noch nicht synchronisiert");
        if (cause instanceof PersonalApiError && cause.status === 409) {
          setRemoteChanged(true);
        }
      }
      throw cause;
    } finally {
      if (current.current === v) setSaving(false);
    }
  }
  async function retrySave() {
    const epoch = version.current;
    const pending = pendingSave.current;
    if (!pending) return;
    try {
      setError("");
      await persist(
        pending.index,
        pending.chat,
        pending.assets,
        pending.remove,
      );
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    }
  }
  async function newChat() {
    if (!index || busy || saving || dirty || editingId || recording) return;
    const epoch = version.current;
    setImages({});
    setReferenceIds([]);
    setDraft("");
    setPendingImages([]);
    const next: PersonalChat = { id: objectId("chat"), messages: [] };
    const meta = {
      ...index,
      chats: [
        { id: next.id, title: "Neuer Chat", updatedAt: Date.now() },
        ...index.chats,
      ],
      active: next.id,
    };
    try {
      setError("");
      await persist(meta, next);
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    }
  }
  async function selectChat(id: string) {
    const v = current.current;
    if (!v || busy || saving || dirty || editingId || recording) return;
    setBusy(true);
    setError("");
    try {
      const next = await v.read<PersonalChat>(id, true);
      if (current.current !== v) return;
      setChat(next);
      setReferenceIds([]);
      setPendingImages([]);
      await loadImages(v, next);
    } catch (cause) {
      if (current.current === v) setError(errorText(cause));
    } finally {
      if (current.current === v) setBusy(false);
    }
  }
  async function removeChat() {
    if (
      !index || !chat || busy || saving || dirty || editingId || recording ||
      !confirm(
        "Diese Unterhaltung dauerhaft löschen? Bilder in anderen Abzweigungen bleiben erhalten.",
      )
    ) return;
    const epoch = version.current;
    const v = current.current;
    if (!v) return;
    const next = {
      ...index,
      chats: index.chats.filter((row) => row.id !== chat.id),
      active: "",
    };
    next.active = next.chats[0]?.id ?? "";
    try {
      setBusy(true);
      setError("");
      const remaining: PersonalChat[] = [];
      if (chat.messages.some((message) => message.images.length)) {
        for (const meta of next.chats) {
          remaining.push(await v.read<PersonalChat>(meta.id, true));
          if (version.current !== epoch) return;
        }
      }
      const remove = [chat.id, ...personalUnusedImages(chat, remaining)]
        .filter((id) => v.revision(id) > 0);
      await persist(next, undefined, [], remove);
      if (version.current !== epoch) return;
      await loadLatest(v, next.active);
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const epoch = version.current;
    setBusy(true);
    setError("");
    try {
      const fresh: { id: string; value: string }[] = [];
      for (const file of Array.from(files).slice(0, 3 - pendingImages.length)) {
        fresh.push({ id: objectId("img"), value: await personalJpeg(file) });
      }
      if (version.current === epoch) {
        setPendingImages([...pendingImages, ...fresh]);
      }
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function send(text = draft) {
    if (
      !index || busy || saving || dirty || editingId || gradingSources ||
      (!text.trim() && !pendingImages.length)
    ) return;
    if (
      isRoomGradingRequest(text) &&
      (pendingImages.length || referenceIds.length ||
        /#(?:korrektur|correction)|korrekturvorschl/i.test(text))
    ) {
      openGrading();
      return;
    }
    const active: PersonalChat = chat ?? { id: objectId("chat"), messages: [] };
    const user: PersonalMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: text.trim(),
      images: [
        ...pendingImages.map((img) => img.id),
        ...referenceIds.filter((id) =>
          !pendingImages.some((img) => img.id === id)
        ),
      ],
      createdAt: Date.now(),
      generation: imageMode ? "image" : "chat",
    };
    const base = { ...active, messages: [...active.messages, user] };
    const next = personalChatIndex(index, base);
    const allImages = {
      ...images,
      ...Object.fromEntries(pendingImages.map((img) => [img.id, img.value])),
    };
    await generateAnswer(base, next, allImages, imageMode, pendingImages, true);
  }
  async function forkMessage(
    id: string,
    kind: PersonalBranch["kind"],
    text?: string,
  ) {
    if (!index || !chat || busy || saving || dirty || recording) return;
    const epoch = version.current;
    try {
      const fork = personalBranch(chat, id, kind, text);
      const next = personalChatIndex(index, fork);
      const generation = personalGeneration(chat, id);
      const forkImages = Object.fromEntries(
        [...new Set(fork.messages.flatMap((message) => message.images))]
          .filter((imageId) => images[imageId])
          .map((imageId) => [imageId, images[imageId]]),
      );
      setEditingId("");
      setEditingText("");
      setReferenceIds([]);
      if (kind !== "branch") {
        await generateAnswer(fork, next, forkImages, generation === "image");
        return;
      }
      setBusy(true);
      setError("");
      await persist(next, fork);
      if (version.current !== epoch) return;
      await loadImages(current.current!, fork);
      if (version.current === epoch) {
        setStatus(
          "Abzweigung gespeichert · der Ausgangsverlauf bleibt erhalten.",
        );
      }
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  function openGrading() {
    if (!index || busy || saving || dirty || editingId || recording) return;
    const sources: SourceDoc[] = pendingImages.map((image, at) => ({
      index: at + 1,
      name: `bild-${at + 1}.jpg`,
      kind: "image",
      content: image.value,
    }));
    for (const id of referenceIds) {
      if (images[id]) {
        sources.push({
          index: sources.length + 1,
          name: id.slice(4) + ".jpg",
          kind: "image",
          content: images[id],
        });
      }
    }
    setGradingSources(sources);
  }
  async function generateAnswer(
    base: PersonalChat,
    next: PersonalIndex,
    allImages: Record<string, string>,
    generateImage: boolean,
    assetsToSave: { id: string; value: string }[] = [],
    clearComposer = false,
  ) {
    if (!index) return;
    const epoch = version.current, v = current.current;
    if (!v) return;
    const user = base.messages.at(-1)!;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    let assistant: PersonalMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      images: [],
      createdAt: Date.now(),
      generation: generateImage ? "image" : "chat",
    };
    try {
      await persist(next, base, assetsToSave);
      if (version.current !== epoch) return;
      if (clearComposer) {
        setDraft("");
        setPendingImages([]);
        setReferenceIds([]);
      }
      setImages(allImages);
      if (generateImage) {
        const urls = await personalGenerateImage(
          index.settings,
          user.text,
          user.images.map((id) => allImages[id]).filter(Boolean),
        );
        if (version.current !== epoch) return;
        const assets: { id: string; value: string }[] = [];
        for (const url of urls) {
          if (!url.startsWith("data:image/") && !/^https:\/\//.test(url)) {
            throw new Error(
              "Das Modell hat eine ungültige Bildadresse geliefert.",
            );
          }
          const response = await fetch(url, {
            credentials: "omit",
            referrerPolicy: "no-referrer",
          });
          if (!response.ok) {
            throw new Error(
              "Das erzeugte Bild konnte nicht direkt geladen werden.",
            );
          }
          assets.push({
            id: objectId("img"),
            value: await personalJpeg(await response.blob()),
          });
        }
        if (version.current !== epoch) return;
        assistant = {
          ...assistant,
          text: "Dein Bild",
          images: assets.map((img) => img.id),
        };
        setImages({
          ...allImages,
          ...Object.fromEntries(assets.map((img) => [img.id, img.value])),
        });
        await persist(next, {
          ...base,
          messages: [...base.messages, assistant],
        }, assets);
      } else {
        const requests = base.messages.map((m) => ({
          role: m.role,
          text: m.text,
          images: m.images.map((id) => allImages[id]).filter(Boolean),
        }));
        await personalComplete(
          index.settings,
          requests,
          models.find((m) => m.id === index.settings.models.chat),
          (value) => {
            assistant = { ...assistant, text: value };
            if (version.current === epoch) {
              setChat({ ...base, messages: [...base.messages, assistant] });
            }
          },
          controller.signal,
        );
        if (version.current === epoch) {
          await persist(next, {
            ...base,
            messages: [...base.messages, assistant],
          });
        }
      }
    } catch (cause) {
      if (version.current !== epoch) return;
      if (
        assistant.text && cause instanceof DOMException &&
        cause.name === "AbortError"
      ) {
        assistant = {
          ...assistant,
          text: assistant.text + "\n\n*(Antwort angehalten.)*",
        };
        try {
          await persist(next, {
            ...base,
            messages: [...base.messages, assistant],
          });
        } catch (saveError) {
          if (version.current === epoch) setError(errorText(saveError));
        }
      } else setError(errorText(cause));
    } finally {
      if (version.current === epoch) {
        setBusy(false);
        abort.current = null;
      }
    }
  }
  async function refreshModels() {
    const epoch = version.current;
    setBusy(true);
    setError("");
    try {
      const catalog = await personalModels(draftSettings, true);
      if (version.current !== epoch) return;
      setModels(catalog);
      setStatus(`${catalog.length} Modelle direkt beim Anbieter geladen.`);
      const selected = {
        ...draftSettings,
        models: { ...draftSettings.models },
      };
      if (!selected.models.chat) {
        selected.models.chat = catalog.find((m) =>
          m.roles.includes("chat") && m.free
        )?.id ?? catalog.find((m) => m.roles.includes("chat"))?.id ?? "";
      }
      setDraftSettings(selected);
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function saveSettings() {
    if (!index) return;
    const epoch = version.current;
    setError("");
    try {
      if (!draftSettings.key.trim() || !draftSettings.models.chat) {
        throw new Error("Bitte API-Key und Chatmodell wählen.");
      }
      await persist({ ...index, settings: draftSettings });
      if (version.current === epoch) setSettingsOpen(false);
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    }
  }
  async function testModel() {
    const epoch = version.current;
    setBusy(true);
    setError("");
    try {
      const answer = await personalComplete(
        draftSettings,
        [{ role: "user", text: "Antworte nur mit OK." }],
        models.find((m) => m.id === draftSettings.models.chat),
        undefined,
        undefined,
        24,
      );
      if (version.current === epoch) {
        setStatus("Verbindung erfolgreich: " + answer);
      }
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function transcribe(file: File, submit: boolean) {
    if (!index) return;
    const epoch = version.current;
    setBusy(true);
    setError("");
    try {
      const text = await personalTranscribe(index.settings, file);
      if (version.current !== epoch) return;
      const next = draft ? draft + " " + text : text;
      setDraft(next);
      if (submit && text.trim()) queuedTranscript.current = next;
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function speak(message: PersonalMessage) {
    if (!index) return;
    const epoch = version.current;
    setBusy(true);
    setError("");
    try {
      const blob = await personalSpeech(index.settings, message.text);
      if (version.current !== epoch) return;
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      const player = new Audio(audioUrl.current);
      audio.current = player;
      await player.play();
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function exportChat() {
    if (!chat || !vault) return;
    const epoch = version.current;
    setBusy(true);
    setError("");
    try {
      const pictureMap: Record<string, string> = { ...images };
      for (const id of [...new Set(chat.messages.flatMap((m) => m.images))]) {
        if (!pictureMap[id]) {
          pictureMap[id] = (await vault.read<{ jpeg: string }>(id)).jpeg;
        }
      }
      if (version.current !== epoch) return;
      const blob = new Blob([
        JSON.stringify(
          {
            format: "bud-e-personal-chat",
            version: 1,
            chat,
            images: pictureMap,
          },
          null,
          2,
        ),
      ], { type: "application/json" });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url;
      a.download = "buddy-chat.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function importChat(file: File | undefined) {
    if (!file || !index) return;
    const epoch = version.current;
    setBusy(true);
    setError("");
    try {
      if (file.size > 6 * 1024 * 1024) {
        throw new Error("Bitte eine Chatdatei bis 6 MB wählen.");
      }
      const data = JSON.parse(await file.text());
      if (version.current !== epoch) return;
      if (
        data.format !== "bud-e-personal-chat" || data.version !== 1 ||
        !Array.isArray(data.chat?.messages) || data.chat.messages.length > 1000
      ) throw new Error("Keine passende Buddy-Chatdatei.");
      const remap = new Map<string, string>(),
        assets: { id: string; value: string }[] = [];
      for (const [old, value] of Object.entries(data.images ?? {})) {
        if (
          typeof value !== "string" ||
          !value.startsWith("data:image/jpeg;base64,")
        ) throw new Error("Ungültiges importiertes Bild.");
        const jpeg = await personalJpeg(await (await fetch(value)).blob()),
          id = objectId("img");
        if (version.current !== epoch) return;
        remap.set(old, id);
        assets.push({ id, value: jpeg });
      }
      if (assets.length > 12) {
        throw new Error("Bitte höchstens zwölf Bilder pro Import wählen.");
      }
      const messages = data.chat.messages.map((m: Record<string, unknown>) => {
        if (
          !["user", "assistant"].includes(String(m.role)) ||
          typeof m.text !== "string" || m.text.length > 1000000 ||
          !Array.isArray(m.images)
        ) throw new Error("Ungültige Chatnachricht.");
        const refs = m.images.map((id) => {
          const replacement = remap.get(String(id));
          if (!replacement) throw new Error("Ein Bild fehlt in der Chatdatei.");
          return replacement;
        });
        return {
          id: crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          text: m.text,
          images: refs,
          createdAt: Date.now(),
          ...(m.generation === "chat" || m.generation === "image"
            ? { generation: m.generation }
            : {}),
          ...(m.gradingReport === true ? { gradingReport: true } : {}),
        };
      });
      const imported = { id: objectId("chat"), messages };
      const next = {
        ...index,
        active: imported.id,
        chats: [{
          id: imported.id,
          title: messages.find((m: PersonalMessage) =>
            m.role === "user"
          )?.text.slice(0, 55) || "Importierter Chat",
          updatedAt: Date.now(),
        }, ...index.chats],
      };
      await persist(next, imported, assets);
      if (version.current !== epoch) return;
      setImages(Object.fromEntries(assets.map((a) => [a.id, a.value])));
    } catch (cause) {
      if (version.current === epoch) setError(errorText(cause));
    } finally {
      if (version.current === epoch) setBusy(false);
    }
  }
  async function lock() {
    if (
      (dirty || saving || draft.trim() || pendingImages.length || editingId) &&
      !confirm(
        "Es gibt noch ungesendeten Text oder nicht gespeicherte Änderungen. Sichere deine Inhalte vorher. Trotzdem sperren?",
      )
    ) return;
    ++version.current;
    queuedTranscript.current = null;
    abort.current?.abort();
    audio.current?.pause();
    if (audioUrl.current) {
      URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = "";
    }
    current.current?.clear();
    current.current = null;
    setVault(null);
    setIndex(null);
    setChat(null);
    setImages({});
    setPendingImages([]);
    setDraft("");
    setEditingId("");
    setEditingText("");
    setGradingSources(null);
    setPassword("");
    setRepeat("");
    setModels([]);
    setVoices([]);
    setDraftSettings(personalDefaults());
    setSettingsOpen(false);
    setReferenceIds([]);
    setImageMode(false);
    setBusy(false);
    setSaving(false);
    setDirty(false);
    setStatus("");
    setError("");
    pendingSave.current = null;
    await personalApi("", { action: "logout" }).catch(() => {});
  }
  function changeProvider(value: PersonalSettings["provider"]) {
    setDraftSettings({
      ...draftSettings,
      provider: value,
      models: { chat: "", tts: "", asr: "", image: "" },
      voice: "",
    });
    setModels([]);
    setVoices([]);
  }

  if (!vault || !index) {
    return (
      <section class="mx-auto min-w-0 w-full max-w-xl rounded-3xl border border-indigo-100 bg-white/95 p-6 shadow-sm sm:p-8">
        <div class="mb-5 inline-flex rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-800">
          🔒 Persönlicher Raum · nur bei Buddy
        </div>
        <h1 class="text-2xl font-bold text-slate-900">
          {mode === "register"
            ? "Dein Buddy. Auf deinen Geräten."
            : `${initialSlug || slug || "Deinen Raum"} entsperren`}
        </h1>
        <p class="mt-3 text-sm leading-6 text-slate-600">
          Chats und Bilder werden auf deinem Gerät verschlüsselt und auf dem
          Buddy-Server gespeichert. Nur mit deinem Passwort kannst du sie auf
          dem Handy oder Computer wieder öffnen. Bis zu 100 MB; Bilder werden
          als JPEG komprimiert.
        </p>
        {registration && (
          <div class="my-5 flex gap-2">
            <button
              type="button"
              class={mode === "register" ? button : secondary}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              Raum anlegen
            </button>
            <button
              type="button"
              class={mode === "login" ? button : secondary}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Bestehenden Raum öffnen
            </button>
          </div>
        )}
        <form class="mt-5 space-y-4" onSubmit={unlock}>
          <label class="block text-sm font-semibold text-slate-700">
            Name für deine Adresse<input
              class={input + " mt-1"}
              value={slug}
              readOnly={!!initialSlug}
              onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())}
              autoComplete="username"
              placeholder="z. B. meinbuddy"
              required
              minLength={3}
              maxLength={24}
            />
            <span class="mt-1 block text-xs font-normal text-slate-500">
              bud-e.ai/{slug || "deinname"}{" "}
              · a–z und 0–9, keine Leerzeichen oder Umlaute
            </span>
          </label>
          <label class="block text-sm font-semibold text-slate-700">
            Passwort<input
              class={input + " mt-1"}
              type="password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autoComplete={mode === "register"
                ? "new-password"
                : "current-password"}
              required
            />
          </label>
          {mode === "register" && (
            <>
              <label class="block text-sm font-semibold text-slate-700">
                Passwort wiederholen<input
                  class={input + " mt-1"}
                  type="password"
                  value={repeat}
                  onInput={(e) => setRepeat(e.currentTarget.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <p class="text-xs leading-5 text-slate-500">
                Mindestens 12 Zeichen: Groß- und Kleinbuchstaben, eine Zahl und
                ein Sonderzeichen. Ein langes, einzigartiges Passwort schützt
                deinen Raum.
              </p>
              <label class="block text-sm font-semibold text-slate-700">
                Dein API-Key<input
                  class={input + " mt-1"}
                  type="password"
                  autoComplete="off"
                  value={draftSettings.key}
                  onInput={(e) => {
                    const key = e.currentTarget.value;
                    setDraftSettings({
                      ...draftSettings,
                      key,
                      provider: key.startsWith("rqsty-")
                        ? "requesty"
                        : key.startsWith("AIza") || key.startsWith("AQ.")
                        ? "google"
                        : "openrouter",
                    });
                  }}
                  placeholder="OpenRouter, Requesty oder Google AI Studio"
                  required
                />
              </label>
              <label class="flex gap-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                <input
                  type="checkbox"
                  class="mt-1 h-4 w-4 shrink-0"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.currentTarget.checked)}
                  required
                />
                <span>
                  Ich akzeptiere die{" "}
                  <a
                    href="/about"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline"
                  >
                    Nutzungshinweise
                  </a>{" "}
                  und weiß: Ohne mein Passwort gibt es keine Wiederherstellung.
                  KI-Anfragen gehen direkt an meinen Anbieter und können dort
                  Kosten verursachen.
                </span>
              </label>
            </>
          )}
          {error && (
            <p
              role="alert"
              class="rounded-xl bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}
          {status && (
            <p role="status" class="text-sm text-indigo-700">{status}</p>
          )}
          <button type="submit" class={button + " w-full"} disabled={busy}>
            {busy
              ? "Schlüssel wird berechnet …"
              : mode === "register"
              ? "Persönlichen Raum verschlüsselt anlegen"
              : "Mit Passwort entsperren"}
          </button>
        </form>
        <a
          class="mt-5 block text-center text-sm text-indigo-700 underline"
          href="/my"
        >
          Zur Raumverwaltung
        </a>
      </section>
    );
  }

  const hasBranchParent = !!chat?.branch &&
    index.chats.some((row) => row.id === chat.branch?.chatId);
  return (
    <section class="mx-auto min-w-0 w-full max-w-6xl overflow-hidden rounded-3xl border border-indigo-100 bg-white/90 shadow-sm">
      <header class="flex flex-wrap items-center gap-3 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-4 sm:px-6">
        <div class="min-w-0 w-full flex-none sm:w-auto sm:flex-1">
          <h1 class="truncate text-lg font-bold text-slate-900">
            🔒 {vault.slug}{" "}
            <span class="hidden text-sm font-normal text-slate-500 sm:inline">
              · dein persönlicher Buddy
            </span>
          </h1>
          <p class="mt-1 text-xs text-slate-500">
            {(used / 1024 / 1024).toFixed(1)} / 100 MB · {saving
              ? "Wird verschlüsselt gespeichert …"
              : dirty
              ? "Noch nicht synchronisiert"
              : status || "Ende-zu-Ende verschlüsselter Speicher"}
          </p>
        </div>
        <button
          type="button"
          class={secondary}
          disabled={busy || saving || dirty || !!editingId || recording}
          onClick={() => {
            setDraftSettings(structuredClone(index.settings));
            setSettingsOpen(true);
            setError("");
          }}
        >
          ⚙ Einstellungen
        </button>
        <button
          type="button"
          class={secondary}
          disabled={busy || saving || dirty || !!editingId || recording}
          onClick={openGrading}
        >
          ✓ Korrekturvorschläge
        </button>
        <button
          type="button"
          class={secondary}
          onClick={() =>
            void lock()}
        >
          🔒 Sperren
        </button>
      </header>
      {error && (
        <div
          role="alert"
          class="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
          {dirty && !remoteChanged && (
            <button
              type="button"
              class="ml-2 underline"
              disabled={saving}
              onClick={() => void retrySave()}
            >
              Speichern erneut versuchen
            </button>
          )}
        </div>
      )}
      {remoteChanged && (
        <div class="m-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          Dieser Raum wurde auf einem anderen Gerät geändert. {dirty
            ? "Exportiere zuerst deine lokale Fassung, damit nichts verloren geht."
            : "Lade den aktuellen Stand."}
          <button
            type="button"
            class="ml-2 underline"
            onClick={() => {
              if (
                (!dirty && !editingId) ||
                confirm(
                  "Lokale ungespeicherte Änderungen verwerfen und Serverstand laden? Vorher bei Bedarf JSON exportieren.",
                )
              ) {
                setEditingId("");
                setEditingText("");
                void loadLatest(vault, chat?.id).catch((e) =>
                  setError(errorText(e))
                );
              }
            }}
          >
            Neue Version laden
          </button>
        </div>
      )}
      <div class="grid min-w-0 grid-cols-1 min-h-[60vh] md:grid-cols-[240px_minmax(0,1fr)]">
        <aside class="min-w-0 border-b border-slate-100 bg-slate-50/80 p-3 md:border-b-0 md:border-r">
          <button
            type="button"
            class={button + " mb-3 w-full"}
            disabled={busy || saving || dirty || !!editingId || recording}
            onClick={() => void newChat()}
          >
            + Neue Unterhaltung
          </button>
          <nav
            aria-label="Deine Unterhaltungen"
            class="flex min-w-0 w-full gap-2 overflow-x-auto md:max-h-[60vh] md:flex-col md:overflow-y-auto"
          >
            {personalChatTree(index.chats).map(({ chat: row, depth }) => (
              <button
                type="button"
                key={row.id}
                class={`min-w-[150px] truncate rounded-xl px-3 py-3 text-left text-sm md:min-w-0 ${
                  chat?.id === row.id
                    ? "bg-indigo-100 font-semibold text-indigo-900"
                    : "bg-white text-slate-700 hover:bg-indigo-50"
                }`}
                style={{ paddingLeft: `${12 + Math.min(depth, 4) * 12}px` }}
                title={row.branch ? `Abzweigung · ${row.title}` : row.title}
                disabled={busy || saving || dirty || !!editingId || recording}
                onClick={() => void selectChat(row.id)}
              >
                {row.branch && (
                  <span class="mr-1 text-indigo-500" aria-hidden="true">↳</span>
                )}
                {row.title}
                {row.branch && (
                  <span class="mt-0.5 block text-[10px] font-normal text-slate-500">
                    {row.branch.kind === "edit"
                      ? "Bearbeitete Nachricht"
                      : row.branch.kind === "regenerate"
                      ? "Neue Antwort"
                      : "Abzweigung"}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class={secondary}
              title="Speichert diese Unterhaltung unverschlüsselt auf deinem Gerät, ohne API-Key."
              disabled={!chat || saving}
              onClick={() => void exportChat()}
            >
              ↓ JSON
            </button>
            <button
              type="button"
              class={secondary}
              disabled={busy || saving || dirty || !!editingId || recording}
              onClick={() => importInput.current?.click()}
            >
              ↑ JSON
            </button>
            <button
              type="button"
              class={secondary + " text-red-700"}
              disabled={!chat || busy || saving || dirty || !!editingId ||
                recording}
              onClick={() => void removeChat()}
            >
              Löschen
            </button>
          </div>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            class="hidden"
            onChange={(e) => {
              void importChat(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <a class="mt-5 block text-xs text-indigo-700 underline" href="/my">
            Raumverwaltung
          </a>
        </aside>
        <div class="flex min-w-0 flex-col">
          {chat?.branch && (
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-900">
              <span>
                ↳ {chat.branch.kind === "edit"
                  ? "Bearbeitete Variante"
                  : chat.branch.kind === "regenerate"
                  ? "Neu generierte Variante"
                  : "Abzweigung"} · {hasBranchParent
                  ? "der Ausgangsverlauf bleibt erhalten."
                  : "unabhängig gespeicherter Verlauf."}
              </span>
              {hasBranchParent && (
                <button
                  type="button"
                  class="font-semibold underline"
                  disabled={busy || saving || dirty || !!editingId || recording}
                  onClick={() => void selectChat(chat.branch!.chatId)}
                >
                  Zum Ausgangsverlauf
                </button>
              )}
            </div>
          )}
          <div
            class="chat-history max-h-[60vh] min-h-[35vh] flex-1 space-y-5 overflow-y-auto p-4 sm:p-6"
            aria-live="polite"
          >
            {!chat?.messages.length && (
              <div class="mx-auto max-w-lg py-10 text-center">
                <h2 class="text-2xl font-bold text-slate-800">
                  Woran möchtest du heute arbeiten?
                </h2>
                <p class="mt-3 leading-7 text-slate-500">
                  Stelle Fragen, sammle Ideen oder erstelle Bilder. Deine
                  Unterhaltungen warten verschlüsselt auf dich – auch auf deinem
                  anderen Gerät.
                </p>
                {!index.settings.models.chat && (
                  <button
                    type="button"
                    class={button + " mt-5"}
                    onClick={() => setSettingsOpen(true)}
                  >
                    API-Key und Modelle einrichten
                  </button>
                )}
              </div>
            )}
            {chat?.messages.map((message, messageAt) => (
              <article
                key={message.id}
                data-message-id={message.id}
                class={`rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "ml-5 bg-indigo-50"
                    : "mr-5 border border-slate-100 bg-white"
                }`}
              >
                <div class="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{message.role === "user" ? "Du" : "Buddy"}</span>
                  {message.role === "assistant" && message.text && (
                    <button
                      type="button"
                      class="rounded-lg px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
                      disabled={busy || !index.settings.enabled.tts}
                      onClick={() => void speak(message)}
                      title="Antwort vorlesen"
                    >
                      🔊 Vorlesen
                    </button>
                  )}
                </div>
                {editingId === message.id
                  ? (
                    <div class="mt-3">
                      <label class="block text-sm font-semibold text-slate-700">
                        Nachricht bearbeiten
                        <textarea
                          class={input + " mt-2 min-h-32"}
                          value={editingText}
                          maxLength={200000}
                          autoFocus
                          onInput={(event) =>
                            setEditingText(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setEditingId("");
                              setEditingText("");
                            }
                          }}
                        />
                      </label>
                      <p class="mt-2 text-xs text-slate-500">
                        Deine Änderung wird als neue Abzweigung beantwortet. Der
                        bisherige Verlauf bleibt unverändert. Die neue Antwort
                        kann Kosten beim Anbieter verursachen.
                      </p>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          class={button + " text-sm"}
                          disabled={busy || saving || dirty ||
                            (!editingText.trim() && !message.images.length)}
                          onClick={() =>
                            void forkMessage(message.id, "edit", editingText)}
                        >
                          Speichern & neu antworten
                        </button>
                        <button
                          type="button"
                          class={secondary}
                          onClick={() => {
                            setEditingId("");
                            setEditingText("");
                          }}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  )
                  : <ClassroomCodeContent content={message.text} />}
                {message.gradingReport && (
                  <div class="mt-3">
                    <GradingReportDownload text={message.text} />
                  </div>
                )}
                {message.images.length > 0 && (
                  <div class="mt-3 grid gap-3 sm:grid-cols-2">
                    {message.images.map((id) => (
                      <div
                        key={id}
                        class="overflow-hidden rounded-xl border border-slate-200 bg-white"
                      >
                        {images[id]
                          ? (
                            <a
                              href={images[id]}
                              download={`buddy-${id.slice(4)}.jpg`}
                            >
                              <img
                                src={images[id]}
                                alt="Bild aus deinem verschlüsselten Verlauf"
                                class="max-h-80 w-full object-contain"
                                loading="lazy"
                              />
                            </a>
                          )
                          : (
                            <p class="p-5 text-sm text-slate-500">
                              Bild wird entschlüsselt …
                            </p>
                          )}
                        <label class="flex items-center gap-2 px-3 py-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={referenceIds.includes(id)}
                            disabled={busy}
                            onChange={(e) =>
                              setReferenceIds(
                                e.currentTarget.checked
                                  ? [...referenceIds, id].slice(-3)
                                  : referenceIds.filter((ref) => ref !== id),
                              )}
                          />Als Bildreferenz verwenden
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                {!editingId && (
                  <div class="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
                    {message.role === "user"
                      ? (
                        <button
                          type="button"
                          class="rounded-lg px-2 py-1.5 hover:bg-indigo-100 disabled:opacity-40"
                          disabled={busy || saving || dirty || recording}
                          onClick={() => {
                            setEditingId(message.id);
                            setEditingText(message.text);
                          }}
                        >
                          ✎ Bearbeiten
                        </button>
                      )
                      : (
                        <button
                          type="button"
                          class="rounded-lg px-2 py-1.5 hover:bg-indigo-50 disabled:opacity-40"
                          disabled={busy || saving || dirty || recording ||
                            chat.messages[messageAt - 1]?.role !== "user"}
                          onClick={() =>
                            void forkMessage(message.id, "regenerate")}
                          title="Neue Antwort in einer Abzweigung erzeugen; kann Kosten beim Anbieter verursachen."
                        >
                          ↻ Neu generieren
                        </button>
                      )}
                    <button
                      type="button"
                      class="rounded-lg px-2 py-1.5 hover:bg-indigo-50 disabled:opacity-40"
                      disabled={busy || saving || dirty || recording}
                      onClick={() => void forkMessage(message.id, "branch")}
                      title="Neue Unterhaltung bis einschließlich dieser Nachricht öffnen. Kein KI-Aufruf."
                    >
                      ↳ Ab hier abzweigen
                    </button>
                  </div>
                )}
              </article>
            ))}
            {busy && (
              <p role="status" class="animate-pulse text-sm text-indigo-700">
                Buddy arbeitet …
              </p>
            )}
            <div ref={historyEnd} />
          </div>
          <form
            class="border-t border-slate-100 bg-white p-3 sm:p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (recording) setSubmitSignal((n) => n + 1);
              else void send();
            }}
          >
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                class={!imageMode
                  ? "rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800"
                  : "rounded-full px-3 py-1 text-xs text-slate-600"}
                onClick={() => setImageMode(false)}
              >
                💬 Chat
              </button>
              <button
                type="button"
                disabled={!index.settings.enabled.image}
                class={imageMode
                  ? "rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800"
                  : "rounded-full px-3 py-1 text-xs text-slate-600 disabled:opacity-40"}
                onClick={() => setImageMode(true)}
                title="Bilderzeugung in Einstellungen aktivieren"
              >
                🖼 Bild erzeugen
              </button>
              <span class="ml-auto max-w-[60%] truncate text-[11px] text-slate-400">
                {imageMode
                  ? index.settings.models.image
                  : index.settings.models.chat}
              </span>
            </div>
            {pendingImages.length > 0 && (
              <div class="mb-2 flex gap-2">
                {pendingImages.map((img) => (
                  <div class="relative" key={img.id}>
                    <img
                      src={img.value}
                      alt="Bild zum Senden"
                      class="h-16 w-16 rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      class="absolute -right-1 -top-1 rounded-full bg-slate-800 px-1.5 text-white"
                      onClick={() =>
                        setPendingImages(
                          pendingImages.filter((p) => p.id !== img.id),
                        )}
                      aria-label="Bild entfernen"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label class="sr-only" for="personal-message">
              Deine Nachricht
            </label>
            <textarea
              id="personal-message"
              class="max-h-48 min-h-24 w-full resize-y rounded-xl border border-slate-200 p-3 text-slate-900 outline-none focus:border-indigo-400"
              value={draft}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                  e.preventDefault();
                  if (!busy && !saving && !dirty) void send();
                }
              }}
              placeholder={imageMode
                ? "Beschreibe das Bild, das du erzeugen möchtest …"
                : "Schreibe deine Nachricht …"}
            />
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                class={secondary}
                disabled={busy || saving || dirty || !!editingId}
                onClick={() => fileInput.current?.click()}
                title="JPEG/PNG/WebP oder eine Audioaufnahme"
              >
                📎 Datei
              </button>
              <input
                ref={fileInput}
                type="file"
                class="hidden"
                accept="image/jpeg,image/png,image/webp,audio/*"
                multiple
                onChange={(e) => {
                  const files = e.currentTarget.files;
                  if (files?.[0]?.type.startsWith("audio/")) {
                    void transcribe(
                      files[0],
                      false,
                    );
                  } else void addFiles(files);
                  e.currentTarget.value = "";
                }}
              />
              <ClassroomRecorder
                disabled={busy || saving || dirty || !!editingId ||
                  !index.settings.enabled.asr}
                onAudio={transcribe}
                onError={setError}
                onRecordingChange={setRecording}
                submitSignal={submitSignal}
              />
              <span class="hidden flex-1 text-[11px] text-slate-400 sm:block">
                Direkt zum Anbieter · gespeichert nur als verschlüsselter Inhalt
              </span>
              {busy
                ? (
                  <button
                    type="button"
                    class={secondary + " ml-auto"}
                    onClick={() => abort.current?.abort()}
                  >
                    Stopp
                  </button>
                )
                : (
                  <button
                    data-personal-send
                    type="submit"
                    class={button + " ml-auto"}
                    disabled={saving || dirty || !!editingId ||
                      (!draft.trim() && !pendingImages.length && !recording)}
                  >
                    {recording ? "Aufnahme senden" : "Senden ↑"}
                  </button>
                )}
            </div>
          </form>
        </div>
      </div>
      {gradingSources && (
        <RoomGrading
          privateRoom
          loadBudget={async (provider) => ({ scope: "personal", provider: index.settings.provider, checkedAt: Date.now(), ...(provider && index.settings.provider === "openrouter" ? { balance: await readOpenRouterBalance(index.settings.key) } : {}) })}
          initialSources={gradingSources}
          onClose={() => setGradingSources(null)}
          onBusyChange={setBusy}
          ask={async (prompt, sources, signal, options) => {
            const v = vault, epoch = version.current;
            if (current.current !== v) {
              throw new DOMException("Der Raum ist gesperrt.", "AbortError");
            }
            const pdf = sources.find((source) => source.kind === "pdf");
            const text = await personalComplete(
              index.settings,
              [{
                role: "user",
                text: prompt,
                images: sources.filter((source) => source.kind === "image").map(
                  (source) => source.content,
                ),
                ...(pdf
                  ? { pdf: { name: pdf.name, data: pdf.content.split(",")[1] } }
                  : {}),
              }],
              models.find((model) => model.id === index.settings.models.chat),
              undefined,
              signal,
              options?.maxOutput ?? 8192,
              true,
              GRADING_MODEL_SYSTEM,
              options?.format,
            );
            if (
              version.current !== epoch || current.current !== v
            ) {
              throw new DOMException("Der Raum ist gesperrt.", "AbortError");
            }
            return text;
          }}
          onComplete={async (text, _sources, criteria) => {
            const epoch = version.current;
            if (current.current !== vault) {
              throw new Error("Der Raum ist gesperrt.");
            }
            const retry = pendingSave.current;
            if (
              retry?.chat?.messages.at(-1)?.gradingReport &&
              retry.chat.messages.at(-1)?.text === text
            ) {
              await persist(
                retry.index,
                retry.chat,
                retry.assets,
                retry.remove,
              );
              return;
            }
            // Class sets may contain 120 source pages; keep originals ephemeral.
            // Only the combined report is synced, never plaintext pupil files.
            const assets: { id: string; value: string }[] = [];
            const base: PersonalChat = chat ??
              { id: objectId("chat"), messages: [] };
            const nextChat: PersonalChat = {
              ...base,
              messages: [...base.messages, {
                id: crypto.randomUUID(),
                role: "user",
                text: "Bitte erstelle Korrekturvorschläge. Kriterien:\n" +
                  criteria,
                images: assets.map((asset) => asset.id),
                createdAt: Date.now(),
              }, {
                id: crypto.randomUUID(),
                role: "assistant",
                text,
                images: [],
                createdAt: Date.now(),
                gradingReport: true,
              }],
            };
            await persist(personalChatIndex(index, nextChat), nextChat, assets);
            if (version.current === epoch) {
              setDraft("");
              setPendingImages([]);
              setReferenceIds([]);
            }
          }}
        />
      )}
      {settingsOpen && (
        <div
          class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Persönliche Einstellungen"
        >
          <section class="my-3 w-full max-w-3xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-bold text-slate-900">
                Deine Modelle & dein API-Key
              </h2>
              <button
                type="button"
                class={secondary}
                disabled={saving || busy}
                onClick={() => setSettingsOpen(false)}
                aria-label="Einstellungen schließen"
              >
                ✕
              </button>
            </div>
            <p class="mt-2 text-sm leading-6 text-slate-500">
              Diese Einstellungen werden zusammen mit deinem Key verschlüsselt
              gespeichert. Anfragen gehen direkt an deinen Anbieter. Dein
              Passwort und dein Speicherschlüssel werden nicht an Buddy
              gesendet.
            </p>
            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <label class="text-sm font-semibold text-slate-700">
                Anbieter<select
                  class={input + " mt-1"}
                  value={draftSettings.provider}
                  onChange={(e) =>
                    changeProvider(
                      e.currentTarget.value as PersonalSettings["provider"],
                    )}
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="requesty">Requesty</option>
                  <option value="google">Google AI Studio</option>
                  <option value="compatible">
                    OpenAI-kompatibler Anbieter
                  </option>
                </select>
              </label>
              <label class="text-sm font-semibold text-slate-700">
                API-Key<input
                  type="password"
                  autoComplete="off"
                  class={input + " mt-1"}
                  value={draftSettings.key}
                  onInput={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      key: e.currentTarget.value,
                    })}
                />
              </label>
            </div>
            {draftSettings.provider === "compatible" && (
              <label class="mt-4 block text-sm font-semibold text-slate-700">
                Direkte HTTPS-API-Basisadresse<input
                  class={input + " mt-1"}
                  value={draftSettings.baseUrl}
                  placeholder="https://anbieter.example/v1"
                  onInput={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      baseUrl: e.currentTarget.value,
                    })}
                />
                <span class="mt-1 block text-xs font-normal text-slate-500">
                  Der Anbieter muss Browserzugriffe (CORS) erlauben.
                </span>
              </label>
            )}
            <div class="my-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                class={button}
                disabled={busy || saving}
                onClick={() => void refreshModels()}
              >
                Modelle direkt beim Anbieter laden
              </button>
              <label class="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyFree}
                  onChange={(e) => setOnlyFree(e.currentTarget.checked)}
                />Nur als kostenlos ausgewiesene
              </label>
              <input
                class={input + " sm:max-w-64"}
                value={modelSearch}
                onInput={(e) => setModelSearch(e.currentTarget.value)}
                placeholder="Anbieter oder Modell, z. B. ope, gem …"
                aria-label="Modelle suchen"
              />
            </div>
            <p class="mb-4 text-xs text-slate-500">
              Alphabetisch nach Anbieter und Modell. Tippe die ersten
              Buchstaben: passende Wortanfänge erscheinen als Top-Treffer.
            </p>
            <div class="space-y-4">
              {roles.map((role) => (
                <div
                  key={role.id}
                  class="rounded-2xl border border-slate-200 p-4"
                >
                  <div class="mb-2 flex items-center justify-between">
                    <div>
                      <h3 class="font-semibold text-slate-800">{role.name}</h3>
                      <p class="text-xs text-slate-500">{role.description}</p>
                    </div>
                    {role.id !== "chat" && (
                      <label class="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={draftSettings.enabled[role.id]}
                          onChange={(e) =>
                            setDraftSettings({
                              ...draftSettings,
                              enabled: {
                                ...draftSettings.enabled,
                                [role.id]: e.currentTarget.checked,
                              },
                            })}
                        />Aktiv
                      </label>
                    )}
                  </div>
                  <PersonalModelPicker
                    models={models}
                    provider={draftSettings.provider}
                    role={role.id}
                    label={role.name}
                    value={draftSettings.models[role.id]}
                    query={modelSearch}
                    onlyFree={onlyFree}
                    disabled={busy || saving}
                    onChange={(id) => {
                      setDraftSettings({
                        ...draftSettings,
                        models: {
                          ...draftSettings.models,
                          [role.id]: id,
                        },
                      });
                      setVoices([]);
                    }}
                  />
                  <label class="mt-2 block text-xs text-slate-500">
                    Oder genaue Modell-ID eintragen<input
                      class="mt-1 w-full rounded-lg border border-slate-200 p-2 font-mono text-xs"
                      aria-label={`${role.name} Modell-ID`}
                      value={draftSettings.models[role.id]}
                      onInput={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          models: {
                            ...draftSettings.models,
                            [role.id]: e.currentTarget.value,
                          },
                        })}
                    />
                  </label>
                </div>
              ))}
            </div>
            <div class="mt-4 rounded-2xl bg-indigo-50 p-4">
              <div class="flex items-center justify-between">
                <label class="text-sm font-semibold">TTS-Stimme</label>
                <button
                  type="button"
                  class={secondary}
                  disabled={busy}
                  onClick={() => {
                    const epoch = version.current;
                    void personalVoices(draftSettings).then((list) => {
                      if (version.current === epoch) setVoices(list);
                    }).catch((e) => {
                      if (version.current === epoch) setError(errorText(e));
                    });
                  }}
                >
                  Stimmen anzeigen
                </button>
              </div>
              <input
                class={input + " mt-2"}
                list="personal-voices"
                placeholder="Modellstandard (z. B. Kore oder alloy)"
                value={draftSettings.voice}
                onInput={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    voice: e.currentTarget.value,
                  })}
              />
              <datalist id="personal-voices">
                {voices.map((voice) => (
                  <option value={voice.id} key={voice.id}>{voice.name}</option>
                ))}
              </datalist>
              <label class="mt-3 block text-sm font-semibold">
                Sprechstil<textarea
                  class={input + " mt-1"}
                  value={draftSettings.style}
                  onInput={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      style: e.currentTarget.value,
                    })}
                />
              </label>
            </div>
            {error && (
              <p
                role="alert"
                class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            {status && (
              <p
                role="status"
                class="mt-4 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800"
              >
                {status}
              </p>
            )}
            <div class="mt-5 flex flex-wrap justify-between gap-3">
              <button
                type="button"
                class={secondary}
                disabled={busy || saving || !draftSettings.models.chat}
                onClick={() => void testModel()}
              >
                Chatverbindung testen
              </button>
              <button
                type="button"
                class={button}
                disabled={busy || saving}
                onClick={() => void saveSettings()}
              >
                Verschlüsselt speichern
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
