import {
  learningPathQuery,
  parseLearningPathTarget,
} from "../utils/learningPathLinks.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("learning path links are readable and round-trip", () => {
  const target = {
    subject: "informatik",
    module: "m2-rechnernetze",
    path: "woher-kommen-webseiten",
  };
  const query = learningPathQuery(target);
  assert(
    query === "?lernpfad=informatik/m2-rechnernetze/woher-kommen-webseiten",
    "unexpected link format",
  );
  assert(
    JSON.stringify(parseLearningPathTarget(query)) === JSON.stringify(target),
    "link did not round-trip",
  );
  assert(
    JSON.stringify(parseLearningPathTarget(`${query}&lang=de`)) ===
      JSON.stringify(target),
    "extra language parameter hid the link",
  );
});

Deno.test("learning path links reject malformed or unsafe keys", () => {
  for (const query of [
    "?lernpfad=",
    "?lernpfad=informatik/m2-rechnernetze",
    "?lernpfad=informatik/m2-rechnernetze/path/extra",
    "?lernpfad=../m2-rechnernetze/path",
    "?lernpfad=informatik/m2-rechnernetze/%3Cscript%3E",
    "?lernpfad=informatik/m2-rechnernetze/path&lernpfad=other/more/path",
  ]) {
    assert(parseLearningPathTarget(query) === null, `accepted ${query}`);
  }
});
