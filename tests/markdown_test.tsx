import { assert, assertEquals } from "$std/assert/mod.ts";
import {
  default as MarkdownText,
  markdownTokens,
  safeMarkdownHref,
} from "../components/MarkdownText.tsx";
import type { Tokens } from "npm:marked@18.1.0";

export const SCRATCH_INSTRUCTIONS =
  "1. Ziehe **„sage ‚Miau!‘ für 2 Sekunden“** direkt unter den Flaggen-Block.\n2. Darunter setze **„wiederhole 36-mal“**.\n3. In die Wiederholung kommen diese beiden Blöcke:\n   - **„gehe 10 Schritte“**\n   - **„drehe dich um 10 Grad“**";

Deno.test("Markdown: nummerierte Scratch-Aufgabe mit fetten und eingerückten Stichpunkten", () => {
  const tokens = markdownTokens(SCRATCH_INSTRUCTIONS);
  const list = tokens[0] as Tokens.List;
  assertEquals(list.type, "list");
  assertEquals(list.ordered, true);
  assertEquals(list.items.length, 3);
  const text = list.items[0].tokens[0] as Tokens.Text;
  assert(text.tokens?.some((t) => t.type === "strong"));
  const nested = list.items[2].tokens.find((t) =>
    t.type === "list"
  ) as Tokens.List;
  assertEquals(nested.items.length, 2);
  assertEquals(nested.ordered, false);
});
Deno.test("Markdown: aktive URLs abweisen, sichere Links erhalten", () => {
  for (
    const href of [
      "javascript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:evil",
      "file:///etc/passwd",
    ]
  ) assertEquals(safeMarkdownHref(href), null);
  assertEquals(
    safeMarkdownHref("https://example.org/"),
    "https://example.org/",
  );
  assertEquals(safeMarkdownHref("/scratch/NOTICE.txt"), "/scratch/NOTICE.txt");
  assertEquals(
    safeMarkdownHref("mailto:teacher@example.org"),
    "mailto:teacher@example.org",
  );
});
Deno.test("Markdown: Modell-HTML wird nur als inert renderbares Token gelesen", () => {
  assertEquals(markdownTokens("<script>alert(1)</script>")[0].type, "html");
});

Deno.test("Markdown: DOI und normale Links bleiben klickbar, keine Links in Code", () => {
  const links: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const element = node as {
      type?: unknown;
      props?: { href?: string; children?: unknown };
    };
    if (element.type === "a") links.push(element.props!.href!);
    walk(element.props?.children);
  };
  walk(
    MarkdownText({
      text:
        "DOI: 10.1234/abcd.\n\nwww.example.org\n\n`DOI: 10.1234/not-linked`\n\n[DOI: 10.1234/label](https://example.org)",
    }),
  );
  assertEquals(links, [
    "https://doi.org/10.1234/abcd",
    "http://www.example.org",
    "https://example.org",
  ]);
});
