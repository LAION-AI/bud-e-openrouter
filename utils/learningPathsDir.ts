/**
 * @file learningPathsDir.ts
 * @description Reads learning paths from a folder on disk.
 *
 *              Server side only - it touches the filesystem. The idea is that
 *              a teacher writes one JSON file per lesson, drops it into
 *              learning-paths/<subject>/, and it appears in the app without
 *              anyone editing the source. See LERNPFADE.md for the format.
 *
 *              The folder is optional in every sense: it may not exist, it may
 *              be empty, and a file in it may be wrong. None of that is
 *              allowed to break the app - the built-in paths always work, and
 *              anything unreadable is reported to the log and skipped.
 */

import type { Subject } from "./learningPaths.ts";
import {
  mergeSubjects,
  parseLearningPath,
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
  const text = await Deno.readTextFile(file);
  return JSON.parse(text);
}

/**
 * Scans the folder once.
 *
 * Layout: one directory per subject, an optional _subject.json describing it,
 * and any number of *.json files, each holding one path.
 */
async function scan(dir: string): Promise<LoadReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const subjects: Subject[] = [];
  let files = 0;

  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch (err) {
    // Not there is the normal case, not a problem worth reporting.
    if (!(err instanceof Deno.errors.NotFound)) {
      errors.push(`${dir}: ${err}`);
    }
    return { subjects, errors, warnings, files: 0, scannedAt: Date.now() };
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    const subjectDir = `${dir}/${entry.name}`;

    // The subject description is optional; without it the folder name is used
    // and the tile still appears, which is friendlier than refusing to load.
    let meta: SubjectMeta = {
      key: entry.name,
      title: { de: entry.name, en: entry.name },
      description: { de: "", en: "" },
      icon: "📚",
      accent: "indigo",
    };
    try {
      const raw = await readJson(`${subjectDir}/_subject.json`);
      const parsed = parseSubjectMeta(raw, `${entry.name}/_subject.json`, entry.name);
      errors.push(...parsed.errors.map((e) => `${entry.name}/_subject.json - ${e}`));
      warnings.push(...parsed.warnings.map((w) => `${entry.name}/_subject.json - ${w}`));
      if (parsed.meta) meta = parsed.meta;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        errors.push(`${entry.name}/_subject.json - ${err}`);
      }
    }

    const paths = [];
    let pathFiles: Deno.DirEntry[];
    try {
      pathFiles = [...Deno.readDirSync(subjectDir)];
    } catch (err) {
      errors.push(`${subjectDir}: ${err}`);
      continue;
    }

    for (const f of pathFiles.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!f.isFile || !f.name.endsWith(".json")) continue;
      if (f.name === "_subject.json") continue;
      files++;
      const label = `${entry.name}/${f.name}`;
      try {
        const raw = await readJson(`${subjectDir}/${f.name}`);
        const result = parseLearningPath(raw, label);
        errors.push(...result.errors.map((e) => `${label} - ${e}`));
        warnings.push(...result.warnings.map((w) => `${label} - ${w}`));
        if (result.path) paths.push(result.path);
      } catch (err) {
        // A syntax error in JSON is the most common mistake by far, so it is
        // worth naming the file and repeating what the parser said.
        errors.push(`${label} - could not be read: ${err}`);
      }
    }

    if (paths.length) subjects.push({ ...meta, paths });
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

/** The built-in paths plus everything readable in the folder. */
export async function allSubjects(
  builtin: Subject[],
  force = false,
): Promise<LoadReport> {
  const report = await loadFromDir(force);
  return { ...report, subjects: mergeSubjects(builtin, report.subjects) };
}
