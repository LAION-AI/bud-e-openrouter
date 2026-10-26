import {
  createClassroom,
  defaultConfig,
  issueSession,
  sessionCookie,
  updateClassroom,
} from "../utils/classroomStore.ts";
import { handler as classroomHandler } from "../routes/api/classroom.ts";
import { handler as mediaHandler } from "../routes/api/classroom-media.ts";
import {
  parseResearchCommand,
  researchContext,
  researchSources,
} from "../utils/classroomResearch.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("research hashtags parse and return sourced results", async () => {
  assert(
    parseResearchCommand("#wikipedia: Rechnernetz")?.query === "Rechnernetz",
    "Wikipedia command not recognized",
  );
  assert(
    parseResearchCommand("Bitte #papers: Klimawandel")?.kind === "papers",
    "paper command not recognized",
  );
  assert(parseResearchCommand("Hallo") === null, "ordinary chat changed");
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("list=search")) {
      return Promise.resolve(Response.json({
        query: { search: [{ title: "Rechnernetz" }] },
      }));
    }
    if (url.includes("prop=extracts")) {
      return Promise.resolve(Response.json({
        query: {
          pages: {
            "1": {
              title: "Rechnernetz",
              extract: "Ein Netzwerk verbindet Geräte.",
            },
          },
        },
      }));
    }
    if (url.startsWith("https://api.ask.orkg.org/")) {
      return Promise.resolve(Response.json({
        payload: {
          items: [{
            title: "Forschung zu Klimawandel",
            abstract: "Kurze Zusammenfassung.",
            doi: "10.1234/test.paper",
            authors: ["Ada Beispiel"],
          }],
        },
      }));
    }
    throw new Error(`Unexpected source: ${url}`);
  };
  try {
    const wiki = await researchSources(
      parseResearchCommand("#wikipedia: Rechnernetz")!,
    );
    assert(wiki.length === 1, "Wikipedia result missing");
    assert(wiki[0].url.includes("de.wikipedia.org"), "Wikipedia URL wrong");
    assert(researchContext(wiki).includes("Ein Netzwerk"), "extract missing");
    const papers = await researchSources(
      parseResearchCommand("#papers: Klimawandel")!,
    );
    assert(papers.length === 1, "paper result missing");
    assert(
      papers[0].url === "https://doi.org/10.1234/test.paper",
      "DOI URL wrong",
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

Deno.test("OpenRouter account credits are not confused with key limit", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-credit-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  const chatKey = "sk-or-v1-test-chat-key-never-shown";
  const managementKey = "sk-or-v1-test-management-key-never-stored";
  await createClassroom(
    "kreditraum",
    "EinSicheres!2026",
    "openrouter",
    chatKey,
  );
  const token = await issueSession("kreditraum");
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    if (url.endsWith("/key")) {
      assert(auth === `Bearer ${chatKey}`, "wrong key used for limit");
      return Promise.resolve(Response.json({
        data: { limit: 10, limit_remaining: 8 },
      }));
    }
    if (url.endsWith("/credits")) {
      if (auth === `Bearer ${chatKey}`) {
        return Promise.resolve(Response.json({}, { status: 403 }));
      }
      assert(auth === `Bearer ${managementKey}`, "wrong credits key");
      return Promise.resolve(Response.json({
        data: { total_credits: 50, total_usage: 17.5 },
      }));
    }
    throw new Error(`Unexpected upstream: ${url}`);
  };
  try {
    const headers = { cookie: sessionCookie(token) };
    const partial = await classroomHandler.GET!(
      new Request("https://bud-e.ai/api/classroom?action=balance", { headers }),
      {} as never,
    );
    const partialData = await partial.json();
    assert(
      partialData.accountAvailable === false,
      "credit access not distinguished",
    );
    assert(partialData.keyLimitRemaining === 8, "key limit missing");
    assert(
      partialData.remainingCredits === undefined,
      "limit mislabeled as credits",
    );
    const complete = await classroomHandler.POST!(
      new Request("https://bud-e.ai/api/classroom", {
        method: "POST",
        headers: {
          ...headers,
          origin: "https://bud-e.ai",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "balance", managementKey }),
      }),
      {} as never,
    );
    const data = await complete.json();
    assert(data.accountAvailable === true, "credits were not retrieved");
    assert(data.remainingCredits === 32.5, "remaining credits miscalculated");
    assert(data.keyLimitRemaining === 8, "key limit should remain separate");
    assert(
      !JSON.stringify(data).includes(managementKey),
      "management key leaked",
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

Deno.test("admin can test an unsaved selected media model", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-media-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  const key = "AQ.test-google-key-for-unsaved-model";
  await createClassroom("modellraum", "EinSicheres!2026", "google", key);
  await updateClassroom("modellraum", defaultConfig(), 2, 0, true);
  const token = await issueSession("modellraum");
  const originalFetch = globalThis.fetch;
  let generated = false;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    assert(
      new Headers(init?.headers).get("x-goog-api-key") === key,
      "wrong Google key",
    );
    if (url.includes("/models?pageSize=")) {
      return Promise.resolve(Response.json({
        models: [{
          name: "models/gemini-test-image",
          displayName: "Test Image",
          supportedGenerationMethods: ["generateContent"],
        }],
      }));
    }
    if (url.includes("gemini-test-image:generateContent")) {
      generated = true;
      return Promise.resolve(Response.json({
        candidates: [{
          content: {
            parts: [{
              inlineData: { mimeType: "image/png", data: "aGVsbG8=" },
            }],
          },
        }],
      }));
    }
    throw new Error(`Unexpected Google request: ${url}`);
  };
  try {
    const response = await mediaHandler.POST!(
      new Request("https://bud-e.ai/api/classroom-media", {
        method: "POST",
        headers: {
          origin: "https://bud-e.ai",
          cookie: sessionCookie(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "image",
          slug: "modellraum",
          adminTest: true,
          model: "gemini-test-image",
          text: "Kleiner Kreis",
        }),
      }),
      {} as never,
    );
    const result = await response.json();
    assert(response.status === 200, `unsaved test failed: ${result.error}`);
    assert(
      result.model === "gemini-test-image" && generated,
      "wrong model tested",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("student hashtag search reaches the model and returns source links", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-research-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  const key = "rqsty-test-research-key";
  await createClassroom("rechercheraum", "EinSicheres!2026", "requesty", key);
  const cfg = defaultConfig();
  cfg.models.chat = "provider/research-chat";
  await updateClassroom("rechercheraum", cfg, 1, Date.now() + 60_000, false);
  const originalFetch = globalThis.fetch;
  let contextReachedModel = false;
  const longReply = `\`\`\`html\n${"<p>Hallo</p>\n".repeat(3_500)}\`\`\``;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return Promise.resolve(Response.json({
        data: [{
          api: "chat",
          id: "provider/research-chat",
          input_price: "0.000001",
          output_price: "0.000001",
          data_retention: true,
          geolocation: "us",
        }],
      }));
    }
    if (url.includes("list=search")) {
      return Promise.resolve(Response.json({
        query: { search: [{ title: "Rechnernetz" }] },
      }));
    }
    if (url.includes("prop=extracts")) {
      return Promise.resolve(Response.json({
        query: {
          pages: {
            "1": { title: "Rechnernetz", extract: "Computer sind verbunden." },
          },
        },
      }));
    }
    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      assert(body.max_tokens === 64_000, "long output limit not requested");
      contextReachedModel = body.messages.at(-1)?.content.includes(
        "Computer sind verbunden.",
      );
      return Promise.resolve(Response.json({
        choices: [{ message: { content: longReply, finish_reason: "stop" } }],
        usage: { cost: 0.001 },
      }));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await classroomHandler.POST!(
      new Request("https://bud-e.ai/api/classroom", {
        method: "POST",
        headers: {
          origin: "https://bud-e.ai",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "chat",
          slug: "rechercheraum",
          messages: [{ role: "user", content: "#wikipedia: Rechnernetz" }],
        }),
      }),
      {} as never,
    );
    const result = await response.json();
    assert(response.status === 200, `research chat failed: ${result.error}`);
    assert(contextReachedModel, "search result did not reach model");
    assert(
      result.reply === longReply,
      "long code response was silently shortened",
    );
    assert(
      result.sources?.[0]?.url.includes("wikipedia.org"),
      "source link missing",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
