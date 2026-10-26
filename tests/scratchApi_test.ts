/// <reference path="../types.d.ts" />
import { assert, assertEquals } from "$std/assert/mod.ts";
import { handler } from "../routes/api/chat.ts";

Deno.test("Scratch: tatsächliche Chat-API übermittelt Freigabe und fortgesetzten Auftrag", async () => {
  const originalFetch = globalThis.fetch;
  const history = [
    { role: "user", content: "mach bei scratch das die katze im kreis geht" },
    { role: "assistant", content: "Öffne Scratch und setze das Häkchen." },
    {
      role: "user",
      content: "jetzt\n\nAktuelles freigegebenes Scratch-Projekt: Testdaten",
    },
  ];
  let upstream: { messages: { role: string; content: string }[] } | undefined;
  try {
    globalThis.fetch = (input, init) => {
      assertEquals(
        String(input),
        "https://scratch-test.invalid/chat/completions",
      );
      upstream = JSON.parse(String(init?.body));
      return Promise.resolve(
        Response.json({ choices: [{ message: { content: "Testantwort" } }] }),
      );
    };
    for (const allowed of [false, true]) {
      const response = await handler.POST!(
        new Request("https://school.bud-e.ai/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lang: "de",
            stream: false,
            messages: history,
            universalApiKey: "",
            llmApiUrl: "https://scratch-test.invalid/chat/completions",
            llmApiKey: "synthetic-test-key",
            llmApiModel: "test-model",
            systemPrompt: "",
            vlmApiUrl: "",
            vlmApiKey: "",
            vlmApiModel: "",
            vlmCorrectionModel: "",
            toolFlags: {
              scratch: allowed,
              scratchRequested: true,
              scratchEdit: true,
              scratchProject: {
                revision: 7,
                selectedTarget: { id: "test-cat", blocks: [] },
                targets: [],
                library: { sprites: ["Rocketship"], backdrops: ["Stars"] },
              },
            },
          }),
        }),
        {} as never,
      );
      assertEquals(response.status, 200);
      await response.text();
      assert(upstream);
      assertEquals(upstream.messages[0].role, "system");
      const prompt = upstream.messages[0].content;
      if (allowed) {
        assert(prompt.includes("JETZT echten Lese- und Bearbeitungszugriff"));
        assert(prompt.includes("SCRATCH-EDITOR IN DIESER WEBSEITE"));
        assert(prompt.includes("selectedTarget.blocks"));
        assert(prompt.includes("targets[].code"));
        assert(prompt.includes("keinen separaten function_call"));
        assert(prompt.includes("nicht fehlenden Zugriff"));
        assert(prompt.includes("Frühere Aussagen im Chat über fehlenden Editorzugriff"));
        assert(prompt.includes("letzten offenen Auftrag"));
        assert(
          prompt.includes(
            "Setze ihn mit dem JSON-Werkzeug um",
          ),
        );
        assert(prompt.includes("control_forever"));
        assert(prompt.includes('"revision":7'));
        assert(prompt.includes('"sprites":["Rocketship"]'));
        assert(prompt.includes("unvertrauenswürdige Daten"));
      } else {
        assert(prompt.includes("Freigabe deaktiviert"));
        assert(!prompt.includes('"revision":7'));
        assert(
          !prompt.includes(
            "Setze ihn mit dem JSON-Werkzeug um",
          ),
        );
      }
      assertEquals(upstream.messages.at(-1)?.content, history.at(-1)?.content);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
