/**
 * @file learningPathsDir.ts
 * @description Reads subjects, modules and learning paths from a folder.
 *
 *              Server side only - it touches the filesystem. A teacher writes
 *              one JSON file per lesson, drops it into
 *              learning-paths/<subject>/<module>/, and it appears in the app
 *              without anyone editing the source. See LERNPFADE.md.
 *
 *              The layout mirrors the three levels the app shows:
 *
 *                learning-paths/
 *                  physik/                    a subject
 *                    _subject.json            describes it
 *                    elektrizitaetslehre/     a module
 *                      _module.json           describes it
 *                      stromkreis.json        a learning path
 *
 *              Paths lying loose in a subject folder still work: they are put
 *              into a module of their own, because a folder someone made
 *              before this structure existed should not silently disappear.
 *
 *              The folder is optional in every sense: it may not exist, it may
 *              be empty, and a file in it may be wrong. None of that is
 *              allowed to break the app - the built-in paths always work, and
 *              anything unreadable is reported to the log and skipped.
 */

import type { Module, Subject } from "./learningPaths.ts";
import {
  mergeSubjects,
  type ModuleMeta,
  parseLearningPath,
  parseModuleMeta,
  parseSubjectMeta,
  type SubjectMeta,
} from "./learningPathFile.ts";

/** Where files are looked for, relative to the working directory. */
export const PATHS_DIR = Deno.env.get("LEARNING_PATHS_DIR") ?? "learning-paths";

/** How long a scan is reused before the folder is read again. */
const TTL_MS = 30_000;

export interface LoadReport {
  subjects: Subject[];
  /** One line per file that could not be used. */
  errors: string[];
  warnings: string[];
  files: number;
  scannedAt: number;
}

let cached: LoadReport | null = null;

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(file));
}

function entriesOf(dir: string): Deno.DirEntry[] | null {
  try {
    return [...Deno.readDirSync(dir)].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  } catch {
    return null;
  }
}

/** Reads every *.json in one folder as a learning path. */
async function readPaths(
  dir: string,
  label: string,
  errors: string[],
  warnings: string[],
): Promise<{ paths: import("./learningPaths.ts").LearningPath[]; files: number }> {
  const paths = [];
  let files = 0;
  for (const f of entriesOf(dir) ?? []) {
    if (!f.isFile || !f.name.endsWith(".json")) continue;
    if (f.name.startsWith("_")) continue; // _subject.json, _module.json
    files++;
    const where = `${label}/${f.name}`;
    try {
      const result = parseLearningPath(await readJson(`${dir}/${f.name}`), where);
      errors.push(...result.errors.map((e) => `${where} - ${e}`));
      warnings.push(...result.warnings.map((w) => `${where} - ${w}`));
      if (result.path) paths.push(result.path);
    } catch (err) {
      // A syntax error in the JSON is by far the most common mistake, so the
      // file is named and the parser's own words are repeated.
      errors.push(`${where} - could not be read: ${err}`);
    }
  }
  return { paths, files };
}

/** Scans the folder once. */
async function scan(dir: string): Promise<LoadReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const subjects: Subject[] = [];
  let files = 0;

  const top = entriesOf(dir);
  if (!top) {
    // Not being there is the normal case, not a problem worth reporting.
    return { subjects, errors, warnings, files: 0, scannedAt: Date.now() };
  }

  for (const entry of top) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    const subjectDir = `${dir}/${entry.name}`;

    // The description is optional; without it the folder name is used and the
    // tile still appears, which is friendlier than refusing to load.
    let meta: SubjectMeta = {
      key: entry.name,
      title: { de: entry.name, en: entry.name },
      description: { de: "", en: "" },
      icon: "📚",
      accent: "indigo",
    };
    try {
      const parsed = parseSubjectMeta(
        await readJson(`${subjectDir}/_subject.json`),
        `${entry.name}/_subject.json`,
        entry.name,
      );
      errors.push(...parsed.errors.map((e) => `${entry.name}/_subject.json - ${e}`));
      warnings.push(...parsed.warnings.map((w) => `${entry.name}/_subject.json - ${w}`));
      if (parsed.meta) meta = parsed.meta;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        errors.push(`${entry.name}/_subject.json - ${err}`);
      }
    }

    const modules: Module[] = [];

    // Sub-folders are modules.
    for (const sub of entriesOf(subjectDir) ?? []) {
      if (!sub.isDirectory || sub.name.startsWith(".")) continue;
      const moduleDir = `${subjectDir}/${sub.name}`;
      const label = `${entry.name}/${sub.name}`;

      let modMeta: ModuleMeta = {
        key: sub.name,
        title: { de: sub.name, en: sub.name },
        description: { de: "", en: "" },
        icon: "📗",
        accent: meta.accent,
      };
      try {
        const parsed = parseModuleMeta(
          await readJson(`${moduleDir}/_module.json`),
          `${label}/_module.json`,
          sub.name,
          meta.accent,
        );
        errors.push(...parsed.errors.map((e) => `${label}/_module.json - ${e}`));
        warnings.push(...parsed.warnings.map((w) => `${label}/_module.json - ${w}`));
        if (parsed.meta) modMeta = parsed.meta;
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          errors.push(`${label}/_module.json - ${err}`);
        }
      }

      const read = await readPaths(moduleDir, label, errors, warnings);
      files += read.files;
      if (read.paths.length) modules.push({ ...modMeta, paths: read.paths });
    }

    // Paths lying directly in the subject folder, from before modules existed.
    // They get a module of their own rather than being dropped.
    const loose = await readPaths(subjectDir, entry.name, errors, warnings);
    files += loose.files;
    if (loose.paths.length) {
      warnings.push(
        `${entry.name} - ${loose.paths.length} path(s) lie directly in the ` +
          `subject folder; they were put into a module called "${meta.key}". ` +
          `Move them into a sub-folder to give the module a name of its own.`,
      );
      modules.unshift({
        key: meta.key,
        title: meta.title,
        description: meta.description,
        icon: meta.icon,
        accent: meta.accent,
        paths: loose.paths,
      });
    }

    if (modules.length) subjects.push({ ...meta, modules });
  }

  return { subjects, errors, warnings, files, scannedAt: Date.now() };
}

/** The folder contents, rescanned at most every 30 seconds. */
export async function loadFromDir(force = false): Promise<LoadReport> {
  if (!force && cached && Date.now() - cached.scannedAt < TTL_MS) return cached;
  cached = await scan(PATHS_DIR);
  if (cached.errors.length) {
    console.warn(
      `[learning-paths] ${cached.errors.length} problem(s) in ${PATHS_DIR}:`,
    );
    for (const e of cached.errors) console.warn(`  ${e}`);
  }
  return cached;
}

/** The built-in subjects plus everything readable in the folder. */
export async function allSubjects(
  builtin: Subject[],
  force = false,
): Promise<LoadReport> {
  const report = await loadFromDir(force);
  return { ...report, subjects: mergeSubjects(builtin, report.subjects) };
}
