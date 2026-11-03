import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";

/** Plain-language help: keyboard, pointer and touch, without a second modal. */
export function GradingInfo({ label, text }: { label: string; text: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    if (!open) return;
    const rect = button.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(320, innerWidth - 24);
      const height = tip.current?.offsetHeight ?? 160;
      setPosition({
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        top: Math.max(
          12,
          rect.bottom + height + 20 < innerHeight
            ? rect.bottom + 8
            : rect.top - height - 8,
        ),
      });
    }
    const close = () => {
      pinned.current = false;
      setOpen(false);
    };
    const outside = (event: Event) => {
      if (
        !button.current?.contains(event.target as Node) &&
        !tip.current?.contains(event.target as Node)
      ) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    globalThis.addEventListener("resize", close);
    globalThis.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      globalThis.removeEventListener("resize", close);
      globalThis.removeEventListener("scroll", close, true);
    };
  }, [open]);
  return (
    <span class="ml-2 inline-flex align-middle">
      <button
        ref={button}
        type="button"
        aria-label={`Info: ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-sm font-bold text-indigo-700 focus:outline focus:outline-2 focus:outline-indigo-600"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (
            !pinned.current && document.activeElement !== button.current
          ) setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            pinned.current = false;
            setOpen(false);
          }
        }}
        onBlur={() => {
          pinned.current = false;
          setOpen(false);
        }}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        i
      </button>
      {open && (
        <span
          ref={tip}
          id={id}
          role="tooltip"
          class="fixed z-[80] block overflow-y-auto rounded-xl border border-indigo-200 bg-white p-4 text-left text-sm font-normal leading-6 text-slate-800 shadow-xl"
          style={{
            ...position,
            width: "min(320px, calc(100vw - 24px))",
            maxHeight: "calc(100vh - 24px)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function GradingWalkthrough({ privateRoom, busy, onReturn }: {
  privateRoom: boolean;
  busy: boolean;
  onReturn: () => void;
}) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const screens = [
    {
      title: "1. Arbeiten auswählen",
      invitation:
        "Ein Stapel Tests – und du möchtest für jede Person eine Rückmeldung?",
      paragraphs: [
        "Klicke auf „Arbeiten hochladen“ und wähle deine PDF-Datei aus. Sie darf die ganze Klasse enthalten. Du kannst auch mehrere Fotos, Word-Dateien oder eine ZIP-Datei mit mehreren Arbeiten auswählen.",
        "PDF, Word und Fotos: bis 20 MB je Datei. ZIP: bis 40 MB. Nutze möglichst Pseudonyme statt voller Namen. Für eine genaue Seitenansicht speichere Word-Dokumente vorher als PDF.",
        "Noch nicht fertig? Du kannst vor dem Start weitere Dateien hinzufügen oder falsche Dateien unter „Dateien anzeigen oder entfernen“ wieder herausnehmen. Das Auswählen allein schickt noch keine Arbeiten an die KI.",
      ],
    },
    {
      title: "2. Erklären, worauf es ankommt",
      invitation:
        "Was sollen deine Schülerinnen und Schüler zeigen – und wofür gibt es Punkte?",
      paragraphs: [
        "Schreibe im Feld „Erwartungshorizont / Korrekturkriterien“ die erwarteten Antworten und deine Punktregeln auf. Wichtig sind Punkte je Teilaufgabe und Regeln für teilweise richtige Antworten. Ohne Punktbewertung? Klicke ausdrücklich auf „Ohne Punkte bewerten“.",
        "Beispiel: „Aufgabe 1: je richtige Lücke 1 Punkt. Aufgabe 2: richtiger Rechenansatz 1 Punkt, richtiges Ergebnis mit Einheit 1 Punkt. Keine Note.“ Wenn Lösungen fehlen, kannst du Bud-E erlauben, sie aus den Aufgaben herzuleiten. Diese Lösungen musst du später ebenfalls prüfen.",
        "Normalerweise laufen alle drei Stufen automatisch nacheinander. Möchtest du die Abschrift vorher selbst prüfen, setze das Häkchen „Prüfpause einlegen“. Fehlende Kriterien können auch im automatischen Ablauf eine Rückfrage auslösen.",
      ],
    },
    {
      title: "3. Kosten und Zugang verstehen",
      invitation:
        "Wer bezahlt die KI-Anfragen – und wie behältst du die Kosten im Blick?",
      paragraphs: [
        "Ein API-Key ist ein geheimer Zugangscode zum KI-Anbieter, etwa OpenRouter. Der hier hinterlegte Code ermöglicht die Anfragen. Du musst ihn nicht in deinen Auftrag schreiben und solltest ihn nie weitergeben. Die Nutzung kann Geld kosten, auch bei Wiederholungen.",
        privateRoom
          ? "Im privaten Raum wird direkt über deinen hinterlegten Anbieterzugang abgerechnet. Hier gibt es kein zusätzliches Klassenraum-Budget. Guthaben und Ausgabenlimits beim Anbieter gelten weiterhin."
          : "Das Raumbudget ist die zusätzliche Kostengrenze, die du unter /my für diesen Klassenraum eingestellt hast. Alle Personen im Raum teilen sie. Wenn du das Budget ansehen möchtest, melde dich als Lehrkraft mit dem Raum-Passwort an; der Klassenchat selbst braucht dieses Passwort nicht.",
        "Anbieterguthaben ist das verfügbare Geld im Konto beim KI-Anbieter. Ein Key-Limit ist eine weitere Ausgabengrenze für den Zugangscode – kein Guthaben. „Nicht abrufbar“ bedeutet unbekannt, nicht kostenlos oder unbegrenzt. Prüfe dann direkt dein Anbieterkonto. Bud-E kauft kein Guthaben und erhöht keine Grenzen automatisch.",
      ],
    },
    {
      title: "4. Starten, beobachten und bei Bedarf pausieren",
      invitation:
        "Du musst nicht jede Seite einzeln starten – Bud-E arbeitet den Stapel ab.",
      paragraphs: [
        "Klicke auf „Alle drei Stufen starten“. Zuerst werden die Seiten abgeschrieben. Dann werden zusammengehörende Seiten je Person sortiert. Schließlich werden die Arbeiten bewertet und am Original zweitgeprüft. Mehrere Anfragen laufen parallel, die drei Stufen bauen aber aufeinander auf.",
        "Die Anzeige sagt dir, was gerade läuft. Auch die Vorbereitung gemeinsamer Lösungen braucht Zeit. „0 bewertet“ bedeutet in dieser Phase nicht, dass nichts passiert. Lass diesen Tab offen; große Stapel können länger dauern. Die KI kann trotzdem Lesefehler machen.",
        "Bei vorübergehenden Fehlern versucht Bud-E es begrenzt erneut. Hält es an, lies die Erklärung. Bei leerem Budget erst den Zwischenstand herunterladen und das Limit oder Guthaben prüfen. Mit „Noch einmal versuchen“ geht es dann weiter, ohne fertige Schritte neu zu bezahlen. Zum Unterbrechen: „Pausieren“, danach den Zwischenstand herunterladen, erst dann den Tab schließen.",
      ],
    },
    {
      title: "5. Prüfen, herunterladen und später weitermachen",
      invitation:
        "Welche Rückmeldung gehört zu welchem Test? Die Prüfmappe hält alles zusammen.",
      paragraphs: [
        "Lade die Prüfmappe als PDF oder Word herunter: je Arbeit Originalseite, dazugehörige Abschrift und danach die Rückmeldung auf einer neuen Seite. Prüfe Namen, Zuordnung, Lesestellen und Punkte. KI-Vorschläge sind keine verbindlichen Bewertungen. Die getrennten Schüler-Rückmeldungen kannst du nach deiner Prüfung weitergeben.",
        "Zum Weiterarbeiten brauchst du „Zwischenstand herunterladen“. Diese .json-Datei enthält Originale, Abschriften, Zuordnung und bisherige Ergebnisse, aber keine Passwörter oder API-Keys. Öffne später die Korrektur, klappe „Schon angefangen? Zwischenstand laden“ auf und wähle diese Datei. Erst dein Klick auf Fortsetzen startet weitere KI-Anfragen.",
        privateRoom
          ? "Im privaten Raum wird der fertige Gesamtbericht im Chat verschlüsselt gespeichert. Originale und Zwischenstände werden dort nicht automatisch mitgesichert. Für die Korrektur werden ausgewählte Inhalte an deinen KI-Anbieter übermittelt. Heruntergeladene PDF-, Word- und JSON-Dateien sind unverschlüsselt: bewahre sie geschützt auf. Die Prüfmappe und Sicherungsdatei gehören nicht in den Klassenchat."
          : "Originale und Zwischenstände bleiben nur in diesem Fenster, bis du sie selbst herunterlädst. Für die Korrektur werden ausgewählte Inhalte an den eingestellten KI-Anbieter übermittelt. Heruntergeladene PDF-, Word- und JSON-Dateien sind unverschlüsselt: bewahre sie geschützt auf. Die Prüfmappe und Sicherungsdatei enthalten Daten der ganzen Klasse und gehören nicht in Schülerhände.",
      ],
    },
  ];
  const current = screens[step];
  return (
    <div class="mt-5" aria-label="Kurzanleitung zur Korrektur">
      <p class="text-sm text-indigo-700">
        Schritt {step + 1} von {screens.length}{" "}
        · Deine Eingaben bleiben erhalten.
      </p>
      {busy && (
        <p role="status" class="mt-2 rounded-xl bg-amber-50 p-3 text-sm">
          Die Korrektur läuft währenddessen weiter. Diese Anleitung startet
          keine neue Anfrage.
        </p>
      )}
      <h3
        ref={heading}
        tabIndex={-1}
        class="mt-4 text-xl font-bold text-slate-900"
      >
        {current.title}
      </h3>
      <p class="mt-3 font-semibold text-indigo-800">{current.invitation}</p>
      <div class="mt-4 space-y-3">
        {current.paragraphs.map((text) => (
          <p
            key={text}
            class="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700"
          >
            {text}
          </p>
        ))}
      </div>
      <nav
        class="mt-5 flex flex-wrap items-center gap-3"
        aria-label="Schritte der Kurzanleitung"
      >
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
          class="rounded-xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          Zurück
        </button>
        {step < screens.length - 1 && (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Weiter
          </button>
        )}
        <button
          type="button"
          onClick={onReturn}
          class="ml-auto rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700"
        >
          Zur Korrektur
        </button>
      </nav>
    </div>
  );
}
