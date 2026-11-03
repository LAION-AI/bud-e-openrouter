/** Conservative preflight, not a semantic rubric validator. Never invent points. */
export function gradingCriteriaQuestions(criteria: string): string[] {
  const text = criteria.trim();
  if (!text) {
    return [
      "Welche Lösungen oder fachlichen Kriterien gelten? Füge deinen Erwartungshorizont ein oder erlaube ausdrücklich, die Lösungen aus den Aufgaben abzuleiten.",
      "Wie viele Punkte gibt es je (Teil-)Aufgabe und wofür Teilpunkte? Alternativ: ausdrücklich ohne Punkte bewerten.",
    ];
  }
  const noPoints =
    /(?:ohne|keine|keinerlei)\s+(?:\w+\s+){0,2}(?:punkte|punktvergabe|bepunktung)|(?:no|without)\s+(?:points|scores)/i
      .test(text);
  const numericPoints =
    /\d\s*(?:[.,]\d+\s*)?(?:punkte?|P\.?\b|BE\b|points?\b)|(?:punkte?|bepunktung|points?)\s*(?:je\s+\w+\s*)?[:=]?\s*\d|(?:je|jeweils|pro)\s*\d+[^.\n]{0,40}punkt/i
      .test(text);
  const referencedPoints =
    /(?:punkte|bepunktung|bewertungsraster)[^.\n]{0,100}(?:original|aufgabenblatt|vorlage|erwartungshorizont|rubrik)|(?:original|aufgabenblatt|vorlage)[^.\n]{0,100}(?:punkte|bepunktung)/i
      .test(text);
  const writtenPoints =
    /(?:ein(?:en)?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|halb(?:en)?)\s+(?:punkte?|BE\b)|(?:one|two|three|four|five|half)\s+points?/i
      .test(text);
  return noPoints || numericPoints || referencedPoints || writtenPoints ? [] : [
    "Welche Höchstpunkte gelten je (Teil-)Aufgabe, und wann gibt es Teilpunkte? Trage die Punktregeln ein, verweise ausdrücklich auf die Punkte im Original oder wähle eine Rückmeldung ohne Punkte. Einen Notenschlüssel brauchen wir nur, wenn du zusätzlich eine Note möchtest.",
  ];
}

export const DERIVE_SOLUTIONS_POLICY =
  "Die fachlich richtigen Lösungen dürfen aus dem gedruckten Aufgabentext abgeleitet werden. Schülerantworten sind keine Musterlösung. Punkte und Teilpunkte ausschließlich nach meinen ausdrücklichen Vorgaben; fehlende oder widersprüchliche Regeln zuerst gezielt erfragen, nicht selbst festlegen.";
