import type { Subject } from "./learningPaths.ts";

/** Stage is presentation metadata, not a restriction on shared path URLs. */
export function learningStages(subjects: Subject[]): string[] {
  const order = ["klasse56", "sek1", "sek2"];
  const stages = [
    ...new Set(
      subjects.flatMap((subject) =>
        subject.modules.map((module) => module.level ?? "sek1")
      ),
    ),
  ];
  return stages.sort((a, b) => {
    const rank = (value: string) => {
      const known = order.indexOf(value);
      return known < 0 ? order.length : known;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

export function subjectsForStage(
  subjects: Subject[],
  stage: string,
): Subject[] {
  return subjects.map((subject) => ({
    ...subject,
    modules: subject.modules.filter((module) =>
      (module.level ?? "sek1") === stage
    ),
  })).filter((subject) => subject.modules.length > 0);
}
