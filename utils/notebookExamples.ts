/**
 * @file notebookExamples.ts
 * @description The example notebooks offered in the notebook overlay.
 *
 *              Written for someone who has never programmed: every cell is
 *              short, every cell prints something, and the comments explain
 *              the idea rather than restating the code. They build on each
 *              other in the order listed.
 */

import { type Notebook, newCell } from "./notebookStore.ts";

export interface ExampleSpec {
  key: string;
  /** shown in the list */
  name: Record<string, string>;
  /** one sentence: what you learn here */
  about: Record<string, string>;
  cells: { type: "code" | "markdown"; source: string }[];
}

export const EXAMPLES: ExampleSpec[] = [
  // ------------------------------------------------------------------ 1
  {
    key: "hello",
    name: { de: "1 - Hallo Welt", en: "1 - Hello world" },
    about: {
      de: "Ausgeben mit print, der Unterschied zwischen Zahlen und Text, und die ersten Variablen.",
      en: "Printing with print, how numbers differ from text, and your first variables.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 1 - Hallo Welt

Dein erstes Python-Programm. Klick in die Zelle darunter und druecke
Strg+Enter (oder das Dreieck links oben in der Zelle).`,
      },
      {
        type: "code",
        source: `# print schreibt etwas unter die Zelle.
print("Hallo Welt")`,
      },
      {
        type: "markdown",
        source: `## Zahlen oder Text?

Anfuehrungszeichen machen aus etwas **Text**. Ohne Anfuehrungszeichen ist es
eine **Zahl**, mit der Python rechnen kann. Der Unterschied ist wichtig - hier
siehst du ihn:`,
      },
      {
        type: "code",
        source: `# Ohne Anfuehrungszeichen rechnet Python: 3 + 7 sind 10.
print(3 + 7)

# Mit Anfuehrungszeichen sind es zwei Texte. Das Plus haengt sie aneinander.
print("3" + "7")`,
      },
      {
        type: "markdown",
        source: `Oben kommt \`10\` heraus, unten \`37\`. Python hat im zweiten Fall nicht
gerechnet, sondern die beiden Zeichen aneinandergehaengt.`,
      },
      {
        type: "code",
        source: `# Auch bei Woertern haengt das Plus einfach aneinander.
print("Hallo" + " " + "Welt")

# Ein Komma in print setzt automatisch ein Leerzeichen dazwischen.
print("Hallo", "Welt")`,
      },
      {
        type: "markdown",
        source: `## Variablen

Eine Variable ist ein Name fuer einen Wert. Du vergibst ihn mit \`=\` und
kannst den Wert danach ueberall ueber seinen Namen benutzen.`,
      },
      {
        type: "code",
        source: `meine_variable = 5
print(meine_variable)`,
      },
      {
        type: "code",
        source: `meine_variable1 = 5
meine_variable2 = 7

print(meine_variable1 + 2)              # 5 + 2  ->  7
print(meine_variable2 + 2)              # 7 + 2  ->  9
print(meine_variable1 + meine_variable2)  # 5 + 7  ->  12`,
      },
      {
        type: "markdown",
        source: `## Zwischen Zellen bleibt alles erhalten

Die Zellen teilen sich einen Interpreter. Was du oben angelegt hast, kennt
Python auch weiter unten - probier es aus:`,
      },
      {
        type: "code",
        source: `# meine_variable1 gibt es noch, obwohl sie in einer anderen Zelle steht.
summe = meine_variable1 + meine_variable2
print("Die Summe ist", summe)

# Steht in der letzten Zeile nur ein Wert, zeigt das Notebook ihn auch ohne print.
summe * 2`,
      },
      {
        type: "markdown",
        source: `**Selbst probieren:** aendere oben die 5 in eine 10 und fuehre die Zellen
noch einmal aus. Was passiert mit der Summe? (Tipp: die Zelle mit der Summe
musst du danach auch noch einmal ausfuehren.)`,
      },
    ],
  },

  // ------------------------------------------------------------------ 2
  {
    key: "chat",
    name: { de: "2 - Ein kleines Gespraech", en: "2 - A small conversation" },
    about: {
      de: "Eingaben mit input abfragen und mit if/elif/else unterschiedlich darauf antworten.",
      en: "Reading answers with input and reacting to them with if/elif/else.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 2 - Ein kleines Gespraech

Bis jetzt hat das Programm nur geredet. Jetzt darf es fragen.

\`input()\` haelt an und wartet, bis du unter der Zelle etwas eintippst und
Enter druueckst. Was du eingibst, kommt als Text zurueck.`,
      },
      {
        type: "code",
        source: `name = input("Wie heisst du? ")
print("Hallo " + name + "!")`,
      },
      {
        type: "markdown",
        source: `## Auf die Antwort reagieren

\`if\` heisst "wenn". Damit reagiert das Programm unterschiedlich, je nachdem
was du eingibst.

Wichtig sind die zwei Dinge am Zeilenende und -anfang:
der **Doppelpunkt** hinter der Bedingung und die **Einrueckung** darunter.
Die eingerueckten Zeilen gehoeren zum \`if\`.`,
      },
      {
        type: "code",
        source: `stimmung = input("Wie geht es dir? ")

if stimmung == "gut":
    print("Das freut mich!")
elif stimmung == "schlecht":
    print("Oh, das ist schade.")
else:
    print("Aha.")`,
      },
      {
        type: "markdown",
        source: `\`==\` fragt "ist gleich?" - ein einzelnes \`=\` wuerde stattdessen zuweisen.
\`elif\` heisst "sonst wenn" und wird nur geprueft, wenn das \`if\` davor nicht
gepasst hat. \`else\` faengt alles Uebrige auf.

## Alles zusammen`,
      },
      {
        type: "code",
        source: `name = input("Wie heisst du? ")
print("Hallo " + name + ", schoen dich kennenzulernen.")

stimmung = input("Wie geht es dir heute? ")

if stimmung == "gut":
    print("Das freut mich, " + name + "!")
elif stimmung == "schlecht":
    print("Oh, das tut mir leid, " + name + ".")
else:
    print("Aha, interessant.")

alter = input("Wie alt bist du? ")

# input liefert immer Text. Zum Rechnen macht int() eine Zahl daraus.
alter_zahl = int(alter)
print("In 10 Jahren bist du", alter_zahl + 10)`,
      },
      {
        type: "markdown",
        source: `**Achtung:** \`input()\` gibt *immer* Text zurueck, auch wenn du eine Zahl
eintippst. \`"12" + 10\` waere ein Fehler - deshalb steht dort \`int(alter)\`.

**Selbst probieren:** Frag zusaetzlich nach der Lieblingsfarbe und antworte
bei "blau" etwas anderes als bei allen anderen Farben.`,
      },
    ],
  },

  // ------------------------------------------------------------------ 3
  {
    key: "loops",
    name: { de: "3 - Schleifen", en: "3 - Loops" },
    about: {
      de: "Etwas mehrfach tun: mit for zaehlen, ueber Buchstaben laufen und mit while wiederholen.",
      en: "Doing things repeatedly: counting with for, walking over letters, repeating with while.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 3 - Schleifen

Statt zehnmal \`print\` zu schreiben, laesst du Python zaehlen.`,
      },
      {
        type: "code",
        source: `# range(5) liefert 0, 1, 2, 3, 4 - fuenf Zahlen, beginnend bei null.
for i in range(5):
    print(i)`,
      },
      {
        type: "markdown",
        source: `Python faengt bei **0** an zu zaehlen. \`range(5)\` hoert deshalb bei 4 auf -
es sind trotzdem fuenf Zahlen. Wenn du bei 1 anfangen willst, sagst du es dazu:`,
      },
      {
        type: "code",
        source: `# range(1, 11) laeuft von 1 bis 10. Die zweite Zahl ist nicht mehr dabei.
for zahl in range(1, 11):
    print(zahl, "mal 3 ist", zahl * 3)`,
      },
      {
        type: "markdown",
        source: `## Ueber Buchstaben laufen

Eine Schleife kann auch durch ein Wort gehen - Buchstabe fuer Buchstabe.`,
      },
      {
        type: "code",
        source: `wort = "Python"

for buchstabe in wort:
    print(buchstabe)

print("Das Wort hat", len(wort), "Buchstaben.")`,
      },
      {
        type: "code",
        source: `# Genauso geht es durch eine Liste.
tiere = ["Katze", "Hund", "Pferd"]

for tier in tiere:
    print("Ein " + tier + " hat", len(tier), "Buchstaben.")`,
      },
      {
        type: "markdown",
        source: `## while - solange etwas gilt

\`for\` laeuft eine feste Anzahl durch. \`while\` wiederholt, **solange** eine
Bedingung stimmt. Du musst selbst dafuer sorgen, dass sie irgendwann nicht
mehr stimmt - sonst hoert die Schleife nie auf.`,
      },
      {
        type: "code",
        source: `countdown = 5

while countdown > 0:
    print(countdown)
    countdown = countdown - 1   # ohne diese Zeile laeuft es ewig!

print("Start!")`,
      },
      {
        type: "markdown",
        source: `**Falls doch mal etwas ewig laeuft:** oben im Fenster ist ein Knopf
"Stopp". Der bricht die Zelle ab, ohne dass du die Seite neu laden musst.

**Selbst probieren:** lass die erste Schleife die Quadratzahlen ausgeben
(\`zahl * zahl\`) und zaehle im Countdown von 10 herunter.`,
      },
    ],
  },

  // ------------------------------------------------------------------ 4
  {
    key: "guessing",
    name: { de: "4 - Zahlenraten", en: "4 - Guess the number" },
    about: {
      de: "Ein fertiges kleines Spiel: Zufallszahlen, eine Schleife und Vergleiche zusammen.",
      en: "A small finished game: random numbers, a loop and comparisons working together.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 4 - Zahlenraten

Jetzt kommt alles zusammen: eine Zufallszahl, eine Schleife und Vergleiche.

\`random\` ist ein Modul - eine Sammlung fertiger Funktionen, die zu Python
gehoert. Mit \`import\` holst du sie dazu.`,
      },
      {
        type: "code",
        source: `import random

# Wuerfelt eine ganze Zahl von 1 bis 20 - beide Grenzen sind dabei.
zahl = random.randint(1, 20)
print("Ich habe mir eine Zahl gedacht. Aber ich verrate sie nicht.")`,
      },
      {
        type: "markdown",
        source: `## Das Spiel

\`while True:\` laeuft erst einmal endlos. \`break\` steigt aus, sobald geraten
wurde - das ist hier die Abbruchbedingung.`,
      },
      {
        type: "code",
        source: `import random

zahl = random.randint(1, 20)
versuche = 0

print("Ich denke an eine Zahl zwischen 1 und 20.")

while True:
    eingabe = input("Dein Tipp: ")
    tipp = int(eingabe)      # aus dem Text eine Zahl machen
    versuche = versuche + 1

    if tipp < zahl:
        print("Zu klein.")
    elif tipp > zahl:
        print("Zu gross.")
    else:
        print("Richtig! Du hast", versuche, "Versuche gebraucht.")
        break                # geschafft - raus aus der Schleife`,
      },
      {
        type: "markdown",
        source: `## Ein bisschen fairer

Mit einer Obergrenze an Versuchen wird ein richtiges Spiel daraus.`,
      },
      {
        type: "code",
        source: `import random

zahl = random.randint(1, 20)
maximal = 5

print("Zahl zwischen 1 und 20. Du hast", maximal, "Versuche.")

for versuch in range(1, maximal + 1):
    tipp = int(input("Versuch " + str(versuch) + ": "))

    if tipp == zahl:
        print("Richtig! Gewonnen in", versuch, "Versuchen.")
        break
    elif tipp < zahl:
        print("Zu klein.")
    else:
        print("Zu gross.")
else:
    # Dieses else gehoert zur for-Schleife: es laeuft nur,
    # wenn kein break ausgeloest wurde.
    print("Verloren. Die Zahl war", zahl)`,
      },
      {
        type: "markdown",
        source: `**Selbst probieren:** aendere den Bereich auf 1 bis 100 und gib mehr
Versuche. Wie viele braucht man klugerweise? (Tipp: immer die Mitte raten.)`,
      },
    ],
  },

  // ------------------------------------------------------------------ 5
  {
    key: "packages",
    name: { de: "5 - Geheimschrift und Pakete", en: "5 - Secret writing and packages" },
    about: {
      de: "Die Caesar-Verschluesselung selbst bauen und danach mit !pip install ein Paket dazuholen.",
      en: "Build the Caesar cipher yourself, then add a package with !pip install.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 5 - Geheimschrift und Pakete

## Die Caesar-Verschluesselung

Schon Julius Caesar hat seine Nachrichten verschluesselt - mit einem sehr
einfachen Trick: **jeder Buchstabe wird im Alphabet um ein paar Stellen
weitergeschoben.**

Bei einer Verschiebung von 3 wird aus \`A\` ein \`D\`, aus \`B\` ein \`E\`, aus
\`C\` ein \`F\`. Am Ende geht es vorne weiter: aus \`Z\` wird \`C\`.

    Klartext:      H A L L O
    verschoben +3: K D O O R

Zum Entschluesseln schiebt man einfach zurueck.`,
      },
      {
        type: "code",
        source: `alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

def verschluesseln(text, verschiebung):
    ergebnis = ""
    for buchstabe in text.upper():
        if buchstabe in alphabet:
            alte_position = alphabet.index(buchstabe)
            # % 26 sorgt dafuer, dass es hinter Z vorne weitergeht.
            neue_position = (alte_position + verschiebung) % 26
            ergebnis = ergebnis + alphabet[neue_position]
        else:
            # Leerzeichen und Satzzeichen bleiben, wie sie sind.
            ergebnis = ergebnis + buchstabe
    return ergebnis

print(verschluesseln("Hallo Welt", 3))`,
      },
      {
        type: "markdown",
        source: `Zum Entschluesseln brauchst du keine zweite Funktion - eine Verschiebung um
\`-3\` ist genau das Gegenteil:`,
      },
      {
        type: "code",
        source: `geheim = verschluesseln("Treffen um acht", 5)
print("Verschluesselt:  ", geheim)
print("Wieder lesbar:   ", verschluesseln(geheim, -5))`,
      },
      {
        type: "markdown",
        source: `## Geheimschrift knacken

Die Caesar-Verschluesselung ist leicht zu brechen: es gibt nur 25
Moeglichkeiten. Die probiert man einfach alle durch - eine davon ergibt Sinn.`,
      },
      {
        type: "code",
        source: `geheim = "LWZXX FZX MFRGZWL"

for verschiebung in range(1, 26):
    print(verschiebung, ":", verschluesseln(geheim, -verschiebung))`,
      },
      {
        type: "markdown",
        source: `Eine der Zeilen ist lesbar - so einfach ist diese Verschluesselung zu
knacken. Deshalb benutzt sie heute niemand mehr ernsthaft.

---

## Pakete nachinstallieren

Zu Python gehoeren viele fertige Module wie \`random\`. Noch viel mehr liegt
im Internet bereit und laesst sich dazuholen. Das geht hier genau wie in
Google Colab - mit einem Ausrufezeichen davor:`,
      },
      {
        type: "code",
        source: `!pip install cowsay`,
      },
      {
        type: "markdown",
        source: `Beim ersten Mal dauert das ein paar Sekunden, danach ist das Paket in
dieser Sitzung da.`,
      },
      {
        type: "code",
        source: `import cowsay

cowsay.cow("Ich kann jetzt sprechen!")`,
      },
      {
        type: "code",
        source: `# Und beides zusammen: die Kuh spricht in Geheimschrift.
import cowsay

nachricht = input("Was soll die Kuh sagen? ")
cowsay.cow(verschluesseln(nachricht, 3))`,
      },
      {
        type: "markdown",
        source: `### Was geht und was nicht

Python laeuft hier komplett **in deinem Browser** - es gibt keinen Computer
im Hintergrund, auf dem etwas ausgefuehrt wird. Deshalb:

- \`!pip install <paket>\` funktioniert fuer Pakete aus reinem Python.
- Grosse Pakete wie \`numpy\`, \`pandas\` und \`matplotlib\` sind schon dabei
  und werden geladen, sobald du sie importierst - ohne pip.
- Pakete, die auf das Betriebssystem zugreifen (Dateien, Netzwerk, Kamera),
  gibt es hier nicht.
- Andere \`!\`-Befehle als \`pip install\` gehen nicht, weil kein Terminal
  dahintersteckt.

**Selbst probieren:** \`!pip install emoji\`, danach
\`import emoji\` und \`print(emoji.emojize("Python ist :snake:"))\`.`,
      },
    ],
  },
];

/** Builds a fresh, independent notebook from an example. */
export function notebookFromExample(spec: ExampleSpec, lang: string): Notebook {
  const now = new Date().toISOString();
  return {
    budeNotebook: 1,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    name: spec.name[lang] ?? spec.name.de,
    created: now,
    updated: now,
    cells: spec.cells.map((c) => {
      const cell = newCell(c.type, c.source);
      return cell;
    }),
  };
}
