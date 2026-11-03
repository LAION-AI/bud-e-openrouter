import {
  googleGenerateContent,
  googleTranscriptionText,
} from "../utils/googleAi.ts";

Deno.test("Google transcriptions use the audio transcription field", () => {
  const result = googleTranscriptionText({
    candidates: [{
      content: {
        parts: [{ audioTranscription: { text: "Hallo, das ist ein Test." } }],
      },
    }],
  });
  if (result !== "Hallo, das ist ein Test.") {
    throw new Error(`Unerwartetes Transkript: ${result}`);
  }
});

Deno.test("Google daily quota errors explain why another network does not help", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(Response.json({
      error: {
        code: 429,
        message:
          "Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      },
    }, { status: 429 }));
  try {
    let message = "";
    try {
      await googleGenerateContent("test-key", "gemini-3.1-flash-lite", {
        contents: [{ parts: [{ text: "Hallo" }] }],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message.includes("Tageslimit") || !message.includes("Hotspot")) {
      throw new Error(`Unklare Fehlermeldung: ${message}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
