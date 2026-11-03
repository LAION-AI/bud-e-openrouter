import { Handlers } from "$fresh/server.ts";
import {
  fetchResearchJson,
  type ResearchReport,
} from "../../utils/classroomResearch.ts";

const PAPERS_API_URL = "https://api.ask.orkg.org/index/search";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export const handler: Handlers = {
  async GET(req: Request) {
    try {
      const url = new URL(req.url);
      const query = url.searchParams.get("query");
      const limit = parseInt(url.searchParams.get("limit") || "5", 10);

      if (!query) {
        throw new Error("Query parameter is required");
      }

      const response = await fetch(
        `${PAPERS_API_URL}?query=${encodeURIComponent(query)}&limit=${limit}`,
        {
          headers: { "accept": "application/json" },
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error in papers API:", error);
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },

  async POST(req: Request) {
    let research: ResearchReport | undefined;
    try {
      const payload = await req.json();
      if (!payload.query) {
        throw new Error("Query parameter is required");
      }

      const top_n = payload.limit || 5;

      if (payload.transparent) {
        research = {
          kind: "papers",
          query: String(payload.query).slice(0, 160),
          at: new Date().toISOString(),
          requests: [],
        };
      }
      const data = await fetchResearchJson(
        new URL(
          `${PAPERS_API_URL}?query=${encodeURIComponent(payload.query)}&limit=${
            top_n * 4
          }`,
        ),
        research,
      ) as unknown as PapersResponse;

      if (!data.payload) {
        throw new Error("Invalid response from papers API");
      }

      data.payload.items = data.payload.items.filter((item: PapersItem) => {
        return item.abstract && item.title && item.doi && item.date_published;
      });

      data.payload.items = data.payload.items.slice(0, top_n);

      if (research && !data.payload.items.length) {
        research.error = "Keine passenden Quellen gefunden.";
      }
      return new Response(
        JSON.stringify({ ...data, ...(research ? { research } : {}) }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("Error in papers API:", error);
      if (research) research.error = getErrorMessage(error);
      return new Response(
        JSON.stringify({ error: getErrorMessage(error), research }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};
