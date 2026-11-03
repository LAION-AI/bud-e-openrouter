import { Handlers } from "$fresh/server.ts";
import {
  agreementCookie,
  agreementReturnTo,
} from "../../utils/agreement.ts";

export const handler: Handlers = {
  async POST(req) {
    const source = req.headers.get("origin") ?? req.headers.get("referer");
    try {
      if (!source || new URL(source).host !== new URL(req.url).host ||
        new URL(source).protocol !== "https:") {
        return new Response("Ungültige Herkunft.", { status: 403 });
      }
    } catch {
      return new Response("Ungültige Herkunft.", { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return new Response("Ungültiges Formular.", { status: 400 });
    }
    const returnTo = agreementReturnTo(form.get("returnTo"));
    if (form.get("agree") !== "yes" || !returnTo) {
      return new Response("Bitte erst die Nutzungsbedingungen akzeptieren.", {
        status: 400,
      });
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: returnTo,
        "Set-Cookie": agreementCookie(),
        "Cache-Control": "no-store",
      },
    });
  },
};
