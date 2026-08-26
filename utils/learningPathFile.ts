/**
 * @file learningPathFile.ts
 * @description Reads a learning path out of a plain JSON file and checks it.
 *
 *              The paths that ship with Bud-E live in learningPaths.ts as
 *              TypeScript, which the compiler checks for us. A path written by
 *              a teacher and dropped into a folder has no compiler behind it,
 *              so the checking happens here - and it is strict on purpose.
 *
 *              Two rules guided this:
 *
 *              A broken file must never take the page down. Everything is
 *              validated before it is used, and a file that does not pass is
 *              skipped with a message naming the file and the field. The other
 *              paths carry on working.
 *
 *              The messages are written for someone who is not a programmer.
 *              "screens[2].blocks[0]: table has 3 headings but row 2 has 4
 *              cells" tells an author what to fix; "invalid input" does not.
 */

import type {
  Accent,
  Module,
  Block,
  CalloutTone,
  Exercise,
  ExerciseKind,
  LearningPath,
  Localized,
  Screen,
  Subject,
} from "./learningPaths.ts";
import { EXAMPLES } from "./notebookExamples.ts";

/**
 * The example notebooks a "notebook" block may point at.
 *
 * Taken from the examples themselves rather than written out here, so a
 * renamed example turns into a clear parse error instead of a button that
 * opens nothing.
 */
const EXAMPLE_KEYS: string[] = EXAMPLES.map((e) => e.key);

/** What came out of one file, plus anything worth telling the author. */
export interface ParseResult {
  path?: LearningPath;
  errors: string[];
  warnings: string[];
}

const ACCENTS: Accent[] = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
];
const TONES: CalloutTone[] = ["tip", "note", "try", "fact", "warn"];
const KINDS: ExerciseKind[] = ["cloze", "compare", "reflect"];

const BLOCK_KINDS = [
  "lead",
  "heading",
  "paragraph",
  "list",
  "steps",
  "callout",
  "table",
  "timeline",
  "stats",
  "quote",
  "caption",
  "notebook",
  "sources",
] as const;

/* ============================== small helpers ============================== */

class Problems {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  fail(where: string, what: string) {
    this.errors.push(`${where}: ${what}`);
  }
  warn(where: string, what: string) {
    this.warnings.push(`${where}: ${what}`);
  }
}

// deno-lint-ignore no-explicit-any
function isObject(v: any): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Reads a two-language text.
 *
 * A single string is accepted and used for both languages - most authors will
 * write in one language first, and refusing the file for that would be an
 * unhelpful kind of strictness. It is flagged as a warning so it does not pass
 * unnoticed.
 */
function localized(
  value: unknown,
  where: string,
  p: Problems,
  required = true,
): Localized | undefined {
  if (value == null || value === "") {
    if (required) p.fail(where, "is missing");
    return undefined;
  }
  if (typeof value === "string") {
    p.warn(where, "only one language given - used for German and English");
    return { de: value, en: value };
  }
  if (!isObject(value)) {
    p.fail(where, 'must be a text or {"de": "...", "en": "..."}');
    return undefined;
  }
  const de = typeof value.de === "string" ? value.de : "";
  const en = typeof value.en === "string" ? value.en : "";
  if (!de && !en) {
    p.fail(where, 'needs at least "de" or "en"');
    return undefined;
  }
  if (!de) p.warn(where, 'no German text - "en" is used instead');
  if (!en) p.warn(where, 'no English text - "de" is used instead');
  return { de: de || en, en: en || de };
}

function localizedList(
  value: unknown,
  where: string,
  p: Problems,
): Localized[] {
  if (!Array.isArray(value)) {
    p.fail(where, "must be a list");
    return [];
  }
  return value
    .map((v, i) => localized(v, `${where}[${i}]`, p))
    .filter((v): v is Localized => !!v);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/* ================================= blocks ================================= */

// deno-lint-ignore no-explicit-any
function parseBlock(raw: any, where: string, p: Problems): Block | null {
  if (!isObject(raw)) {
    p.fail(where, "must be an object with a \"kind\"");
    return null;
  }
  const kind = str(raw.kind);
  if (!(BLOCK_KINDS as readonly string[]).includes(kind)) {
    p.fail(
      where,
      `unknown kind "${kind}" - allowed: ${BLOCK_KINDS.join(", ")}`,
    );
    return null;
  }

  switch (kind) {
    case "lead":
    case "heading":
    case "paragraph":
    case "caption":
    case "quote": {
      const text = localized(raw.text, `${where}.text`, p);
      if (!text) return null;
      if (kind === "quote") {
        const source = localized(raw.source, `${where}.source`, p, false);
        return { kind, text, ...(source ? { source } : {}) };
      }
      return { kind, text };
    }

    case "list": {
      const items = localizedList(raw.items, `${where}.items`, p);
      if (items.length === 0) {
        p.fail(`${where}.items`, "a list needs at least one entry");
        return null;
      }
      return { kind, items, ...(raw.ordered === true ? { ordered: true } : {}) };
    }

    case "steps": {
      if (!Array.isArray(raw.items) || raw.items.length === 0) {
        p.fail(`${where}.items`, "steps need a list of entries");
        return null;
      }
      const items = raw.items.map((it: unknown, i: number) => {
        const w = `${where}.items[${i}]`;
        if (!isObject(it)) {
          p.fail(w, 'must be {"title": ..., "text": ...}');
          return null;
        }
        const title = localized(it.title, `${w}.title`, p);
        const text = localized(it.text, `${w}.text`, p);
        return title && text ? { title, text } : null;
      }).filter(Boolean);
      return items.length ? { kind, items } as Block : null;
    }

    case "callout": {
      const text = localized(raw.text, `${where}.text`, p);
      if (!text) return null;
      const tone = str(raw.tone, "note") as CalloutTone;
      if (!TONES.includes(tone)) {
        p.fail(`${where}.tone`, `unknown tone "${tone}" - allowed: ${TONES.join(", ")}`);
        return null;
      }
      const title = localized(raw.title, `${where}.title`, p, false);
      return {
        kind,
        tone,
        icon: str(raw.icon, "💡"),
        ...(title ? { title } : {}),
        text,
      };
    }

    case "table": {
      const head = localizedList(raw.head, `${where}.head`, p);
      if (head.length === 0) {
        p.fail(`${where}.head`, "a table needs headings");
        return null;
      }
      if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
        p.fail(`${where}.rows`, "a table needs at least one row");
        return null;
      }
      const rows: Localized[][] = [];
      raw.rows.forEach((row: unknown, i: number) => {
        const cells = localizedList(row, `${where}.rows[${i}]`, p);
        // A row with the wrong number of cells silently shifts the whole
        // table, so it is worth saying out loud which row and by how much.
        if (cells.length !== head.length) {
          p.fail(
            `${where}.rows[${i}]`,
            `the table has ${head.length} headings but this row has ${cells.length} cells`,
          );
          return;
        }
        rows.push(cells);
      });
      if (rows.length === 0) return null;
      const caption = localized(raw.caption, `${where}.caption`, p, false);
      return {
        kind,
        head,
        rows,
        ...(caption ? { caption } : {}),
        ...(raw.highlightFirst === true ? { highlightFirst: true } : {}),
      };
    }

    case "timeline": {
      if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
        p.fail(`${where}.entries`, "a timeline needs entries");
        return null;
      }
      const entries = raw.entries.map((e: unknown, i: number) => {
        const w = `${where}.entries[${i}]`;
        if (!isObject(e)) {
          p.fail(w, 'must be {"year": "...", "title": ..., "text": ...}');
          return null;
        }
        const title = localized(e.title, `${w}.title`, p);
        const text = localized(e.text, `${w}.text`, p);
        const year = str(e.year);
        if (!year) p.fail(`${w}.year`, "is missing");
        return title && text && year ? { year, title, text } : null;
      }).filter(Boolean);
      return entries.length ? { kind, entries } as Block : null;
    }

    case "stats": {
      if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
        p.fail(`${where}.entries`, "stats need entries");
        return null;
      }
      const entries = raw.entries.map((e: unknown, i: number) => {
        const w = `${where}.entries[${i}]`;
        if (!isObject(e)) {
          p.fail(w, 'must be {"value": "...", "label": ...}');
          return null;
        }
        const label = localized(e.label, `${w}.label`, p);
        const value = str(e.value);
        if (!value) p.fail(`${w}.value`, "is missing");
        const hint = localized(e.hint, `${w}.hint`, p, false);
        return label && value
          ? { value, label, ...(hint ? { hint } : {}) }
          : null;
      }).filter(Boolean);
      return entries.length ? { kind, entries } as Block : null;
    }

    case "notebook": {
      // The example has to exist, otherwise the button opens an empty
      // notebook and the reader is left wondering what went wrong.
      const example = str(raw.example);
      if (!EXAMPLE_KEYS.includes(example)) {
        p.fail(
          `${where}.example`,
          `unknown example "${example}" - available: ${EXAMPLE_KEYS.join(", ")}`,
        );
        return null;
      }
      const text = localized(raw.text, `${where}.text`, p);
      const title = localized(raw.title, `${where}.title`, p, false);
      const cellRaw = raw.cell;
      let cell: number | undefined;
      if (cellRaw !== undefined) {
        if (typeof cellRaw !== "number" || !Number.isInteger(cellRaw) || cellRaw < 1) {
          p.fail(`${where}.cell`, "must be a whole number, counting code cells from 1");
          return null;
        }
        cell = cellRaw;
      }
      if (!text) return null;
      return {
        kind,
        example,
        ...(cell !== undefined ? { cell } : {}),
        ...(title ? { title } : {}),
        text,
      };
    }

    case "sources": {
      if (!Array.isArray(raw.items) || raw.items.length === 0) {
        p.fail(`${where}.items`, "sources need at least one entry");
        return null;
      }
      const items = raw.items.map((it: unknown, i: number) => {
        const w = `${where}.items[${i}]`;
        if (!isObject(it)) {
          p.fail(w, 'must be {"label": ..., "url": "https://..."}');
          return null;
        }
        const label = localized(it.label, `${w}.label`, p);
        const url = str(it.url);
        // Only http(s): a source link is rendered into the page, and a
        // javascript: URL there would be an invitation.
        if (!/^https?:\/\//i.test(url)) {
          p.fail(`${w}.url`, "must start with http:// or https://");
          return null;
        }
        return label ? { label, url } : null;
      }).filter(Boolean);
      return items.length ? { kind, items } as Block : null;
    }
  }
  return null;
}

/* =============================== exercises =============================== */

// deno-lint-ignore no-explicit-any
function parseExercise(raw: any, where: string, p: Problems): Exercise | null {
  if (!isObject(raw)) {
    p.fail(where, "must be an object");
    return null;
  }
  const kind = str(raw.kind) as ExerciseKind;
  if (!KINDS.includes(kind)) {
    p.fail(`${where}.kind`, `unknown kind "${kind}" - allowed: ${KINDS.join(", ")}`);
    return null;
  }
  const title = localized(raw.title, `${where}.title`, p);
  const intro = localized(raw.intro, `${where}.intro`, p);
  const text = localized(raw.text, `${where}.text`, p);
  if (!title || !intro || !text) return null;

  if (kind === "cloze") {
    const de = text.de.split("___").length - 1;
    const en = text.en.split("___").length - 1;
    if (de === 0) {
      p.fail(`${where}.text`, "a cloze needs gaps, written as ___");
      return null;
    }
    // Different gap counts mean one language has a hole the other has not -
    // the printed worksheet then differs between the two.
    if (de !== en) {
      p.warn(
        `${where}.text`,
        `German has ${de} gaps, English has ${en} - they should match`,
      );
    }
    if (text.de.trimStart().startsWith("___")) {
      p.warn(`${where}.text`, "starting with a gap gives no context to work from");
    }
  }

  const hint = localized(raw.hint, `${where}.hint`, p, false);
  return { kind, title, intro, text, ...(hint ? { hint } : {}) };
}

/* ================================== path ================================== */

/** Turns the parsed contents of one file into a learning path. */
export function parseLearningPath(raw: unknown, file: string): ParseResult {
  const p = new Problems();
  if (!isObject(raw)) {
    p.fail(file, "the file must contain a JSON object");
    return { errors: p.errors, warnings: p.warnings };
  }

  const key = str(raw.key);
  if (!key) p.fail("key", "is missing - it identifies the path");
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    p.fail("key", 'only lowercase letters, digits and hyphens, e.g. "optics-basics"');
  }

  const title = localized(raw.title, "title", p);
  const summary = localized(raw.summary, "summary", p);

  const accent = str(raw.accent, "indigo") as Accent;
  if (!ACCENTS.includes(accent)) {
    p.fail("accent", `unknown colour "${accent}" - allowed: ${ACCENTS.join(", ")}`);
  }

  const minutes = Number(raw.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    p.warn("minutes", "missing or not a number - 10 is assumed");
  }

  if (!Array.isArray(raw.screens) || raw.screens.length === 0) {
    p.fail("screens", "a path needs at least one screen");
  }

  const screens: Screen[] = [];
  if (Array.isArray(raw.screens)) {
    raw.screens.forEach((s: unknown, i: number) => {
      const where = `screens[${i}]`;
      if (!isObject(s)) {
        p.fail(where, "must be an object");
        return;
      }
      const sTitle = localized(s.title, `${where}.title`, p);
      if (!Array.isArray(s.blocks) || s.blocks.length === 0) {
        p.fail(`${where}.blocks`, "a screen needs at least one block");
        return;
      }
      const blocks = s.blocks
        .map((b: unknown, j: number) => parseBlock(b, `${where}.blocks[${j}]`, p))
        .filter((b): b is Block => !!b);
      if (!sTitle || blocks.length === 0) return;
      screens.push({ key: str(s.key, `screen-${i + 1}`), title: sTitle, blocks });
    });
  }

  let exercises: Exercise[] | undefined;
  if (raw.exercises != null) {
    if (!Array.isArray(raw.exercises)) {
      p.fail("exercises", "must be a list");
    } else {
      exercises = raw.exercises
        .map((e: unknown, i: number) => parseExercise(e, `exercises[${i}]`, p))
        .filter((e): e is Exercise => !!e);
      const kinds = exercises.map((e) => e.kind).join(",");
      if (exercises.length && kinds !== "cloze,compare,reflect") {
        p.warn(
          "exercises",
          `the built-in paths use cloze, compare, reflect in that order - this one has ${kinds}`,
        );
      }
    }
  }

  if (p.errors.length || !title || !summary || !key || screens.length === 0) {
    return { errors: p.errors, warnings: p.warnings };
  }

  return {
    path: {
      key,
      title,
      summary,
      icon: str(raw.icon, "📘"),
      accent: ACCENTS.includes(accent) ? accent : "indigo",
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 10,
      screens,
      ...(exercises && exercises.length ? { exercises } : {}),
    },
    errors: p.errors,
    warnings: p.warnings,
  };
}

/* ================================ subject ================================ */

export interface SubjectMeta {
  key: string;
  title: Localized;
  description: Localized;
  icon: string;
  accent: Accent;
}

/** Reads the _subject.json that describes a folder of paths. */
export function parseSubjectMeta(
  raw: unknown,
  file: string,
  fallbackKey: string,
): { meta?: SubjectMeta; errors: string[]; warnings: string[] } {
  const p = new Problems();
  if (!isObject(raw)) {
    p.fail(file, "the file must contain a JSON object");
    return { errors: p.errors, warnings: p.warnings };
  }
  const title = localized(raw.title, "title", p);
  const description = localized(raw.description, "description", p, false);
  const accent = str(raw.accent, "indigo") as Accent;
  if (!ACCENTS.includes(accent)) {
    p.fail("accent", `unknown colour "${accent}" - allowed: ${ACCENTS.join(", ")}`);
  }
  if (!title || p.errors.length) {
    return { errors: p.errors, warnings: p.warnings };
  }
  return {
    meta: {
      key: str(raw.key, fallbackKey),
      title,
      description: description ?? { de: "", en: "" },
      icon: str(raw.icon, "📚"),
      accent: ACCENTS.includes(accent) ? accent : "indigo",
    },
    errors: p.errors,
    warnings: p.warnings,
  };
}

export interface ModuleMeta {
  key: string;
  title: Localized;
  description: Localized;
  icon: string;
  accent: Accent;
  badge?: string;
}

/** Reads the _module.json that describes a folder of paths. */
export function parseModuleMeta(
  raw: unknown,
  file: string,
  fallbackKey: string,
  fallbackAccent: Accent,
): { meta?: ModuleMeta; errors: string[]; warnings: string[] } {
  const p = new Problems();
  if (!isObject(raw)) {
    p.fail(file, "the file must contain a JSON object");
    return { errors: p.errors, warnings: p.warnings };
  }
  const title = localized(raw.title, "title", p);
  const description = localized(raw.description, "description", p, false);
  const accent = str(raw.accent) as Accent;
  if (accent && !ACCENTS.includes(accent)) {
    p.fail("accent", `unknown colour "${accent}" - allowed: ${ACCENTS.join(", ")}`);
  }
  if (!title || p.errors.length) {
    return { errors: p.errors, warnings: p.warnings };
  }
  return {
    meta: {
      key: str(raw.key, fallbackKey),
      title,
      description: description ?? { de: "", en: "" },
      icon: str(raw.icon, "📗"),
      // A module without its own colour takes the subject's, so a folder made
      // in a hurry still looks like it belongs.
      accent: accent && ACCENTS.includes(accent) ? accent : fallbackAccent,
      ...(str(raw.badge) ? { badge: str(raw.badge).slice(0, 12) } : {}),
    },
    errors: p.errors,
    warnings: p.warnings,
  };
}

/**
 * Merges loaded subjects into the built-in ones.
 *
 * Matching happens by key at every level: a subject that already exists gains
 * the new modules rather than appearing twice, a module that already exists
 * gains the new paths, and a path key that already exists replaces the
 * built-in one. That last rule is what makes it possible to correct a shipped
 * path by dropping a file next to it, without touching the source.
 */
export function mergeSubjects(
  builtin: Subject[],
  extra: Subject[],
): Subject[] {
  const out = builtin.map((s) => ({
    ...s,
    modules: s.modules.map((m) => ({ ...m, paths: [...m.paths] })),
  }));

  for (const add of extra) {
    const subject = out.find((s) => s.key === add.key);
    if (!subject) {
      out.push({
        ...add,
        modules: add.modules.map((m) => ({ ...m, paths: [...m.paths] })),
      });
      continue;
    }
    for (const addModule of add.modules) {
      const module = subject.modules.find((m) => m.key === addModule.key);
      if (!module) {
        subject.modules.push({ ...addModule, paths: [...addModule.paths] });
        continue;
      }
      for (const path of addModule.paths) {
        const at = module.paths.findIndex((p) => p.key === path.key);
        if (at >= 0) module.paths[at] = path;
        else module.paths.push(path);
      }
    }
  }
  return out;
}
