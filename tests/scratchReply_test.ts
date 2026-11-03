import { assert, assertEquals, assertRejects } from "$std/assert/mod.ts";
import {
  inspectScratchReply,
  parseScratchProposal,
  scratchRepairMessages,
} from "../utils/scratchTools.ts";
import { resolveScratchReply } from "../utils/scratchReply.ts";

const plan = {
  action: "propose",
  revision: 3,
  summary: "Hallo",
  scripts: [{
    targetId: "real-cat",
    blocks: [
      { opcode: "event_whenflagclicked" },
      { opcode: "looks_say", inputs: { MESSAGE: "Miau {ja}!" } },
    ],
  }],
};
const command = JSON.stringify({ scratch: plan });

Deno.test("Scratch: vollständige Router-JSON-Varianten werden erkannt und geprüft", () => {
  for (
    const reply of [
      command,
      "Hier kommt es:\n```JSON\n" + command + "\n```",
      JSON.stringify(command),
      JSON.stringify(plan),
      JSON.stringify({ tool: "scratch", arguments: plan }),
      JSON.stringify({ name: "scratch", arguments: JSON.stringify(plan) }),
      command.replace(/"scratch":/, "scratch:").replace(/}}]}/, "}}]},"),
      "{scratch: " + JSON.stringify(plan) + ",}",
      command.replace(/"/g, "'"),
    ]
  ) {
    assertEquals(parseScratchProposal(reply)?.revision, 3, reply);
  }
  assert(inspectScratchReply(command.slice(0, -1)).attempted);
  assertEquals(parseScratchProposal(command.slice(0, -1)), null);
  assertEquals(parseScratchProposal(command + '\n{"scratch":'), null);
  assertEquals(
    parseScratchProposal(
      command + "\n" + JSON.stringify({ scratch: { ...plan, revision: 4 } }),
    ),
    null,
  );
  assertEquals(
    parseScratchProposal(JSON.stringify({ scratch: plan, python: "run" })),
    null,
  );
  assertEquals(
    parseScratchProposal(
      JSON.stringify({ tool: "scratch", arguments: plan, python: "run" }),
    ),
    null,
  );
  assertEquals(
    parseScratchProposal(
      JSON.stringify({
        scratch: {
          ...plan,
          scripts: [{
            targetId: "real-cat",
            blocks: [{ opcode: "javascript" }],
          }],
        },
      }),
    ),
    null,
  );
});

Deno.test("Scratch: Reparatur bleibt unter dem Zwölf-Nachrichten-Limit und nennt den Fehler", () => {
  const messages = scratchRepairMessages(
    Array.from(
      { length: 30 },
      (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: `Nachricht ${i}`,
      }),
    ),
    command,
    "Die Figur existiert nicht.",
    true,
  );
  assertEquals(messages.length, 12);
  assertEquals(messages.at(-1)?.role, "user");
  assert(
    String(messages.at(-1)?.content).includes("Die Figur existiert nicht."),
  );
  assert(String(messages.at(-1)?.content).includes("aktuelle revision"));
});

Deno.test("Scratch: zwei gezielte Korrekturen, danach genau eine bestätigte Änderung", async () => {
  let repairs = 0, prepares = 0, applies = 0;
  const receipt = await resolveScratchReply("Ich kann das leider nicht.", {
    directEdit: true,
    allowed: () => true,
    prepare: () => {
      prepares++;
      if (prepares === 1) {
        return Promise.reject(new Error("Figur-ID existiert nicht"));
      }
      return Promise.resolve("Vorschau");
    },
    apply: () => {
      applies++;
      return Promise.resolve();
    },
    repair: (_reply, error) => {
      repairs++;
      assert(error.includes(repairs === 1 ? "vollständige" : "Figur-ID"));
      return Promise.resolve(command);
    },
  });
  assert(receipt?.startsWith("Dein Scratch-Projekt wurde"));
  assertEquals([repairs, prepares, applies], [2, 2, 1]);
});

Deno.test("Scratch: ungültige Antworten enden klar, Vorschau und Lesefragen ändern nichts", async () => {
  let repairs = 0, applies = 0;
  const options = {
    directEdit: true,
    allowed: () => true,
    prepare: () => Promise.resolve("Vorschau"),
    apply: () => {
      applies++;
      return Promise.resolve();
    },
    repair: () => {
      repairs++;
      return Promise.resolve("leider nein");
    },
  };
  await assertRejects(
    () => resolveScratchReply("leider nein", options),
    Error,
    "nach zwei Korrekturversuchen",
  );
  assertEquals([repairs, applies], [2, 0]);
  assertEquals(
    await resolveScratchReply("Eine Erklärung", {
      ...options,
      directEdit: false,
    }),
    null,
  );
  assertEquals(
    await resolveScratchReply(JSON.stringify(plan), {
      ...options,
      directEdit: false,
    }),
    "Vorschau",
  );
  assertEquals(applies, 0);
  await assertRejects(
    () =>
      resolveScratchReply('{"scratch":{"action":"propose"}}', {
        ...options,
        directEdit: false,
      }),
    Error,
    "nach zwei Korrekturversuchen",
  );
  assertEquals(applies, 0);
  await assertRejects(
    () => resolveScratchReply(command, { ...options, allowed: () => false }),
    Error,
    "Freigabe",
  );
  assertEquals(applies, 0);
});

Deno.test("Scratch: einen möglicherweise angewendeten Auftrag bei Timeout nie wiederholen", async () => {
  let applies = 0, repairs = 0;
  await assertRejects(
    () =>
      resolveScratchReply(command, {
        directEdit: true,
        allowed: () => true,
        prepare: () => Promise.resolve("Vorschau"),
        apply: () => {
          applies++;
          return Promise.reject(new Error("Timeout"));
        },
        repair: () => {
          repairs++;
          return Promise.resolve(command);
        },
      }),
    Error,
    "Timeout",
  );
  assertEquals([applies, repairs], [1, 0]);
});
