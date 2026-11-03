import {
  createClassroom,
  defaultConfig,
  findClassroom,
  issueSession,
  sessionCookie,
  updateClassroom,
} from "../utils/classroomStore.ts";
import { handler } from "../routes/api/classroom.ts";

function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}

Deno.test("failed classroom calls release the maximum-output reservation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-budget-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  await createClassroom(
    "budgetraum",
    "EinSicheres!2026",
    "openrouter",
    "sk-or-v1-test-budget-key-never-shown",
  );
  const cfg = defaultConfig();
  cfg.models.chat = "test/paid";
  await updateClassroom("budgetraum", cfg, 0.5, Date.now() + 60_000, false);
  const token = await issueSession("budgetraum");
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return Promise.resolve(Response.json({
        data: [{
          id: "test/paid",
          name: "Test Paid",
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "0.0000002", completion: "0.000010" },
          top_provider: { max_completion_tokens: 128_000 },
        }],
      }));
    }
    if (url.includes("/models?")) {
      return Promise.resolve(Response.json({ data: [] }));
    }
    if (url.includes("/models/")) {
      return Promise.resolve(Response.json({}, { status: 404 }));
    }
    if (url.endsWith("/chat/completions")) {
      calls++;
      const body = JSON.parse(String(init?.body));
      if (calls <= 2) {
        assert(
          body.max_completion_tokens > 30_000,
          "large reservation not exercised",
        );
      }
      return Promise.resolve(
        calls === 2
          ? Response.json({
            choices: [{
              message: { content: "Hallo!" },
              finish_reason: "stop",
            }],
            usage: { cost: 0.001 },
          })
          : Response.json({ error: { code: 503 } }, { status: 503 }),
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const studentRequest = () =>
      new Request("https://bud-e.ai/api/classroom", {
        method: "POST",
        headers: {
          origin: "https://bud-e.ai",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "chat",
          slug: "budgetraum",
          messages: [{ role: "user", content: "Hallo" }],
        }),
      });
    const failed = await handler.POST!(studentRequest(), {} as never);
    assert(failed.status === 502, "provider failure was not returned");
    let room = await findClassroom("budgetraum");
    assert(room?.spent_usd === 0, "failed chat consumed teacher budget");
    assert(room?.reserved_usd === 0, "failed chat left a reservation");

    const success = await handler.POST!(studentRequest(), {} as never);
    assert(success.status === 200, "room remained blocked after failed call");
    room = await findClassroom("budgetraum");
    assert(room?.spent_usd === 0.001, "actual provider cost not counted");

    const test = await handler.POST!(
      new Request("https://bud-e.ai/api/classroom", {
        method: "POST",
        headers: {
          origin: "https://bud-e.ai",
          cookie: sessionCookie(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "test", model: "test/paid" }),
      }),
      {} as never,
    );
    assert(test.status === 502, "failed teacher test was not returned");
    room = await findClassroom("budgetraum");
    assert(room?.spent_usd === 0.001, "failed teacher test consumed budget");
    assert(room?.reserved_usd === 0, "failed teacher test left reservation");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
