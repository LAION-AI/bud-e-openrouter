/** Generate local, clearly labelled audit files from a classroom checkpoint. */
import { parseGradingCheckpoint } from "../utils/gradingCheckpoint.ts";
import { transcriptMarkdown } from "../utils/grading.ts";
import { buildGradingPdf, buildGradingWord } from "../utils/gradingExports.ts";

const [input, destination] = Deno.args;
if (!input || !destination) throw new Error("checkpoint.json and output directory required");
const checkpoint = parseGradingCheckpoint(await Deno.readTextFile(input));
await Deno.mkdir(destination, { recursive: true, mode: 0o700 });
const work = checkpoint.work;
const prefix = "# UNGEPRÜFTE KI-ABSCHRIFT – NICHT ALS BEWERTUNG VERWENDEN\n\n" +
  "Diese Abschrift ist ein technischer Zwischenstand. Im realen Test wurden Abweichungen zur Handschrift festgestellt. Vor jeder Bewertung mit den Originalseiten vergleichen. Die Original-PDF bleibt maßgeblich.\n\n";
const text = prefix + transcriptMarkdown(work.pages, work.papers, "de");
await Deno.writeTextFile(destination+"/Abschrift-UNGEPRUEFT.txt", text, { mode: 0o600 });
await Deno.writeFile(destination+"/Abschrift-UNGEPRUEFT.docx", await buildGradingWord(text,{audience:"transcript"}), { mode: 0o600 });
const fonts = await Promise.all(["DejaVuSans.ttf","DejaVuSans-Bold.ttf"].map(name=>Deno.readFile(new URL("../static/fonts/"+name, import.meta.url)))) as [Uint8Array,Uint8Array];
await Deno.writeFile(destination+"/Abschrift-UNGEPRUEFT.pdf", await buildGradingPdf(text, fonts,{audience:"transcript"}), { mode: 0o600 });
const csv = (value: unknown) => '"'+String(value ?? "").replaceAll('"','""')+'"';
const rows = [["Gruppe (ungeprüft)","PDF-Seiten","Nicht bewerten","Begründung"], ...work.papers.map(p=>[p.student,p.pages.join(", "),p.ignored?"ja":"nein",p.note])];
await Deno.writeTextFile(destination+"/Seitenzuordnung-UNGEPRUEFT.csv", "\uFEFF"+rows.map(r=>r.map(csv).join(";")).join("\n"), { mode: 0o600 });
if (checkpoint.report) {
  await Deno.writeTextFile(destination+"/Korrekturvorschlag.txt", checkpoint.report, { mode: 0o600 });
  await Deno.writeFile(destination+"/Korrekturvorschlag.docx", await buildGradingWord(checkpoint.report), { mode: 0o600 });
  await Deno.writeFile(destination+"/Korrekturvorschlag.pdf", await buildGradingPdf(checkpoint.report,fonts), { mode: 0o600 });
}
console.log(JSON.stringify({pages:work.pages.length,selected:work.papers.filter(p=>!p.ignored).length,excludedGroups:work.papers.filter(p=>p.ignored).length,report:!!checkpoint.report}));
