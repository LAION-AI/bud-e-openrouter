import { assert, assertEquals, assertThrows } from "$std/assert/mod.ts";
import {
  base64Bytes,
  MAX_PDF_BASE64,
  MAX_PDF_BYTES,
  MAX_ROOM_REQUEST_BYTES,
  validPdfBase64,
} from "../utils/uploadLimits.ts";
import { validateGradingSources } from "../utils/roomGrading.ts";
import {
  createClassroom,
  defaultConfig,
  updateClassroom,
} from "../utils/classroomStore.ts";
import { handler } from "../routes/api/classroom.ts";

const exact = () => "A".repeat(MAX_PDF_BASE64 - 1) + "=";
Deno.test("PDF limits: exactly 20 MB accepted, same base64 length with one extra decoded byte rejected", () => {
  const data = exact(), over = "A".repeat(MAX_PDF_BASE64);
  assertEquals(MAX_PDF_BYTES, 20000000);
  assertEquals(base64Bytes(data), MAX_PDF_BYTES);
  assertEquals(base64Bytes(over), MAX_PDF_BYTES + 1);
  assert(validPdfBase64(data));
  assert(!validPdfBase64(over));
  for (const invalid of ["", "A", "AA=A", "=AAA", "AAAA===", "AA A"]) {
    assert(!validPdfBase64(invalid));
  }
  const source = {
    index: 1,
    name: "gross.pdf",
    kind: "pdf" as const,
    content: "data:application/pdf;base64," + data,
  };
  assertEquals(validateGradingSources([source]).length, 1);
  assertEquals(validateGradingSources([source, source]).length, 2);
  assertThrows(() => validateGradingSources([source, source, source]));
  assertThrows(() =>
    validateGradingSources([{
      ...source,
      content: "data:application/pdf;base64," + over,
    }])
  );
  assert(MAX_ROOM_REQUEST_BYTES > data.length + 3 * 700000 + 100000);
});
Deno.test("classroom API transports a 20 MB PDF through the bounded body and rejects 20 MB plus one byte before provider call", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-pdf20-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  await createClassroom(
    "pdfraum",
    "TestPDF!Lang2026",
    "openrouter",
    "sk-or-v1-synthetic-pdf-key",
  );
  const cfg = defaultConfig();
  cfg.models.chat = "test/pdf-vision";
  await updateClassroom("pdfraum", cfg, 5, Date.now() + 60000, false);
  const old = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return Promise.resolve(Response.json({
        data: [{
          id: "test/pdf-vision",
          name: "Test PDF",
          architecture: {
            input_modalities: ["text", "image", "file"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "0", completion: "0" },
          context_length: 128000,
        }],
      }));
    }
    if (url.includes("/models")) {
      return Promise.resolve(Response.json({ data: [] }));
    }
    if (url.endsWith("/chat/completions")) {
      providerCalls++;
      const payload = JSON.parse(String(init?.body));
      const parts = payload.messages.at(-1).content;
      assert(
        parts.some((part: { file?: { file_data: string } }) =>
          part.file?.file_data.length ===
            MAX_PDF_BASE64 + "data:application/pdf;base64,".length
        ),
      );
      return Promise.resolve(
        Response.json({
          choices: [{
            message: { content: "PDF erhalten" },
            finish_reason: "stop",
          }],
          usage: { cost: 0.001 },
        }),
      );
    }
    throw new Error("Unexpected test request");
  };
  const request = (data: string) =>
    new Request("https://school.bud-e.ai/api/classroom", {
      method: "POST",
      headers: {
        origin: "https://school.bud-e.ai",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "chat",
        slug: "pdfraum",
        toolContinuation: true,
        messages: [{ role: "user", content: "Lies diese Arbeit" }],
        pdf: { name: "gross.pdf", data },
      }),
    });
  try {
    const accepted = await handler.POST!(request(exact()), {} as never);
    assertEquals(accepted.status, 200);
    assertEquals(providerCalls, 1);
    const rejected = await handler.POST!(
      request("A".repeat(MAX_PDF_BASE64)),
      {} as never,
    );
    assertEquals(rejected.status, 400);
    assert((await rejected.json()).error.includes("20 MB"));
    assertEquals(providerCalls, 1);
  } finally {
    globalThis.fetch = old;
  }
});
