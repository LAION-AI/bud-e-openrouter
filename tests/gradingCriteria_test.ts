import { assertEquals } from "$std/assert/mod.ts";
import {
  DERIVE_SOLUTIONS_POLICY,
  gradingCriteriaQuestions,
} from "../utils/gradingCriteria.ts";

Deno.test("missing teacher policy yields targeted questions", () => {
  assertEquals(gradingCriteriaQuestions("").length, 2);
  assertEquals(
    gradingCriteriaQuestions("Bitte freundlich korrigieren.").length,
    1,
  );
  assertEquals(gradingCriteriaQuestions(DERIVE_SOLUTIONS_POLICY).length, 1);
});

Deno.test("explicit points, original rubric references and no-points are accepted", () => {
  for (
    const criteria of [
      "Je richtige Lücke 1 Punkt, übrige Aufgaben je 2 Punkte, Ansatz 1 Teilpunkt.",
      "Aufgabe 1: 4 BE; Aufgabe 2: 2 BE.",
      "Punkte gemäß Aufgabenblatt übernehmen.",
      "Die Punkte im Original verwenden.",
      "Ohne Punkte bewerten. Nur fachliche Rückmeldung.",
      "Keine Punktvergabe, keine Note.",
      "No points, feedback only.",
      "Maximum 10 points.",
      "Pro Lücke einen Punkt, je Rechnung zwei Punkte.",
    ]
  ) assertEquals(gradingCriteriaQuestions(criteria), [], criteria);
});
