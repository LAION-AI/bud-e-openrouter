import { assert, assertEquals } from "$std/assert/mod.ts";
import {
  createClassroom,
  defaultConfig,
  findClassroom,
  updateClassroom,
} from "../utils/classroomStore.ts";
import { handler } from "../routes/api/classroom.ts";
import { DatabaseSync } from "node:sqlite";
Deno.test("parallel grading uses bounded output reservations and reports temporary budget contention without spending or bypassing limits", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-grading-budget-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  await createClassroom(
    "gradbudget",
    "TestGrading!2026",
    "openrouter",
    "sk-or-v1-synthetic-budget-key",
  );
  const cfg = defaultConfig();
  cfg.models.chat = "test/grading";
  await updateClassroom("gradbudget", cfg, .16, Date.now() + 60000, false);
  const old = globalThis.fetch;
  let calls = 0, ready!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => ready = resolve),
    hold = new Promise<void>((resolve) => release = resolve);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return Response.json({
        data: [{
          id: "test/grading",
          name: "Grading",
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "0", completion: "0.00001" },
          top_provider: { max_completion_tokens: 64000 },
        }],
      });
    }
    if (url.includes("/models")) return Response.json({ data: [] });
    if (url.endsWith("/chat/completions")) {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert(body.max_completion_tokens <= 8192);
      assertEquals(body.response_format.type, "json_schema");
      assertEquals(body.response_format.json_schema.strict, true);
      assert(
        JSON.stringify(body.messages[0]).includes("keine Tool") ||
          JSON.stringify(body.messages[0]).includes("keine Tools"),
      );
      if (calls === 1) {
        ready();
        await hold;
      }
      return Response.json({
        choices: [{ message: { content: "Bewertung" }, finish_reason: "stop" }],
        usage: { cost: .002 },
      });
    }
    throw new Error("Unexpected test request");
  };
  const request = () =>
    new Request("https://school.bud-e.ai/api/classroom", {
      method: "POST",
      headers: {
        origin: "https://school.bud-e.ai",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "chat",
        slug: "gradbudget",
        grading: true,
        gradingFormat: "transcript",
        messages: [{ role: "user", content: "Bewerte die Arbeit" }],
        images: ["data:image/jpeg;base64,AAAA"],
      }),
    });
  try {
    const first = handler.POST!(request(), {} as never);
    await started;
    const second = await handler.POST!(request(), {} as never);
    assertEquals(second.status, 409);
    assertEquals((await second.json()).code, "grading_budget_busy");
    assertEquals(calls, 1);
    release();
    assertEquals((await first).status, 200);
    assertEquals((await handler.POST!(request(), {} as never)).status, 200);
    assertEquals((await findClassroom("gradbudget"))!.spent_usd, .004);
    await updateClassroom("gradbudget", cfg, .05, Date.now() + 60000, false);
    const insufficient = await handler.POST!(request(), {} as never);
    assertEquals(insufficient.status, 403);
    assert(
      (await insufficient.json()).error.includes(
        "vollständigen Korrekturschritt",
      ),
    );
    assertEquals(
      calls,
      2,
      "Never purchase a silently shortened grading response just because budget is reserved/low",
    );
    await updateClassroom("gradbudget", cfg, .16, Date.now() + 60000, false);
    const db = new DatabaseSync(dir + "/classrooms.sqlite");
    db.prepare(
      "UPDATE classroom_rate SET requests=90 WHERE slug=? AND minute=?",
    ).run("gradbudget", Math.floor(Date.now() / 60000));
    db.close();
    const paced = await handler.POST!(request(), {} as never);
    assertEquals(paced.status, 429);
    const pacing = await paced.json();
    assertEquals(pacing.code, "grading_rate_busy");
    assert(pacing.retryAfterMs > 0 && pacing.retryAfterMs <= 61000);
    assertEquals(calls, 2);
  } finally {
    release();
    globalThis.fetch = old;
  }
});
