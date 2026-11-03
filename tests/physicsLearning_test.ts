import { assert, assertEquals } from "$std/assert/mod.ts";
import { allSubjects } from "../utils/learningPathsDir.ts";
import { subjects } from "../utils/learningPaths.ts";

function prose(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(prose);
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  if (obj.kind === "sources") return [];
  if (typeof obj.de === "string" && typeof obj.en === "string") {
    return [obj.de, obj.en];
  }
  return Object.values(obj).flatMap(prose);
}

Deno.test("physics offers both stages and five distinct acoustics paths without school-specific preview copy", async () => {
  const report = await allSubjects(subjects, true);
  assertEquals(report.errors, []);
  const physics = report.subjects.find((subject) => subject.key === "physik")!;
  assert(physics);
  assertEquals(
    physics.modules.find((module) => module.key === "akustik")!.paths.length,
    5,
  );
  assert(physics.modules.some((module) => module.level === "sek2"));
  const school =
    /\b(?:STS|NWT|Gymnasium|Stadtteilschule|Gym\d|gA|eA)\b|\bKlasse\s*\d|\bJahrgang(?:sstufe)?\s*\d/i;
  for (const module of physics.modules) {
    assert(!module.badge || !school.test(module.badge), module.key);
    const preview = prose([
      module.title,
      module.description,
      ...module.paths.flatMap((path) => [path.title, path.summary]),
    ]).join(" ");
    assert(!school.test(preview), `${module.key}: school-specific preview`);
    for (const path of module.paths) {
      assert(
        !school.test(prose(path.screens).join(" ")),
        `${path.key}: administrative curriculum text in a learner screen`,
      );
    }
  }
});

Deno.test("new physics paths are bilingual conceptual journeys with all three closing exercises", async () => {
  const report = await allSubjects(subjects, true);
  const physics = report.subjects.find((subject) => subject.key === "physik")!;
  let upper = 0;
  for (const module of physics.modules) {
    for (const path of module.paths) {
      const isUpper = module.level === "sek2";
      const isAcoustics = [
        "musik-und-klangfarben",
        "echo-und-raumakustik",
        "doppler-echo-und-ultraschall",
      ].includes(path.key);
      if (!isUpper && !isAcoustics) continue;
      if (isUpper) upper++;
      assert(path.screens.length >= 4 && path.screens.length <= 5, path.key);
      assertEquals(path.exercises?.map((e) => e.kind), [
        "cloze",
        "compare",
        "reflect",
      ]);
      assertEquals(
        (path.exercises![0].text.de.match(/___/g) ?? []).length,
        (path.exercises![0].text.en.match(/___/g) ?? []).length,
      );
      for (const screen of path.screens) {
        const texts = prose(screen.blocks);
        for (let lang = 0; lang < 2; lang++) {
          const words = texts.filter((_, index) =>
            index % 2 === lang
          ).join(" ").split(/\s+/).filter(Boolean).length;
          assert(
            words >= 200,
            `${path.key}/${screen.key}: only ${words} words in language ${lang}`,
          );
        }
      }
      const instructions = prose(path.exercises).join(" ");
      assert(!/\bberechne\b|\bcalculate the\b/i.test(instructions), path.key);
      assert(
        path.screens.at(-1)!.blocks.some((block) => block.kind === "sources"),
        path.key,
      );
    }
  }
  assertEquals(upper, 13);
});
