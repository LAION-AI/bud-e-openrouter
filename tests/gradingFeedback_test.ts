import { assert, assertEquals } from "$std/assert/mod.ts";
import {
  gradingErrorHelp,
  gradingFailureCode,
  roomBudgetState,
} from "../utils/gradingFeedback.ts";
import {
  createClassroom,
  defaultConfig,
  issueSession,
  sessionCookie,
  updateClassroom,
} from "../utils/classroomStore.ts";
import { handler } from "../routes/api/classroom.ts";
import { classroomGradingCall } from "../utils/gradingBatch.ts";
import { recoverGrading } from "../utils/gradingRecovery.ts";
import { assertRejects } from "$std/assert/mod.ts";

Deno.test("exhausted provider credit and local budgets pause immediately even when wrapped in HTTP 502", async () => {
  const original = globalThis.fetch;
  try {
    for (
      const code of [
        "room_budget",
        "room_closed",
        "provider_credit",
        "provider_auth",
      ]
    ) {
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        return Promise.resolve(
          Response.json({ code, error: "Anfrage abgelehnt" }, { status: 502 }),
        );
      };
      const controller = new AbortController();
      await assertRejects(() =>
        recoverGrading(
          "Test",
          (_attempt, _plain, signal) =>
            classroomGradingCall("test", "Auftrag", [], signal),
          controller.signal,
          () => {},
        )
      );
      assertEquals(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("grading help distinguishes local budget, provider credit, key permissions, rate and format; gives recovery instructions", () => {
  const cases = [
    ["Der Ausgabenrahmen reicht nicht", "room_budget"],
    ["Auf dem Anbieter-Konto ist nicht genug Guthaben.", "provider_credit"],
    ["API-Key ist ungültig", "provider_auth"],
    ["Zeitlimit der Modellanfrage erreicht", "timeout"],
    ["Zu viele Anfragen, 429", "provider_rate"],
    ["Die KI hat kein gültiges JSON geliefert", "format"],
    ["Raum ist geschlossen", "room_closed"],
  ];
  for (const [message, code] of cases) {
    assertEquals(gradingFailureCode(message), code);
    const help = gradingErrorHelp(message, "request");
    assertEquals(help.kind, code);
    assert(help.title.length > 20 && help.next.length > 50);
  }
  assert(
    gradingErrorHelp("", "room_budget").explanation.includes(
      "nicht das Guthaben",
    ),
  );
  assert(
    gradingErrorHelp("", "provider_credit").explanation.includes(
      "allein löst das nicht",
    ),
  );
  assert(gradingErrorHelp("", "cancelled").next.includes("Zwischenstand"));
  assert(
    gradingErrorHelp("", "provider_auth", true).next.includes("privaten Raums"),
  );
});

Deno.test("budget warnings distinguish spent, reserved and unknown; a reservation is not a charge", () => {
  const room = {
    budgetUsd: 10,
    spentUsd: 2,
    reservedUsd: 7.9,
    activeCalls: 5,
    active: true,
    disabled: false,
    expiresAt: Date.now() + 60000,
  };
  const busy = roomBudgetState(room);
  assert(busy.waiting && busy.low && !busy.exhausted);
  assert(Math.abs(busy.remaining - 0.1) < 0.00001);
  const empty = roomBudgetState({ ...room, spentUsd: 10, reservedUsd: 0 });
  assert(empty.exhausted);
  assertEquals(empty.remaining, 0);
  assertEquals(roomBudgetState({ ...room, reservedUsd: 0 }).low, false);
});

Deno.test("grading status financial details require the matching teacher session and never return keys; provider reads are explicit", async () => {
  Deno.env.set(
    "CLASSROOM_DATA_DIR",
    await Deno.makeTempDir({ prefix: "grading-status-" }),
  );
  await createClassroom(
    "feedbacktest",
    "TeacherOnly!2026",
    "openrouter",
    "sk-or-v1-synthetic-feedback-key",
  );
  const config = defaultConfig();
  config.models.chat = "test/vision";
  await updateClassroom("feedbacktest", config, 10, Date.now() + 60000, false);
  const token = await issueSession("feedbacktest");
  const cookie = sessionCookie(token).split(";")[0];
  const request = (slug = "feedbacktest", signed = true, provider = false) =>
    new Request(
      `https://school.bud-e.ai/api/classroom?action=grading-status&slug=${slug}${
        provider ? "&provider=1" : ""
      }`,
      { headers: signed ? { cookie } : {} },
    );
  assertEquals(
    (await handler.GET!(request("feedbacktest", false), {} as never)).status,
    401,
  );
  assertEquals(
    (await handler.GET!(request("anotherteacher"), {} as never)).status,
    403,
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (input) => {
    calls++;
    return Promise.resolve(
      Response.json({
        data: String(input).endsWith("/key")
          ? { is_management_key: false, limit: 5, limit_remaining: 3 }
          : { total_credits: 0, total_usage: 0 },
      }),
    );
  };
  try {
    const result = await handler.GET!(request(), {} as never);
    assertEquals(result.headers.get("cache-control"), "no-store");
    const budget = await result.json();
    assertEquals(budget.room.budgetUsd, 10);
    assertEquals(budget.room.reservedUsd, 0);
    assertEquals(budget.room.activeCalls, 0);
    assertEquals(calls, 0);
    assert(!JSON.stringify(budget).includes("synthetic-feedback"));
    const provider = await (await handler.GET!(
      request("feedbacktest", true, true),
      {} as never,
    )).json();
    assertEquals(calls, 2);
    assertEquals(provider.balance.keyLimitRemaining, 3);
    assertEquals(provider.balance.accountAvailable, false);
    assertEquals(provider.balance.remainingCredits, undefined);
    assert(!JSON.stringify(provider).includes("synthetic-feedback"));
  } finally {
    globalThis.fetch = original;
  }
});
