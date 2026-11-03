import {
  parseClassroomArchive,
  selectedImages,
} from "../utils/classroomConversation.ts";
import { splitClassroomContent } from "../components/ClassroomCodeContent.tsx";
import { writeZip } from "../utils/docx.ts";
import { extractDocumentText } from "../utils/documentText.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("code fences become copyable code parts without executing HTML", () => {
  const parts = splitClassroomContent(
    "Vorher\n```python\nprint('<script>')\n```\nNachher",
  );
  assert(parts.length === 3, "three content parts expected");
  assert(parts[1].kind === "code", "middle part is code");
  assert(parts[1].value === "print('<script>')", "code is preserved as text");
});

Deno.test("unfinished fences and raw HTML still render as code", () => {
  const unfinished = splitClassroomContent(
    "Hier ist HTML:\n```html\n<html><body>Hallo",
  );
  assert(unfinished[1].kind === "code", "unfinished fence was plain text");
  assert(
    unfinished[1].kind === "code" && unfinished[1].incomplete === true,
    "missing closing fence not marked",
  );
  const raw = splitClassroomContent("<!DOCTYPE html>\n<html></html>");
  assert(raw[0].kind === "code", "raw HTML not rendered as code");
  const prefaced = splitClassroomContent(
    "Hier ist die Seite:\n<!DOCTYPE html>\n<html><body>Hallo</body></html>\nViel Spaß!",
  );
  assert(prefaced.length === 3, "HTML with introduction was not separated");
  assert(prefaced[1].kind === "code", "introduced HTML was not code");
});

Deno.test("image IDs and natural numbers resolve to the same gallery entry", () => {
  const gallery = [{
    id: "upl_00005",
    src: "data:image/jpeg;base64,AA==",
    name: "Test",
  }];
  assert(
    selectedImages("Was zeigt Bild Nummer 1?", [], gallery)[0].id ===
      "upl_00005",
    "number references image",
  );
  assert(
    selectedImages("Vergleiche upl_00005 mit Bild 1", [], gallery).length === 1,
    "duplicates are removed",
  );
});

Deno.test("archive import rejects wrong room and unsafe image sources", () => {
  const safe = {
    version: 1,
    slug: "schuhmann",
    messages: [{ role: "user", content: "Hallo" }],
    gallery: [],
  };
  assert(
    parseClassroomArchive(safe, "schuhmann").messages.length === 1,
    "safe archive imports",
  );
  let rejected = false;
  try {
    parseClassroomArchive({ ...safe, slug: "other" }, "schuhmann");
  } catch {
    rejected = true;
  }
  assert(rejected, "foreign room rejected");
  rejected = false;
  try {
    parseClassroomArchive({
      ...safe,
      gallery: [{ id: "upl_00001", src: "javascript:alert(1)", name: "evil" }],
    }, "schuhmann");
  } catch {
    rejected = true;
  }
  assert(rejected, "unsafe URL rejected");
  const longCode = "<p>Hallo</p>".repeat(4_000);
  const restored = parseClassroomArchive({
    ...safe,
    messages: [{
      role: "assistant",
      content: longCode,
      truncated: true,
      outputLimit: 64_000,
    }],
  }, "schuhmann");
  assert(restored.messages[0].content === longCode, "long code was clipped");
  assert(restored.messages[0].truncated, "output limit notice was lost");
});

Deno.test("PowerPoint slide text is available as a document attachment", async () => {
  const bytes = await writeZip([{
    name: "ppt/slides/slide1.xml",
    data: new TextEncoder().encode(
      "<p:sld><a:t>Unser Projekt</a:t><a:t>Rechnernetze</a:t></p:sld>",
    ),
  }]);
  const result = await extractDocumentText("vortrag.pptx", bytes);
  assert(
    result.kind === "pptx" && result.text.includes("Folie 1"),
    "slide marker missing",
  );
  assert(result.text.includes("Rechnernetze"), "slide text missing");
});
