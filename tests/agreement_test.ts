import { handler } from "../routes/api/agreement.ts";
import { handler as homeHandler } from "../routes/index.tsx";
import {
  AGREEMENT_COOKIE,
  hasAgreementCookie,
} from "../utils/agreement.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function request(fields: Record<string, string>, origin = "https://school.bud-e.ai") {
  return new Request("https://school.bud-e.ai/api/agreement", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  });
}

Deno.test("consent form works without client JavaScript and returns to the class", async () => {
  const response = await handler.POST!(
    request({ agree: "yes", returnTo: "/maryasis" }),
    {} as never,
  );
  assert(response.status === 303, "successful consent must redirect");
  assert(response.headers.get("location") === "/maryasis", "wrong return path");
  const cookie = response.headers.get("set-cookie") ?? "";
  assert(cookie.startsWith(`${AGREEMENT_COOKIE}=1;`), "consent cookie missing");
  assert(cookie.includes("HttpOnly") && cookie.includes("Secure"), "cookie flags missing");
  const nextPage = new Request("https://school.bud-e.ai/maryasis", {
    headers: { cookie: cookie.split(";")[0] },
  });
  assert(hasAgreementCookie(nextPage), "next page did not recognise consent");
});

Deno.test("consent form refuses missing tick and unsafe redirects", async () => {
  const missingTick = await handler.POST!(
    request({ returnTo: "/maryasis" }),
    {} as never,
  );
  assert(missingTick.status === 400, "unchecked form was accepted");
  const external = await handler.POST!(
    request({ agree: "yes", returnTo: "https://other.example/" }),
    {} as never,
  );
  assert(external.status === 400, "external redirect was accepted");
  const foreignOrigin = await handler.POST!(
    request({ agree: "yes", returnTo: "/maryasis" }, "https://other.example"),
    {} as never,
  );
  assert(foreignOrigin.status === 403, "foreign website set consent");
});

Deno.test("home route reads the request cookie before rendering", async () => {
  const response = await homeHandler.GET!(
    new Request("https://school.bud-e.ai/?lang=de", {
      headers: { cookie: `${AGREEMENT_COOKIE}=1` },
    }),
    { render: (data: unknown) => Response.json(data) } as never,
  );
  const data = await response.json();
  assert(data.lang === "de", "home route lost the language");
  assert(data.initialAgreed === true, "home route lost the consent cookie");
});

Deno.test("shared learning path survives first-time agreement", async () => {
  const path = "/?lernpfad=informatik/m2-rechnernetze/woher-kommen-webseiten";
  const home = await homeHandler.GET!(
    new Request(`https://school.bud-e.ai${path}`),
    { render: (data: unknown) => Response.json(data) } as never,
  );
  assert((await home.json()).returnTo === path, "home did not preserve link");
  const accepted = await handler.POST!(
    request({ agree: "yes", returnTo: path }),
    {} as never,
  );
  assert(accepted.status === 303, "shared link agreement failed");
  assert(accepted.headers.get("location") === path, "shared link was lost");
  const unsafe = await handler.POST!(
    request({ agree: "yes", returnTo: `${path}&next=https://evil.example` }),
    {} as never,
  );
  assert(unsafe.status === 400, "unsafe agreement redirect was accepted");
});
