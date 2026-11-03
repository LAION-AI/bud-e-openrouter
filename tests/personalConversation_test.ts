import { assert, assertEquals, assertThrows } from "$std/assert/mod.ts";
import type {
  PersonalChat,
  PersonalChatMeta,
  PersonalIndex,
  PersonalMessage,
} from "../utils/personalClient.ts";
import { personalDefaults } from "../utils/personalClient.ts";
import {
  personalBranch,
  personalChatIndex,
  personalChatTree,
  personalGeneration,
  personalUnusedImages,
} from "../utils/personalConversation.ts";
import {
  personalModelChoices,
  personalModelVendor,
} from "../utils/personalModelSelection.ts";
import type { PersonalModel } from "../utils/personalProviders.ts";

const message = (
  id: string,
  role: PersonalMessage["role"],
  text = id,
  images: string[] = [],
): PersonalMessage => ({ id, role, text, images, createdAt: 1 });
const source: PersonalChat = {
  id: "chat:original",
  messages: [
    message("q1", "user"),
    message("a1", "assistant"),
    message("q2", "user"),
    message("a2", "assistant", "Bild", ["img:shared"]),
    message("q3", "user"),
    message("a3", "assistant"),
  ],
};

Deno.test("personal branches preserve original, exclude future, and edit only the selected user message", () => {
  const before = structuredClone(source);
  const fork = personalBranch(source, "a1", "branch");
  assert(fork.id !== source.id);
  assertEquals(fork.messages.map((m) => m.id), ["q1", "a1"]);
  assertEquals(fork.branch, {
    chatId: source.id,
    messageId: "a1",
    kind: "branch",
  });
  const edited = personalBranch(source, "q2", "edit", "  Neue Idee  ");
  assertEquals(edited.messages.length, 3);
  assertEquals(edited.messages.at(-1)!.text, "Neue Idee");
  assert(edited.messages.at(-1)!.id !== "q2");
  edited.messages[0].images.push("img:only-in-fork");
  assertEquals(source, before);
  assertThrows(() => personalBranch(source, "a1", "edit", "nein"));
  assertThrows(() => personalBranch(source, "q1", "edit", " "));
  assertThrows(() => personalBranch(source, "missing", "branch"));
});
Deno.test("personal regeneration excludes old response without duplicating prompt and retains image action", () => {
  const regenerated = personalBranch(source, "a2", "regenerate");
  assertEquals(regenerated.messages.map((m) => m.id), ["q1", "a1", "q2"]);
  assertEquals(personalGeneration(source, "a2"), "image");
  assertEquals(personalGeneration(source, "q2"), "image");
  assertEquals(personalGeneration(source, "a1"), "chat");
  assertThrows(() => personalBranch(source, "q2", "regenerate"));
  assertThrows(() =>
    personalBranch(
      { id: "x", messages: [message("only", "assistant")] },
      "only",
      "regenerate",
    )
  );
});
Deno.test("personal branch index keeps ancestry after continuation; tree renders nesting, orphans and cycles once", () => {
  const fork = personalBranch(source, "a2", "branch");
  const index: PersonalIndex = {
    version: 1,
    settings: personalDefaults(),
    active: source.id,
    chats: [{ id: source.id, title: "Original", updatedAt: 1 }],
  };
  const next = personalChatIndex(index, fork);
  assertEquals(
    personalChatIndex(next, {
      ...fork,
      messages: [...fork.messages, message("new", "user")],
    }).chats[0].branch,
    fork.branch,
  );
  const nested = personalBranch(fork, "a2", "branch");
  const final = personalChatIndex(next, nested);
  const tree = personalChatTree(final.chats);
  assertEquals(tree.map((row) => row.chat.id), [source.id, fork.id, nested.id]);
  assertEquals(tree.map((row) => row.depth), [0, 1, 2]);
  const cycle = (id: string, parent: string): PersonalChatMeta => ({
    id,
    title: id,
    updatedAt: 1,
    branch: { chatId: parent, messageId: "x", kind: "branch" },
  });
  assertEquals(
    personalChatTree([cycle("a", "b"), cycle("b", "a"), cycle("c", "deleted")])
      .length,
    3,
  );
  assertEquals(personalChatTree([cycle("c", "deleted")])[0].depth, 0);
});
Deno.test("personal branch images are retained until their last conversation is removed", () => {
  const fork = personalBranch(source, "a2", "branch");
  assertEquals(personalUnusedImages(source, [fork]), []);
  assertEquals(
    personalUnusedImages(source, [personalBranch(source, "a1", "branch")]),
    ["img:shared"],
  );
  assertEquals(personalUnusedImages(fork, []), ["img:shared"]);
});
const model = (
  id: string,
  name: string,
  free = false,
  roles: PersonalModel["roles"] = ["chat"],
): PersonalModel => ({ id, name, free, roles, vision: false, price: "test" });
const catalog = [
  model("qwen/qwen", "Qwen"),
  model("openai/zeta", "Zeta"),
  model("google/gemini", "Gemini Flash"),
  model("anthropic/claude", "Claude"),
  model("openai/alpha", "Alpha", true),
  model("other/embedded", "The Gemini alternative"),
  model("google/gemini-tts", "Gemini TTS", true, ["tts"]),
];
Deno.test("personal model choices sort by vendor then model, independent of catalog order", () => {
  assertEquals(
    personalModelChoices(catalog, "openrouter", "chat").map((m) => m.id),
    [
      "anthropic/claude",
      "google/gemini",
      "openai/alpha",
      "openai/zeta",
      "other/embedded",
      "qwen/qwen",
    ],
  );
  assertEquals(personalModelVendor(catalog[2], "openrouter"), "Google");
  assertEquals(
    personalModelVendor(model("gemini-4-preview", "Gemini 4"), "google"),
    "Google",
  );
  assertEquals(
    personalModelChoices(catalog, "openrouter", "chat", "", true).map((m) =>
      m.id
    ),
    ["openai/alpha"],
  );
});
Deno.test("personal model search ranks vendor/model prefixes ahead of substrings and supports multiple terms", () => {
  assertEquals(
    personalModelChoices(catalog, "openrouter", "chat", "ope").map((m) => m.id),
    ["openai/alpha", "openai/zeta"],
  );
  assertEquals(
    personalModelChoices(catalog, "openrouter", "chat", " gEm ").map((m) =>
      m.id
    ),
    ["google/gemini", "other/embedded"],
  );
  assertEquals(
    personalModelChoices(catalog, "requesty", "chat", "open al").map((m) =>
      m.id
    ),
    ["openai/alpha"],
  );
  assertEquals(
    personalModelChoices(catalog, "openrouter", "tts", "gem").map((m) => m.id),
    ["google/gemini-tts"],
  );
  assertEquals(
    personalModelChoices(catalog, "openrouter", "chat", "notfound"),
    [],
  );
});
