import type {
  PersonalBranch,
  PersonalChat,
  PersonalChatMeta,
  PersonalIndex,
} from "./personalClient.ts";

/** Fork a prefix, never mutate the original or copy its future messages. */
export function personalBranch(
  source: PersonalChat,
  messageId: string,
  kind: PersonalBranch["kind"],
  text?: string,
): PersonalChat {
  const at = source.messages.findIndex((message) => message.id === messageId);
  if (at < 0) throw new Error("Die Nachricht wurde nicht gefunden.");
  const message = source.messages[at];
  if (kind === "edit" && message.role !== "user") {
    throw new Error("Nur eigene Nachrichten können bearbeitet werden.");
  }
  if (kind === "regenerate" && message.role !== "assistant") {
    throw new Error("Nur Buddy-Antworten können neu generiert werden.");
  }
  const messages = structuredClone(
    source.messages.slice(0, kind === "regenerate" ? at : at + 1),
  );
  if (kind === "edit") {
    if (
      typeof text !== "string" || text.length > 200000 ||
      (!text.trim() && !message.images.length)
    ) {
      throw new Error("Bitte eine Nachricht bis 200.000 Zeichen eingeben.");
    }
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      text: text.trim(),
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
  }
  if (kind !== "branch" && messages.at(-1)?.role !== "user") {
    throw new Error("Zu dieser Antwort fehlt die vorherige eigene Nachricht.");
  }
  return {
    id: "chat:" + crypto.randomUUID(),
    messages,
    branch: { chatId: source.id, messageId, kind },
  };
}

/** Regeneration uses the original action, not the current composer mode. */
export function personalGeneration(source: PersonalChat, messageId: string) {
  const at = source.messages.findIndex((message) => message.id === messageId);
  if (at < 0) throw new Error("Die Nachricht wurde nicht gefunden.");
  const message = source.messages[at];
  const response = message.role === "assistant"
    ? message
    : source.messages[at + 1]?.role === "assistant"
    ? source.messages[at + 1]
    : undefined;
  return response?.generation ??
    (response?.images.length ? "image" : message.generation ?? "chat");
}

export function personalChatIndex(
  index: PersonalIndex,
  chat: PersonalChat,
): PersonalIndex {
  const meta: PersonalChatMeta = {
    id: chat.id,
    title: chat.messages.find((message) => message.role === "user")?.text.slice(
      0,
      55,
    ) || "Bilder",
    updatedAt: Date.now(),
    ...(chat.branch ? { branch: chat.branch } : {}),
  };
  return {
    ...index,
    active: chat.id,
    chats: [meta, ...index.chats.filter((row) => row.id !== chat.id)],
  };
}

/** Shared JPEG objects stay alive while any remaining branch uses them. */
export function personalUnusedImages(
  removed: PersonalChat,
  remaining: PersonalChat[],
): string[] {
  const retained = new Set(
    remaining.flatMap((chat) =>
      chat.messages.flatMap((message) => message.images)
    ),
  );
  return [...new Set(removed.messages.flatMap((message) => message.images))]
    .filter((id) => !retained.has(id));
}

/** Parents before children, with orphan/cycle protection for imported metadata. */
export function personalChatTree(
  chats: PersonalChatMeta[],
): { chat: PersonalChatMeta; depth: number }[] {
  const ids = new Set(chats.map((chat) => chat.id));
  const children = new Map<string, PersonalChatMeta[]>();
  for (const chat of chats) {
    const parent = chat.branch?.chatId;
    if (parent && parent !== chat.id && ids.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(chat);
      children.set(parent, list);
    }
  }
  const result: { chat: PersonalChatMeta; depth: number }[] = [],
    seen = new Set<string>();
  const visit = (root: PersonalChatMeta) => {
    const stack = [{ chat: root, depth: 0 }];
    while (stack.length) {
      const item = stack.pop()!;
      if (seen.has(item.chat.id)) continue;
      seen.add(item.chat.id);
      result.push(item);
      for (const child of (children.get(item.chat.id) ?? []).toReversed()) {
        stack.push({ chat: child, depth: item.depth + 1 });
      }
    }
  };
  for (const chat of chats) {
    if (
      !chat.branch || !ids.has(chat.branch.chatId) ||
      chat.branch.chatId === chat.id
    ) visit(chat);
  }
  for (const chat of chats) if (!seen.has(chat.id)) visit(chat);
  return result;
}
