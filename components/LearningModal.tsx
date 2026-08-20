// components/LearningModal.tsx
//
// A reader for the learning paths: subject -> path -> screens. Every block is
// rendered by a typed component, so the content file can never inject markup
// into the page. Where the pupil stopped is kept in localStorage, because a
// text worth reading is rarely finished in one sitting.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { learningContent } from "../internalization/learning-content.ts";
import {
  type Accent,
  type Block,
  findPath,
  type LearningPath,
  loadProgress,
  pick,
  type Progress,
  saveProgress,
  type Screen,
  type Subject,
  subjects,
} from "../utils/learningPaths.ts";

/** Written out in full because Tailwind only sees literal class names. */
const ACCENTS: Record<Accent, {
  tile: string;
  chip: string;
  bar: string;
  soft: string;
  text: string;
}> = {
  indigo: {
    tile: "from-indigo-500 to-indigo-700 hover:from-indigo-400",
    chip: "bg-indigo-100 text-indigo-800",
    bar: "bg-indigo-500",
    soft: "bg-indigo-50 border-indigo-200",
    text: "text-indigo-800",
  },
  emerald: {
    tile: "from-emerald-500 to-emerald-700 hover:from-emerald-400",
    chip: "bg-emerald-100 text-emerald-800",
    bar: "bg-emerald-500",
    soft: "bg-emerald-50 border-emerald-200",
    text: "text-emerald-800",
  },
  amber: {
    tile: "from-amber-500 to-amber-700 hover:from-amber-400",
    chip: "bg-amber-100 text-amber-900",
    bar: "bg-amber-500",
    soft: "bg-amber-50 border-amber-200",
    text: "text-amber-900",
  },
  rose: {
    tile: "from-rose-500 to-rose-700 hover:from-rose-400",
    chip: "bg-rose-100 text-rose-800",
    bar: "bg-rose-500",
    soft: "bg-rose-50 border-rose-200",
    text: "text-rose-800",
  },
  sky: {
    tile: "from-sky-500 to-sky-700 hover:from-sky-400",
    chip: "bg-sky-100 text-sky-800",
    bar: "bg-sky-500",
    soft: "bg-sky-50 border-sky-200",
    text: "text-sky-800",
  },
};

const CALLOUTS = {
  tip: "bg-blue-50 border-blue-200 text-blue-950",
  note: "bg-slate-50 border-slate-200 text-slate-800",
  try: "bg-emerald-50 border-emerald-300 text-emerald-950",
  fact: "bg-violet-50 border-violet-200 text-violet-950",
  warn: "bg-amber-50 border-amber-300 text-amber-950",
};

export default function LearningModal({
  lang = "en",
  onClose,
}: {
  lang?: string;
  onClose: () => void;
}) {
  const t = (key: string) =>
    (learningContent[lang]?.[key] ?? learningContent.en[key] ?? key) as string;
  const L = (value: { de: string; en: string }) => pick(value, lang);

  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [subjectKey, setSubjectKey] = useState<string | null>(null);
  const [pathKey, setPathKey] = useState<string | null>(null);
  const [screenIndex, setScreenIndex] = useState(0);
  const [showResume, setShowResume] = useState(false);

  const scrollRef = useRef<HTMLElement | null>(null);

  const subject = subjects.find((s) => s.key === subjectKey) ?? null;
  const path = subject?.paths.find((p) => p.key === pathKey) ?? null;
  const screen: Screen | null = path?.screens[screenIndex] ?? null;

  // The resume banner only makes sense while the pupil is still on an
  // overview - once they are reading, they are already where they left off.
  useEffect(() => {
    const last = progress.lastPath;
    if (!last) return;
    const found = findPath(last);
    if (!found) return;
    const reached = progress.screens[last] ?? 0;
    if (reached > 0) setShowResume(true);
  }, []);

  const remember = (next: Progress) => {
    setProgress(next);
    saveProgress(next);
  };

  const openPath = (nextSubject: Subject, nextPath: LearningPath, at = 0) => {
    setSubjectKey(nextSubject.key);
    setPathKey(nextPath.key);
    setScreenIndex(at);
    setShowResume(false);
    remember({
      ...progress,
      lastSubject: nextSubject.key,
      lastPath: nextPath.key,
      screens: { ...progress.screens, [nextPath.key]: at },
    });
  };

  const goToScreen = (index: number) => {
    if (!path) return;
    const clamped = Math.max(0, Math.min(index, path.screens.length - 1));
    setScreenIndex(clamped);
    scrollRef.current?.scrollTo({ top: 0 });
    // Only ever move the bookmark forward; re-reading must not lose progress.
    const reached = Math.max(progress.screens[path.key] ?? 0, clamped);
    remember({
      ...progress,
      lastPath: path.key,
      lastSubject: subjectKey ?? progress.lastSubject,
      screens: { ...progress.screens, [path.key]: reached },
    });
  };

  const leaveReader = () => {
    setPathKey(null);
    setScreenIndex(0);
  };

  // Escape steps back through the levels before it closes the whole modal,
  // which is what a reader expects from a three level menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pathKey) leaveReader();
        else if (subjectKey) setSubjectKey(null);
        else onClose();
        return;
      }
      if (!pathKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA/.test(target.tagName)) return;
      if (e.key === "ArrowRight") goToScreen(screenIndex + 1);
      if (e.key === "ArrowLeft") goToScreen(screenIndex - 1);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [onClose, pathKey, subjectKey, screenIndex, progress]);

  const resumeTarget = progress.lastPath ? findPath(progress.lastPath) : null;

  return (
    <div class="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-4">
      <div class="bg-white rounded-xl shadow-2xl w-[96vw] h-[93vh] flex flex-col overflow-hidden">
        {/* ---------------------------------------------------- title bar */}
        <header class="flex items-center gap-3 px-4 py-2.5 bg-slate-800 text-white shrink-0">
          {(subjectKey || pathKey) && (
            <button
              onClick={() => (pathKey ? leaveReader() : setSubjectKey(null))}
              title={pathKey ? t("backToPaths") : t("backToSubjects")}
              class="p-1.5 rounded hover:bg-white/15 shrink-0"
            >
              <BackIcon />
            </button>
          )}

          <div class="min-w-0">
            <div class="flex items-baseline gap-2">
              <span class="text-2xl leading-none">🧭</span>
              <h2 class="font-semibold truncate">
                {path ? L(path.title) : t("title")}
              </h2>
            </div>
            <p class="text-xs text-slate-300 hidden md:block truncate">
              {path
                ? L(path.summary)
                : subject
                ? L(subject.title)
                : t("subtitle")}
            </p>
          </div>

          <div class="flex-1" />

          {path && (
            <span class="hidden sm:inline text-xs px-2.5 py-1 rounded-full bg-white/10">
              {t("pageOf")
                .replace("{current}", String(screenIndex + 1))
                .replace("{total}", String(path.screens.length))}
            </span>
          )}

          <button
            onClick={onClose}
            title={t("close")}
            class="p-1.5 rounded hover:bg-white/15 shrink-0"
          >
            <CloseIcon />
          </button>
        </header>

        {/* ------------------------------------------------ progress strip */}
        {path && (
          <div class="h-1.5 bg-slate-200 shrink-0">
            <div
              class={`h-full transition-all duration-300 ${
                ACCENTS[path.accent].bar
              }`}
              style={{
                width: `${((screenIndex + 1) / path.screens.length) * 100}%`,
              }}
            />
          </div>
        )}

        {/* -------------------------------------------------------- body */}
        <main ref={scrollRef} class="flex-1 overflow-y-auto bg-slate-100">
          {!subject && (
            <SubjectGrid
              t={t}
              L={L}
              resume={resumeTarget}
              showResume={showResume}
              resumeScreen={progress.lastPath
                ? progress.screens[progress.lastPath] ?? 0
                : 0}
              onResume={() => {
                if (resumeTarget) {
                  openPath(
                    resumeTarget.subject,
                    resumeTarget.path,
                    progress.screens[resumeTarget.path.key] ?? 0,
                  );
                }
              }}
              onDismissResume={() => setShowResume(false)}
              onOpen={(s) => setSubjectKey(s.key)}
            />
          )}

          {subject && !path && (
            <PathGrid
              t={t}
              L={L}
              subject={subject}
              progress={progress}
              onOpen={(p, at) => openPath(subject, p, at)}
            />
          )}

          {path && screen && (
            <ScreenView key={screen.key} t={t} L={L} screen={screen} />
          )}
        </main>

        {/* ------------------------------------------------------- footer */}
        {path && (
          <footer class="flex items-center gap-2 px-4 py-2.5 border-t bg-white shrink-0">
            <NavButton
              onClick={() => goToScreen(screenIndex - 1)}
              disabled={screenIndex === 0}
            >
              <BackIcon /> {t("previous")}
            </NavButton>

            <div class="flex-1 flex items-center justify-center gap-1.5">
              {path.screens.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => goToScreen(i)}
                  title={L(s.title)}
                  class={`h-2.5 rounded-full transition-all ${
                    i === screenIndex
                      ? `w-7 ${ACCENTS[path.accent].bar}`
                      : "w-2.5 bg-slate-300 hover:bg-slate-400"
                  }`}
                />
              ))}
            </div>

            {screenIndex < path.screens.length - 1
              ? (
                <NavButton
                  primary
                  onClick={() => goToScreen(screenIndex + 1)}
                >
                  {t("next")} <ForwardIcon />
                </NavButton>
              )
              : (
                <NavButton primary onClick={leaveReader}>
                  {t("finish")} ✓
                </NavButton>
              )}
          </footer>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- subject level

function SubjectGrid({
  t,
  L,
  resume,
  showResume,
  resumeScreen,
  onResume,
  onDismissResume,
  onOpen,
}: {
  t: (key: string) => string;
  L: (value: { de: string; en: string }) => string;
  resume: { subject: Subject; path: LearningPath } | null;
  showResume: boolean;
  resumeScreen: number;
  onResume: () => void;
  onDismissResume: () => void;
  onOpen: (subject: Subject) => void;
}) {
  return (
    <div class="max-w-5xl mx-auto px-4 py-8">
      <h3 class="text-2xl font-bold text-slate-800">{t("chooseSubject")}</h3>
      <p class="text-slate-500 mt-1">{t("chooseSubjectHint")}</p>

      {showResume && resume && (
        <div class="mt-6 flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
          <span class="text-2xl leading-none">🔖</span>
          <div class="flex-1 min-w-[12rem]">
            <p class="text-xs uppercase tracking-wide text-slate-400">
              {t("resumeBanner")}
            </p>
            <p class="font-medium text-slate-800">
              {L(resume.path.title)}
              <span class="text-slate-400 font-normal">
                {" - "}
                {t("pageOf")
                  .replace("{current}", String(resumeScreen + 1))
                  .replace("{total}", String(resume.path.screens.length))}
              </span>
            </p>
          </div>
          <button
            onClick={onResume}
            class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            {t("resumeOpen")}
          </button>
          <button
            onClick={onDismissResume}
            class="px-3 py-2 rounded-lg text-slate-500 text-sm hover:bg-slate-100"
          >
            {t("resumeDismiss")}
          </button>
        </div>
      )}

      <div class="mt-8 grid gap-6 sm:grid-cols-2">
        {subjects.map((subject) => (
          <button
            key={subject.key}
            onClick={() => onOpen(subject)}
            class={`group text-left rounded-2xl p-6 text-white shadow-lg
                    bg-gradient-to-br transition-all hover:shadow-xl
                    hover:-translate-y-0.5 ${ACCENTS[subject.accent].tile}`}
          >
            <div class="flex items-start gap-4">
              <span class="text-5xl leading-none">{subject.icon}</span>
              <div class="min-w-0">
                <h4 class="text-xl font-bold">{L(subject.title)}</h4>
                <p class="text-white/80 text-sm mt-1 leading-snug">
                  {L(subject.description)}
                </p>
              </div>
            </div>
            <div class="mt-5 flex items-center gap-2 text-sm font-medium text-white/90">
              <span class="px-2.5 py-1 rounded-full bg-white/20">
                {subject.paths.length}{" "}
                {L({ de: "Lernpfade", en: "learning paths" })}
              </span>
              <span class="opacity-0 group-hover:opacity-100 transition-opacity">
                →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- path level

function PathGrid({
  t,
  L,
  subject,
  progress,
  onOpen,
}: {
  t: (key: string) => string;
  L: (value: { de: string; en: string }) => string;
  subject: Subject;
  progress: Progress;
  onOpen: (path: LearningPath, at: number) => void;
}) {
  return (
    <div class="max-w-5xl mx-auto px-4 py-8">
      <div class="flex items-center gap-3">
        <span class="text-4xl leading-none">{subject.icon}</span>
        <div>
          <h3 class="text-2xl font-bold text-slate-800">{L(subject.title)}</h3>
          <p class="text-slate-500 text-sm">{t("choosePathHint")}</p>
        </div>
      </div>

      <div class="mt-7 grid gap-5 md:grid-cols-2">
        {subject.paths.map((path) => {
          const reached = progress.screens[path.key];
          const started = reached !== undefined && reached > 0;
          const done = reached !== undefined &&
            reached >= path.screens.length - 1;
          const accent = ACCENTS[path.accent];

          return (
            <div
              key={path.key}
              class="bg-white rounded-2xl border border-slate-200 shadow-sm
                     hover:shadow-md hover:border-slate-300 transition-all
                     flex flex-col overflow-hidden"
            >
              <div class={`h-1.5 ${accent.bar}`} />
              <div class="p-5 flex-1 flex flex-col">
                <div class="flex items-start gap-3">
                  <span class="text-4xl leading-none">{path.icon}</span>
                  <div class="min-w-0 flex-1">
                    <h4 class="font-bold text-slate-800 leading-tight">
                      {L(path.title)}
                    </h4>
                    <div class="flex flex-wrap gap-1.5 mt-1.5">
                      <span
                        class={`text-xs px-2 py-0.5 rounded-full ${accent.chip}`}
                      >
                        {path.screens.length} {t("screens")}
                      </span>
                      <span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        ~{path.minutes} {t("minutes")}
                      </span>
                      {done && (
                        <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                          ✓ {t("doneBadge")}
                        </span>
                      )}
                      {!done && started && (
                        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                          {t("inProgressBadge")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p class="text-sm text-slate-600 leading-relaxed mt-3 flex-1">
                  {L(path.summary)}
                </p>

                <details class="mt-3 group">
                  <summary class="text-xs text-slate-500 cursor-pointer hover:text-slate-700 select-none">
                    {t("overviewTitle")}
                  </summary>
                  <ol class="mt-2 space-y-1 text-xs text-slate-600 list-decimal list-inside">
                    {path.screens.map((s) => <li key={s.key}>{L(s.title)}</li>)}
                  </ol>
                </details>

                <div class="mt-4 flex gap-2">
                  <button
                    onClick={() => onOpen(path, started ? reached : 0)}
                    class={`flex-1 px-4 py-2 rounded-lg text-white text-sm
                            font-medium bg-gradient-to-br ${accent.tile}`}
                  >
                    {started ? t("continueReading") : t("start")}
                  </button>
                  {started && (
                    <button
                      onClick={() => onOpen(path, 0)}
                      title={t("startOver")}
                      class="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ screen level

function ScreenView({
  t,
  L,
  screen,
}: {
  t: (key: string) => string;
  L: (value: { de: string; en: string }) => string;
  screen: Screen;
}) {
  return (
    <article class="max-w-3xl mx-auto px-4 py-8">
      <h3 class="text-2xl md:text-3xl font-bold text-slate-800 mb-6">
        {L(screen.title)}
      </h3>
      <div class="space-y-5">
        {screen.blocks.map((block, i) => (
          <BlockView key={i} block={block} t={t} L={L} />
        ))}
      </div>
    </article>
  );
}

function BlockView({
  block,
  t,
  L,
}: {
  block: Block;
  t: (key: string) => string;
  L: (value: { de: string; en: string }) => string;
}) {
  switch (block.kind) {
    case "lead":
      return (
        <p class="text-lg md:text-xl text-slate-700 leading-relaxed font-medium">
          {L(block.text)}
        </p>
      );

    case "heading":
      return (
        <h4 class="text-lg font-bold text-slate-800 pt-3">{L(block.text)}</h4>
      );

    case "paragraph":
      return <p class="text-slate-700 leading-relaxed">{L(block.text)}</p>;

    case "list":
      return block.ordered
        ? (
          <ol class="list-decimal list-outside pl-6 space-y-1.5 text-slate-700 leading-relaxed marker:text-slate-400 marker:font-semibold">
            {block.items.map((item, i) => <li key={i}>{L(item)}</li>)}
          </ol>
        )
        : (
          <ul class="list-disc list-outside pl-6 space-y-1.5 text-slate-700 leading-relaxed marker:text-slate-400">
            {block.items.map((item, i) => <li key={i}>{L(item)}</li>)}
          </ul>
        );

    case "steps":
      return (
        <ol class="space-y-2.5">
          {block.items.map((step, i) => (
            <li
              key={i}
              class="flex gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm"
            >
              <span class="w-7 h-7 shrink-0 rounded-full bg-slate-800 text-white text-sm font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <div class="min-w-0">
                <p class="font-semibold text-slate-800">{L(step.title)}</p>
                <p class="text-slate-600 text-sm leading-relaxed mt-0.5">
                  {L(step.text)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      );

    case "callout": {
      const labels: Record<string, string> = {
        tip: t("remember"),
        try: t("tryIt"),
        fact: t("funFact"),
        warn: t("heads"),
        note: t("numbers"),
      };
      return (
        <aside
          class={`flex gap-3 rounded-xl border-2 px-4 py-3 ${
            CALLOUTS[block.tone]
          }`}
        >
          <span class="text-2xl leading-none shrink-0">{block.icon}</span>
          <div class="min-w-0">
            <p class="font-bold text-sm">
              {block.title ? L(block.title) : labels[block.tone]}
            </p>
            <p class="leading-relaxed mt-0.5">{L(block.text)}</p>
          </div>
        </aside>
      );
    }

    case "table":
      return (
        <figure class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="bg-slate-800 text-white text-left">
                  {block.head.map((cell, i) => (
                    <th
                      key={i}
                      class="px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {L(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr
                    key={r}
                    class={r % 2 ? "bg-slate-50" : "bg-white"}
                  >
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        class={`px-3 py-2 border-t border-slate-100 align-top ${
                          c === 0 && block.highlightFirst
                            ? "font-semibold text-slate-800 whitespace-nowrap"
                            : "text-slate-600"
                        }`}
                      >
                        {L(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && (
            <figcaption class="px-3 py-2 text-xs text-slate-500 border-t bg-slate-50">
              {L(block.caption)}
            </figcaption>
          )}
        </figure>
      );

    case "timeline":
      return (
        <ol class="relative border-l-2 border-slate-300 ml-3 space-y-5">
          {block.entries.map((entry, i) => (
            <li key={i} class="ml-5">
              <span class="absolute -left-[9px] w-4 h-4 rounded-full bg-slate-800 border-2 border-white" />
              <p class="text-xs font-bold uppercase tracking-wide text-slate-400">
                {entry.year}
              </p>
              <p class="font-semibold text-slate-800">{L(entry.title)}</p>
              <p class="text-slate-600 leading-relaxed text-sm mt-0.5">
                {L(entry.text)}
              </p>
            </li>
          ))}
        </ol>
      );

    case "stats":
      return (
        <div class="grid gap-3 sm:grid-cols-3">
          {block.entries.map((entry, i) => (
            <div
              key={i}
              class="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 text-center"
            >
              <p class="text-2xl font-bold text-slate-800">{entry.value}</p>
              <p class="text-sm font-medium text-slate-600 mt-0.5">
                {L(entry.label)}
              </p>
              {entry.hint && (
                <p class="text-xs text-slate-400 mt-1 leading-snug">
                  {L(entry.hint)}
                </p>
              )}
            </div>
          ))}
        </div>
      );

    case "quote":
      return (
        <blockquote class="border-l-4 border-slate-400 pl-4 py-1 italic text-slate-700">
          <p class="leading-relaxed">{L(block.text)}</p>
          {block.source && (
            <footer class="text-sm not-italic text-slate-500 mt-1">
              — {L(block.source)}
            </footer>
          )}
        </blockquote>
      );

    case "caption":
      return (
        <p class="text-xs text-slate-500 leading-relaxed border-l-2 border-slate-200 pl-3">
          {L(block.text)}
        </p>
      );

    case "sources":
      return (
        <section class="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mt-8">
          <h5 class="font-semibold text-slate-800 text-sm">
            📚 {t("sourcesTitle")}
          </h5>
          <p class="text-xs text-slate-400 mb-2">{t("sourcesHint")}</p>
          <ul class="space-y-1.5">
            {block.items.map((item, i) => (
              <li key={i} class="text-sm leading-snug">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-blue-700 hover:underline break-words"
                >
                  {L(item.label)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      );
  }
}

// ------------------------------------------------------------------ pieces

function NavButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ComponentChildren;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      class={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm
              font-medium border shadow-sm disabled:opacity-40
              disabled:cursor-not-allowed ${
        primary
          ? "bg-slate-800 border-slate-800 text-white hover:bg-slate-700"
          : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
      }`}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------- icons

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="m19 6.4-1.4-1.4-5.6 5.6-5.6-5.6L5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4Z" />
  </svg>
);

const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6 4.6-4.6Z" />
  </svg>
);

const ForwardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8.6 7.4 10 6l6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6Z" />
  </svg>
);
