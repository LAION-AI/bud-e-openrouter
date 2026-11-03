import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "$std/assert/mod.ts";
import { DatabaseSync } from "node:sqlite";
import {
  decryptPersonal,
  encryptPersonal,
  PERSONAL_KDF_ITERATIONS,
  PERSONAL_QUOTA,
  personalKeys,
  toHex,
} from "../utils/personalCrypto.ts";
import {
  personalCookie,
  PersonalError,
  personalSession,
  PersonalStore,
} from "../utils/personalStore.ts";

const auth = "a".repeat(64), salt = "b".repeat(32);
const packed = (size = 100) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  bytes[0] = 1;
  return bytes;
};
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE classrooms(slug TEXT PRIMARY KEY)");
  return db;
}
Deno.test("personal encryption: password-derived nonextractable keys, independent login secret, fresh nonce and bound object identities", async () => {
  assertEquals(PERSONAL_KDF_ITERATIONS, 600000);
  assertEquals(PERSONAL_QUOTA, 100 * 1024 * 1024);
  const first = await personalKeys("EinLanges!Passwort2026", "privat", salt),
    second = await personalKeys("EinLanges!Passwort2026", "privat", salt);
  assertEquals(first.auth, second.auth);
  assertEquals(first.key.extractable, false);
  await assertRejects(() => crypto.subtle.exportKey("raw", first.key));
  const value = {
    settings: { key: "synthetic-provider-key" },
    messages: ["Privater Text"],
    jpeg: "data:image/jpeg;base64,/9j/",
  };
  const one = await encryptPersonal(first.key, "privat", "index", value),
    two = await encryptPersonal(first.key, "privat", "index", value);
  assert(toHex(one) !== toHex(two));
  assert(!new TextDecoder().decode(one).includes("Privater Text"));
  assertEquals(
    await decryptPersonal(second.key, "privat", "index", one),
    value,
  );
  const wrong = await personalKeys("EinAnderes!Passwort2026", "privat", salt);
  await assertRejects(() => decryptPersonal(wrong.key, "privat", "index", one));
  await assertRejects(() =>
    decryptPersonal(second.key, "anders", "index", one)
  );
  await assertRejects(() =>
    decryptPersonal(
      second.key,
      "privat",
      "chat:12345678-1234-1234-1234-123456789012",
      one,
    )
  );
  const damaged = one.slice();
  damaged[damaged.length - 1] ^= 1;
  await assertRejects(() =>
    decryptPersonal(first.key, "privat", "index", damaged)
  );
});
Deno.test("personal rooms: shared name uniqueness, opaque storage, isolated sessions and five-attempt lockout", () => {
  const db = database(), store = new PersonalStore(db);
  try {
    db.prepare("INSERT INTO classrooms VALUES(?)").run("klasse");
    assertThrows(
      () => store.create("klasse", salt, auth, packed()),
      PersonalError,
    );
    store.create("privat", salt, auth, packed());
    assertThrows(
      () => store.create("privat", salt, auth, packed()),
      PersonalError,
    );
    assertThrows(() =>
      db.prepare("INSERT INTO classrooms VALUES(?)").run("privat")
    );
    const row = db.prepare("SELECT * FROM personal_rooms").get()!;
    assert(!JSON.stringify(row).includes(auth));
    const session = store.login("privat", auth);
    store.authenticate(session, "privat");
    assertThrows(() => store.authenticate(session, "anders"), PersonalError);
    assert(
      personalCookie(session).includes("Secure; HttpOnly; SameSite=Strict"),
    );
    assertEquals(
      personalSession(
        new Request("https://bud-e.ai", {
          headers: { cookie: personalCookie(session) },
        }),
      ),
      session,
    );
    store.logout(session);
    assertThrows(() => store.authenticate(session, "privat"), PersonalError);
    for (let i = 0; i < 5; i++) {
      assertThrows(() => store.login("privat", "c".repeat(64)), PersonalError);
    }
    const locked = assertThrows(
      () => store.login("privat", auth),
      PersonalError,
    );
    assertEquals(locked.status, 429);
  } finally {
    db.close();
  }
});
Deno.test("personal storage: atomic quota checks, revision conflicts, deletes and no silent overwrites", () => {
  const db = database(),
    store = new PersonalStore(db, 600),
    id = "img:12345678-1234-1234-1234-123456789012";
  try {
    store.create("privat", salt, auth, packed(100));
    store.save("privat", [{ id, revision: 0, value: packed(200) }]);
    assertEquals(store.manifest("privat").usedBytes, 300);
    const before = store.read("privat", "index").value;
    assertThrows(
      () =>
        store.save("privat", [{
          id: "index",
          revision: 1,
          value: packed(500),
        }]),
      PersonalError,
    );
    assertEquals(store.read("privat", "index").value, before);
    assertEquals(store.read("privat", "index").revision, 1);
    const conflict = assertThrows(
      () => store.save("privat", [{ id, revision: 0, value: packed(100) }]),
      PersonalError,
    );
    assertEquals(conflict.status, 409);
    assertEquals(store.manifest("privat").usedBytes, 300);
    store.save("privat", [{ id: "index", revision: 1, value: packed(200) }], [{
      id,
      revision: 1,
    }]);
    assertEquals(store.manifest("privat").usedBytes, 200);
    assertThrows(() => store.read("privat", id), PersonalError);
    assertThrows(
      () => store.save("privat", [], [{ id: "index", revision: 2 }]),
      PersonalError,
    );
    assertThrows(
      () =>
        store.save("privat", [{
          id: "../elsewhere",
          revision: 0,
          value: packed(),
        }]),
      PersonalError,
    );
  } finally {
    db.close();
  }
});
Deno.test("personal storage: conversations with many images can be deleted atomically", () => {
  const db = database(), store = new PersonalStore(db);
  try {
    store.create("privat", salt, auth, packed());
    const ids = Array.from({ length: 40 }, () => "img:" + crypto.randomUUID());
    for (let start = 0; start < ids.length; start += 16) {
      store.save(
        "privat",
        ids.slice(start, start + 16).map((id) => ({
          id,
          revision: 0,
          value: packed(),
        })),
      );
    }
    assertEquals(store.manifest("privat").records.length, 41);
    store.save(
      "privat",
      [{ id: "index", revision: 1, value: packed() }],
      ids.map((id) => ({ id, revision: 1 })),
    );
    assertEquals(store.manifest("privat").records.length, 1);
    assertEquals(store.manifest("privat").usedBytes, 100);
  } finally {
    db.close();
  }
});
