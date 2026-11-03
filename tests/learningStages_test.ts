import { assert, assertEquals } from "$std/assert/mod.ts";
import { learningStages, subjectsForStage } from "../utils/learningStages.ts";
import { allSubjects } from "../utils/learningPathsDir.ts";
import { subjects } from "../utils/learningPaths.ts";
import {
  learningPathQuery,
  parseLearningPathTarget,
} from "../utils/learningPathLinks.ts";

Deno.test("stages show years 5–6 before secondary without moving existing paths", async () => {
  const report = await allSubjects(subjects, true);
  assertEquals(report.errors, []);
  assertEquals(learningStages(report.subjects).slice(0, 3), [
    "klasse56",
    "sek1",
    "sek2",
  ]);
  const junior = subjectsForStage(report.subjects, "klasse56");
  assertEquals(junior.map((s) => s.key), ["natur-und-technik"]);
  assertEquals(junior[0].modules.length, 6);
  assertEquals(junior[0].modules.flatMap((m) => m.paths).length, 18);
  assert(
    subjectsForStage(report.subjects, "sek1").some((s) =>
      s.key === "informatik"
    ),
  );
  assert(
    !subjectsForStage(report.subjects, "sek1").some((s) =>
      s.key === "natur-und-technik"
    ),
  );
  assertEquals(subjectsForStage(report.subjects, "unknown"), []);
  assert(
    report.subjects.find((s) => s.key === "informatik")!.modules.some((m) =>
      m.level === "sek2"
    ),
  );
});

Deno.test("junior paths keep three short bilingual content pages, all exercise types and share links", async () => {
  const report = await allSubjects(subjects, true);
  const junior = subjectsForStage(report.subjects, "klasse56")[0];
  const keys = new Set<string>();
  for (const module of junior.modules) {
    for (const path of module.paths) {
      assert(!keys.has(path.key));
      keys.add(path.key);
      assertEquals(path.screens.length, 3);
      assertEquals(path.exercises?.map((e) => e.kind), [
        "cloze",
        "compare",
        "reflect",
      ]);
      for (const lang of ["de", "en"] as const) {
        assertEquals(
          (path.exercises![0].text[lang].match(/___/g) ?? []).length,
          8,
        );
        for (const screen of path.screens) {
          const prose = screen.blocks.flatMap((b) =>
            "text" in b ? [b.text[lang]] : []
          ).join(" ");
          const words = prose.trim().split(/\s+/).length;
          assert(
            words >= 65 && words <= 140,
            `${path.key}/${screen.key}: ${words} words`,
          );
          assertEquals(screen.blocks[0].kind, "lead");
          assert(
            screen.blocks.some((b) => b.kind === "callout" && b.tone === "try"),
          );
        }
      }
      const target = {
        subject: junior.key,
        module: module.key,
        path: path.key,
      };
      assertEquals(parseLearningPathTarget(learningPathQuery(target)), target);
      assert(path.screens.at(-1)!.blocks.some((b) => b.kind === "sources"));
    }
  }
});
