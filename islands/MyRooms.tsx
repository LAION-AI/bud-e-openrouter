import { useState } from "preact/hooks";
import ClassroomAdmin from "./ClassroomAdmin.tsx";
import PersonalRoom from "./PersonalRoom.tsx";

export default function MyRooms() {
  const [kind, setKind] = useState<"classroom" | "personal">("classroom");
  const [opened, setOpened] = useState(false);
  return (
    <div class="mx-auto w-full max-w-6xl">
      {!opened && (
        <>
          <h1 class="mb-2 text-3xl font-bold text-slate-900">
            Dein Buddy. Dein Raum.
          </h1>
          <p class="mb-6 text-slate-600">
            Teile einen Klassenraum oder öffne deinen persönlichen,
            verschlüsselten Chat auf all deinen Geräten.
          </p>
          <div
            class="mb-7 grid gap-3 sm:grid-cols-2"
            role="tablist"
            aria-label="Art des Raums"
          >
            <button
              type="button"
              role="tab"
              aria-selected={kind === "classroom"}
              class={`rounded-2xl border p-4 text-left ${
                kind === "classroom"
                  ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100"
                  : "border-slate-200 bg-white"
              }`}
              onClick={() => setKind("classroom")}
            >
              <span class="block font-bold text-slate-900">🏫 Klassenraum</span>
              <span class="mt-1 block text-sm text-slate-500">
                Du verwaltest den Key. Deine Klasse nutzt den gemeinsamen Link.
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === "personal"}
              class={`rounded-2xl border p-4 text-left ${
                kind === "personal"
                  ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100"
                  : "border-slate-200 bg-white"
              }`}
              onClick={() => setKind("personal")}
            >
              <span class="block font-bold text-slate-900">
                🔒 Persönlicher Raum
              </span>
              <span class="mt-1 block text-sm text-slate-500">
                Nur mit deinem Passwort. Chats und Bilder verschlüsselt
                synchronisieren.
              </span>
            </button>
          </div>
        </>
      )}
      {kind === "classroom"
        ? <ClassroomAdmin brand="Buddy" />
        : <PersonalRoom registration onOpened={() => setOpened(true)} />}
    </div>
  );
}
