// islands/ChatAgreement.tsx
//
// The terms a visitor has to accept before the chat appears.
//
// This screen used to be unreliable: the box could be ticked and the button
// still did nothing, on some browsers always, on others only sometimes. Four
// separate things caused it, and all four are addressed here rather than
// papered over, because a person who cannot get past this screen cannot use
// anything at all.
//
//  1. The terms were rendered into a <p> with dangerouslySetInnerHTML, and
//     they begin with a <div>. A paragraph cannot contain block elements, so
//     every browser closes the <p> early and moves the rest up a level. The
//     DOM then no longer matches what Preact expects while hydrating, and the
//     click handlers end up on the wrong nodes - which is exactly the
//     "nothing happens" symptom, and why it differed between browsers.
//
//  2. Whether the button worked depended on a piece of state that only gets
//     set if onChange fires. Now the checkbox is read straight from the DOM
//     when the button is pressed, so a missed event cannot lock anyone out.
//
//  3. localStorage.setItem throws in Safari's private mode. The exception
//     came out of the click handler and the page simply sat there. It is
//     caught now, and refusing to store the agreement no longer refuses the
//     visitor entry.
//
//  4. The page reloaded itself to show the chat, which meant a second
//     opportunity for all of the above. It now tells its parent directly.

import { useEffect, useRef, useState } from "preact/hooks";
import { agreementContent } from "../internalization/content.ts";

export const AGREEMENT_KEY = "bud-e-agreement";

/** Whether the visitor has accepted before. Safe to call anywhere. */
export function hasAgreed(): boolean {
  try {
    return localStorage.getItem(AGREEMENT_KEY) === "true";
  } catch {
    // Private mode, or storage switched off: treat it as "not yet".
    return false;
  }
}

/** Records the agreement. False when it could not be stored. */
export function storeAgreement(): boolean {
  try {
    localStorage.setItem(AGREEMENT_KEY, "true");
    return true;
  } catch {
    return false;
  }
}

interface Props {
  lang: string;
  /** Called once the visitor has accepted. */
  onAgree?: () => void;
}

export default function ChatAgreement({ lang, onAgree }: Props) {
  const t = (key: string): string =>
    (agreementContent[lang]?.[key] ?? agreementContent.en?.[key] ?? "") as string;

  const [agreed, setAgreed] = useState(false);
  const [hint, setHint] = useState(false);
  const boxRef = useRef<HTMLInputElement | null>(null);

  // Reflects a box the browser restored after a reload - Firefox keeps form
  // state across a refresh, and the state here would otherwise start at false
  // while the box on screen is ticked.
  useEffect(() => {
    if (boxRef.current?.checked) setAgreed(true);
  }, []);

  /** The truth about the checkbox, taken from the element itself. */
  const isTicked = () => boxRef.current?.checked ?? agreed;

  const handleAgree = () => {
    if (!isTicked()) {
      setHint(true);
      boxRef.current?.focus();
      return;
    }
    // Not being able to remember it is a reason to ask again next time, not a
    // reason to keep someone out now.
    storeAgreement();
    if (onAgree) onAgree();
    else globalThis.location.reload();
  };

  const setTicked = (on: boolean) => {
    setAgreed(on);
    if (on) setHint(false);
  };

  return (
    <div class="w-full max-w-xl p-6 bg-white/50 rounded-lg shadow-md">
      <h2 class="text-2xl font-bold mb-4">{t("title")}</h2>
      <p class="mb-4">{t("content")}</p>
      <p class="mb-4">
        <a href="#terms" class="underline">{t("terms")}</a>
      </p>

      {/*
        A div, not a p: the terms start with a <div> of their own, and a
        paragraph cannot hold one. Scrollable, because they are long and the
        button should stay reachable without a journey to the bottom.
      */}
      <div
        id="terms"
        class="mb-4 max-h-72 overflow-y-auto rounded border border-slate-200
               bg-white/70 p-3 text-sm"
        dangerouslySetInnerHTML={{ __html: t("temsAndConditionsContent") }}
      />

      <div class="mb-4">
        <label class="flex items-start gap-2 cursor-pointer select-none">
          <input
            ref={boxRef}
            id="agree-box"
            type="checkbox"
            checked={agreed}
            // Both events: a label click reaches one or the other depending
            // on the browser, and either is enough to keep the two in step.
            onChange={(e) => setTicked((e.target as HTMLInputElement).checked)}
            onClick={(e) => setTicked((e.target as HTMLInputElement).checked)}
            class="mt-1 shrink-0"
          />
          <span>{t("agree")}</span>
        </label>
      </div>

      {hint && (
        <p class="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200
                  rounded px-3 py-2">
          {t("pleaseTick")}
        </p>
      )}

      {/*
        Never disabled. A disabled button gives no feedback at all when the
        state it depends on is wrong - it just sits there, which is the bug
        this screen had. It asks for the tick instead.
      */}
      <button
        type="button"
        onClick={handleAgree}
        class={`w-full p-2 rounded font-semibold transition-colors ${
          agreed
            ? "bg-blue-500 text-white hover:bg-blue-600"
            : "bg-slate-300 text-slate-700 hover:bg-slate-400"
        }`}
      >
        {t("accept")}
      </button>
    </div>
  );
}
