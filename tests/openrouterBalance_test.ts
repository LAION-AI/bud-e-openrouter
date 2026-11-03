import { assert, assertEquals } from "$std/assert/mod.ts";
import {
  keyAllowanceText,
  readOpenRouterBalance,
} from "../utils/openrouterBalance.ts";

async function balance(
  key: unknown,
  credits: unknown,
  keyStatus = 200,
  creditStatus = 200,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (input) =>
    Promise.resolve(Response.json(
      { data: String(input).endsWith("/key") ? key : credits },
      { status: String(input).endsWith("/key") ? keyStatus : creditStatus },
    ));
  try {
    return await readOpenRouterBalance("test-only-chat-key");
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("account balance uses account totals, not key allowance", async () => {
  const value = await balance({ limit: 10, limit_remaining: 8 }, {
    total_credits: 50,
    total_usage: 17.5,
  });
  assertEquals(value.remainingCredits, 32.5);
  assertEquals(value.keyLimitRemaining, 8);
  assertEquals(value.keyLimitState, "limited");
  assert(keyAllowanceText(value).includes("kein Kontoguthaben"));
});

Deno.test("missing or malformed key limits are unknown, not unlimited", async () => {
  for (const invalid of [undefined, "", false, {}, "0"]) {
    const value = await balance(
      { limit: invalid, limit_remaining: invalid },
      {},
    );
    assertEquals(value.keyLimitState, "unknown");
    assertEquals(value.keyLimitRemaining, null);
    assert(keyAllowanceText(value).includes("unbekannt"));
  }
  const unlimited = await balance({ limit: null, limit_remaining: null }, {});
  assertEquals(unlimited.keyLimitState, "unlimited");
  const missingRemaining = await balance({ limit: 10 }, {});
  assert(
    keyAllowanceText(missingRemaining).includes(
      "verbleibender Betrag unbekannt",
    ),
  );
});

Deno.test("zero and negative genuine balances are preserved; malformed zeros rejected", async () => {
  assertEquals(
    (await balance({}, { total_credits: 0, total_usage: 0 })).remainingCredits,
    0,
  );
  assertEquals(
    (await balance({}, { total_credits: 1, total_usage: 1.5 }))
      .remainingCredits,
    -0.5,
  );
  for (const bad of ["", false, null, "0"]) {
    const value = await balance({}, { total_credits: bad, total_usage: bad });
    assertEquals(value.accountAvailable, false);
    assertEquals(value.remainingCredits, undefined);
  }
});

Deno.test("partial provider failures retain independent data without inventing permission errors", async () => {
  const keyOnly = await balance(
    { limit: 10, limit_remaining: 8 },
    {},
    200,
    500,
  );
  assertEquals(keyOnly.keyLimitRemaining, 8);
  assertEquals(keyOnly.requiresManagementKey, undefined);
  const creditsOnly = await balance(
    {},
    { total_credits: 10, total_usage: 2 },
    500,
  );
  assertEquals(creditsOnly.remainingCredits, 8);
  assertEquals(creditsOnly.keyLimitState, "unknown");
  const forbidden = await balance({ limit: null }, {}, 200, 403);
  assertEquals(forbidden.requiresManagementKey, true);
  assertEquals(forbidden.remainingCredits, undefined);
});

Deno.test("normal inference key cannot turn a placeholder zero into account balance", async () => {
  const value = await balance({
    is_management_key: false,
    limit: 5,
    limit_remaining: 3,
  }, { total_credits: 0, total_usage: 0 });
  assertEquals(value.accountAvailable, false);
  assertEquals(value.keyLimitRemaining, 3);
  assertEquals(value.requiresManagementKey, true);
});

Deno.test("management-key account scope is explicit and credentials never returned", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (input) =>
    Promise.resolve(
      Response.json({
        data: String(input).endsWith("/key")
          ? { is_management_key: false, limit: 1, limit_remaining: 0.5 }
          : { total_credits: 20, total_usage: 4 },
      }),
    );
  try {
    const value = await readOpenRouterBalance(
      "test-chat-secret",
      "test-management-secret",
    );
    assertEquals(value.accountScope, "supplied-management-key");
    assertEquals(value.remainingCredits, 16);
    assert(!JSON.stringify(value).includes("secret"));
  } finally {
    globalThis.fetch = original;
  }
});
