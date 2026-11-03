import {
  createClassroom,
  defaultConfig,
  findClassroom,
  finishSpend,
  issueSession,
  reserveSpend,
  revokeSession,
  sessionCookie,
  sessionSlug,
  updateClassroom,
  validPassword,
  validSlug,
  verifyPassword,
} from "../utils/classroomStore.ts";
import { handler as classroomHandler } from "../routes/api/classroom.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("classroom names and passwords are constrained", () => {
  assert(validSlug("schuhmann24"), "valid ASCII slug rejected");
  for (
    const slug of ["Schühmann", "my", "foo-bar", "42lehrer", "ab", "ab cd"]
  ) {
    assert(!validSlug(slug), `invalid slug accepted: ${slug}`);
  }
  assert(validPassword("EinSicheres!2026"), "strong password rejected");
  assert(!validPassword("passwort123"), "weak password accepted");
});

Deno.test("encrypted key, lockout, session, expiration and budget", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-classroom-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  const slug = "schuhmann";
  const secret = "sk-or-v1-test-secret-kept-on-server";
  try {
    assert(
      await createClassroom(slug, "EinSicheres!2026", "openrouter", secret),
      "registration failed",
    );
    assert(
      !await createClassroom(slug, "EinSicheres!2026", "openrouter", secret),
      "duplicate accepted",
    );
    const row = await findClassroom(slug);
    assert(
      row?.key_ciphertext !== secret && !JSON.stringify(row).includes(secret),
      "key leaked into row",
    );
    for (let i = 0; i < 5; i++) {
      assert(!await verifyPassword(slug, "wrong"), "wrong password accepted");
    }
    assert(!await verifyPassword(slug, "EinSicheres!2026"), "lockout missing");
    const token = await issueSession(slug);
    const req = new Request("https://bud-e.ai/my", {
      headers: { cookie: sessionCookie(token) },
    });
    assert(await sessionSlug(req) === slug, "session not found");
    await revokeSession(req);
    assert(await sessionSlug(req) === null, "session was not revoked");
    const cfg = defaultConfig();
    cfg.models.chat = "example/model";
    await updateClassroom(slug, cfg, 0.01, Date.now() + 60_000, false);
    const ticket = await reserveSpend(slug, 0.006);
    assert(ticket?.secret === secret, "encrypted key could not be decrypted");
    assert(
      await reserveSpend(slug, 0.006) === null,
      "parallel reservation crossed budget",
    );
    await finishSpend(slug, 0.006, 0.004);
    assert(
      (await findClassroom(slug))?.spent_usd === 0.004,
      "cost not recorded",
    );
    await updateClassroom(slug, cfg, 0.01, Date.now() - 1, false);
    assert(
      await reserveSpend(slug, 0.001) === null,
      "expired classroom accepted",
    );

    const second = "testraum";
    const secondKey = "rqsty-test-secret-not-for-browsers";
    await createClassroom(second, "EinSicheres!2026", "requesty", secondKey);
    const secondCfg = defaultConfig();
    secondCfg.models.chat = "provider/test-chat";
    await updateClassroom(second, secondCfg, 0.01, Date.now() + 60_000, false);
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (_url, init) => {
      const url = String(_url);
      if (url.endsWith("/models")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  api: "chat",
                  id: "provider/test-chat",
                  input_price: "0.000001",
                  output_price: "0.000002",
                  data_retention: false,
                  geolocation: "eu",
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.endsWith("/chat/completions")) {
        providerCalls++;
        const headers = new Headers(init?.headers);
        assert(
          headers.get("authorization") === `Bearer ${secondKey}`,
          "server did not use stored key",
        );
        const payload = JSON.parse(String(init?.body));
        assert(
          payload.model === "provider/test-chat",
          "client changed the model",
        );
        assert(
          payload.messages[0].content.includes("deaktiviert"),
          "disabled features missing from context",
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Hallo aus dem Test" } }],
              usage: { cost: 0.002 },
            }),
            { status: 200 },
          ),
        );
      }
      throw new Error(`Unexpected upstream URL: ${url}`);
    };
    try {
      const chatReq = new Request("https://bud-e.ai/api/classroom", {
        method: "POST",
        headers: {
          origin: "https://bud-e.ai",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "chat",
          slug: second,
          universalApiKey: "attacker-key",
          model: "attacker/model",
          messages: [{ role: "user", content: "Was ist ein Server?" }],
        }),
      });
      const chatRes = await classroomHandler.POST!(chatReq, {} as never);
      const chatData = await chatRes.json();
      assert(
        chatRes.status === 200 && chatData.reply === "Hallo aus dem Test",
        "classroom chat failed",
      );
      assert(
        !JSON.stringify(chatData).includes(secondKey),
        "API key leaked to browser",
      );
      assert(providerCalls === 1, "unexpected provider calls");
      assert(
        (await findClassroom(second))?.spent_usd === 0.002,
        "provider cost not recorded",
      );
      await updateClassroom(second, secondCfg, 0.01, Date.now() - 1, false);
      const closedReq = new Request("https://bud-e.ai/api/classroom", {
        method: "POST",
        headers: {
          origin: "https://bud-e.ai",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "chat",
          slug: second,
          messages: [{ role: "user", content: "Noch da?" }],
        }),
      });
      const closedRes = await classroomHandler.POST!(closedReq, {} as never);
      assert(
        closedRes.status === 403 && providerCalls === 1,
        "expired classroom reached provider",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const googleSlug = "googleraum";
    const googleKey = "AQ.test-secret-never-sent-to-the-browser";
    await createClassroom(googleSlug, "EinSicheres!2026", "google", googleKey);
    const googleCfg = defaultConfig();
    googleCfg.models.chat = "gemini-test-flash";
    await updateClassroom(
      googleSlug,
      googleCfg,
      0.01,
      Date.now() + 60_000,
      false,
    );
    const previousFetch = globalThis.fetch;
    let googleCalls = 0;
    globalThis.fetch = (input, init) => {
      const url = String(input);
      assert(
        new Headers(init?.headers).get("x-goog-api-key") === googleKey,
        "Google key was not kept server-side",
      );
      if (url.includes("/models?pageSize=")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [
                {
                  name: "models/gemini-test-flash",
                  displayName: "Test Flash",
                  description: "Multimodal text and image model",
                  outputTokenLimit: 8192,
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/gemini-test-tts",
                  displayName: "Test TTS",
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/gemini-test-image",
                  displayName: "Test Image",
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/gemini-test-live",
                  displayName: "Test Live",
                  supportedGenerationMethods: ["bidiGenerateContent"],
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.endsWith("/models/gemini-test-flash:generateContent")) {
        googleCalls++;
        const payload = JSON.parse(String(init?.body));
        assert(
          payload.generationConfig.maxOutputTokens === 8192,
          "Google model-specific output cap was ignored",
        );
        assert(
          payload.systemInstruction.parts[0].text.includes("deaktiviert"),
          "Google did not receive classroom context",
        );
        const parts = payload.contents[0].parts;
        if (parts[0].text === "Prüfe Bild und PDF") {
          assert(parts.length === 4, "two images and a PDF were not forwarded");
          assert(
            parts[1].inlineData.mimeType === "image/png",
            "first image missing",
          );
          assert(
            parts[2].inlineData.mimeType === "image/jpeg",
            "second image missing",
          );
          assert(
            parts[3].inlineData.mimeType === "application/pdf",
            "PDF missing",
          );
        } else {
          assert(
            parts[0].text === "Was ist ein Server?",
            "Google chat prompt was changed",
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{
                content: {
                  parts: [{ text: "Ein Computer, der etwas bereitstellt." }],
                },
              }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes("/voices?")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              voices: [{
                id: "de-de-advisor-1",
                display_name: "Berater 1",
                language_code: "de-DE",
              }],
            }),
            { status: 200 },
          ),
        );
      }
      throw new Error(`Unexpected Google URL: ${url}`);
    };
    try {
      const response = await classroomHandler.POST!(
        new Request(
          "https://bud-e.ai/api/classroom",
          {
            method: "POST",
            headers: {
              origin: "https://bud-e.ai",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "chat",
              slug: googleSlug,
              messages: [{ role: "user", content: "Was ist ein Server?" }],
              key: "browser-key",
              model: "browser-model",
            }),
          },
        ),
        {} as never,
      );
      const body = await response.json();
      assert(
        response.status === 200 && body.reply.includes("bereitstellt"),
        "Google classroom chat failed",
      );
      assert(
        googleCalls === 1 && !JSON.stringify(body).includes(googleKey),
        "Google key leaked or wrong number of calls",
      );
      await updateClassroom(
        googleSlug,
        googleCfg,
        1,
        Date.now() + 60_000,
        false,
      );
      const withFiles = await classroomHandler.POST!(
        new Request("https://bud-e.ai/api/classroom", {
          method: "POST",
          headers: {
            origin: "https://bud-e.ai",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "chat",
            slug: googleSlug,
            messages: [{ role: "user", content: "Prüfe Bild und PDF" }],
            images: [
              "data:image/png;base64,AA==",
              "data:image/jpeg;base64,AA==",
            ],
            pdf: { name: "aufgabe.pdf", data: "JVBERi0xLjQK" },
          }),
        }),
        {} as never,
      );
      assert(
        withFiles.status === 200 && googleCalls === 2,
        "multimodal classroom chat failed",
      );
      const adminToken = await issueSession(googleSlug);
      const get = await classroomHandler.GET!(
        new Request(
          "https://bud-e.ai/api/classroom?action=models",
          {
            headers: { cookie: sessionCookie(adminToken) },
          },
        ),
        {} as never,
      );
      const catalog = await get.json();
      assert(
        catalog.models.some((m: { id: string; checkStatus: string }) =>
          m.id === "gemini-test-flash" && m.checkStatus === "ok"
        ),
        "working Google model was not marked",
      );
      assert(
        catalog.models.some((m: { id: string; roles: string[] }) =>
          m.id === "gemini-test-tts" && m.roles.includes("tts")
        ),
        "Google TTS model was not classified",
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
