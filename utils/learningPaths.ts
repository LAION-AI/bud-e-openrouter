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
                  "Ein Elektromagnet zieht ein Metallplättchen an und schließt damit einen zweiten Stromkreis. Konrad Zuses Z3 von 1941 arbeitete mit rund 2.000 solcher Relais. Der Rechner klapperte beim Rechnen hörbar - und schaffte etwa eine Addition pro halbe Sekunde.",
                en:
                  "An electromagnet pulls a small metal plate and closes a second circuit. Konrad Zuse's Z3 from 1941 used around 2,000 such relays. The machine audibly clattered while it worked - and managed roughly one addition every half second.",
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
              "Es ist ziemlich unpraktisch, \"an aus aus an an aus an aus\" aufzuschreiben. Also schreiben wir für \"an\" eine 1 und für \"aus\" eine 0: 10011010. Deshalb heißt es, Computer sprächen Einsen und Nullen. In Wirklichkeit sprechen sie die Sprache von Strom an und Strom aus - die Einsen und Nullen sind nur unsere Schreibweise dafür, damit wir Menschen mitkommen.",
            en:
              "Writing down \"on off off on on off on off\" is pretty awkward. So we write 1 for \"on\" and 0 for \"off\": 10011010. That is why people say computers speak ones and zeros. In reality they speak the language of power on and power off - the ones and zeros are just our notation, so that we humans can follow along.",
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
              "Festplatten- und Handyhersteller rechnen beim Aufdruck mit 1000 statt 1024. Eine Platte mit \"500 GB\" hat also 500 Milliarden Byte - dein Betriebssystem teilt aber durch 1024 und zeigt darum nur rund 465 GB an. Es fehlt nichts, es wird nur anders gezählt. Wer es ganz genau nimmt, sagt zu den 1024er-Stufen Kibibyte, Mebibyte und Gibibyte (KiB, MiB, GiB).",
            en:
              "Disk and phone makers count in 1000s rather than 1024s on the label. A disk marked \"500 GB\" therefore holds 500 billion bytes - but your operating system divides by 1024 and shows only about 465 GB. Nothing is missing, it is just counted differently. Sticklers call the 1024 steps kibibyte, mebibyte and gibibyte (KiB, MiB, GiB).",
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
                de: "Wikipedia: Zuse Z3 - Relaisrechner von 1941",
                en: "Wikipedia: Zuse Z3 - the 1941 relay computer",
              },
              url: "https://de.wikipedia.org/wiki/Zuse_Z3",
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
    paths: [bitsAndBytes],
  },
];
