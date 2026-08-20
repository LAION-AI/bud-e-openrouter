// utils/learningPaths.ts
//
// The content of the learning paths, as plain data. Keeping the text out of
// the component means a teacher can add a subject or fix a sentence without
// touching any rendering code, and the renderer stays free of raw HTML - every
// block below has a typed counterpart in LearningModal.tsx.

/** Every user facing string carries both languages side by side. */
export interface Localized {
  de: string;
  en: string;
}

export interface SourceLink {
  label: Localized;
  url: string;
}

/** Tone drives the colour of a callout, not its meaning - keep it readable. */
export type CalloutTone = "tip" | "note" | "try" | "fact" | "warn";

export interface TimelineEntry {
  year: string;
  title: Localized;
  text: Localized;
}

export interface StepEntry {
  title: Localized;
  text: Localized;
}

export interface StatEntry {
  value: string;
  label: Localized;
  hint?: Localized;
}

export type Block =
  | { kind: "lead"; text: Localized }
  | { kind: "heading"; text: Localized }
  | { kind: "paragraph"; text: Localized }
  | { kind: "list"; ordered?: boolean; items: Localized[] }
  | { kind: "steps"; items: StepEntry[] }
  | {
    kind: "callout";
    tone: CalloutTone;
    icon: string;
    title?: Localized;
    text: Localized;
  }
  | {
    kind: "table";
    caption?: Localized;
    head: Localized[];
    rows: Localized[][];
    highlightFirst?: boolean;
  }
  | { kind: "timeline"; entries: TimelineEntry[] }
  | { kind: "stats"; entries: StatEntry[] }
  | { kind: "quote"; text: Localized; source?: Localized }
  | { kind: "caption"; text: Localized }
  | { kind: "sources"; items: SourceLink[] };

export interface Screen {
  key: string;
  title: Localized;
  blocks: Block[];
}

// ------------------------------------------------------------- exercises

/**
 * Three exercises close every path, in rising difficulty:
 *
 *   cloze    - reproduce: a summary of the path with the nouns taken out
 *   compare  - relate two facts to each other, which reading alone will not
 *              answer
 *   reflect  - open question with no single right answer, meant to connect
 *              the topic to the world the pupil lives in
 *
 * No solutions are stored anywhere. Looking them up in the path is the point;
 * an answer key would only invite skipping straight to it.
 */
export type ExerciseKind = "cloze" | "compare" | "reflect";

export interface Exercise {
  kind: ExerciseKind;
  title: Localized;
  /** One line saying what to do. */
  intro: Localized;
  /**
   * For "cloze" the text carries the gaps, written as three underscores
   * (___). Each language has its own text, because a German sentence puts
   * its nouns elsewhere than an English one.
   */
  text: Localized;
  /** Optional nudge for the harder two - never the answer. */
  hint?: Localized;
}

/** Splits a cloze text into the parts around its gaps. */
export function clozeParts(text: string): string[] {
  return text.split("___");
}

/** Accent keys map to fixed Tailwind classes in the modal - see ACCENTS. */
export type Accent = "indigo" | "emerald" | "amber" | "rose" | "sky";

export interface LearningPath {
  key: string;
  title: Localized;
  summary: Localized;
  icon: string;
  accent: Accent;
  minutes: number;
  screens: Screen[];
  /** Shown on a closing screen and printed on the worksheet. */
  exercises?: Exercise[];
}

export interface Subject {
  key: string;
  title: Localized;
  description: Localized;
  icon: string;
  accent: Accent;
  paths: LearningPath[];
}

/** Falls back to English so a half translated string can never blank a page. */
export function pick(value: Localized, lang: string): string {
  return lang === "de" ? value.de : value.en;
}

// --------------------------------------------------------------- progress

const PROGRESS_KEY = "bude-learning-progress";

export interface Progress {
  /** Screen index reached per path key, so several paths can be open at once. */
  screens: Record<string, number>;
  lastSubject?: string;
  lastPath?: string;
}

const EMPTY_PROGRESS: Progress = { screens: {} };

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      screens: parsed.screens ?? {},
      lastSubject: parsed.lastSubject,
      lastPath: parsed.lastPath,
    };
  } catch {
    // Private mode or corrupt entry - starting fresh beats crashing the modal.
    return { ...EMPTY_PROGRESS };
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Reading works without a memory of where we were; fail quietly.
  }
}

export function findPath(
  pathKey: string,
): { subject: Subject; path: LearningPath } | null {
  for (const subject of subjects) {
    const path = subject.paths.find((p) => p.key === pathKey);
    if (path) return { subject, path };
  }
  return null;
}

// ------------------------------------------------------------- the content

const whatIsAComputer: LearningPath = {
  key: "what-is-a-computer",
  title: { de: "Was ist ein Computer?", en: "What is a computer?" },
  summary: {
    de:
      "Von Zahnrädern über glühende Röhren und geknackte Geheimcodes bis zu dem Gerät in deiner Hosentasche - die Geschichte einer Maschine, die alles verändert hat.",
    en:
      "From cogwheels through glowing tubes and broken secret codes to the device in your pocket - the story of a machine that changed everything.",
  },
  icon: "🖥️",
  accent: "indigo",
  minutes: 15,
  screens: [
    {
      key: "before-electricity",
      title: {
        de: "Als Computer noch Menschen waren",
        en: "When computers were people",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Wie viele Computer waren heute schon in deiner Nähe? Zähl ruhig mit: Handy, Kopfhörer, Smartwatch, der Bus, in dem du saßt, die Ampel an der Kreuzung, die Waschmaschine zu Hause, die Kasse im Supermarkt. Wahrscheinlich waren es dutzende - und die meisten davon sehen kein bisschen nach Computer aus.",
            en:
              "How many computers have been near you today? Count along: phone, headphones, smartwatch, the bus you sat in, the traffic light at the crossing, the washing machine at home, the till in the supermarket. Probably dozens - and most of them do not look remotely like a computer.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'Um zu verstehen, was diese Geräte gemeinsam haben, gehen wir weit zurück. Zu einer Zeit, in der "Computer" noch eine Berufsbezeichnung war.',
            en:
              'To understand what these devices have in common, we go a long way back. To a time when "computer" was still a job title.',
          },
        },
        {
          kind: "callout",
          tone: "fact",
          icon: "👩‍💼",
          title: {
            de: "Computer war ein Beruf",
            en: "Computer used to be a job",
          },
          text: {
            de:
              'Bis in die 1940er Jahre hinein war ein "computer" ein Mensch, der beruflich rechnete - meist Frauen, oft in großen Rechensälen, die stundenlang Tabellen für Astronomie, Artillerie oder Versicherungen ausrechneten. Als die Maschinen kamen, übernahmen sie erst den Beruf und dann den Namen.',
            en:
              'Right into the 1940s a "computer" was a person who calculated for a living - mostly women, often in large calculating rooms, working out tables for astronomy, artillery or insurance for hours on end. When the machines arrived, they first took over the job and then the name.',
          },
        },
        {
          kind: "heading",
          text: {
            de: "Die ersten Rechenmaschinen aus Zahnrädern",
            en: "The first calculating machines made of cogwheels",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Lange bevor jemand an Strom dachte, versuchten Erfinder, das Rechnen an Zahnräder auszulagern. Die Idee dahinter ist bis heute dieselbe wie in deinem Handy: Ein Vorgang, der im Kopf mühsam und fehleranfällig ist, wird in viele winzige, immer gleiche Schritte zerlegt - und die kann eine Maschine übernehmen.",
            en:
              "Long before anyone thought of electricity, inventors tried to hand calculation over to cogwheels. The idea behind it is still the same as in your phone: a task that is tiring and error prone in your head gets broken down into many tiny, always identical steps - and a machine can take those over.",
          },
        },
        {
          kind: "timeline",
          entries: [
            {
              year: "1623",
              title: {
                de: "Schickards Rechenuhr",
                en: "Schickard's calculating clock",
              },
              text: {
                de:
                  "Der Tübinger Gelehrte Wilhelm Schickard baut eine Maschine, die addieren und subtrahieren kann. Sie verbrennt bei einem Brand, bevor sie richtig benutzt wird - die Baupläne überleben in Briefen an den Astronomen Johannes Kepler.",
                en:
                  "The Tübingen scholar Wilhelm Schickard builds a machine that can add and subtract. It burns in a fire before it is properly used - the plans survive in letters to the astronomer Johannes Kepler.",
              },
            },
            {
              year: "1642",
              title: {
                de: "Pascals Rechenmaschine",
                en: "Pascal's calculator",
              },
              text: {
                de:
                  "Der neunzehnjährige Blaise Pascal baut für seinen Vater, einen Steuerbeamten, die Pascaline. Sie addiert und subtrahiert über ineinandergreifende Zifferräder - der erste mechanische Rechner, der tatsächlich in kleiner Stückzahl gebaut und verkauft wurde.",
                en:
                  "Nineteen year old Blaise Pascal builds the Pascaline for his father, a tax official. It adds and subtracts through interlocking number wheels - the first mechanical calculator that was actually built and sold in small numbers.",
              },
            },
            {
              year: "1673",
              title: {
                de: "Leibniz und die Staffelwalze",
                en: "Leibniz and the stepped drum",
              },
              text: {
                de:
                  "Gottfried Wilhelm Leibniz stellt eine Maschine vor, die zusätzlich multiplizieren und dividieren kann. Von ihm stammt auch die Beschreibung des Dualsystems - jener Rechnerei mit Einsen und Nullen, die dreihundert Jahre später jeden Chip antreiben wird.",
                en:
                  "Gottfried Wilhelm Leibniz presents a machine that can also multiply and divide. He also described the binary system - that arithmetic of ones and zeros which would drive every chip three hundred years later.",
              },
            },
            {
              year: "1834",
              title: {
                de: "Babbages Analytical Engine",
                en: "Babbage's Analytical Engine",
              },
              text: {
                de:
                  "Charles Babbage entwirft eine Maschine, die nicht nur eine Rechenart beherrscht, sondern Anweisungen von Lochkarten liest - also programmierbar ist. Gebaut wird sie zu seinen Lebzeiten nie: Sie war zu groß, zu teuer und für die Feinmechanik der Zeit zu anspruchsvoll.",
                en:
                  "Charles Babbage designs a machine that does not just master one kind of arithmetic but reads instructions from punched cards - in other words, it is programmable. It was never built in his lifetime: too large, too expensive and too demanding for the precision engineering of the day.",
              },
            },
            {
              year: "1843",
              title: {
                de: "Ada Lovelace schreibt das erste Programm",
                en: "Ada Lovelace writes the first program",
              },
              text: {
                de:
                  "Die Mathematikerin Ada Lovelace übersetzt einen Aufsatz über Babbages Maschine und ergänzt ihn um eigene Anmerkungen, die dreimal so lang sind wie der Text selbst. In der letzten steht die erste veröffentlichte Schritt-für-Schritt-Anleitung für so eine Maschine - weshalb sie oft die erste Programmiererin genannt wird. Fachleute streiten bis heute, wie viel davon von ihr und wie viel von Babbage stammt. Unbestritten ist der größere Gedanke: Sie erkannte als Erste, dass eine solche Maschine nicht nur Zahlen verarbeiten könnte, sondern beliebige Symbole - sogar Musik.",
                en:
                  "The mathematician Ada Lovelace translates an article about Babbage's machine and adds notes of her own that are three times as long as the text itself. The last of them contains the first published step by step procedure for such a machine - which is why she is often called the first programmer. Experts still argue over how much of it came from her and how much from Babbage. The larger idea is undisputed: she was the first to see that such a machine could process not only numbers but arbitrary symbols - even music.",
              },
            },
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Damit war die Idee da: eine Maschine, die Schritt für Schritt Anweisungen abarbeitet. Was noch fehlte, war Tempo. Zahnräder sind langsam, und sie nutzen sich ab. Es brauchte etwas, das schalten kann, ohne sich zu bewegen. Und es brauchte, so unangenehm das ist, einen Krieg.",
            en:
              "So the idea existed: a machine that works through instructions step by step. What was missing was speed. Cogwheels are slow and they wear out. Something was needed that could switch without moving. And, uncomfortable as it is, it took a war.",
          },
        },
      ],
    },
    {
      key: "war-and-tubes",
      title: {
        de: "Glühende Röhren und geknackte Codes",
        en: "Glowing tubes and broken codes",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Der Zweite Weltkrieg war die Zeit, in der aus einer Idee Maschinen wurden - weil plötzlich Regierungen bereit waren, Unsummen für Geräte auszugeben, die Zahlen schneller verarbeiten als Menschen.",
            en:
              "The Second World War was the time when an idea turned into machines - because governments were suddenly willing to spend fortunes on devices that process numbers faster than people can.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Die Maschine, die schneller schaltet als jedes Zahnrad",
            en: "The machine that switches faster than any cogwheel",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Zuerst kamen Relais: kleine Elektromagnete, die einen Kontakt zusammenziehen. Konrad Zuse baute daraus 1941 in Berlin die Z3 - eine der ersten funktionsfähigen, frei programmierbaren und vollautomatischen Rechenmaschinen der Welt, zusammengesetzt aus etwa 2.000 bis 2.400 Relais. 1943 wurde sie bei einem Luftangriff zerstört. Relais klappern aber, und sie sind für Maschinenverhältnisse träge.",
            en:
              "First came relays: small electromagnets that pull a contact together. In Berlin in 1941 Konrad Zuse used them to build the Z3 - one of the world's first working, freely programmable, fully automatic calculating machines, assembled from about 2,000 to 2,400 relays. It was destroyed in an air raid in 1943. But relays clatter, and by machine standards they are slow.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Die Vakuumröhre löste das Problem. In ihr fliegen Elektronen durch ein Vakuum, gesteuert von einem winzigen Signal - ein Schalter ohne bewegliche Teile, tausendfach schneller als ein Relais. Dafür ist sie so groß wie eine Glühbirne, wird heiß und brennt gelegentlich durch. Ein Rechner mit tausenden Röhren war ein Vollzeitjob für ein ganzes Wartungsteam.",
            en:
              "The vacuum tube solved that. Inside it electrons fly through a vacuum, steered by a tiny signal - a switch with no moving parts, a thousand times faster than a relay. In exchange it is the size of a light bulb, runs hot and occasionally burns out. A computer with thousands of tubes was a full time job for an entire maintenance team.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Enigma: Funksprüche, die niemand lesen konnte",
            en: "Enigma: radio messages nobody could read",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Die deutsche Wehrmacht verschlüsselte ihren Funkverkehr mit der Enigma, einer Maschine, die aussah wie eine Schreibmaschine mit Zusatzteilen. Drückte man einen Buchstaben, liefen mehrere Walzen weiter, und heraus kam ein anderer Buchstabe - beim nächsten Tastendruck ein völlig anderer, obwohl man dieselbe Taste drückte. Die Zahl der möglichen Einstellungen war astronomisch groß. Ohne die richtige Tageseinstellung war ein abgefangener Funkspruch reiner Buchstabensalat.",
            en:
              "The German armed forces encrypted their radio traffic with the Enigma, a machine that looked like a typewriter with extra parts. Press a letter and several rotors advanced, and out came a different letter - and on the next keypress a completely different one, even for the same key. The number of possible settings was astronomically large. Without the correct setting for the day, an intercepted message was pure alphabet soup.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Das Entscheidende daran: Über Funk wurden Konvois geleitet, U-Boote dirigiert und Angriffe koordiniert. Wer mitlesen konnte, wusste vorher, wo der Gegner sein würde.",
            en:
              "The crucial part: radio directed convoys, steered submarines and coordinated attacks. Whoever could read along knew in advance where the enemy would be.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Bletchley Park: das bestgehütete Geheimnis Großbritanniens",
            en: "Bletchley Park: Britain's best kept secret",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'In einem Landhaus nördlich von London arbeitete eine der ungewöhnlichsten Belegschaften der Geschichte: Mathematikerinnen und Mathematiker, Schachmeister, Kreuzworträtselprofis, Sprachtalente. Den ersten Durchbruch hatten schon vor dem Krieg drei polnische Mathematiker erzielt: Marian Rejewski, Henryk Zygalski und Jerzy Różycki. Im Juli 1939 gaben sie ihr Wissen bei einem geheimen Treffen im Wald von Pyry bei Warschau an britische und französische Kollegen weiter. In Bletchley Park entwickelten Alan Turing und Gordon Welchman daraus die "Bombe": eine elektromechanische Maschine, die mögliche Enigma-Einstellungen in rasendem Tempo durchprobierte und die falschen ausschloss. Die erste lief ab März 1940. Die Erkenntnisse, die aus all diesen entschlüsselten Funksprüchen gewonnen wurden, liefen unter dem Decknamen "Ultra".',
            en:
              'In a country house north of London worked one of the most unusual workforces in history: mathematicians, chess champions, crossword experts, gifted linguists. The first breakthrough had been achieved before the war by three Polish mathematicians: Marian Rejewski, Henryk Zygalski and Jerzy Różycki. In July 1939, at a secret meeting in the Pyry forest near Warsaw, they passed their knowledge to British and French colleagues. At Bletchley Park, Alan Turing and Gordon Welchman turned it into the "Bombe": an electromechanical machine that raced through possible Enigma settings and ruled out the wrong ones. The first one started work in March 1940. The intelligence gained from all these decrypted messages went under the codename "Ultra".',
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Für eine noch schwierigere deutsche Verschlüsselung, die Lorenz-Maschine, baute der Ingenieur Tommy Flowers den Colossus. Das erste Gerät lief ab Februar 1944 in Bletchley Park und enthielt rund 1.600 Vakuumröhren; die verbesserte Fassung ab Juni 1944 sogar etwa 2.400 bis 2.500. Colossus gilt als der erste programmierbare elektronische Digitalrechner der Welt. Nach dem Krieg wurden die meisten Geräte zerstört und die Arbeit blieb jahrzehntelang geheim; viele Beteiligte durften bis in die 1970er Jahre niemandem erzählen, was sie getan hatten.",
            en:
              "For an even harder German cipher, the Lorenz machine, the engineer Tommy Flowers built Colossus. The first one ran from February 1944 at Bletchley Park and held around 1,600 vacuum tubes; the improved version from June 1944 held some 2,400 to 2,500. Colossus is regarded as the world's first programmable electronic digital computer. After the war most machines were destroyed and the work stayed secret for decades; many of those involved were not allowed to tell anyone what they had done until the 1970s.",
          },
        },
        {
          kind: "callout",
          tone: "warn",
          icon: "🔁",
          title: {
            de: "Die Verwechslung, die fast alle machen",
            en: "The mix-up almost everyone makes",
          },
          text: {
            de:
              "Colossus hat die Enigma nicht geknackt. Gegen die Enigma lief die Bombe von Turing und Welchman; Colossus arbeitete gegen die Lorenz-Maschine, mit der die deutsche Führung ihre wichtigsten Nachrichten verschlüsselte. Die Enigma hatte drei bis vier Walzen, die Lorenz-Maschine zwölf. Wer diese beiden Maschinen auseinanderhält, hat in jeder Diskussion über Bletchley Park einen Punkt gut.",
            en:
              "Colossus did not crack Enigma. Against Enigma ran the Bombe by Turing and Welchman; Colossus worked against the Lorenz machine, with which the German high command encrypted its most important messages. Enigma had three or four rotors, the Lorenz machine had twelve. Anyone who can keep the two apart scores a point in any discussion about Bletchley Park.",
          },
        },
        {
          kind: "callout",
          tone: "note",
          icon: "⚖️",
          title: {
            de: "Wie sehr hat das den Krieg verkürzt?",
            en: "How much did this shorten the war?",
          },
          text: {
            de:
              'Sir Harry Hinsley, der offizielle Historiker des britischen Geheimdienstes im Zweiten Weltkrieg, sagte 1993 in einem Vortrag in Cambridge, die Entschlüsselungsarbeit habe den Krieg "um nicht weniger als zwei Jahre und wahrscheinlich um vier Jahre" verkürzt. Er betonte im selben Vortrag ausdrücklich, dass das kontrafaktische Geschichte sei - "ein ziemlich kühnes Unternehmen aus Hypothese und Spekulation". Die Alliierten hätten seiner Ansicht nach auch ohne Ultra gewonnen, aber erst nach einem "langen und viel brutaleren, zerstörerischeren Krieg".',
            en:
              'Sir Harry Hinsley, the official historian of British intelligence in the Second World War, said in a 1993 Cambridge lecture that the codebreaking work shortened the war "by not less than two years and probably by four years". In the same lecture he stressed explicitly that this is counter-factual history - "a pretty bold enterprise in hypothesis and speculation". In his view the Allies would have won without Ultra too, but only after "a long and much more brutal and destructive war".',
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Auf dem Höhepunkt arbeiteten rund 9.000 Menschen in Bletchley Park, etwa drei Viertel davon Frauen. Wer das nächste Mal hört, Informatik sei schon immer Männersache gewesen, darf gern widersprechen.",
            en:
              "At its peak around 9,000 people worked at Bletchley Park, roughly three quarters of them women. Next time somebody claims computing has always been a men's field, feel free to disagree.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "ENIAC: 27 Tonnen Rechenmaschine",
            en: "ENIAC: 27 tons of calculating machine",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "In den USA entstand parallel der ENIAC, 1945 fertiggestellt an der University of Pennsylvania. Er war ursprünglich für Artillerie-Berechnungen gedacht, wurde aber schon bald für Fragen der Atomforschung eingesetzt. Programmiert wurde er nicht mit Tastatur, sondern durch Umstecken von Kabeln und Umlegen von Schaltern - eine Arbeit, die ein Team von sechs Mathematikerinnen leistete, deren Namen lange vergessen waren.",
            en:
              "In the USA the ENIAC was built in parallel, completed in 1945 at the University of Pennsylvania. It was originally meant for artillery calculations but was soon used for questions in nuclear research. It was not programmed with a keyboard but by replugging cables and flipping switches - work done by a team of six women mathematicians whose names were forgotten for a long time.",
          },
        },
        {
          kind: "stats",
          entries: [
            {
              value: "~17.500",
              label: { de: "Vakuumröhren", en: "vacuum tubes" },
              hint: {
                de: "regelmäßig brannte eine durch",
                en: "one burned out regularly",
              },
            },
            {
              value: "~27 t",
              label: { de: "Gewicht", en: "weight" },
              hint: {
                de: "so viel wie vier Elefanten",
                en: "about four elephants",
              },
            },
            {
              value: "~150 kW",
              label: { de: "Stromverbrauch", en: "power draw" },
              hint: {
                de: "wie ein ganzes Wohnhaus",
                en: "like an entire apartment block",
              },
            },
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Diese Maschine, so groß wie ein Klassenzimmer, war schwächer als der billigste Taschenrechner, den du heute an der Supermarktkasse bekommst. Wie aus dem Klassenzimmer eine Hosentasche wurde, steht auf der nächsten Seite.",
            en:
              "This machine, the size of a classroom, was weaker than the cheapest pocket calculator you can pick up at a supermarket checkout today. How the classroom became a trouser pocket is on the next screen.",
          },
        },
      ],
    },
    {
      key: "transistor-and-mainframes",
      title: {
        de: "Der Transistor und die große Schrumpfkur",
        en: "The transistor and the great shrinking",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Am 23. Dezember 1947 führten John Bardeen und Walter Brattain in den Bell Labs in New Jersey ihren Vorgesetzten ein unscheinbares Gebilde aus Germanium, Goldfolie und einem Plastikkeil vor. Es war der erste Transistor - und der Anfang von so ziemlich allem.",
            en:
              "On 23 December 1947 John Bardeen and Walter Brattain demonstrated an unremarkable arrangement of germanium, gold foil and a plastic wedge to their superiors at Bell Labs in New Jersey. It was the first transistor - and the beginning of pretty much everything.",
          },
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "🔀",
          title: {
            de: "Was ein Transistor eigentlich ist",
            en: "What a transistor actually is",
          },
          text: {
            de:
              "Ein Transistor ist im Kern ein sehr einfacher Schalter. Er hat drei Anschlüsse: An zweien soll Strom fließen, der dritte entscheidet, ob er das darf. Ein kleines Signal am Steueranschluss schaltet einen größeren Stromfluss an oder aus. Kein Klappern, kein Glühen, kein Verschleiß - und man kann ihn schrumpfen. Genau daraus baut man alles: Rechenwerke, Speicher, Grafikchips, KI-Beschleuniger.",
            en:
              "At heart a transistor is a very simple switch. It has three terminals: current is meant to flow between two of them, and the third decides whether it may. A small signal at the control terminal switches a larger current on or off. No clatter, no glow, no wear - and it can be made smaller. Everything is built from this: arithmetic units, memory, graphics chips, AI accelerators.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "William Shockley, der Leiter der Gruppe, entwickelte die Idee weiter zum robusteren Flächentransistor, der sich in Serie fertigen ließ: gedacht im Januar 1948, gebaut 1950, vorgestellt 1951. 1956 erhielten die drei gemeinsam den Nobelpreis für Physik. Die eigentliche Revolution kam aber erst mit dem nächsten Schritt: Ende der 1950er Jahre gelang es Jack Kilby und, unabhängig davon, Robert Noyce, mehrere Transistoren samt Verdrahtung auf ein einziges Stück Halbleiter zu setzen - der integrierte Schaltkreis, der Chip.",
            en:
              "William Shockley, who led the group, developed the idea into the sturdier junction transistor that could be mass produced: conceived in January 1948, built in 1950, presented in 1951. In 1956 the three shared the Nobel Prize in Physics. The real revolution came with the next step though: in the late 1950s Jack Kilby and, independently, Robert Noyce managed to put several transistors and their wiring onto a single piece of semiconductor - the integrated circuit, the chip.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Ab da ließ sich Rechenleistung nicht mehr nur bauen, sondern drucken. Und Gedrucktes lässt sich verkleinern.",
            en:
              "From then on computing power was no longer just built, it was printed. And printed things can be made smaller.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Großrechner: die Maschinen im Keller",
            en: "Mainframes: the machines in the basement",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "In den 1950er und 1960er Jahren waren Computer riesige, teure Anlagen in klimatisierten Räumen, die sich nur Regierungen, Universitäten, Banken und Großkonzerne leisten konnten. Man kaufte keinen Computer, man mietete Rechenzeit. Wer etwas rechnen wollte, gab einen Stapel Lochkarten ab und holte am nächsten Tag den Ausdruck.",
            en:
              "In the 1950s and 1960s computers were huge, expensive installations in air conditioned rooms, affordable only to governments, universities, banks and large corporations. You did not buy a computer, you rented computing time. If you wanted something calculated you handed in a stack of punched cards and collected the printout the next day.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Im Kalten Krieg wurden diese Großrechner zu strategischen Werkzeugen: für Luftraumüberwachung, für Wettervorhersagen, für Verschlüsselung und deren Gegenteil, für die Berechnung von Raketenbahnen. Und für die Raumfahrt: Der Bordcomputer der Apollo-Mondlandefähre wog etwa 32 Kilogramm und hatte weniger Speicher, als heute in einem einzigen Foto steckt - aber er brachte Menschen zum Mond und zurück.",
            en:
              "During the Cold War these mainframes became strategic tools: for air defence, weather forecasting, encryption and its opposite, and for calculating missile trajectories. And for spaceflight: the guidance computer of the Apollo lunar module weighed about 32 kilograms and had less memory than a single photo takes up today - yet it took humans to the Moon and back.",
          },
        },
        {
          kind: "callout",
          tone: "fact",
          icon: "🧊",
          title: {
            de: "Der Satz, den man gern zitiert",
            en: "The quote everyone likes to repeat",
          },
          text: {
            de:
              "In den 1940er Jahren sollen führende Köpfe geglaubt haben, weltweit brauche man nur eine Handvoll Computer. Ob dieser Satz je genau so gefallen ist, ist historisch umstritten - er ist aber ein hübsches Denkmal dafür, wie schwer es ist, exponentielles Wachstum vorherzusehen. Genau darum geht es im vierten Lernpfad.",
            en:
              "In the 1940s leading figures are said to have believed the world would only need a handful of computers. Whether that sentence was ever really said is historically disputed - but it is a neat monument to how hard exponential growth is to foresee. Which is exactly what the fourth path is about.",
          },
        },
      ],
    },
    {
      key: "computers-come-home",
      title: {
        de: "Der Computer zieht zu Hause ein",
        en: "The computer moves in at home",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "In den 1970er Jahren passierte etwas, mit dem kaum jemand gerechnet hatte: Computer wurden billig genug, dass Privatleute sie kaufen konnten. Nicht Firmen. Nicht Universitäten. Menschen.",
            en:
              "In the 1970s something happened that almost nobody had expected: computers became cheap enough for private people to buy. Not companies. Not universities. People.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Erst im Büro: die Tabelle, die alles verkaufte",
            en: "First in the office: the spreadsheet that sold everything",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "In Firmen setzte sich der Computer zuerst dort durch, wo stumpfe Rechenarbeit anfiel: Buchhaltung, Lohnabrechnung, Lagerverwaltung. Den größten Schub gab 1979 ein Programm namens VisiCalc - die erste Tabellenkalkulation. Plötzlich konnte man eine Zahl ändern und alle anderen rechneten sich von selbst neu aus. Buchhalter kauften sich einen Apple II, nur um dieses eine Programm zu benutzen. So etwas nennt man seither eine Killer-App.",
            en:
              "In companies the computer first took hold where dull arithmetic piled up: bookkeeping, payroll, stock control. The biggest push came in 1979 from a program called VisiCalc - the first spreadsheet. Suddenly you could change one number and all the others recalculated themselves. Accountants bought an Apple II purely to use that one program. Ever since, that is what people call a killer app.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Dann im Kinderzimmer: Pong, Pac-Man und der C64",
            en: "Then in the bedroom: Pong, Pac-Man and the C64",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Parallel dazu entdeckte die Welt, dass Computer Spaß machen. Im selben Jahr 1972 kamen gleich zwei Dinge auf den Markt: die Magnavox Odyssey, die erste Spielkonsole für den Fernseher zu Hause, entworfen von Ralph Baer - und der Spielautomat Pong von Atari, den Nolan Bushnell in Auftrag gab und der Ingenieur Allan Alcorn baute. Pong bestand aus zwei weißen Strichen, einem weißen Quadrat und Tischtennis. Die Legende sagt, der erste Automat sei ausgefallen, weil die Münzbox überquoll. 1975 kam Pong als Gerät für zu Hause in den Handel und wurde zum Weihnachtsgeschenk der Saison. 1978 folgte Space Invaders von Taito, 1980 Pac-Man von Namco - und Videospiele waren endgültig ein Massenphänomen.",
            en:
              "At the same time the world discovered that computers are fun. In that same year, 1972, two things arrived: the Magnavox Odyssey, the first games console for the television at home, designed by Ralph Baer - and Atari's Pong arcade cabinet, commissioned by Nolan Bushnell and built by engineer Allan Alcorn. Pong consisted of two white bars, one white square and table tennis. Legend has it the first machine broke down because the coin box overflowed. In 1975 Pong went on sale as a home device and became the Christmas present of the season. Space Invaders by Taito followed in 1978, Pac-Man by Namco in 1980 - and video games were a mass phenomenon for good.",
          },
        },
        {
          kind: "timeline",
          entries: [
            {
              year: "1975",
              title: {
                de: "Altair 8800 - der Bausatz",
                en: "Altair 8800 - the kit",
              },
              text: {
                de:
                  "Ein Gerät ohne Bildschirm und ohne Tastatur, bedient über Kippschalter und Leuchtdioden. Man musste es selbst zusammenlöten. Und trotzdem wollten es tausende Bastler haben - für zwei junge Programmierer namens Paul Allen und Bill Gates war es der Anlass, eine Firma zu gründen.",
                en:
                  "A device without a screen or keyboard, operated through toggle switches and LEDs. You had to solder it together yourself. And still thousands of hobbyists wanted one - for two young programmers called Paul Allen and Bill Gates it was the reason to found a company.",
              },
            },
            {
              year: "1977",
              title: {
                de: "Apple II, Commodore PET und TRS-80",
                en: "Apple II, Commodore PET and TRS-80",
              },
              text: {
                de:
                  "Drei fertige Computer im selben Jahr, die man auspacken, anschließen und benutzen konnte. Der Apple II hatte Farbe und wurde zum Liebling von Schulen und Buchhaltungen.",
                en:
                  "Three ready made computers in the same year that you could unpack, plug in and use. The Apple II had colour and became the darling of schools and accounting offices.",
              },
            },
            {
              year: "1981",
              title: {
                de: "Der IBM PC",
                en: "The IBM PC",
              },
              text: {
                de:
                  "IBM, der Konzern der Großrechner, baut einen Kleincomputer - aus zugekauften Standardteilen. Andere Hersteller bauen ihn nach, und aus dem Gerät wird ein Standard, dessen Urenkel heute in jedem Büro steht.",
                en:
                  "IBM, the mainframe corporation, builds a small computer - out of bought in standard parts. Other manufacturers copy it, and the device becomes a standard whose great grandchildren sit in every office today.",
              },
            },
            {
              year: "1982",
              title: {
                de: "Commodore 64 - der Heimcomputer schlechthin",
                en: "Commodore 64 - the home computer",
              },
              text: {
                de:
                  "Bezahlbar, farbig, mit gutem Sound und tausenden Spielen. Der C64 gilt als das meistverkaufte Computermodell aller Zeiten; das Guinness-Buch der Rekorde führt heute rund 12,5 Millionen verkaufte Geräte zwischen 1982 und 1994. Für eine ganze Generation war er das Gerät, an dem sie das Programmieren gelernt hat - oft, weil man ein Spiel Zeile für Zeile abtippen musste, das in einer Zeitschrift abgedruckt war.",
                en:
                  "Affordable, colourful, with good sound and thousands of games. The C64 is regarded as the best selling single computer model of all time; Guinness World Records today lists around 12.5 million units sold between 1982 and 1994. For a whole generation it was the machine on which they learned to program - often because you had to type in a game line by line from a magazine.",
              },
            },
          ],
        },
        {
          kind: "heading",
          text: {
            de: "Und heute?",
            en: "And today?",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Die spannendste Entwicklung ist, dass der Computer aufgehört hat, wie ein Computer auszusehen. Suchst du in deiner Wohnung nach Rechnern, findest du zum Beispiel:",
            en:
              "The most interesting development is that the computer stopped looking like a computer. Go hunting for processors in your home and you will find, for example:",
          },
        },
        {
          kind: "list",
          items: [
            {
              de:
                "im Handy: mehrere Prozessoren gleichzeitig - einen für Programme, einen für Grafik, einen eigenen nur für KI-Aufgaben",
              en:
                "in your phone: several processors at once - one for programs, one for graphics, and a separate one just for AI tasks",
            },
            {
              de:
                "in der Waschmaschine: ein kleiner Chip, der Wassermenge, Temperatur und Schleuderdrehzahl steuert",
              en:
                "in the washing machine: a small chip controlling water level, temperature and spin speed",
            },
            {
              de:
                "in kabellosen Kopfhörern: ein Rechner, der Umgebungsgeräusche misst und in Echtzeit den Gegenschall erzeugt",
              en:
                "in wireless headphones: a computer that measures ambient noise and generates the counter sound in real time",
            },
            {
              de:
                "im Auto: je nach Modell mehr als hundert kleine Steuergeräte, vom Airbag bis zum Scheibenwischer",
              en:
                "in a car: depending on the model, more than a hundred little control units, from the airbag to the windscreen wiper",
            },
            {
              de:
                "auf der Bankkarte: ein winziger Chip, der Geheimnisse berechnen kann, ohne sie preiszugeben",
              en:
                "on your bank card: a tiny chip that can compute secrets without revealing them",
            },
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Heute ist der Computer nicht mehr ein Gerät, sondern ein Bauteil. Er steckt in deinem Handy, im Auto, im Fahrkartenautomaten, im Herzschrittmacher, im Roboterstaubsauger, im Fußballstadion und in der Ampel. Er hilft, Wettervorhersagen zu rechnen, Medikamente zu entwerfen, Erdbeben zu erkennen, Filme zu erschaffen. Und er steckt in den Rechenzentren, in denen die KI-Modelle laufen, mit denen du dich unterhältst - so wie gerade eben mit diesem Lernpfad.",
            en:
              "Today the computer is no longer a device but a component. It sits in your phone, in the car, in the ticket machine, in the pacemaker, in the robot vacuum, in the football stadium and in the traffic light. It helps forecast weather, design medicines, detect earthquakes, create films. And it sits in the data centres where the AI models run that you talk to - just as you did a moment ago with this learning path.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Von Pascals Zahnrädern bis zu dem Gerät in deiner Hosentasche sind nicht einmal 400 Jahre vergangen. Und wenn du weiterliest, siehst du: Das Tempo hat sich nicht verlangsamt, im Gegenteil. Es ist eine ziemlich gute Zeit, neugierig zu sein.",
            en:
              "Not even 400 years have passed between Pascal's cogwheels and the device in your pocket. And if you read on, you will see: the pace has not slowed down, quite the opposite. It is a rather good time to be curious.",
          },
        },
        {
          kind: "sources",
          items: [
            {
              label: {
                de:
                  "Computer History Museum: Zeitleiste der Computergeschichte",
                en: "Computer History Museum: timeline of computer history",
              },
              url: "https://www.computerhistory.org/timeline/",
            },
            {
              label: {
                de: "Bletchley Park: Geschichte, Enigma und die Bombe",
                en: "Bletchley Park: history, Enigma and the Bombe",
              },
              url: "https://bletchleypark.org.uk/our-story/",
            },
            {
              label: {
                de:
                  "The National Museum of Computing: Colossus und die Lorenz-Maschine",
                en:
                  "The National Museum of Computing: Colossus and the Lorenz machine",
              },
              url: "https://www.tnmoc.org/colossus",
            },
            {
              label: {
                de:
                  "The National Museum of Computing: die Turing-Welchman-Bombe",
                en:
                  "The National Museum of Computing: the Turing-Welchman Bombe",
              },
              url: "https://www.tnmoc.org/bombe",
            },
            {
              label: {
                de: "GCHQ: das Treffen im Wald von Pyry, Juli 1939",
                en: "GCHQ: the Pyry forest meeting, July 1939",
              },
              url:
                "https://www.gchq.gov.uk/information/the-pyry-forest-meeting",
            },
            {
              label: {
                de:
                  'Harry Hinsley, "The Influence of ULTRA in the Second World War", Vortrag in Cambridge 1993',
                en:
                  'Harry Hinsley, "The Influence of ULTRA in the Second World War", Cambridge lecture 1993',
              },
              url: "https://www.cix.co.uk/~klockstone/hinsley.htm",
            },
            {
              label: {
                de:
                  "University of Pennsylvania: ENIAC (17.468 Röhren, rund 27 Tonnen, etwa 150 kW)",
                en:
                  "University of Pennsylvania: ENIAC (17,468 tubes, about 27 tons, some 150 kW)",
              },
              url:
                "https://www.engineering.upenn.edu/about/history-heritage/eniac/",
            },
            {
              label: {
                de: "Nobelpreis für Physik 1956: Shockley, Bardeen, Brattain",
                en: "Nobel Prize in Physics 1956: Shockley, Bardeen, Brattain",
              },
              url: "https://www.nobelprize.org/prizes/physics/1956/summary/",
            },
            {
              label: {
                de: "Computer History Museum: Der erste Transistor",
                en: "Computer History Museum: the first transistor",
              },
              url:
                "https://www.computerhistory.org/siliconengine/the-first-transistor/",
            },
            {
              label: {
                de:
                  "Computer History Museum: Ada Lovelace und ihre Anmerkungen von 1843",
                en: "Computer History Museum: Ada Lovelace and her 1843 notes",
              },
              url: "https://www.computerhistory.org/babbage/adalovelace/",
            },
            {
              label: {
                de:
                  "Guinness World Records: meistverkaufter Heimcomputer (Commodore 64)",
                en:
                  "Guinness World Records: best selling desktop computer (C64)",
              },
              url:
                "https://www.guinnessworldrecords.com/world-records/72695-most-computer-sales",
            },
            {
              label: {
                de: "The Strong National Museum of Play: Pong (Atari, 1972)",
                en: "The Strong National Museum of Play: Pong (Atari, 1972)",
              },
              url: "https://www.museumofplay.org/games/pong/",
            },
          ],
        },
      ],
    },
  ],
  exercises: [
    {
      kind: "cloze",
      title: {
        de: "1. Lückentext: die Geschichte in acht Sätzen",
        en: "1. Fill in the blanks: the story in eight sentences",
      },
      intro: {
        de:
          "Setze die fehlenden Wörter ein. Alle Antworten stehen irgendwo in diesem Lernpfad - blättere ruhig zurück.",
        en:
          "Fill in the missing words. Every answer is somewhere in this path - feel free to page back.",
      },
      text: {
        de:
          'Bis in die 1940er Jahre war ein "Computer" gar keine Maschine, sondern ein ___, der beruflich rechnete. Die ersten Rechenmaschinen arbeiteten mit ___, die man von Hand drehte - eine Idee, die schon Pascal und Leibniz verfolgten. Schnell wurde das Rechnen erst, als man die Mechanik durch Elektrik ersetzte: zuerst durch ___, die hörbar klickten, dann durch ___, in denen Elektronen ohne bewegliche Teile flogen. 1947 kam in den Bell Labs der ___ dazu, im Kern nichts anderes als ein sehr einfacher ___. Im Zweiten Weltkrieg verschlüsselte die deutsche Wehrmacht ihren Funkverkehr mit der ___, und in Bletchley Park arbeiteten rund 9.000 Menschen daran, genau das zu knacken. In den USA entstand 1945 der ___, eine Maschine so groß wie ein Klassenzimmer. Ab den 1970er Jahren wurden Computer billig genug für Privatleute - der meistverkaufte Heimcomputer wurde der ___.',
        en:
          'Well into the 1940s a "computer" was not a machine at all but a ___ who calculated for a living. The first calculating machines worked with ___ turned by hand - an idea already pursued by Pascal and Leibniz. Calculating only became fast once the mechanics were replaced by electrics: first by ___ that clicked audibly, then by ___ in which electrons flew with no moving parts at all. In 1947 the Bell Labs added the ___, at heart nothing more than a very simple ___. During the Second World War the German forces encrypted their radio traffic with the ___, and some 9,000 people at Bletchley Park worked on breaking exactly that. In the United States the ___ was finished in 1945, a machine the size of a classroom. From the 1970s computers became cheap enough for private households - the best selling home computer of all was the ___.',
      },
    },
    {
      kind: "compare",
      title: {
        de: "2. Vergleiche: drei Schalter, dieselbe Aufgabe",
        en: "2. Compare: three switches, the same job",
      },
      intro: {
        de:
          "Diese Frage steht nicht wörtlich im Text. Du musst zwei Dinge miteinander in Beziehung setzen.",
        en:
          "This question is not answered word for word in the text. You have to relate two things to each other.",
      },
      text: {
        de:
          "Relais, Vakuumröhre und Transistor tun im Grunde alle dasselbe: Sie schalten Strom an und aus. Trotzdem war jeder Wechsel ein gewaltiger Sprung. Erkläre an mindestens zwei Eigenschaften - zum Beispiel Größe, Geschwindigkeit, Hitze oder Zuverlässigkeit -, warum der ENIAC mit seinen 17.500 Röhren 27 Tonnen wog und 150 Kilowatt verbrauchte, ein heutiges Handy aber mit Milliarden Schaltern in die Hosentasche passt.",
        en:
          "Relays, vacuum tubes and transistors all do fundamentally the same thing: they switch current on and off. Each change was still an enormous leap. Using at least two properties - size, speed, heat or reliability, say - explain why ENIAC with its 17,500 tubes weighed 27 tonnes and drew 150 kilowatts, while a phone today fits billions of switches into your pocket.",
      },
      hint: {
        de:
          "Denke daran, was passiert, wenn eine einzelne Röhre durchbrennt - und wie oft das bei 17.500 Stück vorkommt.",
        en:
          "Think about what happens when a single tube burns out - and how often that happens when there are 17,500 of them.",
      },
    },
    {
      kind: "reflect",
      title: {
        de: "3. Zum Nachdenken: der Computer, den man nicht sieht",
        en: "3. Something to think about: the computer you never see",
      },
      intro: {
        de:
          "Auf diese Frage gibt es keine richtige Antwort. Schreib auf, was du denkst.",
        en: "There is no right answer to this one. Write down what you think.",
      },
      text: {
        de:
          "Der Computer hat aufgehört, wie ein Computer auszusehen. Er steckt in der Ampel, im Herzschrittmacher, im Auto und in deinen Kopfhörern. Geh in Gedanken durch deinen gestrigen Tag und suche drei Computer, die du gar nicht als solche wahrgenommen hast. Und dann: Was verändert sich für uns, wenn wir dauernd von Rechnern umgeben sind, die wir nicht mehr als Rechner erkennen - im Guten wie im Bedenklichen?",
        en:
          "Computers have stopped looking like computers. There is one in the traffic light, in a pacemaker, in the car and in your headphones. Walk through yesterday in your head and find three computers you never noticed as such. And then: what changes for us when we are surrounded by machines we no longer recognise as machines - for better and for worse?",
      },
    },
  ],
};

const bitsAndBytes: LearningPath = {
  key: "bits-and-bytes",
  title: { de: "Von Bits und Bytes", en: "Of bits and bytes" },
  summary: {
    de:
      "Computer sprechen angeblich Einsen und Nullen. In Wirklichkeit sprechen sie Strom an und Strom aus - und mit deiner linken Hand kannst du das nachmachen.",
    en:
      "Computers supposedly speak ones and zeros. What they really speak is power on and power off - and your left hand can do the same trick.",
  },
  icon: "✋",
  accent: "emerald",
  minutes: 12,
  screens: [
    {
      key: "power-on-off",
      title: { de: "Strom an, Strom aus", en: "Power on, power off" },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Dein Handy spielt Videos ab, erkennt dein Gesicht und rechnet dir in Sekunden aus, wie lange du bis zur Schule brauchst. Und tief im Inneren macht es dabei die ganze Zeit nur eines: Es schaltet Strom an und wieder aus. Milliardenfach in jeder Sekunde.",
            en:
              "Your phone plays videos, recognises your face and works out in seconds how long you need to get to school. And deep inside it does exactly one thing the whole time: it switches electricity on and off again. Billions of times every second.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Das klingt fast zu einfach, um wahr zu sein. Wie kann aus An und Aus ein Musikvideo werden? Die Antwort ist der Grund, warum es sich lohnt, diesen Lernpfad zu Ende zu lesen.",
            en:
              "That sounds almost too simple to be true. How do on and off turn into a music video? The answer is the reason this path is worth reading to the end.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Ein Lichtschalter, mehr ist es nicht",
            en: "A light switch, nothing more",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Stell dir den Lichtschalter in deinem Zimmer vor. Er kennt genau zwei Zustände: an oder aus. Dazwischen gibt es nichts. Genau so ein Schalter steckt milliardenfach in jedem Computerchip - nur ist er winzig klein, hat keine bewegten Teile und wird nicht von deinem Finger umgelegt, sondern von einem anderen elektrischen Signal.",
            en:
              "Picture the light switch in your room. It knows exactly two states: on or off. There is nothing in between. That very switch sits billions of times over inside every computer chip - only it is tiny, has no moving parts, and is flipped not by your finger but by another electrical signal.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Diese Schalter waren nicht immer winzig. Sie haben eine kleine Familiengeschichte:",
            en:
              "These switches were not always tiny. They have a little family history:",
          },
        },
        {
          kind: "timeline",
          entries: [
            {
              year: "1930er",
              title: {
                de: "Das Relais - ein Schalter, der klickt",
                en: "The relay - a switch that clicks",
              },
              text: {
                de:
                  "Ein Elektromagnet zieht ein Metallplättchen an und schließt damit einen zweiten Stromkreis. Konrad Zuses Z3 von 1941 arbeitete mit etwa 2.000 bis 2.400 solcher Relais. Der Rechner klapperte beim Rechnen hörbar - und brauchte für eine einzige Addition nicht ganz eine Sekunde.",
                en:
                  "An electromagnet pulls a small metal plate and closes a second circuit. Konrad Zuse's Z3 from 1941 used about 2,000 to 2,400 such relays. The machine audibly clattered while it worked - and needed just under a second for a single addition.",
              },
            },
            {
              year: "1940er",
              title: {
                de: "Die Vakuumröhre - ein Schalter, der glüht",
                en: "The vacuum tube - a switch that glows",
              },
              text: {
                de:
                  "Eine Glasröhre, in der Elektronen durch ein Vakuum fliegen. Keine beweglichen Teile mehr, also tausendfach schneller als ein Relais. Dafür heiß, zerbrechlich und stromhungrig: Der ENIAC von 1945 hatte rund 17.500 davon, wog etwa 27 Tonnen und brauchte etwa 150 Kilowatt - so viel wie ein ganzes Wohnhaus.",
                en:
                  "A glass tube in which electrons fly through a vacuum. No moving parts any more, so a thousand times faster than a relay. But hot, fragile and power hungry: the 1945 ENIAC had around 17,500 of them, weighed about 27 tons and drew roughly 150 kilowatts - as much as an entire apartment block.",
              },
            },
            {
              year: "1947",
              title: {
                de: "Der Transistor - ein Schalter ohne Glas",
                en: "The transistor - a switch without glass",
              },
              text: {
                de:
                  "In den Bell Labs in den USA gelingt John Bardeen und Walter Brattain im Dezember 1947 der erste Transistor. Er macht dasselbe wie Relais und Röhre, aber ohne Klappern, ohne Glühen, mit einem Bruchteil des Stroms - und er lässt sich schrumpfen.",
                en:
                  "At Bell Labs in the USA, John Bardeen and Walter Brattain built the first transistor in December 1947. It does the same job as relay and tube, but without clatter, without glowing, on a fraction of the power - and it can be made smaller.",
              },
            },
            {
              year: "heute",
              title: {
                de: "Milliarden auf einem Daumennagel",
                en: "Billions on a thumbnail",
              },
              text: {
                de:
                  "In dem Chip, der dein Handy antreibt, sitzen mehrere Milliarden dieser Schalter auf einer Fläche kleiner als ein Daumennagel. Wie es dazu kam, erzählt der Lernpfad über exponentielles Wachstum.",
                en:
                  "The chip that drives your phone holds several billion of these switches on an area smaller than a thumbnail. How that happened is the story of the path about exponential growth.",
              },
            },
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "🔌",
          title: {
            de: "Das Wichtigste in einem Satz",
            en: "The key idea in one sentence",
          },
          text: {
            de:
              "Ein Transistor ist im Kern nichts anderes als ein sehr einfacher Schalter: Ein kleines Signal an einem Anschluss entscheidet, ob am anderen Strom fließt oder nicht. Alles, was ein Computer kann, baut auf diesem einen Trick auf.",
            en:
              "At heart a transistor is nothing but a very simple switch: a small signal at one terminal decides whether current flows at the other or not. Everything a computer can do is built on that single trick.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Ein Morsecode aus An und Aus",
            en: "A morse code of on and off",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Beim Morsen gibt es nur kurz und lang - und trotzdem lässt sich damit jeder Satz in jeder Sprache übertragen, weil die Reihenfolge die Bedeutung trägt. Im Computer ist es genauso, nur mit an und aus. Eine einzelne Leitung, die an oder aus ist, sagt wenig. Acht Leitungen nebeneinander sagen schon eine Menge. Und Millionen davon, in der richtigen Reihenfolge, ergeben ein Video.",
            en:
              "Morse code only knows short and long - and still it can carry any sentence in any language, because the order carries the meaning. Inside a computer it is the same, only with on and off. A single wire that is on or off says very little. Eight wires side by side already say quite a lot. And millions of them, in the right order, add up to a video.",
          },
        },
        {
          kind: "callout",
          tone: "fact",
          icon: "💡",
          title: {
            de: "Warum alle von Einsen und Nullen reden",
            en: "Why everyone talks about ones and zeros",
          },
          text: {
            de:
              'Es ist ziemlich unpraktisch, "an aus aus an an aus an aus" aufzuschreiben. Also schreiben wir für "an" eine 1 und für "aus" eine 0: 10011010. Deshalb heißt es, Computer sprächen Einsen und Nullen. In Wirklichkeit sprechen sie die Sprache von Strom an und Strom aus - die Einsen und Nullen sind nur unsere Schreibweise dafür, damit wir Menschen mitkommen.',
            en:
              'Writing down "on off off on on off on off" is pretty awkward. So we write 1 for "on" and 0 for "off": 10011010. That is why people say computers speak ones and zeros. In reality they speak the language of power on and power off - the ones and zeros are just our notation, so that we humans can follow along.',
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Ein solcher einzelner Wert - an oder aus, 1 oder 0 - heißt Bit. Das ist die kleinste Informationseinheit, die es gibt. Auf der nächsten Seite baust du dir mit deiner eigenen Hand einen kleinen Computer aus Bits.",
            en:
              "One such single value - on or off, 1 or 0 - is called a bit. It is the smallest unit of information there is. On the next screen you will build a small computer out of bits using your own hand.",
          },
        },
      ],
    },
    {
      key: "hand-experiment",
      title: {
        de: "Das Handexperiment: Zählen mit drei Fingern",
        en: "The hand experiment: counting on three fingers",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Jetzt wird mitgemacht. Wenn du diesen Bildschirm nur liest, ohne die Hand zu benutzen, funktioniert es nur halb. Also: linke Hand hoch.",
            en:
              "Time to join in. If you only read this screen without using your hand, it only half works. So: left hand up.",
          },
        },
        {
          kind: "callout",
          tone: "try",
          icon: "✋",
          title: { de: "Vorbereitung", en: "Getting ready" },
          text: {
            de:
              "Halte deine linke Hand locker vor dich, die Handfläche zeigt zu dir. Du schaust also auf deine eigene Handinnenfläche. Alle Finger sind eingeklappt, die Hand ist eine lockere Faust. Bereit?",
            en:
              "Hold your left hand loosely in front of you, palm facing you. So you are looking at your own palm. All fingers are folded in, the hand is a relaxed fist. Ready?",
          },
        },
        {
          kind: "steps",
          items: [
            {
              title: {
                de: "Der Daumen ist dein erstes Bit",
                en: "Your thumb is your first bit",
              },
              text: {
                de:
                  "Daumen ausgeklappt bedeutet 1, Daumen eingeklappt bedeutet 0. Mehr kann ein Bit nicht: zwei mögliche Werte, sonst nichts. Klapp ihn ein paarmal auf und zu - du schaltest gerade genau das, was in einem Chip ein Transistor schaltet.",
                en:
                  "Thumb out means 1, thumb folded in means 0. That is all a bit can do: two possible values, nothing else. Flip it open and closed a few times - you are switching exactly what a transistor switches inside a chip.",
              },
            },
            {
              title: {
                de: "Der Zeigefinger ist das zweite Bit - und er zählt doppelt",
                en: "The index finger is the second bit - and it counts double",
              },
              text: {
                de:
                  "Klapp den Daumen wieder ein und streck nur den Zeigefinger aus. Das ist nicht die 1, sondern die 2. Jeder Finger weiter links ist doppelt so viel wert wie sein Nachbar rechts: Daumen 1, Zeigefinger 2.",
                en:
                  "Fold the thumb back in and stretch out only the index finger. That is not 1, it is 2. Each finger further left is worth twice as much as its neighbour to the right: thumb 1, index finger 2.",
              },
            },
            {
              title: {
                de: "Zwei Finger können schon vier Werte",
                en: "Two fingers already manage four values",
              },
              text: {
                de:
                  "Alle eingeklappt ist 0. Nur der Daumen ist 1. Nur der Zeigefinger ist 2. Daumen und Zeigefinger zusammen sind 1 + 2 = 3. Das sind vier verschiedene Werte mit nur zwei Fingern. Probier alle vier durch, bevor du weiterliest.",
                en:
                  "All folded in is 0. Thumb only is 1. Index finger only is 2. Thumb and index finger together are 1 + 2 = 3. That is four different values with just two fingers. Try all four before reading on.",
              },
            },
            {
              title: {
                de: "Der Mittelfinger ist das dritte Bit und zählt 4",
                en: "The middle finger is the third bit and counts 4",
              },
              text: {
                de:
                  "Ja, ausgerechnet der. Er ist in der Mathematik völlig unschuldig und steht hier einfach für die 4. Damit sich niemand angesprochen fühlt: Zeig damit bitte auf niemanden, sondern schau selbst auf deine Handfläche. In der Binärwelt ist er nur ein Schalter wie jeder andere.",
                en:
                  "Yes, that one. In mathematics it is entirely innocent and simply stands for 4 here. So that nobody feels targeted: please do not point it at anyone, just look at your own palm. In the binary world it is just a switch like any other.",
              },
            },
            {
              title: {
                de: "Jetzt kommst du bis 7",
                en: "Now you can reach 7",
              },
              text: {
                de:
                  "Daumen und Mittelfinger sind 1 + 4 = 5. Zeigefinger und Mittelfinger sind 2 + 4 = 6. Alle drei zusammen sind 1 + 2 + 4 = 7. Mit drei Fingern zählst du also von 0 bis 7 - das sind acht verschiedene Werte.",
                en:
                  "Thumb and middle finger are 1 + 4 = 5. Index and middle finger are 2 + 4 = 6. All three together are 1 + 2 + 4 = 7. So with three fingers you count from 0 to 7 - that is eight different values.",
              },
            },
          ],
        },
        {
          kind: "table",
          highlightFirst: true,
          caption: {
            de:
              "Die ganze Tabelle mit drei Fingern. Geh sie einmal von oben nach unten durch - das ist genau das Zählen, das ein Computer macht.",
            en:
              "The full three finger table. Work through it once from top to bottom - this is exactly the counting a computer does.",
          },
          head: [
            { de: "Wert", en: "Value" },
            { de: "Mittelfinger (4)", en: "Middle finger (4)" },
            { de: "Zeigefinger (2)", en: "Index finger (2)" },
            { de: "Daumen (1)", en: "Thumb (1)" },
            { de: "Als Bits", en: "As bits" },
          ],
          rows: [
            [
              { de: "0", en: "0" },
              { de: "eingeklappt", en: "folded in" },
              { de: "eingeklappt", en: "folded in" },
              { de: "eingeklappt", en: "folded in" },
              { de: "000", en: "000" },
            ],
            [
              { de: "1", en: "1" },
              { de: "eingeklappt", en: "folded in" },
              { de: "eingeklappt", en: "folded in" },
              { de: "ausgeklappt", en: "out" },
              { de: "001", en: "001" },
            ],
            [
              { de: "2", en: "2" },
              { de: "eingeklappt", en: "folded in" },
              { de: "ausgeklappt", en: "out" },
              { de: "eingeklappt", en: "folded in" },
              { de: "010", en: "010" },
            ],
            [
              { de: "3", en: "3" },
              { de: "eingeklappt", en: "folded in" },
              { de: "ausgeklappt", en: "out" },
              { de: "ausgeklappt", en: "out" },
              { de: "011", en: "011" },
            ],
            [
              { de: "4", en: "4" },
              { de: "ausgeklappt", en: "out" },
              { de: "eingeklappt", en: "folded in" },
              { de: "eingeklappt", en: "folded in" },
              { de: "100", en: "100" },
            ],
            [
              { de: "5", en: "5" },
              { de: "ausgeklappt", en: "out" },
              { de: "eingeklappt", en: "folded in" },
              { de: "ausgeklappt", en: "out" },
              { de: "101", en: "101" },
            ],
            [
              { de: "6", en: "6" },
              { de: "ausgeklappt", en: "out" },
              { de: "ausgeklappt", en: "out" },
              { de: "eingeklappt", en: "folded in" },
              { de: "110", en: "110" },
            ],
            [
              { de: "7", en: "7" },
              { de: "ausgeklappt", en: "out" },
              { de: "ausgeklappt", en: "out" },
              { de: "ausgeklappt", en: "out" },
              { de: "111", en: "111" },
            ],
          ],
        },
        {
          kind: "callout",
          tone: "try",
          icon: "🎯",
          title: { de: "Kleine Mutprobe", en: "A small dare" },
          text: {
            de:
              "Nimm den Ringfinger dazu, er zählt 8. Dann den kleinen Finger, er zählt 16. Mit einer ganzen Hand kommst du von 0 bis 31 - das sind 32 Werte. Wer beide Hände nimmt, zählt bis 1023. Auf zehn Fingern. Ohne Taschenrechner.",
            en:
              "Add the ring finger, it counts 8. Then the little finger, it counts 16. With a whole hand you get from 0 to 31 - that is 32 values. Use both hands and you count up to 1023. On ten fingers. Without a calculator.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Ist dir aufgefallen, was mit jedem neuen Finger passiert? Die Anzahl der möglichen Werte verdoppelt sich. Ein Finger: 2 Werte. Zwei Finger: 4. Drei Finger: 8. Diese Verdopplung ist das Herzstück der ganzen Informatik - und im vierten Lernpfad wirst du sehen, wie viel Wucht in so einer Verdopplung steckt.",
            en:
              "Did you notice what happens with every new finger? The number of possible values doubles. One finger: 2 values. Two fingers: 4. Three fingers: 8. This doubling is at the heart of all computing - and in the fourth path you will see how much force such a doubling carries.",
          },
        },
      ],
    },
    {
      key: "byte-and-friends",
      title: {
        de: "Acht Bits sind ein Byte",
        en: "Eight bits make a byte",
      },
      blocks: [
        {
          kind: "paragraph",
          text: {
            de:
              "Rechnen wir die Verdopplung weiter, so wie du es an der Hand gesehen hast. Jedes zusätzliche Bit verdoppelt die Anzahl der Werte:",
            en:
              "Let us carry the doubling on, just as you saw it on your hand. Every extra bit doubles the number of values:",
          },
        },
        {
          kind: "table",
          highlightFirst: true,
          head: [
            { de: "Bits", en: "Bits" },
            { de: "Mögliche Werte", en: "Possible values" },
            { de: "Zählt von ... bis", en: "Counts from ... to" },
          ],
          rows: [
            [
              { de: "1 Bit", en: "1 bit" },
              { de: "2", en: "2" },
              { de: "0 bis 1", en: "0 to 1" },
            ],
            [
              { de: "2 Bit", en: "2 bits" },
              { de: "4", en: "4" },
              { de: "0 bis 3", en: "0 to 3" },
            ],
            [
              { de: "3 Bit", en: "3 bits" },
              { de: "8", en: "8" },
              { de: "0 bis 7", en: "0 to 7" },
            ],
            [
              { de: "4 Bit", en: "4 bits" },
              { de: "16", en: "16" },
              { de: "0 bis 15", en: "0 to 15" },
            ],
            [
              { de: "5 Bit", en: "5 bits" },
              { de: "32", en: "32" },
              { de: "0 bis 31", en: "0 to 31" },
            ],
            [
              { de: "6 Bit", en: "6 bits" },
              { de: "64", en: "64" },
              { de: "0 bis 63", en: "0 to 63" },
            ],
            [
              { de: "7 Bit", en: "7 bits" },
              { de: "128", en: "128" },
              { de: "0 bis 127", en: "0 to 127" },
            ],
            [
              { de: "8 Bit", en: "8 bits" },
              { de: "256", en: "256" },
              { de: "0 bis 255", en: "0 to 255" },
            ],
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "📦",
          title: { de: "Das Byte", en: "The byte" },
          text: {
            de:
              "Acht Bits nebeneinander ergeben 256 verschiedene Werte. Diese acht Bits nennt man ein Byte. Das Byte ist die Standardportion, in der Computer Daten abpacken - so wie Eier im Zehnerkarton kommen und nicht einzeln.",
            en:
              "Eight bits side by side give 256 different values. Those eight bits are called a byte. The byte is the standard portion in which computers package data - the way eggs come in a box of ten rather than one by one.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Warum ausgerechnet 256? Weil das lange Zeit genau gereicht hat, um einen Buchstaben zu speichern: alle Groß- und Kleinbuchstaben, die Ziffern, Satzzeichen, Umlaute und noch ein bisschen Platz für Sonderzeichen. Ein Byte war ein Buchstabe. Der Satz, den du gerade liest, ist also ungefähr 130 Bytes lang.",
            en:
              "Why 256 of all numbers? Because for a long time that was exactly enough to store one letter: all upper and lower case letters, the digits, punctuation, accented characters and a little room for special symbols. One byte was one letter. So the sentence you are reading is roughly 130 bytes long.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Kilo, Mega, Giga - die Familie der großen Zahlen",
            en: "Kilo, mega, giga - the family of big numbers",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Ein einzelnes Byte ist winzig. Für ein Foto oder ein Video braucht man Millionen davon, und dafür gibt es größere Einheiten. Weil Computer in Verdopplungen denken, ist der Sprung von einer Stufe zur nächsten nicht 1000, sondern 1024 - das ist 2 hoch 10, also zehnmal verdoppelt.",
            en:
              "A single byte is tiny. A photo or a video needs millions of them, and for that there are bigger units. Because computers think in doublings, the jump from one step to the next is not 1000 but 1024 - that is 2 to the power of 10, in other words ten doublings.",
          },
        },
        {
          kind: "table",
          highlightFirst: true,
          caption: {
            de:
              "Jede Zeile ist 1024-mal so groß wie die darüber. Die letzte Spalte hilft beim Vorstellen.",
            en:
              "Each row is 1024 times the one above it. The last column helps you picture it.",
          },
          head: [
            { de: "Einheit", en: "Unit" },
            { de: "Entspricht", en: "Equals" },
            { de: "So viel wie etwa ...", en: "Roughly as much as ..." },
          ],
          rows: [
            [
              { de: "1 Byte", en: "1 byte" },
              { de: "8 Bit", en: "8 bits" },
              { de: "ein einzelner Buchstabe", en: "a single letter" },
            ],
            [
              { de: "1 Kilobyte (KB)", en: "1 kilobyte (KB)" },
              { de: "1.024 Byte", en: "1,024 bytes" },
              {
                de: "eine halbe Seite Text",
                en: "half a page of text",
              },
            ],
            [
              { de: "1 Megabyte (MB)", en: "1 megabyte (MB)" },
              { de: "1.024 KB", en: "1,024 KB" },
              {
                de: "ein Handyfoto in mittlerer Qualität",
                en: "a phone photo at medium quality",
              },
            ],
            [
              { de: "1 Gigabyte (GB)", en: "1 gigabyte (GB)" },
              { de: "1.024 MB", en: "1,024 MB" },
              {
                de: "etwa eine halbe Stunde Video in guter Qualität",
                en: "about half an hour of video at good quality",
              },
            ],
            [
              { de: "1 Terabyte (TB)", en: "1 terabyte (TB)" },
              { de: "1.024 GB", en: "1,024 GB" },
              {
                de: "eine große Festplatte voller Filme",
                en: "a large hard disk full of films",
              },
            ],
            [
              { de: "1 Petabyte (PB)", en: "1 petabyte (PB)" },
              { de: "1.024 TB", en: "1,024 TB" },
              {
                de: "die Datenmenge eines mittleren Rechenzentrums",
                en: "the data of a mid sized data centre",
              },
            ],
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          icon: "🏷️",
          title: {
            de: "Warum eine 500-GB-Platte weniger anzeigt",
            en: "Why a 500 GB disk shows less",
          },
          text: {
            de:
              'Festplatten- und Handyhersteller rechnen beim Aufdruck mit 1000 statt 1024. Eine Platte mit "500 GB" hat also 500 Milliarden Byte - dein Betriebssystem teilt aber durch 1024 und zeigt darum nur rund 465 GB an. Es fehlt nichts, es wird nur anders gezählt. Wer es ganz genau nimmt, sagt zu den 1024er-Stufen Kibibyte, Mebibyte und Gibibyte (KiB, MiB, GiB).',
            en:
              'Disk and phone makers count in 1000s rather than 1024s on the label. A disk marked "500 GB" therefore holds 500 billion bytes - but your operating system divides by 1024 and shows only about 465 GB. Nothing is missing, it is just counted differently. Sticklers call the 1024 steps kibibyte, mebibyte and gibibyte (KiB, MiB, GiB).',
          },
        },
      ],
    },
    {
      key: "everyday-bytes",
      title: {
        de: "Warum dir das im Handyladen begegnet",
        en: "Why this shows up in the phone shop",
      },
      blocks: [
        {
          kind: "paragraph",
          text: {
            de:
              "Am Anfang ist das alles ein bisschen verwirrend: Bits, Bytes, 1024, Verdopplungen. Aber diese Einheiten sind dir längst begegnet, wahrscheinlich schon heute. Sie stehen auf jeder Handyverpackung, in jeder Speicheranzeige, in jedem Handyvertrag.",
            en:
              "At first all of this is a little confusing: bits, bytes, 1024, doublings. But you have met these units long ago, probably already today. They are on every phone box, in every storage screen, in every mobile contract.",
          },
        },
        {
          kind: "table",
          highlightFirst: true,
          caption: {
            de:
              "Grobe Richtwerte - die genaue Größe hängt immer von Qualität und Kompression ab.",
            en:
              "Rough guide values - the exact size always depends on quality and compression.",
          },
          head: [
            { de: "Das hier", en: "This thing" },
            { de: "ist ungefähr", en: "is roughly" },
          ],
          rows: [
            [
              {
                de: "Eine Kurznachricht",
                en: "A short text message",
              },
              { de: "unter 1 Kilobyte", en: "under 1 kilobyte" },
            ],
            [
              {
                de: "Ein Foto mit der Handykamera",
                en: "A photo from a phone camera",
              },
              { de: "2 bis 5 Megabyte", en: "2 to 5 megabytes" },
            ],
            [
              { de: "Ein Lied als MP3", en: "A song as an MP3" },
              { de: "3 bis 5 Megabyte", en: "3 to 5 megabytes" },
            ],
            [
              {
                de: "Eine Stunde Serie in HD",
                en: "An hour of a series in HD",
              },
              { de: "etwa 3 Gigabyte", en: "about 3 gigabytes" },
            ],
            [
              {
                de: "Eine Stunde Serie in UHD (4K)",
                en: "An hour of a series in UHD (4K)",
              },
              { de: "etwa 7 Gigabyte", en: "about 7 gigabytes" },
            ],
            [
              {
                de: "Ein großes Handyspiel",
                en: "A big mobile game",
              },
              { de: "5 bis 20 Gigabyte", en: "5 to 20 gigabytes" },
            ],
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Wenn du das nächste Mal vor der Frage stehst, ob 128 GB reichen oder es doch 256 GB sein sollen, kannst du das jetzt selbst überschlagen: 128 Gigabyte sind rund 128.000 Megabyte, also etwa 30.000 Fotos - oder eben deutlich weniger, wenn viele Videos dabei sind. Das ist keine Zauberei, das ist Teilen.",
            en:
              "Next time you face the question whether 128 GB is enough or it should be 256 GB, you can now work it out yourself: 128 gigabytes are about 128,000 megabytes, so roughly 30,000 photos - or considerably fewer once videos are in the mix. That is not magic, it is division.",
          },
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "🌍",
          title: {
            de: "Von deiner Hand bis ins Rechenzentrum",
            en: "From your hand to the data centre",
          },
          text: {
            de:
              "Alles, was du heute gelernt hast, ist dieselbe Idee in verschiedenen Größen. Drei Finger zählen bis 7. Acht Bits zählen bis 255. Ein Rechenzentrum schaltet Billiarden solcher Bits pro Sekunde. Der Unterschied ist nur die Menge - nicht das Prinzip.",
            en:
              "Everything you learned today is the same idea at different sizes. Three fingers count to 7. Eight bits count to 255. A data centre switches quadrillions of such bits per second. The only difference is the amount - not the principle.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Und das ist das eigentlich Schöne daran: Du musst kein Mathegenie sein, um Computer zu verstehen. Du musst nur bereit sein, einmal genau hinzuschauen - so wie eben, mit der Hand vor dem Gesicht. Alle, die heute Chips entwerfen, Spiele programmieren oder KI-Modelle bauen, haben genau hier angefangen.",
            en:
              "And that is the genuinely nice part: you do not need to be a maths genius to understand computers. You only need to be willing to look closely once - just as you did a moment ago, with your hand in front of your face. Everyone who designs chips, writes games or builds AI models today started right here.",
          },
        },
        {
          kind: "sources",
          items: [
            {
              label: {
                de: "Wikipedia: Byte - Herkunft und Definition der Einheit",
                en: "Wikipedia: Byte - origin and definition of the unit",
              },
              url: "https://de.wikipedia.org/wiki/Byte",
            },
            {
              label: {
                de: "Wikipedia: Bit - die kleinste Informationseinheit",
                en: "Wikipedia: Bit - the smallest unit of information",
              },
              url: "https://de.wikipedia.org/wiki/Bit",
            },
            {
              label: {
                de:
                  "NIST: Präfixe für binäre Vielfache (Kibibyte, Mebibyte, Gibibyte)",
                en: "NIST: prefixes for binary multiples (KiB, MiB, GiB)",
              },
              url: "https://physics.nist.gov/cuu/Units/binary.html",
            },
            {
              label: {
                de: "Computer History Museum: Die Erfindung des Transistors",
                en: "Computer History Museum: the invention of the transistor",
              },
              url:
                "https://www.computerhistory.org/siliconengine/the-first-transistor/",
            },
            {
              label: {
                de: "Computer History Museum: Konrad Zuse und die Z3",
                en: "Computer History Museum: Konrad Zuse and the Z3",
              },
              // The Konrad Zuse Internet Archive was the obvious source here,
              // but zuse.zib.de has been answering 503 for the whole domain.
              url:
                "https://www.computerhistory.org/revolution/birth-of-the-computer/4/78",
            },
            {
              label: {
                de: "Wikipedia: ENIAC - Röhrenzahl, Gewicht, Stromverbrauch",
                en: "Wikipedia: ENIAC - tube count, weight, power draw",
              },
              url: "https://en.wikipedia.org/wiki/ENIAC",
            },
            {
              label: {
                de: "Netflix Hilfe: Datenverbrauch je Streaming-Qualität",
                en: "Netflix help: data usage per streaming quality",
              },
              url: "https://help.netflix.com/de/node/87",
            },
          ],
        },
      ],
    },
  ],
  exercises: [
    {
      kind: "cloze",
      title: {
        de: "1. Lückentext: von der Hand zum Gigabyte",
        en: "1. Fill in the blanks: from your hand to the gigabyte",
      },
      intro: {
        de:
          "Setze die fehlenden Wörter ein. Alles davon hast du gerade gelesen oder an der Hand abgezählt.",
        en:
          "Fill in the missing words. You have just read or counted all of them on your hand.",
      },
      text: {
        de:
          'Tief im Inneren kennt ein Computer nur zwei Zustände: Strom ___ und Strom ___. Geschaltet werden sie von winzigen Schaltern, die früher ___ hießen, dann Vakuumröhren und heute ___. Weil sich "an aus aus an" schlecht aufschreiben lässt, notieren wir für an eine ___ und für aus eine ___. Ein einzelner solcher Wert heißt ___. Mit jedem weiteren davon ___ sich die Anzahl der möglichen Werte: ein Finger 2, zwei Finger 4, drei Finger ___. Acht Bits nebeneinander ergeben 256 Werte und heißen zusammen ein ___. 1024 davon sind ein ___, und 1024 davon wiederum ein Megabyte.',
        en:
          'Deep down a computer knows only two states: current ___ and current ___. They are switched by tiny switches once called ___, later vacuum tubes and today ___. Because "on off off on" is awkward to write down, we note a ___ for on and a ___ for off. A single such value is called a ___. With every further one the number of possible values ___: one finger 2, two fingers 4, three fingers ___. Eight bits side by side give 256 values and together are called a ___. 1024 of those make a ___, and 1024 of those in turn a megabyte.',
      },
    },
    {
      kind: "compare",
      title: {
        de: "2. Vergleiche: warum 8 Bit nicht 16 Werte sind",
        en: "2. Compare: why 8 bits are not 16 values",
      },
      intro: {
        de:
          "Hier musst du das Handexperiment mit der Byte-Tabelle zusammenbringen.",
        en:
          "Here you need to bring the hand experiment together with the byte table.",
      },
      text: {
        de:
          'Ein Bit kann 2 Werte darstellen. Man könnte denken, acht Bits stellen dann 8 mal 2, also 16 Werte dar - tatsächlich sind es 256. Erkläre mit deinen eigenen Worten, woher der Unterschied kommt. Nimm dazu deine Hand zu Hilfe: Beschreibe, was genau passiert, wenn du zu drei ausgestreckten Fingern einen vierten dazunimmst, und warum daraus nicht "zwei Werte mehr", sondern "doppelt so viele Werte" wird.',
        en:
          'One bit can represent 2 values. You might think eight bits therefore represent 8 times 2, so 16 values - in fact it is 256. Explain in your own words where the difference comes from. Use your hand: describe exactly what happens when you add a fourth finger to three outstretched ones, and why that gives you "twice as many values" rather than "two more values".',
      },
      hint: {
        de:
          "Zähl einmal auf, was der neue Finger mit den Möglichkeiten macht, die es vorher schon gab.",
        en:
          "Count out what the new finger does to the possibilities that already existed before it.",
      },
    },
    {
      kind: "reflect",
      title: {
        de: "3. Zum Nachdenken: alles nur an und aus",
        en: "3. Something to think about: nothing but on and off",
      },
      intro: {
        de: "Keine richtige Antwort - nur deine.",
        en: "No right answer here - only yours.",
      },
      text: {
        de:
          "Dein Lieblingslied, das Foto von jemandem, den du magst, und eine Nachricht, über die du dich gefreut hast: In deinem Handy sind das alles nur sehr lange Folgen von An und Aus. Findest du diesen Gedanken eher ernüchternd oder eher erstaunlich? Und meinst du, es geht dabei etwas verloren - oder ist die Bedeutung ohnehin etwas, das erst in deinem Kopf entsteht?",
        en:
          "Your favourite song, a photo of someone you like, a message that made your day: inside your phone all of these are nothing but very long sequences of on and off. Do you find that thought sobering or astonishing? And do you think something is lost along the way - or does the meaning only ever come into being in your head anyway?",
      },
    },
  ],
};

const pixelsAndResolution: LearningPath = {
  key: "pixels-and-resolution",
  title: { de: "Pixel und Auflösung", en: "Pixels and resolution" },
  summary: {
    de:
      "Warum YouTube bei schlechtem Empfang plötzlich matschig aussieht, warum Minecraft so klotzig ist und was 4K eigentlich bedeutet.",
    en:
      "Why YouTube suddenly looks mushy on a bad connection, why Minecraft is so blocky, and what 4K actually means.",
  },
  icon: "🟦",
  accent: "sky",
  minutes: 12,
  screens: [
    {
      key: "what-is-a-pixel",
      title: { de: "Ein Bild aus Kästchen", en: "A picture made of squares" },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Geh mit der Nase ganz nah an deinen Bildschirm. Näher. Irgendwann verschwindet das Bild und übrig bleiben winzige leuchtende Kästchen in Rot, Grün und Blau. Genau daraus besteht alles, was du je auf einem Bildschirm gesehen hast.",
            en:
              "Put your nose right up against your screen. Closer. At some point the picture disappears and all that is left are tiny glowing squares in red, green and blue. Everything you have ever seen on a screen is made of exactly that.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'Ein solches Kästchen heißt Pixel - das Wort ist eine Abkürzung für "picture element", also Bildelement. Ein Pixel kann genau eine Farbe zeigen, mehr nicht. Ein Bild entsteht erst dadurch, dass sehr viele Pixel nebeneinander liegen und dein Auge sie aus normaler Entfernung nicht mehr einzeln auseinanderhalten kann.',
            en:
              'One such square is called a pixel - the word is short for "picture element". A pixel can show exactly one colour, nothing more. A picture only comes about because a great many pixels lie side by side and, at normal distance, your eye can no longer tell them apart.',
          },
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "📐",
          title: { de: "Auflösung", en: "Resolution" },
          text: {
            de:
              "Die Auflösung sagt, wie viele Pixel ein Bild hat: Breite mal Höhe. Ein Full-HD-Bild ist 1920 Pixel breit und 1080 Pixel hoch. 1920 × 1080 macht 2.073.600 Pixel - über zwei Millionen kleine Farbkästchen, und zwar 30- oder 60-mal in jeder Sekunde neu gesetzt, während du ein Video anschaust.",
            en:
              "The resolution says how many pixels a picture has: width times height. A Full HD picture is 1920 pixels wide and 1080 pixels tall. 1920 × 1080 makes 2,073,600 pixels - over two million little colour squares, redrawn 30 or 60 times every second while you watch a video.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Wo du Pixel richtig gut sehen kannst, ohne dir die Nase platt zu drücken: in Minecraft. Die Standardtexturen des Spiels sind 16 × 16 Pixel groß - das sind 256 Pixel für eine ganze Grasblockseite. Ein einziges Bild in 4K hat mehr als 8 Millionen Pixel, also über 32.000 solcher Minecraft-Texturen. Die Klötzchenoptik ist keine technische Not, sondern eine Entscheidung: Sie ist wiedererkennbar, sie ist schnell zu zeichnen, und jeder kann eigene Texturen malen.",
            en:
              "Somewhere you can see pixels really well without flattening your nose: Minecraft. The game's default textures are 16 × 16 pixels - that is 256 pixels for a whole side of a grass block. A single 4K image has more than 8 million pixels, so over 32,000 such Minecraft textures. The blocky look is not a technical necessity but a decision: it is recognisable, it is quick to draw, and anyone can paint their own textures.",
          },
        },
        {
          kind: "callout",
          tone: "fact",
          icon: "🔤",
          title: {
            de: 'Das "p" bedeutet nicht Pixel',
            en: 'The "p" does not mean pixel',
          },
          text: {
            de:
              'Bei 1080p steht die Zahl nur für die Höhe in Pixeln, und das p für "progressive" - das heißt, jedes Bild wird komplett übertragen und nicht in zwei Hälften wie beim alten Fernsehen. Die Breite ergibt sich aus dem Seitenverhältnis: bei 16:9 sind das 1920.',
            en:
              'In 1080p the number is only the height in pixels, and the p stands for "progressive" - meaning every frame is transmitted completely rather than in two halves as on old television. The width follows from the aspect ratio: at 16:9 that is 1920.',
          },
        },
      ],
    },
    {
      key: "colour-depth",
      title: {
        de: "Von Schwarz-Weiß zu 16,7 Millionen Farben",
        en: "From black and white to 16.7 million colours",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Ein Pixel muss seine Farbe irgendwo speichern - und zwar in Bits. Wie viele Bits pro Pixel zur Verfügung stehen, nennt man Farbtiefe. Und weil du aus dem Lernpfad über Bits und Bytes schon weißt, dass jedes zusätzliche Bit die Anzahl der Werte verdoppelt, kannst du die ganze Geschichte der Bildschirmfarben jetzt selbst nachrechnen.",
            en:
              "A pixel has to store its colour somewhere - in bits. How many bits are available per pixel is called colour depth. And since you already know from the bits and bytes path that every extra bit doubles the number of values, you can now work out the entire history of screen colour yourself.",
          },
        },
        {
          kind: "table",
          highlightFirst: true,
          caption: {
            de:
              "Jede Zeile hat mehr Bits pro Pixel - und damit doppelt so viele Farben pro zusätzlichem Bit.",
            en:
              "Each row has more bits per pixel - and so twice as many colours per extra bit.",
          },
          head: [
            { de: "Farbtiefe", en: "Colour depth" },
            { de: "Farben", en: "Colours" },
            { de: "Typisch für", en: "Typical of" },
          ],
          rows: [
            [
              { de: "1 Bit", en: "1 bit" },
              { de: "2", en: "2" },
              {
                de: "Schwarz oder Weiß - Apple Macintosh, 1984",
                en: "black or white - Apple Macintosh, 1984",
              },
            ],
            [
              { de: "4 Bit", en: "4 bits" },
              { de: "16", en: "16" },
              {
                de: "frühe PC-Grafikkarten (CGA, EGA)",
                en: "early PC graphics cards (CGA, EGA)",
              },
            ],
            [
              { de: "8 Bit", en: "8 bits" },
              { de: "256", en: "256" },
              {
                de: "VGA ab 1987 - die Zeit der Pixelkunst",
                en: "VGA from 1987 - the age of pixel art",
              },
            ],
            [
              { de: "16 Bit", en: "16 bits" },
              { de: "65.536", en: "65,536" },
              {
                de: '"High Color", 1990er Jahre',
                en: '"high colour", 1990s',
              },
            ],
            [
              { de: "24 Bit", en: "24 bits" },
              { de: "16.777.216", en: "16,777,216" },
              {
                de: '"True Color" - Standard bis heute',
                en: '"true colour" - the standard to this day',
              },
            ],
            [
              { de: "30 Bit", en: "30 bits" },
              { de: "1.073.741.824", en: "1,073,741,824" },
              {
                de: "HDR mit 10 Bit je Grundfarbe",
                en: "HDR with 10 bits per primary colour",
              },
            ],
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              'Die berühmten 16,7 Millionen Farben kommen so zustande: Jedes Pixel mischt seine Farbe aus Rot, Grün und Blau. Bekommt jede dieser drei Grundfarben ein ganzes Byte, also 256 Helligkeitsstufen, dann sind es 256 × 256 × 256 = 16.777.216 mögliche Mischungen. Das ist mehr, als das menschliche Auge unterscheiden kann - deshalb heißt es "True Color", echte Farbe.',
            en:
              'The famous 16.7 million colours come about like this: every pixel mixes its colour from red, green and blue. Give each of these three primaries a whole byte, that is 256 brightness levels, and you get 256 × 256 × 256 = 16,777,216 possible mixtures. That is more than the human eye can tell apart - hence the name "true colour".',
          },
        },
        {
          kind: "callout",
          tone: "fact",
          icon: "🟢",
          title: {
            de: "Grün bekommt ein Bit geschenkt",
            en: "Green gets a bonus bit",
          },
          text: {
            de:
              "Bei der 16-Bit-Farbtiefe geht die Rechnung nicht glatt auf: 16 Bit lassen sich nicht in drei gleiche Teile teilen. Also bekommen Rot und Blau je 5 Bit und Grün 6 Bit. Der Grund ist dein Auge: Es unterscheidet Grüntöne feiner als Rot- oder Blautöne. Die Technik richtet sich nach der Biologie.",
            en:
              "With 16 bit colour the maths does not divide evenly: 16 bits cannot be split into three equal parts. So red and blue get 5 bits each and green gets 6. The reason is your eye: it distinguishes shades of green more finely than shades of red or blue. The technology follows the biology.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Und HDR? Dort bekommt jede Grundfarbe 10 statt 8 Bit, also 1024 Stufen statt 256. Das ergibt gut eine Milliarde Farben. Wichtiger als die schiere Zahl ist aber, dass HDR-Bildschirme hellere Lichter und dunklere Schatten gleichzeitig darstellen können - eine Sonne, die wirklich blendet, und daneben Schatten, in denen man noch etwas erkennt.",
            en:
              "And HDR? There each primary gets 10 bits instead of 8, so 1024 levels instead of 256. That gives a good billion colours. More important than the sheer number, though, is that HDR screens can show brighter highlights and darker shadows at the same time - a sun that really dazzles, and next to it shadows in which you can still make things out.",
          },
        },
      ],
    },
    {
      key: "144p-to-4k",
      title: {
        de: "Von 144p bis 4K - und was das für dein Datenvolumen heißt",
        en: "From 144p to 4K - and what it does to your data",
      },
      blocks: [
        {
          kind: "paragraph",
          text: {
            de:
              "Du kennst die Situation: Das Video läuft, der Zug fährt in einen Tunnel, und plötzlich sieht dein Lieblings-Video aus wie ein Aquarell im Regen. YouTube hat gerade die Auflösung heruntergeschaltet, damit das Video überhaupt weiterläuft. Ein niedrig aufgelöstes Bild hat weniger Pixel, also weniger Daten, also kommt es auch durch eine schlechte Verbindung.",
            en:
              "You know the situation: the video is playing, the train enters a tunnel, and suddenly your favourite clip looks like a watercolour in the rain. YouTube has just dropped the resolution so the video keeps playing at all. A low resolution picture has fewer pixels, so less data, so it gets through a bad connection.",
          },
        },
        {
          kind: "table",
          highlightFirst: true,
          caption: {
            de:
              "Die Pixelzahlen sind ausgerechnet: Breite mal Höhe. Der Sprung von Full HD zu 4K vervierfacht die Pixel, weil sich Breite und Höhe beide verdoppeln.",
            en:
              "The pixel counts are simply width times height. The jump from Full HD to 4K quadruples the pixels, because width and height both double.",
          },
          head: [
            { de: "Name", en: "Name" },
            { de: "Auflösung", en: "Resolution" },
            { de: "Pixel insgesamt", en: "Total pixels" },
          ],
          rows: [
            [
              { de: "144p", en: "144p" },
              { de: "256 × 144", en: "256 × 144" },
              { de: "36.864", en: "36,864" },
            ],
            [
              { de: "360p", en: "360p" },
              { de: "640 × 360", en: "640 × 360" },
              { de: "230.400", en: "230,400" },
            ],
            [
              { de: "480p (SD)", en: "480p (SD)" },
              { de: "854 × 480", en: "854 × 480" },
              { de: "409.920", en: "409,920" },
            ],
            [
              { de: "720p (HD)", en: "720p (HD)" },
              { de: "1280 × 720", en: "1280 × 720" },
              { de: "921.600", en: "921,600" },
            ],
            [
              { de: "1080p (Full HD)", en: "1080p (Full HD)" },
              { de: "1920 × 1080", en: "1920 × 1080" },
              { de: "2.073.600", en: "2,073,600" },
            ],
            [
              { de: "1440p (QHD)", en: "1440p (QHD)" },
              { de: "2560 × 1440", en: "2560 × 1440" },
              { de: "3.686.400", en: "3,686,400" },
            ],
            [
              { de: "2160p (4K UHD)", en: "2160p (4K UHD)" },
              { de: "3840 × 2160", en: "3840 × 2160" },
              { de: "8.294.400", en: "8,294,400" },
            ],
            [
              { de: "4320p (8K UHD)", en: "4320p (8K UHD)" },
              { de: "7680 × 4320", en: "7680 × 4320" },
              { de: "33.177.600", en: "33,177,600" },
            ],
          ],
        },
        {
          kind: "callout",
          tone: "note",
          icon: "🧮",
          title: {
            de: "Ein Vergleich, der hängen bleibt",
            en: "A comparison that sticks",
          },
          text: {
            de:
              "Ein 144p-Bild hat knapp 37.000 Pixel. Ein 4K-Bild hat über 8,29 Millionen. Das ist mehr als das 225-fache. Kein Wunder, dass das eine nach Matsch aussieht und das andere nach Fensterscheibe.",
            en:
              "A 144p frame has just under 37,000 pixels. A 4K frame has over 8.29 million. That is more than 225 times as many. No wonder one looks like mush and the other like a window pane.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Mehr Pixel bedeuten mehr Daten, und das merkst du an deinem Datenvolumen. Netflix gibt für die höchste Qualitätsstufe an: rund 1 Gigabyte pro Stunde in SD, etwa 3 Gigabyte pro Stunde in HD und etwa 7 Gigabyte pro Stunde in Ultra HD. Wer also eine Serienstaffel unterwegs in 4K schaut, ist sein Monatsvolumen schneller los, als die Folge zu Ende ist.",
            en:
              "More pixels mean more data, and you notice that in your data allowance. Netflix states for its highest quality setting: around 1 gigabyte per hour in SD, about 3 gigabytes per hour in HD and about 7 gigabytes per hour in Ultra HD. So watching a season on the move in 4K burns through a monthly allowance faster than the episode ends.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Deshalb empfiehlt YouTube auch je nach Auflösung ganz unterschiedliche Datenraten beim Hochladen: 1 Megabit pro Sekunde reichen für 360p, für 1080p sind es 8 Megabit, für 4K 35 bis 45 Megabit und für 8K bis zu 160 Megabit pro Sekunde. Zwischen dem kleinsten und dem größten Format liegt ungefähr der Faktor 100.",
            en:
              "That is also why YouTube recommends wildly different upload data rates depending on resolution: 1 megabit per second is enough for 360p, 1080p wants 8 megabits, 4K needs 35 to 45 megabits and 8K up to 160 megabits per second. Between the smallest and the largest format lies roughly a factor of 100.",
          },
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "👀",
          title: {
            de: "Wann lohnt sich 4K überhaupt?",
            en: "When is 4K worth it at all?",
          },
          text: {
            de:
              "Das hängt davon ab, wie groß der Bildschirm ist und wie weit du weg sitzt. Auf einem Handydisplay aus einem halben Meter Entfernung siehst du zwischen Full HD und 4K kaum einen Unterschied - dein Auge kann die einzelnen Pixel längst nicht mehr trennen. Auf einem großen Fernseher aus zwei Metern schon eher. Die Technik ist also nicht immer besser, nur weil die Zahl größer ist.",
            en:
              "It depends on how big the screen is and how far away you sit. On a phone display at half a metre you can barely tell Full HD from 4K - your eye stopped resolving individual pixels long ago. On a large TV at two metres you might. So the technology is not automatically better just because the number is bigger.",
          },
        },
      ],
    },
    {
      key: "retro-pixels",
      title: {
        de: "Warum Super Mario so klotzig aussieht",
        en: "Why Super Mario looks so blocky",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Wenn du ein altes Super-Mario-Spiel neben ein heutiges Spiel stellst, sieht Mario aus, als wäre er aus Legosteinen gebaut. Das lag nicht an fehlendem Talent der Entwickler, sondern an der Hardware - und wenn du weißt, wie eng die war, wirst du diese Spiele mit anderen Augen sehen.",
            en:
              "Put an old Super Mario game next to a modern one and Mario looks as if he were built from Lego bricks. That was not for lack of talent among the developers but down to the hardware - and once you know how tight it was, you will look at those games differently.",
          },
        },
        {
          kind: "stats",
          entries: [
            {
              value: "256 × 240",
              label: { de: "Auflösung des NES", en: "NES resolution" },
              hint: {
                de: "rund 61.000 Pixel - weniger als zwei 144p-Bilder",
                en: "about 61,000 pixels - fewer than two 144p frames",
              },
            },
            {
              value: "25",
              label: {
                de: "Farben gleichzeitig auf dem Bildschirm",
                en: "colours on screen at once",
              },
              hint: {
                de: "aus einer Hardwarepalette von etwa 54",
                en: "from a hardware palette of about 54",
              },
            },
            {
              value: "160 × 144",
              label: { de: "Game Boy, 1989", en: "Game Boy, 1989" },
              hint: {
                de: "23.040 Pixel in vier Graustufen",
                en: "23,040 pixels in four shades of grey",
              },
            },
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Ein Bild auf dem NES hatte also ungefähr so viele Pixel wie ein Achtel eines heutigen Handyfotos - und nur 25 Farben gleichzeitig. Wenn Marios Mütze, sein Hemd und die Wolken am Himmel dieselbe Farbe haben, ist das kein Zufall: Es war schlicht keine andere übrig. Übrigens sind Marios berühmte Latzhose und die Mütze auch deshalb so markant, weil man mit wenigen Pixeln und wenigen Farben eine Figur bauen musste, die man sofort erkennt.",
            en:
              "So a frame on the NES had roughly as many pixels as an eighth of a modern phone photo - and only 25 colours at once. When Mario's cap, his shirt and the clouds in the sky share a colour, that is no coincidence: there simply was no other one left. Incidentally, Mario's famous dungarees and cap are so distinctive partly because a character had to be instantly recognisable using few pixels and few colours.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Heute ist die Grenze nicht mehr die Anzahl der Pixel, sondern was man mit ihnen anstellt: Licht, Spiegelungen, Schatten, Wasser, Haare. Und trotzdem gibt es einen ganzen Zweig von Spielen, die absichtlich pixelig aussehen - weil dieser Stil eine eigene Schönheit hat, so wie ein Mosaik oder ein Kreuzstichbild. Minecraft ist das bekannteste Beispiel: das meistverkaufte Videospiel der Welt, gebaut aus Texturen von 16 × 16 Pixeln.",
            en:
              "Today the limit is no longer the number of pixels but what you do with them: light, reflections, shadows, water, hair. And yet there is a whole branch of games that look pixelated on purpose - because the style has a beauty of its own, like a mosaic or a cross stitch picture. Minecraft is the best known example: the best selling video game in the world, built from 16 × 16 pixel textures.",
          },
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "🎨",
          title: {
            de: "Zum Selbstausprobieren",
            en: "Something to try yourself",
          },
          text: {
            de:
              "Zeichne auf kariertem Papier ein Herz, ein Smiley oder deinen Anfangsbuchstaben in ein Raster von 8 × 8 Kästchen - jedes Kästchen darf nur ganz ausgemalt oder ganz leer sein. Du wirst merken: Genau so haben Menschen in den 1980er Jahren Spielfiguren gebaut. 8 × 8 sind 64 Pixel, und mit 1 Bit pro Pixel passt dein Bild in 8 Byte.",
            en:
              "On squared paper, draw a heart, a smiley or your initial into a grid of 8 × 8 squares - each square may only be fully filled or fully empty. You will notice: this is exactly how people built game characters in the 1980s. 8 × 8 is 64 pixels, and at 1 bit per pixel your picture fits into 8 bytes.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Am Ende ist ein Bildschirm nur ein sehr großes kariertes Blatt, auf dem sehr schnell sehr viele Kästchen ausgemalt werden. Wenn du das einmal so siehst, verlierst du ein bisschen Zauber - und gewinnst dafür das gute Gefühl, zu verstehen, was da eigentlich passiert.",
            en:
              "In the end a screen is just a very large piece of squared paper on which very many squares get filled in very quickly. Once you see it that way you lose a little magic - and in exchange you gain the good feeling of understanding what is actually going on.",
          },
        },
        {
          kind: "sources",
          items: [
            {
              label: {
                de: "YouTube-Hilfe: empfohlene Datenraten je Auflösung",
                en: "YouTube help: recommended bitrates per resolution",
              },
              url: "https://support.google.com/youtube/answer/1722171",
            },
            {
              label: {
                de: "YouTube-Hilfe: unterstützte Video-Auflösungen",
                en: "YouTube help: supported video resolutions",
              },
              url: "https://support.google.com/youtube/answer/6375112",
            },
            {
              label: {
                de: "Netflix-Hilfe: Datenverbrauch je Qualitätsstufe",
                en: "Netflix help: data usage per quality setting",
              },
              url: "https://help.netflix.com/de/node/87",
            },
            {
              label: {
                de: "Wikipedia: Farbtiefe (1 Bit bis 30 Bit)",
                en: "Wikipedia: colour depth (1 bit to 30 bits)",
              },
              url: "https://en.wikipedia.org/wiki/Color_depth",
            },
            {
              label: {
                de: "Wikipedia: Video Graphics Array (VGA, 1987)",
                en: "Wikipedia: Video Graphics Array (VGA, 1987)",
              },
              url: "https://en.wikipedia.org/wiki/Video_Graphics_Array",
            },
            {
              label: {
                de: "NESdev-Wiki: Farbpalette des NES",
                en: "NESdev wiki: the NES colour palette",
              },
              url: "https://www.nesdev.org/wiki/PPU_palettes",
            },
            {
              label: {
                de: "Wikipedia: Game Boy - 160 × 144 Pixel, vier Graustufen",
                en: "Wikipedia: Game Boy - 160 × 144 pixels, four shades",
              },
              url: "https://en.wikipedia.org/wiki/Game_Boy",
            },
            {
              label: {
                de: "Minecraft-Wiki: Standardtexturen mit 16 × 16 Pixeln",
                en: "Minecraft wiki: default textures at 16 × 16 pixels",
              },
              url: "https://minecraft.wiki/w/Texture_pack",
            },
            {
              label: {
                de: "Apple History: Macintosh 128K mit 512 × 342 Pixeln",
                en: "Apple History: Macintosh 128K with 512 × 342 pixels",
              },
              url: "https://apple-history.com/128k",
            },
          ],
        },
      ],
    },
  ],
  exercises: [
    {
      kind: "cloze",
      title: {
        de: "1. Lückentext: vom Kästchen zum 4K-Bild",
        en: "1. Fill in the blanks: from a little square to a 4K picture",
      },
      intro: {
        de: "Setze die fehlenden Wörter ein.",
        en: "Fill in the missing words.",
      },
      text: {
        de:
          'Ein einzelnes Bildkästchen auf dem Bildschirm heißt ___ - kurz für "picture element". Wie viele davon ein Bild hat, sagt die ___: Sie wird angegeben als Breite mal ___. Ein Full-HD-Bild misst 1920 mal ___ Pixel. Welche Farbe ein Pixel zeigen kann, hängt davon ab, wie viele ___ dafür zur Verfügung stehen; das nennt man ___. Bekommt jede der drei Grundfarben Rot, ___ und Blau ein ganzes Byte, ergibt das die berühmten 16,7 Millionen Farben. Bei schlechter Verbindung schaltet YouTube auf ___ herunter, die schlechteste Stufe. Mehr Pixel bedeuten immer auch mehr ___, und das merkst du an deinem Datenvolumen.',
        en:
          'A single little square on the screen is called a ___ - short for "picture element". How many of them a picture has is given by its ___: written as width times ___. A full HD picture measures 1920 by ___ pixels. Which colour a pixel can show depends on how many ___ are available for it; this is called ___. If each of the three primary colours red, ___ and blue gets a whole byte, that gives the famous 16.7 million colours. On a poor connection YouTube drops down to ___, the worst step there is. More pixels always mean more ___ as well, and you notice that in your data allowance.',
      },
    },
    {
      kind: "compare",
      title: {
        de: "2. Vergleiche: dasselbe Problem, vierzig Jahre auseinander",
        en: "2. Compare: the same problem, forty years apart",
      },
      intro: {
        de:
          "Setze zwei Grenzen zueinander in Beziehung, die auf den ersten Blick nichts miteinander zu tun haben.",
        en:
          "Relate two limits to each other that look unconnected at first glance.",
      },
      text: {
        de:
          "Mario sah auf dem NES klotzig aus, weil die Konsole nur 256 mal 240 Pixel und 25 Farben gleichzeitig darstellen konnte. Heute ist die Auflösung praktisch kein Problem mehr - dafür schaltet dein Handy im Zug auf 144p herunter. Beschreibe, was die beiden Situationen gemeinsam haben und wodurch sie sich unterscheiden. Welche Grenze war es damals, welche ist es heute? Und warum kommt am Ende in beiden Fällen ein gröberes Bild heraus?",
        en:
          "Mario looked blocky on the NES because the console could only show 256 by 240 pixels and 25 colours at once. Today resolution is barely a problem - and yet your phone drops to 144p on the train. Describe what the two situations have in common and where they differ. Which limit was it back then, which is it today? And why does a coarser picture come out at the end in both cases?",
      },
      hint: {
        de:
          "Beide Male fehlt etwas, aber nicht dasselbe. Überlege, wo die Daten jeweils herkommen müssen.",
        en:
          "Something is missing in both cases, but not the same thing. Think about where the data has to come from each time.",
      },
    },
    {
      kind: "reflect",
      title: {
        de: "3. Zum Nachdenken: warum wählt jemand freiwillig Klötzchen?",
        en:
          "3. Something to think about: why would anyone choose blocks on purpose?",
      },
      intro: {
        de: "Diese Frage hat viele mögliche Antworten.",
        en: "This question has many possible answers.",
      },
      text: {
        de:
          "Minecraft könnte längst fotorealistisch aussehen - es sieht trotzdem aus wie aus Klötzchen gebaut, und Millionen Menschen lieben es genau dafür. Auch viele neue Spiele werden absichtlich pixelig gestaltet. Woran liegt das? Und was sagt das darüber aus, was ein Bild eigentlich schön oder gut macht - fällt dir das auch außerhalb von Spielen ein, in Musik, Kleidung oder Fotos?",
        en:
          "Minecraft could have looked photorealistic long ago - it still looks as though it were built from blocks, and millions of people love it for exactly that. Plenty of new games are made deliberately pixelated too. Why is that? And what does it say about what actually makes an image beautiful or good - can you think of the same thing outside games, in music, clothes or photographs?",
      },
    },
  ],
};

const exponentialGrowth: LearningPath = {
  key: "exponential-growth",
  title: { de: "Exponentielles Wachstum", en: "Exponential growth" },
  summary: {
    de:
      "Warum Computer nicht ein bisschen schneller werden, sondern immer wieder doppelt so schnell - und was das mit Taschenrechnern, Mondlandungen und KI zu tun hat.",
    en:
      "Why computers do not get a bit faster but keep getting twice as fast - and what that has to do with pocket calculators, Moon landings and AI.",
  },
  icon: "🚀",
  accent: "rose",
  minutes: 18,
  screens: [
    {
      key: "moore",
      title: {
        de: "Gordon Moore und die Verdopplung",
        en: "Gordon Moore and the doubling",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Nimm ein Blatt Papier und falte es in der Mitte. Dann noch einmal. Und noch einmal. Wenn du es 42-mal falten könntest - was leider physikalisch nicht geht - wäre der Stapel hoch genug, um den Mond zu erreichen. Aus einem Blatt Papier. Willkommen beim exponentiellen Wachstum.",
            en:
              "Take a sheet of paper and fold it in half. Then again. And again. If you could fold it 42 times - which sadly is physically impossible - the stack would be tall enough to reach the Moon. From one sheet of paper. Welcome to exponential growth.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Unser Kopf ist schlecht darin, so etwas vorherzusehen. Wir denken in Schritten: gestern 10, heute 11, morgen 12. Exponentielles Wachstum denkt in Verdopplungen: 1, 2, 4, 8, 16, 32 - und plötzlich, nach ein paar unspektakulären Runden, explodiert die Zahl. Genau das ist der Grund, warum dein Handy leistungsfähiger ist als der teuerste Supercomputer, den es zu deiner Geburt gab.",
            en:
              "Our minds are bad at foreseeing this. We think in steps: 10 yesterday, 11 today, 12 tomorrow. Exponential growth thinks in doublings: 1, 2, 4, 8, 16, 32 - and suddenly, after a few unspectacular rounds, the number explodes. That is exactly why your phone is more capable than the most expensive supercomputer that existed when you were born.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Ein Aufsatz von 1965, der alles veränderte",
            en: "A 1965 article that changed everything",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'Gordon Moore war Forschungsleiter bei einer Halbleiterfirma namens Fairchild und schrieb am 19. April 1965 in der Fachzeitschrift Electronics einen Aufsatz mit dem sperrigen Titel "Cramming more components onto integrated circuits" - also etwa "Mehr Bauteile auf integrierte Schaltkreise quetschen". Darin hielt er etwas fest, das er in seinen Daten sah: Die Anzahl der Bauteile, die man kostengünstig auf einen Chip packen kann, hatte sich bis dahin ungefähr jedes Jahr verdoppelt.',
            en:
              'Gordon Moore was head of research at a semiconductor company called Fairchild, and on 19 April 1965 he wrote an article in the trade journal Electronics with the cumbersome title "Cramming more components onto integrated circuits". In it he recorded something he saw in his data: the number of components you could economically fit onto a chip had so far roughly doubled every year.',
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'Dann wagte er eine Hochrechnung, die damals kühn wirkte: Wenn das so weitergeht, sitzen 1975 rund 65.000 Bauteile auf einem Chip. Diese Beobachtung wurde später als "Mooresches Gesetz" bekannt - obwohl sie kein Gesetz ist, sondern eine Beobachtung, die sich erstaunlich lange gehalten hat.',
            en:
              'Then he ventured an extrapolation that looked bold at the time: if this continues, around 65,000 components will sit on a chip by 1975. This observation later became known as "Moore\'s law" - although it is not a law but an observation that held up for a remarkably long time.',
          },
        },
        {
          kind: "callout",
          tone: "warn",
          icon: "🔍",
          title: {
            de: "Drei Zahlen, die oft durcheinandergeraten",
            en: "Three numbers people mix up",
          },
          text: {
            de:
              '1965 sprach Moore von einer Verdopplung pro Jahr. 1975 korrigierte er sich auf dem Fachkongress IEDM auf etwa alle zwei Jahre. Die berühmten "18 Monate" stammen gar nicht von ihm, sondern werden dem Intel-Manager David House zugeschrieben - und sie meinen nicht die Anzahl der Transistoren, sondern die Rechenleistung, weil Transistoren nicht nur mehr, sondern auch schneller wurden. Wer die drei Zahlen auseinanderhalten kann, weiß mehr als die meisten Erwachsenen.',
            en:
              'In 1965 Moore spoke of a doubling per year. In 1975, at the IEDM conference, he corrected himself to roughly every two years. The famous "18 months" did not come from him at all but is attributed to Intel manager David House - and it refers not to the number of transistors but to performance, because transistors did not only get more numerous but also faster. Anyone who can keep those three apart knows more than most adults.',
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Und es funktionierte. Nicht ein paar Jahre, sondern Jahrzehnte. 1971 saßen rund 2.300 Transistoren auf einem Mikroprozessor. 2021 waren es bei Spitzenchips über 58 Milliarden. Über diesen ganzen Zeitraum entspricht das einer Verdopplung ungefähr alle zwei Jahre - über fünfzig Jahre lang.",
            en:
              "And it worked. Not for a few years but for decades. In 1971 around 2,300 transistors sat on a microprocessor. By 2021 top chips had more than 58 billion. Across that whole period this corresponds to a doubling roughly every two years - for over fifty years.",
          },
        },
        {
          kind: "quote",
          text: {
            de:
              "Dass so etwas 50 Jahre lang funktioniert hat, ist wirklich erstaunlich.",
            en:
              "The fact that something has gone on for 50 years is truly amazing.",
          },
          source: {
            de:
              "Gordon Moore beim Festakt zum 50. Jahrestag seines Aufsatzes, San Francisco, Mai 2015",
            en:
              "Gordon Moore at the 50th anniversary event for his article, San Francisco, May 2015",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Ist das Mooresche Gesetz tot?",
            en: "Is Moore's law dead?",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Irgendwann stieß das Schrumpfen an physikalische Grenzen. Ein Transistor ist heute so klein, dass man seine Bauteile in Atomen zählen kann - viel weiter geht es nicht. Etwa ab 2005 hörte außerdem eine bequeme Nebenwirkung auf: Bis dahin brauchten kleinere Transistoren auch automatisch weniger Strom. Seither wird jeder Fortschritt mit Wärme bezahlt.",
            en:
              "At some point shrinking hit physical limits. A transistor today is so small that you can count its parts in atoms - it does not go much further. From around 2005 a convenient side effect also stopped: until then, smaller transistors automatically needed less power. Since then every advance is paid for in heat.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'Seither streiten sich die Fachleute öffentlich. NVIDIA-Chef Jensen Huang erklärte 2022 in einer Pressekonferenz kurz und knapp: "Moore\'s Law is dead." Intel-Chef Pat Gelsinger antwortete 2024 ebenso knapp: "Anders als Jensen dich glauben machen will, ist das Mooresche Gesetz quicklebendig." Der Chiphersteller TSMC titelte schon 2019 einen Blogbeitrag mit "Moore\'s Law is not Dead". Bemerkenswert dabei: Jeder von ihnen verkauft etwas, das von seiner Antwort profitiert.',
            en:
              'Ever since, the experts have argued in public. NVIDIA boss Jensen Huang declared bluntly at a 2022 press conference: "Moore\'s Law is dead." Intel boss Pat Gelsinger replied just as bluntly in 2024: "Unlike what Jensen might have you believe, Moore\'s Law is alive and well." Chip maker TSMC headlined a blog post "Moore\'s Law is not Dead" back in 2019. Worth noticing: each of them sells something that benefits from their answer.',
          },
        },
        {
          kind: "callout",
          tone: "note",
          icon: "🧩",
          title: {
            de: "Die ehrliche Zwischenbilanz",
            en: "The honest interim verdict",
          },
          text: {
            de:
              "Die Zahl der Transistoren steigt weiter - aber nicht mehr, weil sie einfach kleiner werden, sondern weil Ingenieurinnen und Ingenieure Chips stapeln, aus mehreren Kacheln zusammensetzen und die Stromversorgung auf die Rückseite verlegen. Was wirklich gestorben ist, ist nicht das Wachstum, sondern seine Bequemlichkeit.",
            en:
              "Transistor counts keep rising - but no longer simply because transistors get smaller; rather because engineers stack chips, assemble them from several tiles and move the power supply to the back side. What really died is not the growth but its convenience.",
          },
        },
      ],
    },
    {
      key: "kurzweil",
      title: {
        de: "Ray Kurzweil: erst der Mensch, dann die Kurve",
        en: "Ray Kurzweil: first the person, then the curve",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Bevor wir über seine berühmte Kurve reden, lohnt sich ein Blick auf den Menschen dahinter - denn Ray Kurzweil ist einer der ungewöhnlichsten Erfinder der letzten Jahrzehnte.",
            en:
              "Before we talk about his famous curve, the person behind it is worth a look - because Ray Kurzweil is one of the most unusual inventors of recent decades.",
          },
        },
        {
          kind: "timeline",
          entries: [
            {
              year: "1970er",
              title: {
                de: "Der erste Flachbettscanner",
                en: "The first flat-bed scanner",
              },
              text: {
                de:
                  "Kurzweil gilt als Haupterfinder des ersten CCD-Flachbettscanners - jenes Geräts, auf das man ein Blatt Papier legt und einen Deckel zuklappt. Er brauchte ihn als Baustein für eine viel größere Idee.",
                en:
                  "Kurzweil is credited as the principal inventor of the first CCD flat-bed scanner - the device you lay a sheet of paper on and close a lid over. He needed it as a building block for a much larger idea.",
              },
            },
            {
              year: "1976",
              title: {
                de: "Eine Maschine, die Blinden vorliest",
                en: "A machine that reads aloud to blind people",
              },
              text: {
                de:
                  "Die Kurzweil Reading Machine verband drei Erfindungen: einen Scanner, eine Texterkennung, die beliebige Schriftarten lesen konnte, und eine Sprachsynthese. Man legte ein Buch auf - und die Maschine las es vor. Sieben blinde Ingenieure des amerikanischen Blindenverbands arbeiteten daran mit. Der Musiker Stevie Wonder sah das Gerät im Fernsehen und kaufte das erste Exemplar aus der Serienfertigung.",
                en:
                  "The Kurzweil Reading Machine combined three inventions: a scanner, text recognition that could read arbitrary typefaces, and speech synthesis. You put a book on it - and the machine read it out. Seven blind engineers from the American federation of the blind worked on it. The musician Stevie Wonder saw the device on television and bought the first unit off the production line.",
              },
            },
            {
              year: "1984",
              title: {
                de: "Ein Synthesizer, der wie ein Konzertflügel klingt",
                en: "A synthesizer that sounds like a grand piano",
              },
              text: {
                de:
                  "Aus der Freundschaft mit Stevie Wonder entstand eine Firma für Musikinstrumente. Der Kurzweil K250 konnte die Klänge echter Instrumente so überzeugend nachbilden, dass Profimusiker sie im Blindtest kaum vom Original unterschieden.",
                en:
                  "The friendship with Stevie Wonder led to a musical instrument company. The Kurzweil K250 could reproduce the sounds of real instruments so convincingly that professional musicians could barely tell them from the original in blind tests.",
              },
            },
            {
              year: "1999 / 2002",
              title: {
                de: "Auszeichnungen",
                en: "Awards",
              },
              text: {
                de:
                  "Kurzweil erhielt die National Medal of Technology des Jahres 1999, überreicht im März 2000 im Weißen Haus, und wurde 2002 in die National Inventors Hall of Fame aufgenommen. Dazu kommen mehr als zwanzig Ehrendoktorwürden.",
                en:
                  "Kurzweil received the 1999 National Medal of Technology, presented at the White House in March 2000, and was inducted into the National Inventors Hall of Fame in 2002. On top of that come more than twenty honorary doctorates.",
              },
            },
          ],
        },
        {
          kind: "heading",
          text: {
            de: "Seine Beobachtung: die Kurve ist älter als der Transistor",
            en: "His observation: the curve is older than the transistor",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Kurzweil interessierte sich nicht nur für Transistoren, sondern für eine größere Frage: Wie viel Rechenleistung bekommt man eigentlich für einen Dollar? Und er stellte fest, dass diese Kurve nach oben zeigt, seit es überhaupt Rechenmaschinen gibt - lange bevor jemand den Transistor erfand.",
            en:
              "Kurzweil was interested not only in transistors but in a bigger question: how much computing power do you actually get for one dollar? And he found that this curve has pointed upwards for as long as calculating machines have existed - long before anyone invented the transistor.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'In seinem Aufsatz "The Law of Accelerating Returns" von 2001 - auf Deutsch: das Gesetz der beschleunigten Erträge - beschreibt er fünf Generationen von Rechentechnik, die sich nahtlos ablösen: elektromechanische Zählmaschinen wie bei der US-Volkszählung 1890, Relaisrechner wie die Maschinen der Codeknacker, Vakuumröhren, Transistoren und schließlich integrierte Schaltkreise. Jedes Mal, wenn eine Technik an ihre Grenze kam, übernahm die nächste - und die Kurve machte einfach weiter.',
            en:
              'In his 2001 essay "The Law of Accelerating Returns" he describes five generations of computing technology that hand over seamlessly: electromechanical tabulators as used in the 1890 US census, relay computers like the codebreakers\' machines, vacuum tubes, transistors and finally integrated circuits. Every time one technology reached its limit, the next took over - and the curve simply carried on.',
          },
        },
        {
          kind: "callout",
          tone: "note",
          icon: "📈",
          title: {
            de: "Wie schnell verdoppelt sich das?",
            en: "How fast does it double?",
          },
          text: {
            de:
              'Kurzweil nennt bewusst keine einzelne Zahl. In seinem Aufsatz schreibt er, die Rechenleistung pro Geldeinheit habe sich zwischen 1910 und 1950 etwa alle drei Jahre verdoppelt, zwischen 1950 und 1966 etwa alle zwei Jahre - und zum Zeitpunkt seines Textes ungefähr jedes Jahr. Sein eigentlicher Punkt ist also: Nicht nur die Leistung wächst exponentiell, sondern auch das Tempo des Wachstums. Die oft zitierten "18 Monate" stammen nicht von ihm.',
            en:
              'Kurzweil deliberately gives no single number. In his essay he writes that computing power per unit of money doubled roughly every three years between 1910 and 1950, roughly every two years between 1950 and 1966 - and about every year at the time of writing. So his real point is: not only does performance grow exponentially, so does the speed of that growth. The frequently quoted "18 months" is not his figure.',
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Wichtig ist: Das ist kein Naturgesetz wie die Schwerkraft. Niemand kann daraus ableiten, dass es weitergehen muss. Es ist eine Beobachtung über einen erstaunlich langen Zeitraum - und Beobachtungen können enden.",
            en:
              "Important: this is not a law of nature like gravity. Nobody can conclude from it that things must continue. It is an observation over a remarkably long period - and observations can end.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Wie gut waren seine Vorhersagen wirklich?",
            en: "How good were his predictions really?",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Kurzweil hat aus seiner Kurve Vorhersagen abgeleitet, und einige davon klangen in den 1990er Jahren nach Science-Fiction. Er sagte voraus, dass ein Computer den amtierenden Schachweltmeister bis zum Ende der 1990er Jahre schlagen würde - 1997 gewann Deep Blue gegen Garri Kasparow. Und er schrieb 1999, dass Menschen um 2009 herum drahtlos ins Internet gehen würden, über tragbare Computer. Wer heute mit Kopfhörern und Handy unterwegs ist, lebt in dieser Vorhersage.",
            en:
              "Kurzweil derived predictions from his curve, and some of them sounded like science fiction in the 1990s. He predicted a computer would beat the reigning world chess champion by the end of the 1990s - in 1997 Deep Blue beat Garry Kasparov. And in 1999 he wrote that around 2009 people would go online wirelessly, through wearable computers. Anyone out and about with headphones and a phone today is living inside that prediction.",
          },
        },
        {
          kind: "callout",
          tone: "warn",
          icon: "🚗",
          title: {
            de: "Und jetzt der ehrliche Teil",
            en: "And now the honest part",
          },
          text: {
            de:
              "Selbstfahrende Autos gehören ausdrücklich nicht zu seinen Treffern: In seiner eigenen Bilanz von 2010 bewertete Kurzweil seine Vorhersage dazu als falsch. Außerdem hat der frühere Chefredakteur der Zeitschrift Scientific American, John Rennie, 2010 in der IEEE Spectrum kritisiert, viele Vorhersagen Kurzweils seien so dehnbar formuliert, dass man kaum entscheiden könne, ob sie eingetroffen sind. Das gehört zur Geschichte dazu - eine gute Kurve macht noch keine sichere Zukunft.",
            en:
              "Self driving cars are expressly not among his hits: in his own 2010 assessment Kurzweil rated that prediction as wrong. Moreover, in 2010 the former editor in chief of Scientific American, John Rennie, criticised in IEEE Spectrum that many of Kurzweil's predictions are worded so elastically that it is hard to decide whether they came true. That belongs to the story - a good curve does not make a certain future.",
          },
        },
      ],
    },
    {
      key: "the-calculation",
      title: {
        de: "Die Rechnung: wie viele Erden voller Menschen?",
        en: "The calculation: how many Earths full of people?",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Jetzt wird es konkret - und keine Sorge, wir bleiben bei Zahlen, die man sich vorstellen kann. Wir nehmen drei Grafikkarten, die viele von euch aus Gaming-Videos kennen, und rechnen aus, was ihre Leistung eigentlich bedeutet.",
            en:
              "Now it gets concrete - and do not worry, we stay with numbers you can picture. We take three graphics cards many of you know from gaming videos, and work out what their performance actually means.",
          },
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "🧮",
          title: {
            de: "Was ist ein FLOP?",
            en: "What is a FLOP?",
          },
          text: {
            de:
              'FLOPS steht für "floating point operations per second", also Rechenoperationen mit Kommazahlen pro Sekunde. Eine solche Operation ist ungefähr das, was passiert, wenn du 3,7 mal 2,4 in einen Taschenrechner tippst und auf Gleich drückst. Ein einziges Mal. Merk dir dieses Bild - gleich brauchen wir es.',
            en:
              'FLOPS stands for "floating point operations per second", calculations with decimal numbers per second. One such operation is roughly what happens when you type 3.7 times 2.4 into a pocket calculator and press equals. Once. Remember that picture - we will need it in a moment.',
          },
        },
        {
          kind: "table",
          highlightFirst: true,
          caption: {
            de:
              "Alle Angaben sind Herstellerangaben aus den offiziellen Architektur-Whitepapers von NVIDIA. Die Rechenleistung ist die Spitzenleistung der Shader-Einheiten bei einfacher Genauigkeit (FP32) - die fairste Vergleichszahl zwischen den drei Karten.",
            en:
              "All figures come from NVIDIA's official architecture whitepapers. The compute figure is the peak shader throughput at single precision (FP32) - the fairest comparison between the three cards.",
          },
          head: [
            { de: "Grafikkarte", en: "Graphics card" },
            { de: "Marktstart", en: "Launch" },
            { de: "Preis (UVP)", en: "Price (MSRP)" },
            { de: "Rechenleistung", en: "Compute" },
            { de: "Transistoren", en: "Transistors" },
          ],
          rows: [
            [
              { de: "RTX 3090", en: "RTX 3090" },
              { de: "24.09.2020", en: "24 Sep 2020" },
              { de: "1.499 $", en: "$1,499" },
              { de: "35,6 Billionen/s", en: "35.6 trillion/s" },
              { de: "28,3 Mrd.", en: "28.3 bn" },
            ],
            [
              { de: "RTX 4090", en: "RTX 4090" },
              { de: "12.10.2022", en: "12 Oct 2022" },
              { de: "1.599 $", en: "$1,599" },
              { de: "82,6 Billionen/s", en: "82.6 trillion/s" },
              { de: "76,3 Mrd.", en: "76.3 bn" },
            ],
            [
              { de: "RTX 5090", en: "RTX 5090" },
              { de: "30.01.2025", en: "30 Jan 2025" },
              { de: "1.999 $", en: "$1,999" },
              { de: "104,8 Billionen/s", en: "104.8 trillion/s" },
              { de: "92,2 Mrd.", en: "92.2 bn" },
            ],
          ],
        },
        {
          kind: "heading",
          text: {
            de: "Der Taschenrechner-Vergleich",
            en: "The pocket calculator comparison",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Stell dir vor, jeder Mensch auf der Erde bekommt einen Taschenrechner - alle rund 8,3 Milliarden von uns, vom Baby bis zur Urgroßmutter. Und jeder schafft eine vollständige Rechnung pro Sekunde: Zahl eintippen, mal, zweite Zahl, gleich. Das ist unrealistisch schnell, aber nehmen wir es an. Dann schafft die gesamte Menschheit 8,3 Milliarden Rechnungen pro Sekunde.",
            en:
              "Imagine every person on Earth gets a pocket calculator - all roughly 8.3 billion of us, from babies to great grandmothers. And each manages one complete calculation per second: type a number, times, second number, equals. That is unrealistically fast, but let us assume it. Then all of humanity manages 8.3 billion calculations per second.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Eine einzelne RTX 5090 schafft 104,8 Billionen Rechnungen pro Sekunde. Teilt man das eine durch das andere, kommt heraus: Man bräuchte etwa 12.600 komplette Erden voller tippender Menschen, um mit einer einzigen Grafikkarte mitzuhalten. Einer Grafikkarte, die man in einen normalen Computer schrauben kann.",
            en:
              "A single RTX 5090 manages 104.8 trillion calculations per second. Divide one by the other and you get: you would need about 12,600 complete Earths full of typing people to keep up with a single graphics card. A graphics card you can screw into an ordinary computer.",
          },
        },
        {
          kind: "stats",
          entries: [
            {
              value: "≈ 4.300",
              label: { de: "Erden für eine 3090", en: "Earths for a 3090" },
              hint: {
                de: "35,6 Billionen geteilt durch 8,3 Milliarden",
                en: "35.6 trillion divided by 8.3 billion",
              },
            },
            {
              value: "≈ 9.950",
              label: { de: "Erden für eine 4090", en: "Earths for a 4090" },
              hint: {
                de: "zwei Jahre später - mehr als doppelt so viel",
                en: "two years later - more than twice as many",
              },
            },
            {
              value: "≈ 12.600",
              label: { de: "Erden für eine 5090", en: "Earths for a 5090" },
              hint: {
                de: "und das für rund 2.000 Dollar",
                en: "and that for about 2,000 dollars",
              },
            },
          ],
        },
        {
          kind: "caption",
          text: {
            de:
              "Gerechnet mit einer Weltbevölkerung von rund 8,3 Milliarden Menschen (Schätzung der Vereinten Nationen für Mitte 2026) und den Spitzenwerten aus den NVIDIA-Whitepapers. Nachrechnen ausdrücklich erwünscht: Rechenleistung geteilt durch Weltbevölkerung.",
            en:
              "Calculated with a world population of about 8.3 billion (United Nations estimate for mid 2026) and the peak figures from the NVIDIA whitepapers. Checking the maths is expressly encouraged: compute divided by world population.",
          },
        },
        {
          kind: "callout",
          tone: "fact",
          icon: "⏳",
          title: {
            de: "Dieselbe Zahl, andersherum erzählt",
            en: "The same number, told the other way round",
          },
          text: {
            de:
              "Man kann es auch so sagen: Für das, was eine RTX 5090 in einer einzigen Sekunde ausrechnet, bräuchte die gesamte Menschheit mit Taschenrechnern rund dreieinhalb Stunden. Ohne Pause, ohne Tippfehler, alle 8,3 Milliarden gleichzeitig.",
            en:
              "You can also put it this way: for what an RTX 5090 works out in a single second, all of humanity with pocket calculators would need about three and a half hours. Without a break, without typos, all 8.3 billion at once.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Passt das zu Kurzweils Kurve?",
            en: "Does that fit Kurzweil's curve?",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              'Kurzweils Aussage war ja nicht "Karten werden schneller", sondern: Man bekommt für einen Dollar immer mehr Rechenleistung. Rechnen wir das nach - und zwar ehrlich, auch wenn das Ergebnis nicht ganz so glatt ist, wie man es gern hätte.',
            en:
              'Kurzweil\'s claim was not "cards get faster" but: you get more and more computing power for one dollar. Let us check that - honestly, even if the result is not quite as neat as one might wish.',
          },
        },
        {
          kind: "table",
          highlightFirst: true,
          caption: {
            de:
              "Rechenleistung geteilt durch Preis. Die Preise sind nicht inflationsbereinigt - rechnet man die Teuerung heraus, fällt das Ergebnis für die neueren Karten etwas günstiger aus.",
            en:
              "Compute divided by price. Prices are not adjusted for inflation - correcting for it makes the newer cards look somewhat better.",
          },
          head: [
            { de: "Karte", en: "Card" },
            {
              de: "Rechnungen pro Sekunde je Dollar",
              en: "Calculations per second per dollar",
            },
            { de: "Zuwachs", en: "Increase" },
          ],
          rows: [
            [
              { de: "RTX 3090", en: "RTX 3090" },
              { de: "rund 24 Milliarden", en: "about 24 billion" },
              { de: "-", en: "-" },
            ],
            [
              { de: "RTX 4090", en: "RTX 4090" },
              { de: "rund 52 Milliarden", en: "about 52 billion" },
              {
                de: "gut verdoppelt in gut zwei Jahren",
                en: "a good doubling in a good two years",
              },
            ],
            [
              { de: "RTX 5090", en: "RTX 5090" },
              { de: "rund 52 Milliarden", en: "about 52 billion" },
              {
                de: "praktisch unverändert",
                en: "practically unchanged",
              },
            ],
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Das ist ein spannendes Ergebnis: Von der 3090 zur 4090 hat sich die Leistung pro Dollar mehr als verdoppelt - fast genau im Takt, den Kurzweil beschreibt. Von der 4090 zur 5090 dagegen kaum. Der Grund ist der, den du auf dem ersten Bildschirm gelesen hast: Beide Karten werden im gleichen Fertigungsverfahren gebaut. Die 5090 ist nicht feiner, sondern schlicht größer und stromhungriger.",
            en:
              "That is an interesting result: from the 3090 to the 4090 performance per dollar more than doubled - almost exactly at the pace Kurzweil describes. From the 4090 to the 5090, however, barely at all. The reason is the one you read on the first screen: both cards are built on the same manufacturing process. The 5090 is not finer, just bigger and more power hungry.",
          },
        },
        {
          kind: "callout",
          tone: "warn",
          icon: "⚠️",
          title: {
            de: "Vorsicht bei den Werbezahlen",
            en: "Careful with the marketing numbers",
          },
          text: {
            de:
              'NVIDIA wirbt für die 5090 mit "3352 AI TOPS" - eine viel größere Zahl. Sie stimmt auch, misst aber etwas anderes: Rechnungen mit stark vereinfachten Zahlen, die für KI reichen, aber nicht für Physik oder Wissenschaft. Bei jeder Kartengeneration wurde die Genauigkeit weiter reduziert, also darf man diese Zahlen nicht direkt vergleichen. Wer Kurven vergleicht, muss immer prüfen, ob wirklich dasselbe gemessen wird.',
            en:
              'NVIDIA advertises the 5090 with "3352 AI TOPS" - a much bigger number. It is accurate, but it measures something else: calculations with heavily simplified numbers that are good enough for AI but not for physics or science. With each card generation the precision was reduced further, so these figures must not be compared directly. Whenever you compare curves, always check whether the same thing is being measured.',
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Die Kurve wird also nicht mehr allein dadurch gehalten, dass Transistoren schrumpfen. Sie wird gehalten, weil Chips größer werden, weil sie auf KI zugeschnitten werden - und weil gerade unfassbar viel Geld in genau diese Technik fließt. Wie viel genau, siehst du auf der letzten Seite.",
            en:
              "So the curve is no longer sustained by shrinking transistors alone. It is sustained because chips get bigger, because they are tailored to AI - and because an astonishing amount of money is flowing into precisely this technology right now. Exactly how much is on the final screen.",
          },
        },
      ],
    },
    {
      key: "ai-investment",
      title: {
        de: "Das größte Bauprojekt der Menschheitsgeschichte",
        en: "The biggest building project in human history",
      },
      blocks: [
        {
          kind: "lead",
          text: {
            de:
              "Während du diesen Text liest, werden weltweit Hallen gebaut, in denen nichts steht außer Rechnern. Sie brauchen Strom wie Kleinstädte und Kühlung wie Eisstadien. Und es sind sehr, sehr viele.",
            en:
              "As you read this, halls are being built around the world that contain nothing but computers. They need power like small towns and cooling like ice rinks. And there are very, very many of them.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Das Marktforschungsunternehmen Dell'Oro zählt die Investitionen in Rechenzentren weltweit. 2024 waren es rund 455 Milliarden Dollar. 2025 wuchs diese Summe um 57 Prozent. Und für 2026 erwartet Dell'Oro, dass die Marke von einer Billion Dollar überschritten wird - also von tausend Milliarden. In einem einzigen Jahr.",
            en:
              "The market research firm Dell'Oro tracks investment in data centres worldwide. In 2024 it came to around 455 billion dollars. In 2025 that sum grew by 57 percent. And for 2026 Dell'Oro expects the one trillion dollar mark to be passed - a thousand billion. In a single year.",
          },
        },
        {
          kind: "callout",
          tone: "warn",
          icon: "📏",
          title: {
            de: "Warum die Zahlen so weit auseinandergehen",
            en: "Why the numbers differ so much",
          },
          text: {
            de:
              "Wenn du zu diesem Thema recherchierst, wirst du völlig unterschiedliche Zahlen finden - und alle können stimmen. Es kommt darauf an, was mitgezählt wird: nur die KI-Chips und Server (das Marktforschungsunternehmen IDC kommt so auf 318 Milliarden Dollar für 2025), oder auch Gebäude, Stromversorgung und Kühlung, oder sogar Handys und Notebooks mit KI-Funktionen. Wer Zahlen vergleicht, muss immer zuerst fragen: Was genau wurde da gezählt?",
            en:
              "If you research this topic you will find wildly different numbers - and all of them can be correct. It depends on what is counted: only the AI chips and servers (on that basis the research firm IDC arrives at 318 billion dollars for 2025), or buildings, power supply and cooling as well, or even phones and laptops with AI features. Whenever you compare figures, always ask first: what exactly was counted here?",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Allein die vier großen amerikanischen Technologiekonzerne - Alphabet (Google), Amazon, Microsoft und Meta - gaben 2025 zusammen etwa 410 Milliarden Dollar für Anlagen und Ausrüstung aus. Für 2026 haben sie zusammen rund 700 Milliarden angekündigt. Zum Vergleich: Das ist mehr, als die meisten Länder der Welt in einem Jahr an Steuern einnehmen.",
            en:
              "The four big American technology companies alone - Alphabet (Google), Amazon, Microsoft and Meta - together spent about 410 billion dollars on property and equipment in 2025. For 2026 they have jointly announced around 700 billion. For comparison: that is more than most countries in the world collect in taxes in a year.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Zwei Vergleiche, die das Ausmaß greifbar machen",
            en: "Two comparisons that make the scale tangible",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Um solche Summen einzuordnen, hilft es, sie neben die größten Projekte der Geschichte zu stellen - Projekte, für die ganze Nationen alles gaben, was sie hatten.",
            en:
              "To make sense of such sums it helps to place them next to the largest projects in history - projects for which entire nations gave everything they had.",
          },
        },
        {
          kind: "timeline",
          entries: [
            {
              year: "1942-1946",
              title: {
                de: "Das Manhattan-Projekt",
                en: "The Manhattan Project",
              },
              text: {
                de:
                  "Das geheime Programm der USA zum Bau der ersten Atombombe. Auf dem Höhepunkt arbeiteten rund 130.000 Menschen daran, insgesamt durchliefen es über eine halbe Million. Die berühmte Forschungsstadt lag in Los Alamos im US-Bundesstaat New Mexico; das meiste Geld floss aber in riesige Fabriken in Oak Ridge (Tennessee) und Hanford (Washington). Kosten damals: knapp 2 Milliarden Dollar - je nach Umrechnungsmethode heute etwa 30 bis 35 Milliarden.",
                en:
                  "The secret United States programme to build the first atomic bomb. At its peak around 130,000 people worked on it; more than half a million passed through it in total. The famous research town was Los Alamos in the US state of New Mexico; most of the money, however, went into vast factories at Oak Ridge (Tennessee) and Hanford (Washington). Cost at the time: just under 2 billion dollars - roughly 30 to 35 billion today, depending on the conversion method.",
              },
            },
            {
              year: "1961-1972",
              title: {
                de: "Das Apollo-Programm",
                en: "The Apollo programme",
              },
              text: {
                de:
                  "Menschen auf den Mond zu bringen und lebend zurück. Über 400.000 Menschen arbeiteten daran, in Behörden, Universitäten und tausenden Zulieferbetrieben. Kosten damals: rund 25,8 Milliarden Dollar - nach der Umrechnung der Planetary Society etwa 309 Milliarden Dollar in heutigem Geld, verteilt über dreizehn Jahre.",
                en:
                  "Putting humans on the Moon and bringing them back alive. Over 400,000 people worked on it, in agencies, universities and thousands of supplier firms. Cost at the time: around 25.8 billion dollars - by the Planetary Society's conversion about 309 billion dollars in today's money, spread over thirteen years.",
              },
            },
          ],
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Und jetzt der Vergleich: Was 2026 weltweit in einem einzigen Jahr in Rechenzentren gesteckt wird, entspricht ungefähr drei Apollo-Programmen - oder fast dreißig Manhattan-Projekten. Nur dass Apollo dreizehn Jahre dauerte und das Manhattan-Projekt vier.",
            en:
              "And now the comparison: what goes into data centres worldwide in the single year 2026 corresponds to roughly three Apollo programmes - or nearly thirty Manhattan Projects. Except that Apollo took thirteen years and the Manhattan Project four.",
          },
        },
        {
          kind: "callout",
          tone: "note",
          icon: "⚖️",
          title: {
            de: "Fair bleiben beim Vergleichen",
            en: "Staying fair when comparing",
          },
          text: {
            de:
              "Zwei Einschränkungen gehören dazu. Erstens: Apollo und Manhattan waren staatliche Projekte mit einem einzigen Ziel, die heutigen Summen sind Investitionen vieler Firmen mit vielen Zielen. Zweitens: Wie viel eine alte Summe heute wert ist, hängt stark von der Umrechnungsmethode ab - rechnet man Apollo mit den normalen Verbraucherpreisen um statt mit einem Luftfahrt-Index, landet man eher bei 190 Milliarden. Der Größenunterschied bleibt trotzdem beeindruckend.",
            en:
              "Two caveats belong here. First: Apollo and Manhattan were state projects with a single goal, while today's sums are investments by many companies with many goals. Second: what an old sum is worth today depends heavily on the conversion method - convert Apollo using ordinary consumer prices instead of an aerospace index and you end up nearer 190 billion. The difference in scale is still striking.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Wofür das alles - außer für Chatbots?",
            en: "And all this for what - besides chatbots?",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Der sichtbarste Teil dieser Entwicklung sind Programme, mit denen man sich unterhalten kann, oder solche, die Bilder und Videos erzeugen. Spannender ist, was in der Wissenschaft passiert.",
            en:
              "The most visible part of this development are programs you can hold a conversation with, or ones that generate images and videos. What is happening in science is more exciting.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Proteine sind die Werkzeuge des Lebens, und ihre Funktion hängt davon ab, wie sie sich zusammenfalten. Diese Faltung vorherzusagen galt fünfzig Jahre lang als eines der größten ungelösten Probleme der Biologie - für ein einziges Protein brauchten Forschende oft Jahre im Labor. Das Programm AlphaFold von Google DeepMind kann diese Struktur vorhersagen. In einer frei zugänglichen Datenbank stehen inzwischen über 200 Millionen vorhergesagte Proteinstrukturen, die von Millionen Forschenden in über 190 Ländern genutzt werden. 2024 gab es dafür den Nobelpreis für Chemie: eine Hälfte an David Baker, die andere gemeinsam an Demis Hassabis und John Jumper.",
            en:
              "Proteins are the tools of life, and their function depends on how they fold up. Predicting that folding was regarded for fifty years as one of the great unsolved problems of biology - for a single protein researchers often needed years in the lab. Google DeepMind's AlphaFold program can predict this structure. A freely accessible database now holds more than 200 million predicted protein structures, used by millions of researchers in over 190 countries. In 2024 this earned the Nobel Prize in Chemistry: one half to David Baker, the other jointly to Demis Hassabis and John Jumper.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Auch in der Mathematik geht etwas voran. Bei der Internationalen Mathematik-Olympiade 2024 löste ein System von DeepMind vier von sechs Aufgaben und erreichte damit Silbermedaillen-Niveau - allerdings brauchte es für manche Aufgaben bis zu drei Tage, während Menschen zweimal viereinhalb Stunden haben. Ein Jahr später schaffte ein Modell namens Gemini Deep Think 35 von 42 Punkten innerhalb der regulären Zeit; die Olympiade selbst bestätigte, dass das Goldmedaillen-Niveau entspricht.",
            en:
              "Mathematics is moving too. At the International Mathematical Olympiad in 2024, a DeepMind system solved four of six problems, reaching silver medal level - though it needed up to three days for some problems, while humans get two sessions of four and a half hours. A year later a model called Gemini Deep Think managed 35 out of 42 points within the regular time limit; the Olympiad itself confirmed that this corresponds to gold medal standard.",
          },
        },
        {
          kind: "callout",
          tone: "warn",
          icon: "🔬",
          title: {
            de: "Genau hinschauen lohnt sich",
            en: "Looking closely pays off",
          },
          text: {
            de:
              "Diese Spitzenergebnisse stammen von besonders aufwendigen Spezialsystemen. Als unabhängige Fachleute normale, öffentlich verfügbare KI-Modelle dieselben Olympiade-Aufgaben rechnen ließen, kam das beste davon auf 13 von 42 Punkten - nicht einmal Bronze. Beides ist wahr, und beides gehört in dieselbe Geschichte.",
            en:
              "These headline results come from particularly elaborate specialist systems. When independent experts gave ordinary, publicly available AI models the same olympiad problems, the best of them scored 13 out of 42 - not even bronze. Both are true, and both belong in the same story.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "In der Medizin gibt es die vielleicht handfestesten Ergebnisse. In einer großen schwedischen Studie mit rund 104.000 Frauen wurde die Brustkrebs-Früherkennung einmal mit und einmal ohne KI-Unterstützung durchgeführt. Mit KI wurden mehr Krebserkrankungen gefunden - 80,5 statt 73,8 Prozent - ohne dass es mehr Fehlalarme gab. Das ist kein Versprechen für die Zukunft, das ist gemessen, an echten Menschen, und 2026 in der Fachzeitschrift The Lancet veröffentlicht.",
            en:
              "Medicine offers perhaps the most solid results. In a large Swedish study with around 104,000 women, breast cancer screening was carried out once with and once without AI support. With AI more cancers were found - 80.5 instead of 73.8 percent - without any increase in false alarms. That is not a promise about the future, it was measured, on real people, and published in 2026 in the journal The Lancet.",
          },
        },
        {
          kind: "heading",
          text: {
            de: "Und was heißt das jetzt für dich?",
            en: "So what does this mean for you?",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Ob das Geld, das gerade in diese Technik fließt, sich lohnt, weiß heute niemand sicher. Rechenzentren brauchen sehr viel Strom und Wasser, es gibt berechtigte Kritik daran, und einige Fachleute halten die Investitionen für eine Blase. Andere halten sie für den Beginn einer neuen industriellen Revolution. Beide Lager bestehen aus klugen Menschen, und beide könnten teilweise recht haben.",
            en:
              "Whether the money now flowing into this technology will pay off, nobody knows for certain today. Data centres need a great deal of power and water, there is legitimate criticism of that, and some experts consider the investment a bubble. Others consider it the start of a new industrial revolution. Both camps consist of clever people, and both may be partly right.",
          },
        },
        {
          kind: "paragraph",
          text: {
            de:
              "Sicher ist etwas anderes: Die Kurve, die Gordon Moore 1965 in seinen Daten sah und die Ray Kurzweil Jahrzehnte weiter zurückverfolgte, zeigt weiter nach oben - inzwischen getrieben von größeren Chips, neuen Bauweisen und sehr viel Geld. Und die Werkzeuge, die daraus entstehen, landen nicht nur in Rechenzentren, sondern in Laboren, Kliniken, Klassenzimmern und auf deinem Handy.",
            en:
              "Something else is certain: the curve that Gordon Moore saw in his data in 1965, and that Ray Kurzweil traced decades further back, still points upwards - now driven by bigger chips, new construction methods and a great deal of money. And the tools that come out of it end up not only in data centres but in laboratories, clinics, classrooms and on your phone.",
          },
        },
        {
          kind: "callout",
          tone: "tip",
          icon: "🌱",
          title: {
            de: "Der eigentliche Punkt",
            en: "The actual point",
          },
          text: {
            de:
              "Du lernst diese Dinge in einem Moment, in dem sich viel bewegt und noch längst nicht entschieden ist, wohin es geht. Wer versteht, wie ein Transistor schaltet, was ein Byte ist und warum eine Verdopplung so mächtig wird, kann bei diesen Fragen mitreden - und mitentscheiden. Genau dafür lohnt sich Neugier.",
            en:
              "You are learning these things at a moment when a great deal is in motion and it is far from settled where it leads. Anyone who understands how a transistor switches, what a byte is and why doubling becomes so powerful can join these conversations - and help decide them. That is exactly what curiosity is good for.",
          },
        },
        {
          kind: "sources",
          items: [
            {
              label: {
                de:
                  'Gordon Moore, "Cramming more components onto integrated circuits" (1965), Computer History Museum',
                en:
                  'Gordon Moore, "Cramming more components onto integrated circuits" (1965), Computer History Museum',
              },
              url:
                "https://www.computerhistory.org/collections/catalog/102770822",
            },
            {
              label: {
                de:
                  'Gordon Moore, "Progress in Digital Integrated Electronics" (IEDM 1975)',
                en:
                  'Gordon Moore, "Progress in Digital Integrated Electronics" (IEDM 1975)',
              },
              url:
                "https://www.eng.auburn.edu/~agrawvd/COURSE/E7770_Spr07/READ/Gordon_Moore_1975_Speech.pdf",
            },
            {
              label: {
                de:
                  "Our World in Data: Transistoren pro Mikroprozessor seit 1971",
                en:
                  "Our World in Data: transistors per microprocessor since 1971",
              },
              url:
                "https://ourworldindata.org/grapher/transistors-per-microprocessor",
            },
            {
              label: {
                de: "Our World in Data: Das Mooresche Gesetz erklärt",
                en: "Our World in Data: Moore's law explained",
              },
              url: "https://ourworldindata.org/moores-law",
            },
            {
              label: {
                de: 'Ray Kurzweil, "The Law of Accelerating Returns" (2001)',
                en: 'Ray Kurzweil, "The Law of Accelerating Returns" (2001)',
              },
              url:
                "https://www.writingsbyraykurzweil.com/the-law-of-accelerating-returns",
            },
            {
              label: {
                de: "National Inventors Hall of Fame: Ray Kurzweil",
                en: "National Inventors Hall of Fame: Ray Kurzweil",
              },
              url: "https://www.invent.org/inductees/raymond-kurzweil",
            },
            {
              label: {
                de:
                  'John Rennie, "Ray Kurzweil\'s Slippery Futurism", IEEE Spectrum (2010)',
                en:
                  'John Rennie, "Ray Kurzweil\'s Slippery Futurism", IEEE Spectrum (2010)',
              },
              url: "https://spectrum.ieee.org/ray-kurzweils-slippery-futurism",
            },
            {
              label: {
                de:
                  "NVIDIA: Ampere-GA102-Whitepaper (RTX 3090: 35,6 TFLOPS, 28,3 Mrd. Transistoren)",
                en:
                  "NVIDIA: Ampere GA102 whitepaper (RTX 3090: 35.6 TFLOPS, 28.3bn transistors)",
              },
              url:
                "https://www.nvidia.com/content/PDF/nvidia-ampere-ga-102-gpu-architecture-whitepaper-v2.pdf",
            },
            {
              label: {
                de: "NVIDIA: Ada-Lovelace-Whitepaper (RTX 4090: 82,6 TFLOPS)",
                en: "NVIDIA: Ada Lovelace whitepaper (RTX 4090: 82.6 TFLOPS)",
              },
              url:
                "https://images.nvidia.com/aem-dam/Solutions/geforce/ada/nvidia-ada-gpu-architecture.pdf",
            },
            {
              label: {
                de: "NVIDIA: RTX-Blackwell-Whitepaper (RTX 5090: 104,8 TFLOPS)",
                en: "NVIDIA: RTX Blackwell whitepaper (RTX 5090: 104.8 TFLOPS)",
              },
              url:
                "https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf",
            },
            {
              label: {
                de:
                  "NVIDIA-Pressemitteilung zum Marktstart der RTX 5090 (1.999 $, 30.01.2025)",
                en:
                  "NVIDIA press release on the RTX 5090 launch ($1,999, 30 Jan 2025)",
              },
              url:
                "https://nvidianews.nvidia.com/news/nvidia-blackwell-geforce-rtx-50-series-opens-new-world-of-ai-computer-graphics",
            },
            {
              label: {
                de:
                  "Dell'Oro Group: Investitionen in Rechenzentren 2025 und Ausblick 2026",
                en:
                  "Dell'Oro Group: data centre capex 2025 and outlook for 2026",
              },
              url:
                "https://www.delloro.com/news/data-center-capex-surges-57-percent-in-2025-as-ai-deployments-accelerate/",
            },
            {
              label: {
                de:
                  "IDC: Ausgaben für KI-Infrastruktur (318 Mrd. $ im Jahr 2025)",
                en: "IDC: AI infrastructure spending ($318bn in 2025)",
              },
              url:
                "https://www.idc.com/resource-center/blog/ai-infrastructure-spending-caps-historic-year-at-90-billion-in-q4-2025-2029-spending-to-eclipse-1-trillion/",
            },
            {
              label: {
                de: "Brookings Institution: die Kosten des Manhattan-Projekts",
                en: "Brookings Institution: the costs of the Manhattan Project",
              },
              url:
                "https://www.brookings.edu/the-costs-of-the-manhattan-project/",
            },
            {
              label: {
                de: "US-Energieministerium: Hintergrund zum Manhattan-Projekt",
                en: "US Department of Energy: Manhattan Project background",
              },
              url:
                "https://www.energy.gov/lm/manhattan-project-background-information-and-preservation-work",
            },
            {
              label: {
                de:
                  "The Planetary Society: Was das Apollo-Programm gekostet hat",
                en: "The Planetary Society: how much Apollo cost",
              },
              url: "https://www.planetary.org/space-policy/cost-of-apollo",
            },
            {
              label: {
                de: "Nobelpreis für Chemie 2024 (Baker, Hassabis, Jumper)",
                en: "Nobel Prize in Chemistry 2024 (Baker, Hassabis, Jumper)",
              },
              url: "https://www.nobelprize.org/prizes/chemistry/2024/summary/",
            },
            {
              label: {
                de:
                  "Google DeepMind: AlphaFold-Datenbank mit über 200 Millionen Strukturen",
                en:
                  "Google DeepMind: AlphaFold database with over 200 million structures",
              },
              url:
                "https://deepmind.google/blog/putting-the-power-of-alphafold-into-the-worlds-hands/",
            },
            {
              label: {
                de:
                  "Google DeepMind: Silbermedaillen-Niveau bei der Mathematik-Olympiade 2024",
                en:
                  "Google DeepMind: silver medal level at the 2024 Mathematical Olympiad",
              },
              url:
                "https://deepmind.google/blog/ai-solves-imo-problems-at-silver-medal-level/",
            },
            {
              label: {
                de:
                  "Google DeepMind: Goldmedaillen-Niveau bei der Mathematik-Olympiade 2025",
                en:
                  "Google DeepMind: gold medal standard at the 2025 Mathematical Olympiad",
              },
              url:
                "https://deepmind.google/blog/advanced-version-of-gemini-with-deep-think-officially-achieves-gold-medal-standard-at-the-international-mathematical-olympiad/",
            },
            {
              label: {
                de:
                  "MathArena: unabhängiger Test öffentlicher Modelle an denselben Aufgaben",
                en:
                  "MathArena: independent test of public models on the same problems",
              },
              url: "https://matharena.ai/imo/",
            },
            {
              label: {
                de:
                  "The Lancet (2026): MASAI-Studie zur KI-gestützten Brustkrebs-Früherkennung",
                en:
                  "The Lancet (2026): MASAI trial on AI supported breast cancer screening",
              },
              url:
                "https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(25)02464-X/abstract",
            },
          ],
        },
      ],
    },
  ],
  exercises: [
    {
      kind: "cloze",
      title: {
        de: "1. Lückentext: zwei Kurven und sehr viel Geld",
        en: "1. Fill in the blanks: two curves and a great deal of money",
      },
      intro: {
        de:
          "Setze die fehlenden Wörter ein. Bei den Zahlen darfst du zurückblättern.",
        en: "Fill in the missing words. You may page back for the numbers.",
      },
      text: {
        de:
          "Im Jahr 1965 beobachtete Gordon ___, dass sich die Zahl der ___ auf einem Chip regelmäßig verdoppelt; daraus wurde das Mooresche ___. 1975 korrigierte er den Takt auf etwa ___ Jahre. Ray ___ schaute auf eine andere Größe: darauf, wie viel Rechenleistung man für einen ___ bekommt. Seine Beobachtung nannte er das Gesetz der beschleunigten ___ - und sie begann schon vor der Erfindung des Transistors. Rechenleistung misst man in ___, also Rechenoperationen mit Kommazahlen pro Sekunde. Um die Leistung einer einzigen RTX 5090 zu erreichen, bräuchte man rund 12.600 ___ voller tippender Menschen. Was heute jährlich weltweit in ___ investiert wird, entspricht ungefähr drei ___-Programmen.",
        en:
          "In 1965 Gordon ___ observed that the number of ___ on a chip doubles at regular intervals; this became known as Moore's ___. In 1975 he corrected the pace to about ___ years. Ray ___ looked at a different quantity: how much computing power you get for one ___. He called his observation the law of accelerating ___ - and it began before the transistor was even invented. Computing power is measured in ___, that is floating point operations per second. To match a single RTX 5090 you would need around 12,600 ___ full of people typing. What is invested worldwide in ___ each year today amounts to roughly three ___ programmes.",
      },
    },
    {
      kind: "compare",
      title: {
        de: "2. Vergleiche: gilt die Kurve noch?",
        en: "2. Compare: does the curve still hold?",
      },
      intro: {
        de:
          "Hier musst du zwei Zahlenpaare gegeneinanderhalten und daraus etwas schließen.",
        en:
          "Here you have to hold two pairs of numbers against each other and draw a conclusion.",
      },
      text: {
        de:
          "Von der RTX 3090 zur 4090 hat sich die Rechenleistung pro Dollar mehr als verdoppelt. Von der 4090 zur 5090 hat sie sich kaum verändert. Gleichzeitig steigt die Zahl der Transistoren pro Chip weiter. Was folgt daraus für Kurzweils Behauptung, man bekomme für einen Dollar immer mehr Rechenleistung? Begründe, ob du eine einzelne Generation für einen ausreichenden Beleg hältst - und was du bräuchtest, um die Frage wirklich zu beantworten.",
        en:
          "From the RTX 3090 to the 4090, computing power per dollar more than doubled. From the 4090 to the 5090 it barely moved. At the same time the number of transistors per chip keeps rising. What follows from this for Kurzweil's claim that a dollar buys ever more computing power? Argue whether you consider a single generation sufficient evidence - and what you would need in order to answer the question properly.",
      },
      hint: {
        de:
          "Eine Beobachtung über Jahrzehnte und eine Messung zwischen zwei Produkten sind nicht dasselbe.",
        en:
          "An observation spanning decades and a measurement between two products are not the same thing.",
      },
    },
    {
      kind: "reflect",
      title: {
        de: "3. Zum Nachdenken: drei Apollo-Programme pro Jahr",
        en: "3. Something to think about: three Apollo programmes a year",
      },
      intro: {
        de:
          "Eine Frage ohne richtige Antwort - aber mit vielen guten Begründungen.",
        en:
          "A question with no right answer - but plenty of good reasons on every side.",
      },
      text: {
        de:
          "Für Rechenzentren wird gerade in einem einzigen Jahr ungefähr so viel Geld ausgegeben wie für drei Mondlandeprogramme. Dafür gibt es beeindruckende Ergebnisse - etwa bei der Vorhersage von Proteinstrukturen oder in der Brustkrebs-Früherkennung -, aber auch hohen Strom- und Wasserverbrauch. Wenn du entscheiden dürftest: Wofür würdest du dieses Geld einsetzen, und woran würdest du in zehn Jahren messen, ob es sich gelohnt hat? Nenne mindestens einen Grund, der gegen deine eigene Meinung spricht.",
        en:
          "In a single year, roughly as much money now goes into data centres as into three moon landing programmes. There are impressive results to show for it - predicting protein structures, or spotting breast cancer earlier - but also a great deal of electricity and water consumed. If the decision were yours: what would you spend this money on, and what would you measure in ten years to decide whether it was worth it? Name at least one reason that argues against your own view.",
      },
    },
  ],
};

export const subjects: Subject[] = [
  {
    key: "computing",
    title: {
      de: "Informatische Grundbildung",
      en: "Computing Basics",
    },
    description: {
      de:
        "Wie Computer entstanden sind, wie sie im Inneren wirklich arbeiten und warum sie jedes Jahr schneller werden - ohne Vorwissen, ohne Formelangst.",
      en:
        "How computers came about, how they really work inside and why they get faster every year - no prior knowledge, no fear of formulas.",
    },
    icon: "💻",
    accent: "indigo",
    paths: [
      whatIsAComputer,
      bitsAndBytes,
      pixelsAndResolution,
      exponentialGrowth,
    ],
  },
];
