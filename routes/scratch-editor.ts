import type { Handlers } from "$fresh/server.ts";

/** Static, account-free editor. No project data is accepted by this route. */
export const handler: Handlers = {
  GET() {
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/scratch/vendor/">
<title>Block-Editor – auf Basis von Scratch</title>
<style>html,body,#scratch-app{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif}</style>
</head><body><div id="scratch-app"></div>
<script src="/scratch/vendor/scratch-gui-standalone.js"></script>
<script type="module" src="/scratch/bootstrap.js"></script></body></html>`;
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'self'",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
