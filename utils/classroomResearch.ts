export type ResearchSource = { title: string; url: string; snippet: string };
export type ResearchReport = {
  kind: "wikipedia" | "papers";
  query: string;
  at: string;
  error?: string;
  requests: Array<
    { url: string; status: number; body: string; truncated: boolean }
  >;
};
export type ResearchCommand = {
  kind: "wikipedia" | "papers";
  query: string;
  language: "de" | "en";
};

export function parseResearchCommand(text: string): ResearchCommand | null {
  const match = text.match(
    /#(wikipedia(?:_(?:de|en))?|papers)\s*:\s*([^#\r\n]{1,160})/i,
  );
  if (!match) return null;
  const query = match[2].trim().replace(/[.!?]+$/, "").trim();
  if (!query) return null;
  const tag = match[1].toLowerCase();
  return {
    kind: tag === "papers" ? "papers" : "wikipedia",
    query,
    language: tag === "wikipedia_en" ? "en" : "de",
  };
}

export async function fetchResearchJson(
  url: URL,
  report?: ResearchReport,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Bud-E/1.0 (educational research; https://bud-e.ai)",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    report?.requests.push({
      url: url.href,
      status: 0,
      body: "Keine HTTP-Antwort erhalten.",
      truncated: false,
    });
    throw error;
  }
  const body = await response.text();
  report?.requests.push({
    url: url.href,
    status: response.status,
    body: body.slice(0, 60_000),
    truncated: body.length > 60_000,
  });
  if (!response.ok) {
    throw new Error(`Recherchequelle antwortet mit ${response.status}.`);
  }
  const data = JSON.parse(body);
  if (!data || typeof data !== "object") {
    throw new Error("Die Recherchequelle hat keine gültige Antwort geliefert.");
  }
  return data;
}

export async function researchSources(
  command: ResearchCommand,
  report?: ResearchReport,
): Promise<ResearchSource[]> {
  if (command.kind === "wikipedia") {
    const base = `https://${command.language}.wikipedia.org/w/api.php`;
    const search = new URL(base);
    search.search = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: command.query,
      srlimit: "3",
      format: "json",
    }).toString();
    const result = await fetchResearchJson(search, report);
    const hits = (result.query as { search?: unknown[] } | undefined)?.search;
    const titles = (Array.isArray(hits) ? hits : []).flatMap((item) => {
      const title = (item as { title?: unknown })?.title;
      return typeof title === "string" && title ? [title] : [];
    }).slice(0, 3);
    if (!titles.length) return [];
    const extract = new URL(base);
    extract.search = new URLSearchParams({
      action: "query",
      prop: "extracts",
      titles: titles.join("|"),
      exintro: "true",
      explaintext: "true",
      redirects: "1",
      format: "json",
    }).toString();
    const details = await fetchResearchJson(extract, report);
    const pages =
      (details.query as { pages?: Record<string, unknown> } | undefined)
        ?.pages ?? {};
    const byTitle = new Map<string, ResearchSource>();
    for (const raw of Object.values(pages)) {
      const page = raw as { title?: unknown; extract?: unknown };
      if (typeof page.title !== "string") continue;
      byTitle.set(page.title.toLowerCase(), {
        title: page.title.slice(0, 160),
        url: `https://${command.language}.wikipedia.org/wiki/${
          encodeURIComponent(page.title.replaceAll(" ", "_"))
        }`,
        snippet: typeof page.extract === "string"
          ? page.extract.slice(0, 900)
          : "Keine Kurzbeschreibung verfügbar.",
      });
    }
    const ordered = titles.flatMap((title) => {
      const found = byTitle.get(title.toLowerCase());
      return found ? [found] : [];
    });
    return ordered.length ? ordered : [...byTitle.values()].slice(0, 3);
  }
  const url = new URL("https://api.ask.orkg.org/index/search");
  url.searchParams.set("query", command.query);
  url.searchParams.set("limit", "12");
  const result = await fetchResearchJson(url, report);
  const items = (result.payload as { items?: unknown[] } | undefined)?.items;
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const paper = item as {
      title?: unknown;
      abstract?: unknown;
      doi?: unknown;
      authors?: unknown;
    };
    if (
      typeof paper.title !== "string" ||
      typeof paper.abstract !== "string" ||
      typeof paper.doi !== "string"
    ) return [];
    const doi = paper.doi.trim().replace(
      /^https?:\/\/(?:dx\.)?doi\.org\//i,
      "",
    );
    if (!/^10\.\d{4,9}\/\S{1,200}$/.test(doi)) return [];
    const authors = Array.isArray(paper.authors)
      ? paper.authors.filter((name): name is string => typeof name === "string")
        .slice(0, 5).join(", ")
      : "";
    return [{
      title: paper.title.slice(0, 160),
      url: `https://doi.org/${encodeURI(doi)}`,
      snippet: `${
        authors ? `Autorinnen und Autoren: ${authors}. ` : ""
      }${paper.abstract}`.slice(0, 900),
    }];
  }).slice(0, 3);
}

export async function researchWithReport(
  command: ResearchCommand,
): Promise<{ sources: ResearchSource[]; report: ResearchReport }> {
  const report: ResearchReport = {
    kind: command.kind,
    query: command.query,
    at: new Date().toISOString(),
    requests: [],
  };
  try {
    const sources = await researchSources(command, report);
    if (!sources.length) {
      report.error =
        "Keine passenden Quellen gefunden. Es werden keine Treffer erfunden.";
    }
    return { sources, report };
  } catch (error) {
    report.error = error instanceof Error
      ? error.message
      : "Die Recherchequelle ist nicht erreichbar.";
    return { sources: [], report };
  }
}

export function researchContext(sources: ResearchSource[]): string {
  return sources.map((source, i) =>
    `[${i + 1}] ${source.title}\n${source.url}\n${source.snippet}`
  ).join("\n\n").slice(0, 4_500);
}
