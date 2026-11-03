import { assertEquals, assertRejects } from "$std/assert/mod.ts";
import { fetchClassroomPublic } from "../utils/classroomPublic.ts";

Deno.test("public check handles timeout, invalid responses, retry, and cancellation", async () => {
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  await assertRejects(() =>
    fetchClassroomPublic("test", new AbortController().signal, 10, hanging)
  );
  const bad: typeof fetch = () =>
    Promise.resolve(Response.json({ error: "unavailable" }, { status: 503 }));
  await assertRejects(() =>
    fetchClassroomPublic("test", new AbortController().signal, 100, bad)
  );
  const invalid: typeof fetch = () =>
    Promise.resolve(Response.json({ wrong: true }));
  await assertRejects(() =>
    fetchClassroomPublic("test", new AbortController().signal, 100, invalid)
  );
  const ok: typeof fetch = (_input, init) => {
    assertEquals(init?.cache, "no-store");
    return Promise.resolve(Response.json({ exists: true, active: true }));
  };
  assertEquals(
    await fetchClassroomPublic("test", new AbortController().signal, 100, ok),
    { exists: true, active: true },
  );
  const controller = new AbortController();
  const pending = fetchClassroomPublic(
    "test",
    controller.signal,
    1000,
    hanging,
  );
  controller.abort();
  await assertRejects(() => pending);
});
