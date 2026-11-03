import { assert, assertEquals, assertThrows } from "$std/assert/mod.ts";
import { personalDefaults } from "../utils/personalClient.ts";
import { GRADING_MODEL_SYSTEM } from "../utils/gradingProtocol.ts";
import {
  personalComplete,
  personalGenerateImage,
  personalModels,
  personalSpeech,
  personalTranscribe,
  providerBase,
} from "../utils/personalProviders.ts";

Deno.test("personal grading PDFs go directly to OpenRouter, Requesty and Google in native file formats", async () => {
  const old = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    assert(!url.includes("bud-e.ai"));
    bodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(
      url.includes("googleapis.com")
        ? Response.json({
          candidates: [{ content: { parts: [{ text: "Abschrift" }] } }],
        })
        : new Response(
          'data: {"choices":[{"delta":{"content":"Abschrift"}}]}\n\ndata: [DONE]\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
  };
  try {
    const settings = {
      ...personalDefaults(),
      key: "synthetic-key",
      models: { chat: "test/vision", tts: "", asr: "", image: "" },
    };
    const messages = [{
      role: "user",
      text: "Lies die Datei",
      pdf: { name: "arbeit.pdf", data: "AAAA" },
    }];
    for (const provider of ["openrouter", "requesty", "google"] as const) {
      assertEquals(
        await personalComplete({
          ...settings,
          provider,
          models: {
            ...settings.models,
            chat: provider === "google"
              ? "gemini-test-vision"
              : settings.models.chat,
          },
        }, messages, undefined, undefined, undefined, 8192, true, GRADING_MODEL_SYSTEM, "transcript"),
        "Abschrift",
      );
    }
    const openrouter = bodies[0] as {
      messages: { content: { type: string; file?: { filename: string } }[] }[];
    };
    assertEquals(
      openrouter.messages[1].content[1].file?.filename,
      "arbeit.pdf",
    );
    const requesty = bodies[1] as {
      messages: { content: { type: string }[] }[];
    };
    assertEquals(requesty.messages[1].content[1].type, "input_file");
    for (const body of bodies.slice(0, 2)) {
      const format = body.response_format as { type: string; json_schema: { strict: boolean } };
      assertEquals(format.type, "json_schema"); assertEquals(format.json_schema.strict, true);
    }
    assertEquals((bodies[2].generationConfig as Record<string, unknown>).responseMimeType, "application/json");
    const google = bodies[2] as {
      contents: { parts: { inlineData?: { mimeType: string } }[] }[];
    };
    assertEquals(
      google.contents[0].parts[1].inlineData?.mimeType,
      "application/pdf",
    );
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("personal provider traffic goes directly to the chosen provider, including chat, image, TTS and ASR", async () => {
  const old = globalThis.fetch,
    calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const settings = {
    ...personalDefaults(),
    key: "synthetic-provider-key",
    enabled: { chat: true, image: true, asr: true, tts: true },
    models: {
      chat: "test/chat",
      image: "test/image",
      asr: "test/asr",
      tts: "test/tts",
    },
  };
  globalThis.fetch = (input, init) => {
    const url = String(input);
    assert(url.startsWith("https://openrouter.ai/api/v1/"));
    assert(!url.includes("bud-e.ai"));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    assertEquals(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-provider-key",
    );
    if (url.endsWith("/audio/speech")) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "audio/mpeg" },
        }),
      );
    }
    if (url.endsWith("/audio/transcriptions")) {
      return Promise.resolve(Response.json({ text: "Testaufnahme" }));
    }
    if (body?.modalities) {
      return Promise.resolve(
        Response.json({
          choices: [{
            message: {
              images: [{ image_url: { url: "data:image/png;base64,AAAA" } }],
            },
          }],
        }),
      );
    }
    return Promise.resolve(
      new Response(
        'data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
  };
  try {
    assertEquals(
      await personalComplete(settings, [{ role: "user", text: "Hallo" }]),
      "Hallo",
    );
    assertEquals(
      (await personalGenerateImage(settings, "Eine Katze"))[0],
      "data:image/png;base64,AAAA",
    );
    assertEquals(
      await personalTranscribe(
        settings,
        new File(["test"], "audio.wav", { type: "audio/wav" }),
      ),
      "Testaufnahme",
    );
    assert((await personalSpeech(settings, "Hallo")).size > 0);
    assertEquals(calls.length, 4);
    assertThrows(() =>
      providerBase({
        ...settings,
        provider: "compatible",
        baseUrl: "http://unsafe.invalid/v1",
      })
    );
    assertThrows(() =>
      providerBase({
        ...settings,
        provider: "compatible",
        baseUrl: "https://bud-e.ai/api",
      })
    );
    assertThrows(() =>
      providerBase({
        ...settings,
        provider: "compatible",
        baseUrl: "https://school.bud-e.ai/api",
      })
    );
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("personal model discovery includes native transcription and does not label media prices as free", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    const model = {
      id: "test/chat",
      name: "Test",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0", completion: "0" },
      context_length: 32000,
    };
    if (url.includes("output_modalities=transcription")) {
      return Promise.resolve(
        Response.json({
          data: [{
            ...model,
            id: "test/native-asr",
            architecture: {
              input_modalities: ["audio"],
              output_modalities: ["transcription"],
            },
          }],
        }),
      );
    }
    if (url === "https://openrouter.ai/api/v1/models") {
      return Promise.resolve(
        Response.json({
          data: [model, {
            ...model,
            id: "test/voice",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["speech"],
            },
          }],
        }),
      );
    }
    if (url.endsWith("/models") || url.includes("?zdr=")) {
      return Promise.resolve(Response.json({ data: [] }));
    }
    return Promise.resolve(
      Response.json({ error: "not listed" }, { status: 404 }),
    );
  };
  try {
    const models = await personalModels({
      ...personalDefaults(),
      key: "synthetic-provider-key",
    }, true);
    assert(
      models.some((model) =>
        model.id === "test/native-asr" && model.roles.includes("asr")
      ),
    );
    assertEquals(
      models.find((model) => model.id === "test/voice")?.free,
      false,
    );
    assertEquals(models.find((model) => model.id === "test/chat")?.free, true);
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("personal Gemini TTS sends instruction and matching voice formats for legacy and future versions", async () => {
  const old = globalThis.fetch;
  let seen: Record<string, unknown> | undefined;
  globalThis.fetch = (input, init) => {
    assert(
      String(input).startsWith("https://generativelanguage.googleapis.com/"),
    );
    seen = JSON.parse(String(init?.body));
    return Promise.resolve(
      Response.json({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: "audio/pcm;rate=24000",
                data: "AAAAAA==",
              },
            }],
          },
        }],
      }),
    );
  };
  try {
    for (
      const model of [
        "gemini-2.5-flash-preview-tts",
        "gemini-3.8-flash-tts",
        "gemini-4.0-flash-tts",
        "gemini-10.1-flash-tts",
      ]
    ) {
      const settings = {
        ...personalDefaults(),
        provider: "google" as const,
        key: "synthetic-google-key",
        voice: "Kore",
        style: "Sprich ganz ruhig.",
        models: { chat: "", tts: model, asr: "", image: "" },
        enabled: { chat: true, tts: true, asr: false, image: false },
      };
      assertEquals((await personalSpeech(settings, "Hallo")).type, "audio/wav");
      const json = JSON.stringify(seen);
      assert(json.includes("Kore") && json.includes("Sprich ganz ruhig."));
      assertEquals(
        json.includes("speech_metadata"),
        !model.startsWith("gemini-2."),
      );
      assertEquals(
        json.includes("prebuiltVoiceConfig"),
        model.startsWith("gemini-2."),
      );
    }
  } finally {
    globalThis.fetch = old;
  }
});
