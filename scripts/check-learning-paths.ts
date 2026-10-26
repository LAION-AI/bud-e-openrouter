/**
 * @file check-learning-paths.ts
 * @description Checks learning path files before they are committed.
 *
 *              Written for whoever writes a path - a person or an agent -
 *              and wants to know whether it will be accepted before pushing
 *              it anywhere. It runs the same validator the application runs,
 *              so a green run here means the path shows up in the app.
 *
 *              Usage:
 *                deno task check-paths                 all of learning-paths/
 *                deno task check-paths physik          one subject
 *                deno task check-paths path/to/x.json  one file
 *
 *              Exit code 0 means everything is fine, 1 means at least one
 *              error - so this can sit in a commit hook or a pipeline.
 */

import {
  parseLearningPath,
  parseModuleMeta,
  parseSubjectMeta,
} from "../utils/learningPathFile.ts";
import { clozeParts } from "../utils/learningPaths.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DIR = `${ROOT}/learning-paths`;

let errors = 0;
let warnings = 0;
let files = 0;

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function fail(file: string, message: string) {
  console.log(`${red("  Fehler")} ${file}\n         ${message}`);
  errors++;
}

/**
 * Validator warnings that this script treats as errors.
 *
 * The application is forgiving: a path with mismatched gaps still shows up,
 * only the worksheet looks odd. For a path about to be committed that is not
 * good enough - nobody will come back to fix it later.
 */
const STRICT = [
  "gaps", // unequal number of ___ between the two languages
  "one language", // only German or only English filled in
];

function warn(file: string, message: string) {
  console.log(`${yellow("  Hinweis")} ${file}\n          ${message}`);
  warnings++;
}

/** Reads and parses JSON, reporting a syntax error the way an author needs it. */
async function readJson(path: string, label: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    fail(label, `konnte nicht gelesen werden: ${err}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    // The most common mistake by far is a missing or trailing comma, and the
    // built-in message names the position - worth passing on verbatim.
    fail(label, `kein gültiges JSON: ${err}`);
    return null;
  }
}

/**
 * Checks beyond the validator: things that parse but read badly.
 *
 * The validator decides whether a path can be shown at all. These are the
 * habits that make the mitgelieferte paths what they are - a path can break
 * them and still work, hence warnings rather than errors.
 */
function house(path: Record<string, unknown>, label: string) {
  // A broken file may be missing anything at all, and this runs on those too.
  const screens = Array.isArray(path.screens)
    ? path.screens as Array<Record<string, unknown>>
    : [];
  const exercises = Array.isArray(path.exercises)
    ? path.exercises as Array<Record<string, unknown>>
    : [];
  if (screens.length === 0) return;

  if (screens.length < 2 || screens.length > 6) {
    warn(label, `${screens.length} Bildschirme - üblich sind drei bis fünf`);
  }

  const kinds = exercises.map((e) => e.kind).join(",");
  if (kinds !== "cloze,compare,reflect") {
    warn(
      label,
      `Aufgaben sind "${kinds || "keine"}" - vorgesehen sind genau ` +
        `cloze, compare, reflect in dieser Reihenfolge`,
    );
  }

  const cloze = exercises.find((e) => e.kind === "cloze");
  if (cloze) {
    const text = cloze.text as Record<string, string>;
    const de = clozeParts(text.de ?? "").length - 1;
    const en = clozeParts(text.en ?? "").length - 1;
    // The unequal count is already reported by the validator, as STRICT.
    if (de < 8) warn(label, `Lückentext hat nur ${de} Lücken - acht bis zwölf sind üblich`);
    if ((text.de ?? "").trimStart().startsWith("___")) {
      warn(label, "Lückentext beginnt mit einer Lücke - besser erst ein Satzanfang");
    }
  }

  const hasSources = screens.some((s) =>
    Array.isArray(s.blocks) &&
    (s.blocks as Array<Record<string, unknown>>).some((b) => b?.kind === "sources")
  );
  if (!hasSources) warn(label, "keine Quellen angegeben");

  // Transliterations creep in when text is written outside an editor.
  const prose: string[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === "key" || k === "url" || k === "en" || k === "example") continue;
        if (k === "de" && typeof v === "string") prose.push(v);
        else walk(v);
      }
    }
  };
  walk(path);
  const joined = prose.join(" ").toLowerCase();
  const wrong = ["fuer ", "koennen", "waere", "groesse", "haette", "muessen",
    "laesst", "gefaehrlich", "zurueck", "ueber ", "natuerlich"]
    .filter((w) => joined.includes(w));
  if (wrong.length) {
    fail(label, `Umschreibungen statt Umlauten: ${wrong.join(", ")}`);
  }
}

/** One path file. */
async function checkPath(file: string, label: string) {
  files++;
  const raw = await readJson(file, label);
  if (raw === null) return;
  const r = parseLearningPath(raw, label);
  r.errors.forEach((e) => fail(label, e));
  for (const w of r.warnings) {
    if (STRICT.some((s) => w.includes(s))) fail(label, w);
    else warn(label, w);
  }
  // Also when the validator found errors: an author would rather see
  // everything at once than fix one thing and run again.
  house(raw as Record<string, unknown>, label);
}

/** One subject folder with its modules. */
async function checkSubject(dir: string, name: string) {
  const subjectFile = `${dir}/_subject.json`;
  try {
    const raw = await readJson(subjectFile, `${name}/_subject.json`);
    if (raw !== null) {
      const r = parseSubjectMeta(raw, `${name}/_subject.json`, name);
      r.errors.forEach((e) => fail(`${name}/_subject.json`, e));
      r.warnings.forEach((w) => warn(`${name}/_subject.json`, w));
    }
  } catch {
    warn(name, "kein _subject.json - der Ordnername wird als Titel benutzt");
  }

  let loose = 0;
  let modules = 0;
  for (const entry of [...Deno.readDirSync(dir)].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile && entry.name.endsWith(".json") && !entry.name.startsWith("_")) {
      loose++;
      await checkPath(`${dir}/${entry.name}`, `${name}/${entry.name}`);
    }
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    modules++;
    const mdir = `${dir}/${entry.name}`;
    const label = `${name}/${entry.name}`;
    try {
      const raw = await readJson(`${mdir}/_module.json`, `${label}/_module.json`);
      if (raw !== null) {
        const r = parseModuleMeta(raw, `${label}/_module.json`, entry.name, "indigo");
        r.errors.forEach((e) => fail(`${label}/_module.json`, e));
        r.warnings.forEach((w) => warn(`${label}/_module.json`, w));
      }
    } catch {
      warn(label, "kein _module.json - der Ordnername wird als Titel benutzt");
    }
    let paths = 0;
    for (const f of [...Deno.readDirSync(mdir)].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!f.isFile || !f.name.endsWith(".json") || f.name.startsWith("_")) continue;
      paths++;
      await checkPath(`${mdir}/${f.name}`, `${label}/${f.name}`);
    }
    if (paths === 0) warn(label, "Modul ohne Lernpfade - es erscheint nicht");
  }

  if (loose > 0) {
    warn(
      name,
      `${loose} Pfad(e) liegen direkt im Fachordner. Sie landen in einem ` +
        `Modul, das nach dem Fach heißt - besser in einen Unterordner legen.`,
    );
  }
  if (modules === 0 && loose === 0) warn(name, "Fach ohne Inhalte");
}

// ------------------------------------------------------------------- main

const arg = Deno.args[0];
console.log(dim(`\n  Prüft mit demselben Validator, den die Anwendung benutzt.\n`));

if (arg && arg.endsWith(".json")) {
  await checkPath(arg, arg);
} else if (arg) {
  const dir = arg.includes("/") ? arg : `${DIR}/${arg}`;
  try {
    await checkSubject(dir, arg.split("/").pop() ?? arg);
  } catch (err) {
    fail(arg, `Ordner nicht gefunden: ${err}`);
  }
} else {
  let subjects = 0;
  try {
    for (const e of [...Deno.readDirSync(DIR)].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory || e.name.startsWith(".")) continue;
      subjects++;
      await checkSubject(`${DIR}/${e.name}`, e.name);
    }
  } catch (err) {
    console.log(`${dim("  learning-paths/ gibt es hier nicht:")} ${err}`);
  }
  if (subjects === 0) console.log(dim("  keine Fächer gefunden"));
}

const summary = `  ${files} Datei(en) geprüft, ${errors} Fehler, ${warnings} Hinweise`;
console.log(errors === 0 ? green(`\n${summary}\n`) : red(`\n${summary}\n`));
if (errors === 0 && warnings === 0 && files > 0) {
  console.log(dim("  Alles in Ordnung - die Pfade erscheinen in der Anwendung.\n"));
}
Deno.exit(errors === 0 ? 0 : 1);
