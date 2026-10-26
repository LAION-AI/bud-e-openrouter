import { type ComponentChildren, Fragment } from "preact";
import { marked, type Token, type Tokens } from "npm:marked@18.1.0";

/** Only render trusted element types, never HTML supplied by a model. */
export function markdownTokens(text: string): Token[] {
  return marked.lexer(text, { gfm: true, breaks: true });
}
export function safeMarkdownHref(href: string): string | null {
  try {
    const url = new URL(href, "https://markdown.invalid/");
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}
/** Retain the chat's plain-text DOI links without changing code or link labels. */
function doiText(text: string): ComponentChildren {
  return text.split(/(DOI:\s*10\.\d{4,9}\/[^\s]+)/gi).map((part, key) => {
    if (!/^DOI:\s*10\./i.test(part)) return part;
    const label = part.replace(/[.,;]+$/, "");
    const doi = label.replace(/^DOI:\s*/i, "");
    return (
      <Fragment key={key}>
        <a
          href={`https://doi.org/${doi}`}
          class="text-blue-700 underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {label}
        </a>
        {part.slice(label.length)}
      </Fragment>
    );
  });
}
function inline(tokens: Token[], linkDoi = true): ComponentChildren {
  return tokens.map((token, key) => {
    switch (token.type) {
      case "strong":
        return (
          <strong key={key}>
            {inline((token as Tokens.Strong).tokens, linkDoi)}
          </strong>
        );
      case "em":
        return (
          <em key={key}>{inline((token as Tokens.Em).tokens, linkDoi)}</em>
        );
      case "del":
        return (
          <del key={key}>{inline((token as Tokens.Del).tokens, linkDoi)}</del>
        );
      case "codespan":
        return (
          <code
            key={key}
            class="rounded bg-slate-200 px-1 py-0.5 font-mono text-[0.9em] text-slate-900"
          >
            {(token as Tokens.Codespan).text}
          </code>
        );
      case "br":
        return <br key={key} />;
      case "link": {
        const link = token as Tokens.Link;
        const href = safeMarkdownHref(link.href);
        return href
          ? (
            <a
              key={key}
              href={href}
              title={link.title ?? undefined}
              class="text-blue-700 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {inline(link.tokens, false)}
            </a>
          )
          : <Fragment key={key}>{inline(link.tokens, false)}</Fragment>;
      }
      // Do not fetch untrusted image URLs: uploaded images have their own renderer.
      case "image":
        return <span key={key}>{(token as Tokens.Image).text}</span>;
      case "text": {
        const text = token as Tokens.Text;
        return (
          <Fragment key={key}>
            {text.tokens
              ? inline(text.tokens, linkDoi)
              : linkDoi
              ? doiText(text.text)
              : text.text}
          </Fragment>
        );
      }
      default:
        return <Fragment key={key}>{token.raw}</Fragment>;
    }
  });
}
function blocks(tokens: Token[]): ComponentChildren {
  return tokens.map((token, key) => {
    switch (token.type) {
      case "space":
        return null;
      case "paragraph":
        return (
          <p key={key} class="my-2 first:mt-0 last:mb-0">
            {inline((token as Tokens.Paragraph).tokens)}
          </p>
        );
      case "text":
        return <Fragment key={key}>{inline([token])}</Fragment>;
      case "heading": {
        const heading = token as Tokens.Heading;
        const Tag = `h${heading.depth}` as
          | "h1"
          | "h2"
          | "h3"
          | "h4"
          | "h5"
          | "h6";
        return (
          <Tag
            key={key}
            class={`mb-2 mt-4 font-bold ${
              heading.depth <= 2 ? "text-lg" : "text-base"
            }`}
          >
            {inline(heading.tokens)}
          </Tag>
        );
      }
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, i) => (
          <li key={i} class="my-1 pl-1">
            {item.task && (
              <input
                type="checkbox"
                checked={!!item.checked}
                disabled
                class="mr-2"
              />
            )}
            {blocks(item.tokens)}
          </li>
        ));
        return list.ordered
          ? (
            <ol
              key={key}
              start={typeof list.start === "number" ? list.start : 1}
              class="my-2 list-decimal space-y-1 pl-6"
            >
              {items}
            </ol>
          )
          : <ul key={key} class="my-2 list-disc space-y-1 pl-6">{items}</ul>;
      }
      case "blockquote":
        return (
          <blockquote
            key={key}
            class="my-2 border-l-4 border-slate-300 pl-3 text-slate-700"
          >
            {blocks((token as Tokens.Blockquote).tokens)}
          </blockquote>
        );
      case "hr":
        return <hr key={key} class="my-3 border-slate-300" />;
      case "table": {
        const table = token as Tokens.Table;
        return (
          <div key={key} class="my-2 overflow-x-auto">
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {table.header.map((cell, i) => (
                    <th
                      key={i}
                      class="border border-slate-300 bg-slate-100 p-2 text-left font-semibold"
                    >
                      {inline(cell.tokens)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} class="border border-slate-300 p-2 align-top">
                        {inline(cell.tokens)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "code":
        return (
          <pre
            key={key}
            class="my-2 overflow-x-auto rounded bg-slate-900 p-3 text-sm text-white"
          ><code>{(token as Tokens.Code).text}</code></pre>
        );
      // React/Preact text escaping makes raw HTML inert, including script tags.
      default:
        return <span key={key} class="whitespace-pre-wrap">{token.raw}</span>;
    }
  });
}
export default function MarkdownText({ text }: { text: string }) {
  return (
    <div class="whitespace-normal [overflow-wrap:anywhere]">
      {blocks(markdownTokens(text))}
    </div>
  );
}
