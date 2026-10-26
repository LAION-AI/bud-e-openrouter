import {
  createClassroom,
  issueSession,
  sessionCookie,
} from "../utils/classroomStore.ts";
import { handler } from "../routes/api/classroom.ts";

function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}

Deno.test("OpenRouter free scan is parallel, bounded and uses enough reply tokens", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-free-scan-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  await createClassroom(
    "freitest",
    "EinSicheres!2026",
    "openrouter",
    "sk-or-v1-test-free-scan-key-never-shown",
  );
  const token = await issueSession("freitest");
  const oldFetch = globalThis.fetch;
  const called: string[] = [];
  let active = 0;
  let mostActive = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return Response.json({
        data: [
          ...[
            "openrouter/free",
            ...Array.from({ length: 7 }, (_, i) => `test/model-${i}:free`),
          ].map((id) => ({
            id,
            name: id,
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            pricing: { prompt: "0", completion: "0" },
          })),
          {
            id: "test/paid",
            name: "Paid",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            pricing: { prompt: "0.000001", completion: "0.000001" },
          },
        ],
      });
    }
    if (url.includes("/models?")) return Response.json({ data: [] });
    if (url.includes("/models/")) {
      return Response.json({}, { status: 404 });
    }
    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      called.push(body.model);
      assert(body.max_completion_tokens === 1024, "test token cap too low");
      active++;
      mostActive = Math.max(mostActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      if (body.model === "test/model-0:free") {
        return Response.json({
          error: {
            code: 429,
            metadata: { limit_source: "upstream_provider_shared_pool" },
          },
        }, { status: 429 });
      }
      return Response.json({
        choices: [{ message: { content: "2" }, finish_reason: "stop" }],
        usage: { cost: 0 },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const headers = {
      origin: "https://bud-e.ai",
      cookie: sessionCookie(token),
      "content-type": "application/json",
    };
    const request = () =>
      new Request("https://bud-e.ai/api/classroom", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "scan-free" }),
      });
    const response = await handler.POST!(request(), {} as never);
    const result = await response.json();
    assert(response.status === 200, `scan failed: ${result.error}`);
    assert(result.tested === 6, "scan must cap at six models");
    assert(result.working === 5, "successful models not counted");
    assert(mostActive > 1 && mostActive <= 3, "scan concurrency wrong");
    assert(!called.includes("test/paid"), "paid model was probed");
    const list = await handler.GET!(
      new Request("https://bud-e.ai/api/classroom?action=models", {
        headers: { cookie: sessionCookie(token) },
      }),
      {} as never,
    );
    const models = (await list.json()).models;
    assert(
      models.find((m: { id: string }) => m.id === "openrouter/free")
        ?.checkStatus === "ok",
      "working router not marked available",
    );
    assert(
      models.find((m: { id: string }) => m.id === "test/model-0:free")
        ?.checkStatus === "error",
      "upstream-limited model not marked unavailable",
    );
    const again = await handler.POST!(request(), {} as never);
    assert(again.status === 429, "scan cooldown missing");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
