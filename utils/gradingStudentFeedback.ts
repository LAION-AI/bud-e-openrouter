/** Output contract used for draft, review and consolidation alike. */
import { gradingJson } from "./gradingRecovery.ts";
export const STUDENT_FEEDBACK_INSTRUCTIONS = `
ADRESSAT UND AUSGABE: Diese Rückmeldung wird direkt an die Schülerin oder den Schüler ausgegeben, nicht an die Lehrkraft. Schreibe freundlich, klar, knapp und konsequent in der Du-Form. Keine Kommentare wie „nach Lehrkraftvorgabe“, „für die Lehrkraft“, „im Original stehen andere Punkte“, keine Download-/Prüfprotokolle oder Unterschriftsaufforderungen. Keine Pflichtfelder für Unterschriften. Unbelegte Aussagen über Fleiß, Stift oder Ursache schlechter Scans vermeiden.
Beginne mit EINER Metadatenzeile „Name: … · Klasse: … · Testdatum: … · Version: …“, nur soweit aus dem Original belegt. Keine zusätzliche allgemeine Klassenüberschrift oder doppelten Feedbacktitel.
Danach je Aufgabe/Teilaufgabe: kurze Überschrift, erreichte/erreichbare Rohpunkte, freundlich konkret „Das passt“ und „So kannst du es verbessern“, soweit dafür sichtbare Antwortbelege vorliegen. Bei richtigen Antworten reicht ein kurzer positiver Hinweis; keine Fehler erfinden. Bei Fehlern zeige die fachlich richtige Verbesserung. Im Lückentext kompakte Tabelle „Lücke | Dein Eintrag | Rückmeldung | Punkte“, mit 1/1, 0/1 oder ausdrücklich offenen Punkten nur gemäß tatsächlichem Maßstab. Andere Aufgaben je nach Inhalt als kurze Absätze oder kompakte Tabelle. Aufgaben nicht vermischen und jede Aufgabe genau einmal behandeln.
Jede bepunktete Aufgabe bekommt eine eindeutig erkennbare Teilpunktzahl, und am Ende steht „Insgesamt: x von y Punkten“. Die Kurzschreibweise x/y in Tabellen bedeutet erreichte/mögliche Punkte. Unleserliche Stellen NICHT als falsch behandeln: sichere und noch offene Punkte getrennt nennen, keine scheinbar genaue Endsumme erfinden. Fehlen Rohpunktregeln, zuerst Rückfrage stellen, niemals neue Punkteverteilungen oder Notenmaßstäbe selbst ausdenken. Bei ausdrücklich gewählter Rückmeldung ohne Punkte nur fachliches Feedback, keine Zahlen erfinden. Keine Note ohne ausdrücklich vorgegebenen Notenschlüssel.
Schließe mit höchstens zwei konkreten nächsten Lernschritten, direkt an „du“ gerichtet. Ziel ist ein gut lesbares Blatt pro Person, etwa 250–350 Wörter einschließlich Tabellen. Formeln als Unicode/Klartext, keine LaTeX-Befehle. Transparente Unsicherheit bleibt auf dem Blatt, technische und administrative Hinweise gehören dagegen in die Lehrkraftansicht.
`;

export const GRADING_CLARIFICATION_POLICY = `
PUNKTESCHREIBWEISE: Im Bewertungsraster bedeutet „erreichte Punkte / mögliche Punkte“ eine Punktzahl, keinen ausgerechneten Bruch. Wenn die Lehrkraft für eine Aufgabe 2 Höchstpunkte und 1 Teilpunkt festlegt, bedeutet „1/2“ in diesem Raster „1 von 2 Punkten“, NICHT 0,5 Punkte. Entsprechend bedeutet „2/2“ dort 2 von 2 Punkten. Verursache deshalb keine Rückfrage wegen eines nur scheinbaren Widerspruchs. Echte halbe Punkte („0,5 Punkte“, „ein halber Punkt“ oder ausdrücklich als Bruch angegebene Punktwerte) bleiben halbe Punkte. Tatsächlich widersprüchliche Regeln weiterhin gezielt erfragen. Formuliere Punktstände im Feedback möglichst als „1 von 2 Punkten“, damit sie eindeutig sind.
RÜCKFRAGEN: Wenn notwendige Bewertungs-/Teilpunktregeln fehlen oder widersprüchlich sind, NICHT raten und NICHT eine fertige Schülerbewertung vortäuschen. Antworte dann stattdessen ausschließlich mit einem JSON-Objekt {"type":"grading_clarification","questions":["Konkrete kurze Rückfrage an die Lehrkraft?"]}. Höchstens vier Fragen, nur die wirklich fehlenden Angaben. Die Anwendung fragt damit die Lehrkraft und setzt danach fort. Wenn der Maßstab vollständig ist, normal das angeforderte Ausgabeformat verwenden.
`;
export function gradingClarificationQuestions(reply: string): string[] | null {
  const text = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(
    /\s*```$/,
    "",
  );
  if (!/"type"\s*:\s*"grading_clarification"/.test(text)) return null;
  try {
    const value = gradingJson(text);
    if (value?.type !== "grading_clarification") return null;
    if (
      !Array.isArray(value.questions) || value.questions.length < 1 ||
      value.questions.length > 4 || value.questions.some((q: unknown) =>
        typeof q !== "string" || !q.trim() || q.length > 1000
      )
    ) {
      return [
        "Bitte ergänze den Bewertungsmaßstab: Welche Punkte und Teilpunktregeln gelten für die Aufgaben?",
      ];
    }
    return value.questions.map((q: string) =>
      q.trim()
    );
  } catch {
    return null;
  }
}
