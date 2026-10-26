import { Handlers } from "$fresh/server.ts";

const file = new URL("../../static/webserver-test/buddy.html", import.meta.url);

export const handler: Handlers = {
  async GET() {
    try {
      return new Response(await Deno.readFile(file), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": 'attachment; filename="buddy.html"',
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response("buddy.html ist gerade nicht verfügbar.", {
        status: 404,
      });
    }
  },
};
