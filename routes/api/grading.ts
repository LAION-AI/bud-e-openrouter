/**
 * @file grading.ts
 * @description Runs the correction agent and reports every step it takes.
 *
 *              Two phases, split by a question to the teacher:
 *
 *              phase "transcribe" reads the uploaded pages and sorts them into
 *              papers, then stops and hands back the transcript. The teacher
 *              can download it, and is asked how the work should be marked.
 *
 *              phase "mark" takes that answer and writes one correction per
 *              pupil, each in its own call with the pupil's pages attached so
 *              the model can look again where the transcript is thin. The
 *              result is a .docx.
 *
 *              Both phases stream their steps, so the chat can show what the
 *              agent is doing rather than a spinner that lasts a minute.
 */

import { Handlers } from "$fresh/server.ts";
import {
  attemptsFor,
  getCatalog,
  isOpenRouterKey,
  orFetch,
  policyFor,
} from "../../utils/openrouter.ts";
import {
  buildGradingDocx,
  markPrompt,
  type PageTranscript,
  type SourceDoc,
  sortPrompt,
  type StudentPaper,
  transcribePrompt,
  transcriptMarkdown,
} from "../../utils/grading.ts";
import { buildDocx, docxToText, markdownToBlocks } from "../../utils/docx.ts";

/** A whole class set can be large; one phase may not exceed this. */
const PHASE_TIMEOUT_MS = 600_000;
const MAX_DOCS = 60;

/* ============================ model access ============================ */

interface CallOpts {
  key: string;
  referer: string;
  /** Attachments, already in OpenAI content-part shape. */
  parts?: unknown[];
  /** Ask for a JSON object back. */
  json?: boolean;
  maxTokens?: number;
}

/**
 * One call to the vision model, with the attempt chain behind it.
 *
 * Reasoning is switched on: sorting shuffled pages and weighing a half-right
 * answer are exactly the tasks where a model that thinks first does visibly
 * better, and the extra tokens are cheap next to a teacher's evening.
 */
async function askModel(
  prompt: string,
  opts: CallOpts,
): Promise<string> {
  const cat = await getCatalog();
  const attempts = attemptsFor(cat, "vlm", undefined);
  if (attempts.length === 0) throw new Error("No vision model available");

  let lastErr = "";
  for (const { model, level } of attempts) {
    try {
      const policy = await policyFor(model, level);
      const content = opts.parts?.length
        ? [{ type: "text", text: prompt }, ...opts.parts]
        : prompt;
      const { resp } = await orFetch(opts.key, "/chat/completions", {
        model: model.id,
        messages: [{ role: "user", content }],
        max_tokens: opts.maxTokens ?? 32_000,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        ...(policy ? { provider: policy } : {}),
      }, { model, level, referer: opts.referer });

      const body = await resp.json().catch(() => null);
      if (!resp.ok || body?.error) {
        lastErr = body?.error?.message ?? `HTTP ${resp.status}`;
        throw new Error(lastErr);
      }
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("empty answer");
      }
      return text;
    } catch (err) {
      lastErr = String(err);
      console.error(`[grading] ${model.id}:${level} failed:`, err);
    }
  }
  throw new Error(lastErr || "all attempts failed");
}

/** Pulls a JSON object out of an answer that may be wrapped in prose. */
export function extractJson(text: string): any {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* keep looking */ }

  // ```json ... ``` is the usual wrapper.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch { /* keep looking */ }
  }
  // Otherwise take the outermost braces.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch { /* give up below */ }
  }
  throw new Error("no JSON in the answer");
}

/* ========================= turning docs into parts ========================= */

/**
 * Converts uploads into message parts, and text files into prose.
 *
 * Pages are announced by number before their image, because the model is asked
 * to report page numbers back and otherwise has to guess the order it sees
 * them in.
 */
export function docsToParts(docs: SourceDoc[]): {
  parts: unknown[];
  textPages: string[];
} {
  const parts: unknown[] = [];
  const textPages: string[] = [];

  for (const d of docs) {
    if (d.kind === "text") {
      textPages.push(`--- Seite ${d.index} (${d.name}) ---\n${d.content}`);
      continue;
    }
    parts.push({ type: "text", text: `--- Seite ${d.index} (${d.name}) ---` });
    if (d.kind === "pdf") {
      parts.push({
        type: "file",
        file: { filename: d.name, file_data: d.content },
      });
    } else {
      parts.push({ type: "image_url", image_url: { url: d.content } });
    }
  }
  return { parts, textPages };
}

/** Filenames are compared loosely - case and path prefixes vary. */
function normaliseName(name: string): string {
  return String(name).trim().toLowerCase().replace(/^.*[\\/]/, "");
}

/**
 * Coerces a list into strings.
 *
 * Figure descriptions came back as objects in testing, and String(obj) turned
 * every one of them into "[object Object]" - the whole description of a
 * labelled sketch, lost. Objects are flattened to their text instead.
 */
function toStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const parts = Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val != null && val !== "")
        .map(([k, val]) =>
          typeof val === "string" || typeof val === "number"
            ? `${k}: ${val}`
            : `${k}: ${JSON.stringify(val)}`
        );
      return parts.join("; ");
    }
    return String(v);
  }).map((s) => s.trim()).filter(Boolean);
}

/** The per-page summary the sorting step works from. */
function digestFor(pages: PageTranscript[]): string {
  return pages.map((p) =>
    `Seite ${p.page}: Name="${p.student}" Hinweis="${p.studentEvidence ?? ""}" ` +
    `Aufgaben=[${(p.tasks ?? []).join(",")}] Fortsetzung=${p.continues}\n` +
    p.transcript.slice(0, 2000) +
    ((p.figures ?? []).length
      ? `\n[Abbildungen: ${(p.figures ?? []).join(" | ").slice(0, 600)}]`
      : "")
  ).join("\n\n");
}

/**
 * Papers where the same task is answered twice.
 *
 * Inside one paper each task appears once, so a duplicate is near-proof that a
 * page sits under the wrong pupil - and that is the failure that matters most,
 * because it credits one pupil with another's work.
 */
function findTaskConflicts(
  papers: StudentPaper[],
  pages: PageTranscript[],
): string[] {
  const byPage = new Map(pages.map((p) => [p.page, p]));
  const out: string[] = [];
  for (const paper of papers) {
    const seen = new Map<string, number>();
    paper.pages.forEach((n, i) => {
      const page = byPage.get(n);
      if (!page) return;
      // An answer running onto the next sheet carries the same task number by
      // definition. That is the normal case, not a contradiction - flagging it
      // would cry wolf on exactly the papers that are correctly grouped.
      const isContinuation = page.continues === true && i > 0;
      for (const task of page.tasks ?? []) {
        const key = task.trim();
        if (!key) continue;
        const first = seen.get(key);
        if (first == null) {
          seen.set(key, n);
        } else if (first !== n && !isContinuation) {
          out.push(`${paper.student}: Aufgabe ${key} auf Seite ${first} und ${n}`);
        }
      }
    });
  }
  return out;
}

/* ============================== the phases ============================== */

async function runTranscribe(
  docs: SourceDoc[],
  lang: string,
  key: string,
  referer: string,
  step: (s: string, d?: string) => void,
): Promise<{ pages: PageTranscript[]; papers: StudentPaper[]; markdown: string }> {
  const { parts, textPages } = docsToParts(docs);

  step(
    lang === "de"
      ? `${docs.length} Seiten werden gelesen`
      : `Reading ${docs.length} pages`,
    docs.map((d) => d.name).join(", "),
  );

  let prompt = transcribePrompt(lang, docs.length);
  if (textPages.length) prompt += "\n\n" + textPages.join("\n\n");

  const raw = await askModel(prompt, { key, referer, parts, json: true });
  const data = extractJson(raw);

  // The model is asked to echo the filename, and it is matched on that rather
  // than on the page number. In testing the numbers came back shuffled - each
  // transcript was right, but attached to the wrong page, which then put the
  // right answers under the wrong pupil. A filename is distinctive enough to
  // survive; the page number is a fallback, and position the last resort.
  const byName = new Map(docs.map((d) => [normaliseName(d.name), d.index]));
  const used = new Set<number>();
  const rawPages: any[] = Array.isArray(data.pages) ? data.pages : [];

  const pages: PageTranscript[] = rawPages.map((p: any, i: number) => {
    const claimedName = normaliseName(String(p.file ?? p.filename ?? ""));
    const claimedPage = Number(p.page);
    let index = byName.get(claimedName) ?? 0;
    if (!index && Number.isFinite(claimedPage) && !used.has(claimedPage) &&
      docs.some((d) => d.index === claimedPage)) {
      index = claimedPage;
    }
    if (!index || used.has(index)) index = docs[i]?.index ?? i + 1;
    used.add(index);

    return {
      page: index,
      file: docs.find((d) => d.index === index)?.name,
      student: String(p.student ?? "").trim(),
      studentEvidence: String(p.studentEvidence ?? "").trim() || undefined,
      transcript: String(p.transcript ?? ""),
      figures: toStrings(p.figures),
      tasks: toStrings(p.tasks),
      continues: p.continues === true,
    };
  });
  if (pages.length === 0) throw new Error("no pages transcribed");

  const matched = rawPages.filter((p: any) =>
    byName.has(normaliseName(String(p.file ?? p.filename ?? "")))
  ).length;
  if (matched < rawPages.length) {
    step(
      lang === "de"
        ? `${rawPages.length - matched} Seiten ohne sicheren Dateinamen zugeordnet`
        : `${rawPages.length - matched} pages matched without a reliable filename`,
      lang === "de"
        ? "Reihenfolge geprüft - bitte die Abschrift kurz gegenlesen"
        : "order checked - please skim the transcript",
    );
  }

  const named = pages.filter((p) => p.student).length;
  step(
    lang === "de"
      ? `${pages.length} Seiten abgeschrieben, ${named} mit Namen`
      : `${pages.length} pages transcribed, ${named} carrying a name`,
  );

  // Sorting only earns its call when there is something to sort.
  let papers: StudentPaper[];
  const distinct = new Set(pages.map((p) => p.student).filter(Boolean));
  if (pages.length === 1) {
    papers = [{ student: pages[0].student || "Unbekannt 1", pages: [1] }];
  } else {
    step(
      lang === "de"
        ? "Seiten werden den Arbeiten zugeordnet"
        : "Assigning pages to papers",
      lang === "de"
        ? `${distinct.size} verschiedene Namen gefunden`
        : `${distinct.size} distinct names found`,
    );
    const digest = digestFor(pages);
    const sortRaw = await askModel(`${sortPrompt(lang)}\n\n${digest}`, {
      key,
      referer,
      json: true,
      maxTokens: 8000,
    });
    const sorted = extractJson(sortRaw);
    papers = (sorted.papers ?? []).map((p: any, i: number) => ({
      student: String(p.student ?? "").trim() || `Unbekannt ${i + 1}`,
      pages: (Array.isArray(p.pages) ? p.pages : []).map(Number).filter(Boolean),
      note: String(p.note ?? "").trim() || undefined,
    })).filter((p: StudentPaper) => p.pages.length > 0);
  }
  if (papers.length === 0) {
    // Rather one paper with everything in it than losing the work.
    papers = [{ student: "Unbekannt 1", pages: pages.map((p) => p.page) }];
  }

  // Check the grouping against itself before trusting it. Within one paper a
  // task is answered once; the same task twice means a page was filed under
  // the wrong pupil, which would hand one pupil another's answers. This is
  // worth one more call - it is the mistake with the worst consequences.
  const conflicts = findTaskConflicts(papers, pages);
  if (conflicts.length) {
    step(
      lang === "de"
        ? "Widerspruch in der Zuordnung, wird geprüft"
        : "Contradiction in the grouping, checking",
      conflicts.join("; "),
    );
    try {
      const again = await askModel(
        `${sortPrompt(lang)}\n\n` +
          (lang === "de"
            ? `Dein erster Vorschlag war:\n${JSON.stringify(papers)}\n\n` +
              `Dabei fällt auf: ${conflicts.join("; ")}. Eine Aufgabe kann in ` +
              `einer Arbeit nur einmal vorkommen. Prüfe die betroffenen Seiten ` +
              `noch einmal und ordne sie der Arbeit zu, in der diese Aufgabe ` +
              `noch fehlt.\n\n${digestFor(pages)}`
            : `Your first proposal was:\n${JSON.stringify(papers)}\n\n` +
              `Note: ${conflicts.join("; ")}. A task can appear only once in a ` +
              `paper. Look at the affected pages again and assign them to the ` +
              `paper where that task is still missing.\n\n${digestFor(pages)}`),
        { key, referer, json: true, maxTokens: 8000 },
      );
      const revised = extractJson(again);
      const fixed: StudentPaper[] = (revised.papers ?? []).map((p: any, i: number) => ({
        student: String(p.student ?? "").trim() || `Unbekannt ${i + 1}`,
        pages: (Array.isArray(p.pages) ? p.pages : []).map(Number).filter(Boolean),
        note: String(p.note ?? "").trim() || undefined,
      })).filter((p: StudentPaper) => p.pages.length > 0);

      const stillWrong = findTaskConflicts(fixed, pages);
      const complete = new Set(fixed.flatMap((p) => p.pages)).size === pages.length;
      if (fixed.length && complete && stillWrong.length < conflicts.length) {
        papers = fixed;
        step(
          lang === "de" ? "Zuordnung korrigiert" : "Grouping corrected",
          stillWrong.length
            ? (lang === "de" ? "ein Rest bleibt unsicher" : "some doubt remains")
            : undefined,
        );
      } else {
        step(
          lang === "de"
            ? "Zuordnung bleibt unsicher - bitte die Abschrift gegenlesen"
            : "Grouping stays uncertain - please check the transcript",
        );
      }
    } catch (err) {
      console.error("[grading] re-sort failed:", err);
    }
  }

  step(
    lang === "de"
      ? `${papers.length} Arbeiten erkannt`
      : `${papers.length} papers identified`,
    papers.map((p) => `${p.student} (${p.pages.length})`).join(", "),
  );

  return { pages, papers, markdown: transcriptMarkdown(pages, papers, lang) };
}

async function runMark(
  docs: SourceDoc[],
  pages: PageTranscript[],
  papers: StudentPaper[],
  criteria: string,
  lang: string,
  key: string,
  referer: string,
  step: (s: string, d?: string) => void,
): Promise<{ markdown: string[]; docx: Uint8Array }> {
  const byIndex = new Map(docs.map((d) => [d.index, d]));
  const byPage = new Map(pages.map((p) => [p.page, p]));
  const out: string[] = [];

  for (const [i, paper] of papers.entries()) {
    step(
      lang === "de"
        ? `Korrektur ${i + 1} von ${papers.length}: ${paper.student}`
        : `Marking ${i + 1} of ${papers.length}: ${paper.student}`,
      lang === "de"
        ? `Seiten ${paper.pages.join(", ")}`
        : `pages ${paper.pages.join(", ")}`,
    );

    // The transcript is the working text; the pages ride along so the model
    // can check a reading it is unsure about.
    const transcript = paper.pages.map((n) => {
      const p = byPage.get(n);
      if (!p) return "";
      const figures = (p.figures ?? []).map((f) => `[Abbildung: ${f}]`).join("\n");
      return `--- Seite ${n} ---\n${p.transcript}${figures ? "\n" + figures : ""}`;
    }).join("\n\n");

    const attach = paper.pages
      .map((n) => byIndex.get(n))
      .filter((d): d is SourceDoc => !!d && d.kind === "image")
      .map((d) => ({ type: "image_url", image_url: { url: d.content } }));

    const md = await askModel(
      `${markPrompt(lang, paper.student, criteria)}\n\n${transcript}`,
      { key, referer, parts: attach, maxTokens: 16_000 },
    );
    out.push(md);
  }

  step(lang === "de" ? "Dokument wird gebaut" : "Building the document");
  const title = lang === "de" ? "Korrekturvorschläge" : "Correction proposals";
  const docx = await buildGradingDocx(title, out, lang);
  return { markdown: out, docx };
}

/* =============================== handler =============================== */

export const handler: Handlers = {
  async POST(req) {
    let body: {
      phase?: string;
      docs?: SourceDoc[];
      pages?: PageTranscript[];
      papers?: StudentPaper[];
      criteria?: string;
      lang?: string;
      universalApiKey?: string;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Bad JSON" }, 400);
    }

    const key = String(body.universalApiKey ?? "").trim();
    const lang = body.lang === "de" ? "de" : "en";
    if (!isOpenRouterKey(key)) {
      return json({ error: "Correcting needs an OpenRouter key" }, 400);
    }

    const docs = (body.docs ?? []).slice(0, MAX_DOCS);
    const origin = (() => {
      try {
        return new URL(req.url).origin;
      } catch {
        return "";
      }
    })();

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) =>
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        const step = (s: string, d?: string) => send("step", { step: s, detail: d });

        const timer = setTimeout(() => {
          send("error", { message: "timeout" });
          controller.close();
        }, PHASE_TIMEOUT_MS);

        try {
          if (body.phase === "mark") {
            const { markdown, docx } = await runMark(
              docs,
              body.pages ?? [],
              body.papers ?? [],
              String(body.criteria ?? ""),
              lang,
              key,
              origin,
              step,
            );
            send("done", {
              phase: "mark",
              markdown,
              docx: base64(docx),
              filename: lang === "de"
                ? "Korrekturvorschlaege.docx"
                : "corrections.docx",
            });
          } else {
            if (docs.length === 0) {
              send("error", { message: "no documents" });
              controller.close();
              clearTimeout(timer);
              return;
            }
            const { pages, papers, markdown } = await runTranscribe(
              docs,
              lang,
              key,
              origin,
              step,
            );
            const doc = await buildDocx(markdownToBlocks(markdown));
            send("done", {
              phase: "transcribe",
              pages,
              papers,
              markdown,
              docx: base64(doc),
              filename: lang === "de" ? "Abschrift.docx" : "transcript.docx",
            });
          }
        } catch (err) {
          console.error("[grading] failed:", err);
          send("error", { message: String(err).slice(0, 400) });
        } finally {
          clearTimeout(timer);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  },
};

function base64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Exported for tests: reading a .docx upload into plain text. */
export async function readDocxUpload(dataUrl: string): Promise<string> {
  const b64 = dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return await docxToText(bytes);
}
