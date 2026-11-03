import {
  createClassroom,
  defaultConfig,
  issueSession,
  sessionCookie,
  updateClassroom,
} from "../utils/classroomStore.ts";
import { handler } from "../routes/api/classroom.ts";
import {
  CLASSROOM_DURATIONS,
  MAX_CLASSROOM_DURATION_MS,
} from "../utils/classroomTiming.ts";

function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}

Deno.test("classroom activation stays public for the selected duration", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bude-activation-test-" });
  Deno.env.set("CLASSROOM_DATA_DIR", dir);
  const slug = "zeitklasse";
  await createClassroom(
    slug,
    "EinSicheres!2026",
    "openrouter",
    "sk-or-v1-test-activation-key-never-shown",
  );
  const config = defaultConfig();
  config.models.chat = "openai/gpt-6-luna";
  await updateClassroom(slug, config, 1, 0, true);
  const cookie = sessionCookie(await issueSession(slug)).split(";")[0];

  async function post(body: Record<string, unknown>) {
    const response = await handler.POST!(
      new Request("https://school.bud-e.ai/api/classroom", {
        method: "POST",
        headers: {
          origin: "https://school.bud-e.ai",
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      {} as never,
    );
    return { status: response.status, body: await response.json() };
  }

  async function publicState() {
    const response = await handler.GET!(
      new Request(
        `https://school.bud-e.ai/api/classroom?action=public&slug=${slug}`,
      ),
      {} as never,
    );
    assert(response.status === 200, "public endpoint failed");
    return await response.json();
  }

  assert((await publicState()).reason === "closed", "new room not closed");
  for (const minutes of [3, 7, 14, 30].map((days) => days * 1440)) {
    assert(
      CLASSROOM_DURATIONS.some((choice) => choice.minutes === minutes),
      `${minutes} minute choice missing`,
    );
    const before = Date.now();
    const result = await post({ action: "activate", minutes });
    assert(result.status === 200, `activation ${minutes} failed`);
    assert(result.body.state.active, "admin state not active");
    const until = result.body.state.expiresAt;
    assert(
      until >= before + minutes * 60_000 &&
        until <= Date.now() + minutes * 60_000,
      "wrong stored deadline",
    );
    const student = await publicState();
    assert(student.active && student.expiresAt === until, "student link closed");
  }

  const realNow = Date.now;
  const current = realNow();
  try {
    Date.now = () => current + 60 * 60_000;
    assert((await publicState()).active, "30-day room closed after one hour");
    Date.now = () => current + 13 * 60 * 60_000;
    assert(
      (await publicState()).active,
      "room closed when the teacher's 12-hour login expired",
    );
    Date.now = () => current + MAX_CLASSROOM_DURATION_MS + 60_000;
    assert(
      (await publicState()).reason === "expired",
      "expired room did not report its reason",
    );
  } finally {
    Date.now = realNow;
  }

  const chosenDate = Date.now() + 25 * 24 * 60 * 60_000;
  const dated = await post({ action: "activate", expiresAt: chosenDate });
  assert(dated.status === 200, "specific date was rejected");
  assert(dated.body.state.expiresAt === chosenDate, "date not persisted");
  assert((await publicState()).active, "dated room not public");

  const tooLate = await post({
    action: "activate",
    expiresAt: Date.now() + MAX_CLASSROOM_DURATION_MS + 60_000,
  });
  assert(tooLate.status === 400, "deadline over 30 days was accepted");

  const closed = await post({ action: "deactivate" });
  assert(closed.status === 200, "manual closing failed");
  assert((await publicState()).reason === "closed", "student still sees open room");

  const reopened = await post({ action: "activate", minutes: 3 * 1440 });
  assert(reopened.status === 200, "reopening failed");
  assert((await publicState()).active, "reopened room not public");

  await updateClassroom(
    slug,
    config,
    0,
    Date.now() + 3 * 24 * 60 * 60_000,
    false,
  );
  assert(
    (await publicState()).reason === "budget",
    "budget exhaustion was misreported as a time-based closure",
  );
});
