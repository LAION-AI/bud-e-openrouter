import { assert, assertEquals } from "$std/assert/mod.ts";
import { handler } from "../routes/api/personal.ts";
import {
  encryptPersonal,
  fromBase64,
  personalKeys,
  toBase64,
} from "../utils/personalCrypto.ts";
import { personalDefaults } from "../utils/personalClient.ts";

Deno.test("personal API: ciphertext-only registration, authenticated reads, cross-room isolation, CSRF and conflict responses", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "bude-personal-api-test-",
  });
  Deno.env.set("CLASSROOM_DATA_DIR", directory);
  const slug = "testprivat",
    salt = "c".repeat(32),
    keys = await personalKeys("TestPasswort!2026", slug, salt);
  const initial = {
    version: 1,
    settings: { ...personalDefaults(), key: "synthetic-key-stays-encrypted" },
    chats: [],
    active: "",
  };
  const cipher = await encryptPersonal(keys.key, slug, "index", initial);
  const request = (
    method: string,
    data?: unknown,
    cookie = "",
    origin = "https://bud-e.ai",
    query = "",
  ) =>
    new Request("https://bud-e.ai/api/personal" + query, {
      method,
      headers: {
        origin,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const call = async (method: "GET" | "POST" | "PUT", req: Request) =>
    await handler[method]!(req, {} as never);
  try {
    let response = await call(
      "POST",
      request("POST", {
        action: "register",
        slug,
        salt,
        auth: keys.auth,
        value: toBase64(cipher),
        password: "MUST NOT BE ACCEPTED",
      }),
    );
    assertEquals(response.status, 400);
    response = await call(
      "POST",
      request(
        "POST",
        {
          action: "register",
          slug,
          salt,
          auth: keys.auth,
          value: toBase64(cipher),
        },
        "",
        "https://evil.invalid",
      ),
    );
    assertEquals(response.status, 403);
    response = await call(
      "POST",
      request("POST", {
        action: "register",
        slug,
        salt,
        auth: keys.auth,
        value: toBase64(cipher),
      }),
    );
    assertEquals(response.status, 200);
    const cookie = response.headers.get("set-cookie")!;
    assert(cookie.includes("HttpOnly") && cookie.includes("Secure"));
    response = await call(
      "GET",
      request("GET", undefined, "", undefined, "?action=public&slug=" + slug),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).salt, salt);
    response = await call(
      "GET",
      request("GET", undefined, "", undefined, "?slug=" + slug),
    );
    assertEquals(response.status, 401);
    response = await call(
      "GET",
      request("GET", undefined, cookie, undefined, "?slug=otherroom"),
    );
    assertEquals(response.status, 401);
    response = await call(
      "GET",
      request(
        "GET",
        undefined,
        cookie,
        undefined,
        "?slug=" + slug + "&id=index",
      ),
    );
    assertEquals(response.status, 200);
    const saved = await response.json();
    assertEquals(fromBase64(saved.value), cipher);
    assert(!JSON.stringify(saved).includes(initial.settings.key));
    response = await call(
      "PUT",
      request("PUT", {
        slug,
        writes: [{ id: "index", revision: 0, value: toBase64(cipher) }],
      }, cookie),
    );
    assertEquals(response.status, 409);
    response = await call(
      "PUT",
      request(
        "PUT",
        {
          slug,
          writes: [{ id: "index", revision: 1, value: toBase64(cipher) }],
        },
        cookie,
        "https://evil.invalid",
      ),
    );
    assertEquals(response.status, 403);
    response = await call(
      "PUT",
      request("PUT", {
        slug,
        writes: [{ id: "index", revision: 1, value: toBase64(cipher) }],
      }, cookie),
    );
    assertEquals(response.status, 200);
    response = await call(
      "POST",
      request("POST", { action: "logout" }, cookie),
    );
    assertEquals(response.status, 200);
    response = await call(
      "GET",
      request("GET", undefined, cookie, undefined, "?slug=" + slug),
    );
    assertEquals(response.status, 401);
    response = await call(
      "POST",
      request("POST", { action: "login", slug, auth: keys.auth }),
    );
    assertEquals(response.status, 200);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
