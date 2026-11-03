/** A readable, safe address for one learning path (always its first screen). */
export interface LearningPathTarget {
  subject: string;
  module: string;
  path: string;
}

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseLearningPathTarget(
  search: string,
): LearningPathTarget | null {
  const params = new URLSearchParams(search);
  if (!params.has("lernpfad") || params.getAll("lernpfad").length !== 1) {
    return null;
  }
  const parts = params.get("lernpfad")?.split("/") ?? [];
  if (parts.length !== 3 || !parts.every((part) => KEY.test(part))) return null;
  return { subject: parts[0], module: parts[1], path: parts[2] };
}

export function learningPathQuery(target: LearningPathTarget): string {
  const parts = [target.subject, target.module, target.path];
  if (!parts.every((part) => KEY.test(part))) {
    throw new Error("Invalid learning path key");
  }
  return `?lernpfad=${parts.join("/")}`;
}
