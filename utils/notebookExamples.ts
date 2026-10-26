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

Dein erstes Python-Programm. Klick in die Zelle darunter und drücke
Strg+Enter (oder das Dreieck links oben in der Zelle).`,
      },
      {
        type: "code",
        source: `# print schreibt etwas unter die Zelle.
print("Hallo Welt")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Schreib den Text um, sodass Python **dich** begrüßt - mit deinem Namen.
Füg dann zwei weitere \`print\`-Zeilen dazu, sodass drei Zeilen untereinander
erscheinen: dein Name, deine Lieblingsfarbe, dein Lieblingsessen.

*Die Reihenfolge der Zeilen ist die Reihenfolge der Ausgabe. Immer.*`,
      },
      {
        type: "markdown",
        source: `## Zahlen oder Text?

Anführungszeichen machen aus etwas **Text**. Ohne Anführungszeichen ist es
eine **Zahl**, mit der Python rechnen kann. Der Unterschied ist wichtig - hier
siehst du ihn:`,
      },
      {
        type: "code",
        source: `# Ohne Anführungszeichen rechnet Python: 3 + 7 sind 10.
print(3 + 7)

# Mit Anführungszeichen sind es zwei Texte. Das Plus hängt sie aneinander.
print("3" + "7")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Rechne aus, wie viele Minuten du in einer normalen Schulwoche im Unterricht
sitzt: Stunden pro Tag mal 45 mal 5 Schultage. Lass Python rechnen, nicht dich.

Danach der Test: Setz um die Zahlen Anführungszeichen und führ die Zelle noch
einmal aus. Das Ergebnis ist plötzlich Unsinn - und du weißt jetzt genau, warum.`,
      },
      {
        type: "markdown",
        source: `Oben kommt \`10\` heraus, unten \`37\`. Python hat im zweiten Fall nicht
gerechnet, sondern die beiden Zeichen aneinandergehängt.`,
      },
      {
        type: "code",
        source: `# Auch bei Wörtern hängt das Plus einfach aneinander.
print("Hallo" + " " + "Welt")

# Ein Komma in print setzt automatisch ein Leerzeichen dazwischen.
print("Hallo", "Welt")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Bau deinen vollen Namen aus zwei Teilen zusammen und gib ihn aus - einmal mit
\`+\` und einmal mit Komma. Einer der beiden Wege setzt das Leerzeichen von
selbst, beim anderen musst du daran denken. Welcher ist welcher?`,
      },
      {
        type: "markdown",
        source: `## Variablen

Eine Variable ist ein Name für einen Wert. Du vergibst ihn mit \`=\` und
kannst den Wert danach überall über seinen Namen benutzen.`,
      },
      {
        type: "code",
        source: `meine_variable = 5
print(meine_variable)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Leg eine Variable \`lieblingszahl\` an und gib sie aus. Ändere danach ihren Wert
in der nächsten Zeile und gib sie noch einmal aus - beides in derselben Zelle.

Was du dabei siehst, ist die wichtigste Eigenschaft einer Variablen: Sie merkt
sich immer nur das Letzte.`,
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
        source: `### 🎯 Aufgabe

Rechne dein Taschengeld für ein Jahr aus. Leg dafür zwei Variablen an -
\`pro_woche\` und \`wochen_im_jahr\` - und multipliziere sie mit \`*\`.

Und jetzt das Interessante: Wie viel wäre es, wenn du jede Woche 2 Euro davon
zurücklegst? Wie lange müsstest du sparen für etwas, das du dir wirklich
wünschst? Schreib die Rechnung hin und lass sie dir ausgeben.`,
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
        source: `### 🎯 Aufgabe zum Schluss

Ändere oben die 5 in eine 10 und führ die Zellen noch einmal aus. Was passiert
mit der Summe? *(Die Zelle mit der Summe musst du danach auch noch einmal
ausführen - Python rechnet nicht von selbst nach.)*

Und dann etwas Eigenes: Bau einen kleinen Rechner für dein Leben. Wie viele
Tage sind es noch bis zu den nächsten Ferien? Wie viele Stunden hast du diese
Woche geschlafen? Wie viel Wasser trinkst du im Jahr, wenn es zwei Liter am
Tag sind?

Es ist völlig egal, was du ausrechnest. Wichtig ist der Moment, in dem dir
auffällt, dass du ihn selbst gebaut hast.`,
      },
    ],
  },

  // ------------------------------------------------------------------ 2
  {
    key: "chat",
    name: { de: "2 - Ein kleines Gespräch", en: "2 - A small conversation" },
    about: {
      de: "Eingaben mit input abfragen und mit if/elif/else unterschiedlich darauf antworten.",
      en: "Reading answers with input and reacting to them with if/elif/else.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 2 - Ein kleines Gespräch

Bis jetzt hat das Programm nur geredet. Jetzt darf es fragen.

\`input()\` hält an und wartet, bis du unter der Zelle etwas eintippst und
Enter drückst. Was du eingibst, kommt als Text zurück.`,
      },
      {
        type: "code",
        source: `name = input("Wie heißt du? ")
print("Hallo " + name + "!")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Frag zusätzlich nach dem Lieblingsessen und antworte mit einem Satz, in dem
beides vorkommt - Name und Essen. Zum Beispiel: *"Mia, ich hätte auch gern
Pizza."*

Zwei \`input\`-Zeilen, zwei Variablen, ein \`print\`. Mehr braucht es nicht.`,
      },
      {
        type: "markdown",
        source: `## Auf die Antwort reagieren

\`if\` heißt "wenn". Damit reagiert das Programm unterschiedlich, je nachdem
was du eingibst.

Wichtig sind die zwei Dinge am Zeilenende und -anfang:
der **Doppelpunkt** hinter der Bedingung und die **Einrückung** darunter.
Die eingerückten Zeilen gehören zum \`if\`.`,
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
        source: `### 🎯 Aufgabe

Füg einen dritten Fall dazu: Wenn jemand \`müde\` eintippt, soll das Programm
etwas Aufmunterndes sagen. Du brauchst dafür ein zweites \`elif\`.

Probier danach absichtlich \`Gut\` mit großem G aus. Das Programm erkennt es
nicht - für Python sind \`gut\` und \`Gut\` zwei verschiedene Texte. Findest du
heraus, wie man das freundlicher macht? *(Tipp: \`stimmung.lower()\`)*`,
      },
      {
        type: "markdown",
        source: `\`==\` fragt "ist gleich?" - ein einzelnes \`=\` würde stattdessen zuweisen.
\`elif\` heißt "sonst wenn" und wird nur geprüft, wenn das \`if\` davor nicht
gepasst hat. \`else\` fängt alles Uebrige auf.

## Alles zusammen`,
      },
      {
        type: "code",
        source: `name = input("Wie heißt du? ")
print("Hallo " + name + ", schön dich kennenzulernen.")

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
        source: `**Achtung:** \`input()\` gibt *immer* Text zurück, auch wenn du eine Zahl
eintippst. \`"12" + 10\` wäre ein Fehler - deshalb steht dort \`int(alter)\`.

### 🎯 Aufgabe zum Schluss

Bau dir einen kleinen Gesprächspartner. Frag nach der Lieblingsfarbe und
antworte bei "blau" etwas anderes als bei allen anderen Farben.

Und wenn du magst, geh weiter: Frag nach drei Dingen und lass das Programm am
Ende einen Satz daraus bauen, der alle drei enthält. So entsteht der Eindruck,
es hätte zugehört - dabei hat es nur drei Texte in drei Kisten gelegt.

Genau so funktionierten die ersten Chatprogramme der Welt. Der berühmteste
hieß ELIZA, war 1966 fertig und bestand fast nur aus \`if\`-Zeilen. Menschen
haben ihm trotzdem ihre Sorgen erzählt.`,
      },
    ],
  },

  // ------------------------------------------------------------------ 3
  {
    key: "loops",
    name: { de: "3 - Schleifen", en: "3 - Loops" },
    about: {
      de: "Etwas mehrfach tun: mit for zählen, über Buchstaben laufen und mit while wiederholen.",
      en: "Doing things repeatedly: counting with for, walking over letters, repeating with while.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 3 - Schleifen

Statt zehnmal \`print\` zu schreiben, lässt du Python zählen.`,
      },
      {
        type: "code",
        source: `# range(5) liefert 0, 1, 2, 3, 4 - fünf Zahlen, beginnend bei null.
for i in range(5):
    print(i)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Lass die Schleife von 1 bis 10 zählen statt von 0 bis 4. Danach: rückwärts von
10 bis 1. Für den Rückwärtsgang gibt es einen dritten Wert -
\`range(10, 0, -1)\` heißt "von 10 bis 1, in Schritten von minus eins".

Wenn das läuft, hast du einen Countdown gebaut.`,
      },
      {
        type: "markdown",
        source: `Python fängt bei **0** an zu zählen. \`range(5)\` hört deshalb bei 4 auf -
es sind trotzdem fünf Zahlen. Wenn du bei 1 anfangen willst, sagst du es dazu:`,
      },
      {
        type: "code",
        source: `# range(1, 11) läuft von 1 bis 10. Die zweite Zahl ist nicht mehr dabei.
for zahl in range(1, 11):
    print(zahl, "mal 3 ist", zahl * 3)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Mach daraus dein eigenes Einmaleins: Frag mit \`input\` nach einer Zahl und gib
die ganze Reihe dazu aus. Vergiss \`int()\` nicht, sonst rechnet Python mit Text.

Vier Zeilen, und du hast ein Programm, das jede Einmaleins-Reihe kann - auch
die 17er, die in keinem Heft steht.`,
      },
      {
        type: "markdown",
        source: `## Über Buchstaben laufen

Eine Schleife kann auch durch ein Wort gehen - Buchstabe für Buchstabe.`,
      },
      {
        type: "code",
        source: `wort = "Python"

for buchstabe in wort:
    print(buchstabe)

print("Das Wort hat", len(wort), "Buchstaben.")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Setz deinen eigenen Namen ein. Wie viele Buchstaben hat er?

Und dann etwas zum Angeben: Lass die Schleife den Namen **rückwärts** ausgeben.
Es gibt einen sehr kurzen Weg dafür - \`wort[::-1]\` - aber versuch es ruhig
zuerst mit einer Schleife.`,
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
        source: `### 🎯 Aufgabe

Ersetz die Tiere durch etwas aus deinem Leben: deine Lieblingslieder, die
Fächer am Montag, die Namen deiner Freundinnen und Freunde.

Danach die Frage, die eine Schleife in einer Sekunde beantwortet: Welcher
Eintrag ist der längste? *(Denk an \`len()\` und eine Variable, die sich das
bisherige Maximum merkt.)*`,
      },
      {
        type: "markdown",
        source: `## while - solange etwas gilt

\`for\` läuft eine feste Anzahl durch. \`while\` wiederholt, **solange** eine
Bedingung stimmt. Du musst selbst dafür sorgen, dass sie irgendwann nicht
mehr stimmt - sonst hört die Schleife nie auf.`,
      },
      {
        type: "code",
        source: `countdown = 5

while countdown > 0:
    print(countdown)
    countdown = countdown - 1   # ohne diese Zeile läuft es ewig!

print("Start!")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Zähl von 10 herunter statt von 5. Bau danach absichtlich einen Fehler ein:
Lösch die Zeile \`countdown = countdown - 1\` und führ die Zelle aus.

Nichts geht mehr - die Bedingung wird nie falsch. Genau das ist eine
**Endlosschleife**. Halt sie mit dem Stopp-Knopf oben an. Wer sie einmal
absichtlich gebaut hat, erkennt sie beim nächsten Mal sofort.`,
      },
      {
        type: "markdown",
        source: `**Falls doch mal etwas ewig läuft:** oben im Fenster ist ein Knopf
"Stopp". Der bricht die Zelle ab, ohne dass du die Seite neu laden musst.

**Selbst probieren:** lass die erste Schleife die Quadratzahlen ausgeben
(\`zahl * zahl\`) und zähle im Countdown von 10 herunter.`,
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
gehört. Mit \`import\` holst du sie dazu.`,
      },
      {
        type: "code",
        source: `import random

# Würfelt eine ganze Zahl von 1 bis 20 - beide Grenzen sind dabei.
zahl = random.randint(1, 20)
print("Ich habe mir eine Zahl gedacht. Aber ich verrate sie nicht.")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Bau einen Würfel: \`random.randint(1, 6)\`. Lass ihn in einer Schleife zehnmal
würfeln und gib jedes Ergebnis aus.

Fällt dir etwas auf? Zähl mit, wie oft die Sechs kommt. Bei zehn Würfen ist
alles möglich - probier es mit 1000 Würfen noch einmal. So sieht
Wahrscheinlichkeit aus, wenn man ihr beim Arbeiten zusieht.`,
      },
      {
        type: "markdown",
        source: `## Das Spiel

\`while True:\` läuft erst einmal endlos. \`break\` steigt aus, sobald geraten
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
        print("Zu groß.")
    else:
        print("Richtig! Du hast", versuche, "Versuche gebraucht.")
        break                # geschafft - raus aus der Schleife`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Mach das Spiel netter: Statt nur "zu klein" soll es *heiß* sagen, wenn der Tipp
höchstens 2 danebenliegt, und *kalt*, wenn er weiter weg ist.

Du brauchst dafür den Abstand zwischen Tipp und Zahl - \`abs(tipp - zahl)\`
liefert ihn immer positiv. Ein zusätzliches \`if\` genügt.`,
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
        print("Zu groß.")
else:
    # Dieses else gehört zur for-Schleife: es läuft nur,
    # wenn kein break ausgelöst wurde.
    print("Verloren. Die Zahl war", zahl)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Stell den Bereich auf 1 bis 100 um. Wie viele Versuche sind fair?

Probier es selbst aus: Rate immer die Mitte des noch möglichen Bereichs. Du
wirst merken, dass sieben Versuche fast immer reichen - egal, welche Zahl es
war. Warum das so ist, kannst du sogar ausrechnen: Jeder Tipp halbiert den
Bereich, und 100 lässt sich siebenmal halbieren.`,
      },
      {
        type: "markdown",
        source: `**Selbst probieren:** ändere den Bereich auf 1 bis 100 und gib mehr
Versuche. Wie viele braucht man klugerweise? (Tipp: immer die Mitte raten.)`,
      },
    ],
  },

  // ------------------------------------------------------------------ 5
  {
    key: "packages",
    name: { de: "5 - Geheimschrift und Pakete", en: "5 - Secret writing and packages" },
    about: {
      de: "Die Caesar-Verschlüsselung selbst bauen und danach mit !pip install ein Paket dazuholen.",
      en: "Build the Caesar cipher yourself, then add a package with !pip install.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 5 - Geheimschrift und Pakete

## Die Caesar-Verschlüsselung

Schon Julius Caesar hat seine Nachrichten verschlüsselt - mit einem sehr
einfachen Trick: **jeder Buchstabe wird im Alphabet um ein paar Stellen
weitergeschoben.**

Bei einer Verschiebung von 3 wird aus \`A\` ein \`D\`, aus \`B\` ein \`E\`, aus
\`C\` ein \`F\`. Am Ende geht es vorne weiter: aus \`Z\` wird \`C\`.

    Klartext:      H A L L O
    verschoben +3: K D O O R

Zum Entschlüsseln schiebt man einfach zurück.`,
      },
      {
        type: "code",
        source: `alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

def verschlüsseln(text, verschiebung):
    ergebnis = ""
    for buchstabe in text.upper():
        if buchstabe in alphabet:
            alte_position = alphabet.index(buchstabe)
            # % 26 sorgt dafür, dass es hinter Z vorne weitergeht.
            neue_position = (alte_position + verschiebung) % 26
            ergebnis = ergebnis + alphabet[neue_position]
        else:
            # Leerzeichen und Satzzeichen bleiben, wie sie sind.
            ergebnis = ergebnis + buchstabe
    return ergebnis

print(verschlüsseln("Hallo Welt", 3))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Verschlüssel eine eigene Nachricht mit einer Verschiebung, die nur du kennst.
Gib den verschlüsselten Text jemandem in der Klasse - zusammen mit der Zahl.
Kann die Person ihn wieder lesbar machen?

Und die spannendere Variante: Gib den Text **ohne** die Zahl weiter.`,
      },
      {
        type: "markdown",
        source: `Zum Entschlüsseln brauchst du keine zweite Funktion - eine Verschiebung um
\`-3\` ist genau das Gegenteil:`,
      },
      {
        type: "code",
        source: `geheim = verschlüsseln("Treffen um acht", 5)
print("Verschlüsselt:  ", geheim)
print("Wieder lesbar:   ", verschlüsseln(geheim, -5))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Probier die Verschiebung 13 aus - und dann verschlüssel das Ergebnis noch
einmal mit 13. Was kommt heraus?

Diese Verschiebung hat sogar einen eigenen Namen: **ROT13**. Weil das Alphabet
26 Buchstaben hat, ist Verschlüsseln und Entschlüsseln hier dasselbe.`,
      },
      {
        type: "markdown",
        source: `## Geheimschrift knacken

Die Caesar-Verschlüsselung ist leicht zu brechen: es gibt nur 25
Möglichkeiten. Die probiert man einfach alle durch - eine davon ergibt Sinn.`,
      },
      {
        type: "code",
        source: `geheim = "LWZXX FZX MFRGZWL"

for verschiebung in range(1, 26):
    print(verschiebung, ":", verschlüsseln(geheim, -verschiebung))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Setz deinen eigenen verschlüsselten Text ein und lass ihn knacken. Der Rechner
probiert alle 25 Möglichkeiten in weniger als einer Sekunde durch.

Denk kurz darüber nach: Ein Verfahren, das zweitausend Jahre lang als sicher
galt, fällt hier in einer Zeile Code. Was heißt das für Passwörter, die aus
einem einzigen Wort bestehen?`,
      },
      {
        type: "markdown",
        source: `Eine der Zeilen ist lesbar - so einfach ist diese Verschlüsselung zu
knacken. Deshalb benutzt sie heute niemand mehr ernsthaft.

---

## Pakete nachinstallieren

Zu Python gehören viele fertige Module wie \`random\`. Noch viel mehr liegt
im Internet bereit und lässt sich dazuholen. Das geht hier genau wie in
Google Colab - mit einem Ausrufezeichen davor:`,
      },
      {
        type: "code",
        source: `!pip install cowsay`,
      },
      {
        type: "markdown",
        source: `Beim ersten Mal dauert das ein paar Sekunden, danach ist das Paket in
dieser Sitzung da.

### 🎯 Aufgabe

Was gerade passiert ist, lohnt einen Moment: Dein Browser hat sich Code von
jemandem geholt, den du nie getroffen hast, und führt ihn jetzt aus. Genau so
wird heute Software gebaut - kaum jemand schreibt alles selbst.

Such dir auf **pypi.org** ein Paket aus, dessen Name dir gefällt, und
installier es. Nicht jedes funktioniert hier, denn manche brauchen ein
richtiges Betriebssystem. Finde eins, das läuft.`,
      },
      {
        type: "code",
        source: `import cowsay

cowsay.cow("Ich kann jetzt sprechen!")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Die Kuh ist nicht allein. Probier \`cowsay.trex(...)\`, \`cowsay.dragon(...)\` oder
\`cowsay.pig(...)\` aus. Mit \`cowsay.char_names\` bekommst du die ganze Liste.

Lass dann eines der Tiere sagen, was du heute gelernt hast.`,
      },
      {
        type: "code",
        source: `# Und beides zusammen: die Kuh spricht in Geheimschrift.
import cowsay

nachricht = input("Was soll die Kuh sagen? ")
cowsay.cow(verschlüsseln(nachricht, 3))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Lass die Kuh etwas Verschlüsseltes sagen und zeig den Bildschirm jemandem, der
den Schlüssel nicht kennt. Dann verrat die Verschiebung und zeig es noch
einmal.

Du hast in diesem Notizbuch zwei Dinge gebaut, die es beide wirklich gibt: ein
Verschlüsselungsverfahren und ein Programm, das es knackt. Beides in je zehn
Zeilen.

### Was geht und was nicht

Python läuft hier komplett **in deinem Browser** - es gibt keinen Computer
im Hintergrund, auf dem etwas ausgeführt wird. Deshalb:

- \`!pip install <paket>\` funktioniert für Pakete aus reinem Python.
- Große Pakete wie \`numpy\`, \`pandas\` und \`matplotlib\` sind schon dabei
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

  // ------------------------------------------------------------------ 6
  {
    key: "adventure",
    name: { de: "6 - Das Textadventure", en: "6 - The text adventure" },
    about: {
      de: "Mit input und if/elif/else ein eigenes Abenteuer bauen: Räume als Funktionen und ein Inventar.",
      en: "Build your own adventure with input and if/elif/else: rooms as functions and an inventory.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 6 - Das Textadventure

Dein erstes richtiges Spiel - nur aus Text. Du beschreibst einen Ort,
der Spieler tippt, was er tun will, und mit \`if\` entscheidest du,
wie es weitergeht.

Alles, was du dafür brauchst, kennst du schon: \`input\` aus Notebook 2
und \`if\` mit Einrückung.`,
      },
      {
        type: "code",
        source: `# Zwei Türen, eine Entscheidung. Die Antwort wird danach geputzt:
# .lower() macht alles klein, .strip() schneidet Leerzeichen ab.
# So ist " Links " genauso gut wie "links".
# (Immer in zwei Zeilen: nichts direkt an input() anhängen.)
antwort = input("Links oder rechts? ")
antwort = antwort.lower().strip()

if antwort == "links":
    print("Du findest eine stille Lichtung mit einem alten Brunnen.")
elif antwort == "rechts":
    print("Der Gang wird eng. Irgendwo tropft Wasser.")
else:
    print("Diesen Weg gibt es nicht. Das Abenteuer endet hier.")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Bau eine dritte Tür ein: \`geheim\`. Dahinter liegt eine Schatzkammer.
Du brauchst dafür ein zweites \`elif\`.

Teste danach absichtlich \`LINKS\` in Großbuchstaben. Dank der zweiten
Zeile funktioniert es trotzdem - lass sie einmal weg und sieh dir
den Unterschied an.`,
      },
      {
        type: "markdown",
        source: `## Eingaben sauber machen

Spieler tippen alles Mögliche: große Buchstaben, Leerzeichen davor,
einen Tippfehler. Zwei kleine Helfer fangen das meiste ab:

- \`.lower()\` macht aus \`LINKS\` ein \`links\`
- \`.strip()\` macht aus \`"  links  "\` ein \`links\`

Beide stehen in einer **eigenen Zeile** - direkt an \`input()\`
angehängt versteht Python sie hier nicht. Und die Schleife, die so
lange fragt, bis die Antwort passt, steht **außerhalb jeder Funktion**.
Das sind die zwei Regeln für Eingaben in diesem Notizbuch.`,
      },
      {
        type: "code",
        source: `# So lange fragen, bis die Antwort passt. while True läuft endlos,
# break steigt aus, sobald die Antwort stimmt - wie in Notebook 4.
while True:
    antwort = input("Gehst du nach links oder rechts? ")
    antwort = antwort.lower().strip()
    if antwort in ["links", "rechts"]:
        break
    print("Das geht hier nicht. Versuch links oder rechts.")

print("Du gehst nach", antwort)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Stell eine eigene Frage mit zwei Möglichkeiten - zum Beispiel ob du
einen seltsamen Trank trinkst oder wegwirfst. Baue dieselbe Schleife:
\`while True\`, Eingabe plus Putz-Zeile, \`if\` mit \`break\`, Hinweis
bei ungültigen Antworten.

Teste danach absichtlich \`LINKS\` in Großbuchstaben und mit Leerzeichen
davor. Beides muss funktionieren - und jetzt weißt du auch, welche
zwei Zeilen dafür sorgen.`,
      },
      {
        type: "markdown",
        source: `## Räume als Funktionen

Ein Abenteuer aus lauter \`if\`-Zeilen wird schnell unübersichtlich.
Der Trick: **Jeder Ort wird eine eigene Funktion.** Die Eingabe steht
davor und wird als **Parameter übergeben** - so bleibt jede Funktion
für sich lesbar, und \`input\` steht immer außerhalb.`,
      },
      {
        type: "code",
        source: `# Ein Raum als Funktion: Die Entscheidung kommt als Parameter rein,
# die Beschreibung als Text zurück. Die Eingabe steht nicht hier,
# sondern davor.
def eingang(richtung):
    if richtung == "lichtung":
        return "Lichtung mit einem alten Brunnen. Vögel singen."
    if richtung == "dunkelheit":
        return "Ein enger Gang. Irgendwo tropft Wasser."
    return "Diesen Weg gibt es nicht."

# Die Eingabe steht außerhalb - und wird übergeben:
wunsch = input("Wohin gehst du, lichtung oder dunkelheit? ")
wunsch = wunsch.lower().strip()
print(eingang(wunsch))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Schreib eine zweite Raum-Funktion \`lichtung(aktion)\`: Sie bekommt die
Antwort als Parameter und beschreibt bei \`"öffnen"\` einen
verschlossenen Kasten, bei \`"zurück"\` den Weg zurück.

Frag davor mit \`input\` nach, putze die Antwort in einer eigenen Zeile
und übergib sie: \`print(lichtung(aktion))\`.`,
      },
      {
        type: "markdown",
        source: `## Inventar - Dinge mitnehmen

Manches Abenteuer braucht Gegenstände. Dafür reicht eine **Liste**:
\`append()\` legt etwas dazu, \`in\` prüft, ob etwas dabei ist.`,
      },
      {
        type: "code",
        source: `# Eine leere Liste, dann kommt etwas dazu.
inventar = []
print("Dabei hast du:", inventar)

inventar.append("Laterne")
print("Jetzt hast du:", inventar)

if "Laterne" in inventar:
    print("Mit der Laterne traust du dich in die Dunkelheit.")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Leg einen \`"Schlüssel"\` dazu - aber nur, wenn der Spieler auf die
Frage \`"mitnehmen oder liegenlassen?"\` wirklich \`mitnehmen\`
antwortet. Frag mit \`input\`, putze in der nächsten Zeile und prüfe
danach mit \`if\`, ob der Schlüssel im Inventar ist.`,
      },
      {
        type: "markdown",
        source: `## Alles zusammen - das kleine Abenteuer

Drei Räume, ein Gegenstand, drei Enden. Lies es von oben nach unten:
Jede Funktion ist ein Ort, die letzten Zeilen spielen die Geschichte.`,
      },
      {
        type: "code",
        source: `# Das ganze Spiel. Alle Eingaben stehen unten im Ablauf,
# die Funktionen beschreiben nur Orte - so bleibt input erlaubt
# und trotzdem jeder Raum für sich.

def zeige_hoehle():
    print("Höhle: An der Wand hängt eine Laterne.")

def zeige_gang(rucksack):
    print("Gang: Es wird dunkel. Du hörst Wasser tropfen.")
    if "Laterne" in rucksack:
        print("Deine Laterne zeigt eine Tür mit einem Rätsel:")
        print("'Ich habe Tasten, aber öffne nichts. Was bin ich?'")
    else:
        print("Ohne Licht kehrst du um. Ende 1 von 3.")

def zeige_schatzkammer(mitbringsel):
    print("Schatzkammer: Gold, so weit das Licht reicht!")
    print("Du nimmst:", mitbringsel, "- und wirst zur Legende. Ende 3 von 3.")

# --- Hier läuft die Geschichte ---
zeige_hoehle()
beute = input("Nimmst du die Laterne mit? (ja/nein) ")
beute = beute.lower().strip()

rucksack = []
if beute == "ja":
    rucksack.append("Laterne")

zeige_gang(rucksack)

if "Laterne" in rucksack:
    antwort = input("Deine Antwort: ")
    antwort = antwort.lower().strip()
    if antwort == "klavier":
        print("Die Tür springt auf!")
        mitbringsel = input("Was nimmst du mit? (münze/krone/nichts) ")
        mitbringsel = mitbringsel.lower().strip()
        zeige_schatzkammer(mitbringsel)
    else:
        print("Die Tür bleibt zu. Trotzdem ein Abenteuer. Ende 2 von 3.")`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe zum Schluss - dein neues Level

Jetzt erweiterst du das Spiel. Es hat 3 Enden - bau ein viertes dazu.
So bleibt es übersichtlich:

1. Kopiere eine Raum-Funktion (z. B. \`zeige_gang\`) und benenne sie
   um, zum Beispiel \`zeige_bruecke\`.
2. Frage **eine** Entscheidung mit \`input\` ab (plus Putz-Zeile) und
   biete **zwei bis drei** Möglichkeiten an - mehr verwirrt nur.
   Die Antwort übergibst du an deine Raum-Funktion.
3. Lege **einen** neuen Gegenstand ins Spiel (Seil, Karte, Kompass),
   der an genau einer Stelle nützt.
4. Rufe deinen Raum im Ablauf unten auf und zähle die Enden hoch
   ("Ende 4 von 4").

Regel für Übersicht: eine Funktion, ein Ort, eine Entscheidung.
Wer das einhält, kann zehn Räume bauen, ohne sich zu verlaufen.`,
      },
    ],
  },

  // ------------------------------------------------------------------ 7
  {
    key: "bubblesort",
    name: { de: "7 - Bubble Sort", en: "7 - Bubble sort" },
    about: {
      de: "Sortieren wie aufsteigende Blasen: erst die innere Schleife, dann die äußere, dazu Aufwand und Grenzen.",
      en: "Sorting like rising bubbles: first the inner loop, then the outer one, plus cost and limits.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 7 - Bubble Sort: Sortieren wie Blasen

Wie sortierst du einen Stapel Karten in der Hand? Eine Idee: Geh immer
wieder durch den Stapel, vergleiche zwei Nachbarn und tausche sie, wenn
sie falsch herum liegen.

Die größte Karte steigt dabei wie eine **Blase** nach oben - bis ganz
ans Ende. Daher der Name. Wir schauen zuerst **einem einzigen Vergleich**
zu, dann **einem Durchgang** und erst danach dem ganzen Verfahren.`,
      },
      {
        type: "code",
        source: `# Nur ein Vergleich: Steht der Größere vorne, tauschen wir.
zahlen = [5, 3]
print("Vorher: ", zahlen)

if zahlen[0] > zahlen[1]:
    merk = zahlen[0]
    zahlen[0] = zahlen[1]
    zahlen[1] = merk
    print("Getauscht!")

print("Nachher:", zahlen)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Starte mit \`[3, 5]\` statt \`[5, 3]\` und führ die Zelle aus. Es wird
nichts getauscht - die Reihenfolge stimmt ja schon.

Dreh dann eine längere Liste um: Was passiert mit \`[2, 1, 3]\`?
Nur das erste Paar wird angeschaut, der Rest bleibt liegen. Genau
dafür brauchen wir als Nächstes eine Schleife.`,
      },
      {
        type: "markdown",
        source: `## Die innere Schleife - einmal komplett durchgehen

Jetzt läuft der Vergleich über die **ganze Liste**: Stelle 0 mit 1,
1 mit 2, 2 mit 3. Schau genau hin, was mit der größten Zahl passiert.`,
      },
      {
        type: "code",
        source: `# Ein Durchgang: jedes Nachbarpaar einmal vergleichen.
zahlen = [5, 3, 4, 1, 2]
print("Start:", zahlen)

for i in range(len(zahlen) - 1):
    print("Vergleiche Stelle", i, ":", zahlen[i], "und", zahlen[i + 1])
    if zahlen[i] > zahlen[i + 1]:
        merk = zahlen[i]
        zahlen[i] = zahlen[i + 1]
        zahlen[i + 1] = merk
        print("Getauscht:", zahlen)

print("Nach einem Durchgang:", zahlen)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Die größte Zahl steht jetzt ganz hinten - wie eine Blase, die
aufgestiegen ist. Der Rest ist nur "ein bisschen sortierter".

Starte mit \`[2, 1, 3]\` und dann mit \`[1, 2, 3, 4, 5]\`. Bei der
sortierten Liste wird nie getauscht - ein Durchgang genügt zum
Feststellen, dass alles stimmt.

Zähle mit: Lege vor der Schleife \`tausche = 0\` an, zähle bei jedem
Tausch eins hoch und gib die Zahl danach aus.`,
      },
      {
        type: "markdown",
        source: `## Was ein Durchgang garantiert - und was nicht

Nach **einem** Durchgang steht nur **eine** Zahl sicher richtig:
die größte, ganz hinten.

Also wiederholen wir den Durchgang - für jede Stelle einmal.
Das ist die **äußere Schleife**.`,
      },
      {
        type: "code",
        source: `# Außen: "noch einmal durchgehen". Innen: "jedes Paar prüfen".
# Nach jedem Durchgang ist eine weitere Zahl hinten einsortiert.
zahlen = [5, 3, 4, 1, 2]

for durchgang in range(len(zahlen) - 1):
    for i in range(len(zahlen) - 1):
        if zahlen[i] > zahlen[i + 1]:
            merk = zahlen[i]
            zahlen[i] = zahlen[i + 1]
            zahlen[i + 1] = merk
    print("Nach Durchgang", durchgang + 1, ":", zahlen)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Lies die Ausgabe Zeile für Zeile: Welche Zahl steht nach Durchgang 1
hinten? Welche kommt in Durchgang 2 dazu?

Überlege dann: Der hintere Teil ist schon sortiert - trotzdem
vergleicht die innere Schleife ihn jedes Mal neu. Verschwendung?
Genau die bauen wir als Nächstes aus.`,
      },
      {
        type: "markdown",
        source: `## Als Funktion - mit zwei Verbesserungen

Zum Schluss wird daraus eine wiederverwendbare Funktion. Sie bekommt
zwei Tricks aus der Aufgabe oben mit:

1. **Kürzerer Weg:** Hinten ist schon sortiert, also läuft die innere
   Schleife jedes Mal ein Stück weniger weit (\`- durchgang\`).
2. **Früher Stopp:** Wurde in einem Durchgang gar nichts getauscht,
   war die Liste schon fertig - \`getauscht\` bleibt \`False\` und wir
   hören mit \`break\` auf.`,
      },
      {
        type: "code",
        source: `# Die fertige Funktion. list(zahlen) kopiert, damit die
# übergebene Liste unverändert bleibt.
def bubble_sort(zahlen):
    sortiert = list(zahlen)
    n = len(sortiert)
    for durchgang in range(n - 1):
        getauscht = False
        for i in range(n - 1 - durchgang):
            if sortiert[i] > sortiert[i + 1]:
                merk = sortiert[i]
                sortiert[i] = sortiert[i + 1]
                sortiert[i + 1] = merk
                getauscht = True
        # Nichts getauscht? Dann sind wir fertig.
        if not getauscht:
            break
    return sortiert

print(bubble_sort([5, 3, 4, 1, 2]))
print(bubble_sort([1, 2, 3, 4, 5]))
print(bubble_sort(["birne", "apfel", "kirsche"]))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Sortiere deine eigene Liste: die Geburtsjahre deiner Familie, die
Längen der Vornamen in deiner Klasse oder fünf Zufallszahlen aus
Notebook 4 (\`random.randint\`).

Beobachte: Bei \`[1, 2, 3, 4, 5]\` stoppt die Funktion nach einem
Durchgang - dank \`getauscht\`. Nimm das \`break\` einmal heraus und
vergleiche: Das Ergebnis bleibt gleich, nur die Arbeit nicht.`,
      },
      {
        type: "markdown",
        source: `## Wie schnell ist das? - Aufwand und Ehrlichkeit

Zählen wir Vergleiche: Bei 5 Zahlen sind es höchstens 4 + 3 + 2 + 1
= **10**. Bei 10 Zahlen 9 + 8 + ... + 1 = **45**. Bei 100 schon **4950**.

Die Formel: \`n * (n - 1) / 2\`. Das wächst **quadratisch** - doppelt
so viele Zahlen, viermal so viel Arbeit. Fachwort: \`O(n hoch 2)\`.

**Vorteile:** in zehn Zeilen erklärt, braucht keine extra Liste,
stabil (gleiche Werte behalten ihre Reihenfolge), super zum Lernen.

**Nachteile:** ab ein paar tausend Zahlen quälend langsam. Echte
Programme nehmen \`sorted()\` oder Verfahren wie Mergesort - die sind
komplizierter, schaffen dafür aber \`O(n log n)\`.

Merksatz: Bubble Sort zum **Verstehen**, \`sorted()\` zum **Arbeiten**.`,
      },
      {
        type: "code",
        source: `# Vergleiche zählen: Wie hängt die Arbeit von der Ordnung ab?
def vergleiche_zaehlen(zahlen):
    arbeit = 0
    sortiert = list(zahlen)
    n = len(sortiert)
    for durchgang in range(n - 1):
        getauscht = False
        for i in range(n - 1 - durchgang):
            arbeit = arbeit + 1
            if sortiert[i] > sortiert[i + 1]:
                merk = sortiert[i]
                sortiert[i] = sortiert[i + 1]
                sortiert[i + 1] = merk
                getauscht = True
        if not getauscht:
            break
    return arbeit

print("Durcheinander:", vergleiche_zaehlen([5, 3, 4, 1, 2]))
print("Sortiert:     ", vergleiche_zaehlen([1, 2, 3, 4, 5]))
print("Rückwärts:    ", vergleiche_zaehlen([5, 4, 3, 2, 1]))
print("Pythons Antwort:", sorted([5, 3, 4, 1, 2]))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe zum Schluss

Miss selbst: Baue drei Listen mit je 10 Zahlen - sortiert, gemischt,
rückwärts - und zähle die Vergleiche mit \`vergleiche_zaehlen()\`.
Welche braucht am meisten?

Rechne hoch: Bei 1000 Zahlen wären es fast 500000 Vergleiche. Kein
Wunder, dass \`sorted()\` gewinnt - probier es mit 1000 Zufallszahlen
und staune, wie schnell Python ist.

Und wenn du magst: Erkläre jemandem an der Ausgabe von oben, warum
die größte Zahl wie eine Blase aufsteigt. Wer das in eigenen Worten
kann, hat Sortieren verstanden.`,
      },
    ],
  },

  // ------------------------------------------------------------------ 8
  {
    key: "hangman",
    name: { de: "8 - Galgenraten", en: "8 - Hangman" },
    about: {
      de: "Das schwerste Spiel der Reihe: ASCII-Galgen, Lücken und ein fertiges Ratespiel aus Funktionen.",
      en: "The hardest game in the series: ASCII gallows, blanks and a finished guessing game built from functions.",
    },
    cells: [
      {
        type: "markdown",
        source: `# 8 - Galgenraten (Hangman)

Das schwerste Spiel in dieser Reihe - und das schönste: Das Programm
denkt sich ein Wort aus, du rätst Buchstaben. Jeder Fehlversuch malt
ein Stück mehr vom Galgenmännchen. Nach 6 Fehlern ist das Spiel aus.

Wir bauen es in drei Schritten: erst die **Bilder**, dann die
**Lücken**, dann das **Spiel**. Jede Stufe ist eine eigene Funktion -
so bleibt selbst ein großes Programm übersichtlich.`,
      },
      {
        type: "code",
        source: `# 7 Bilder: vom leeren Galgen bis zum fertigen Männchen.
# GALGEN[0] ist der Anfang, GALGEN[6] das Ende. Es gibt also
# 6 Leben - ein Bild pro Fehlversuch.
GALGEN = [
    """
  +---+
  |   |
      |
      |
      |
      |
=========
""",
    """
  +---+
  |   |
  O   |
      |
      |
      |
=========
""",
    """
  +---+
  |   |
  O   |
  |   |
      |
      |
=========
""",
    """
  +---+
  |   |
  O   |
 /|   |
      |
      |
=========
""",
    """
  +---+
  |   |
  O   |
 /|/  |
      |
      |
=========
""",
    """
  +---+
  |   |
  O   |
 /|/  |
 /    |
      |
=========
""",
    """
  +---+
  |   |
  O   |
 /|/  |
 / /  |
      |
=========
""",
]

print(GALGEN[0])
print("Stufen:", len(GALGEN) - 1)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Gib \`GALGEN[3]\` und \`GALGEN[6]\` aus. Was kam bei Stufe 3 dazu,
was bei Stufe 6?

Zähle nach: \`len(GALGEN)\` ist 7, aber es gibt nur 6 Leben. Warum?
(Weil Bild 0 der Start ohne Fehler ist - genau wie \`range(5)\`
bei 0 anfängt und bei 4 aufhört.)`,
      },
      {
        type: "markdown",
        source: `## Das Wort als Lücken

Solange Buchstaben fehlen, zeigen wir \`_\`. Eine kleine Funktion
baut diese Ansicht: bekannte Buchstaben rein, Rest Unterstriche.`,
      },
      {
        type: "code",
        source: `# maske("python", ["p", "o"]) zeigt p _ _ _ o _.
# Leerzeichen zwischen den Zeichen machen es lesbar.
def maske(wort, geraten):
    ansicht = ""
    for buchstabe in wort:
        if buchstabe in geraten:
            ansicht = ansicht + buchstabe + " "
        else:
            ansicht = ansicht + "_ "
    return ansicht

print(maske("python", ["p", "o"]))
print(maske("python", []))
print(maske("python", ["p", "y", "t", "h", "o", "n"]))`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Nimm dein Lieblingswort mit 6 Buchstaben und zeige es mit zwei
geratenen Buchstaben. Dann mit leerer Liste \`[]\` - alles Lücken.

Frage für später: Woran erkennt das Programm, dass gewonnen ist?
(Tipp: Wenn **kein** \`_\` mehr in der Ansicht steht.)`,
      },
      {
        type: "markdown",
        source: `## Eine Runde: Buchstabe prüfen

Eine Spielrunde ist reine Logik: Eingabe putzen, drei Fälle
unterscheiden - schon erraten, Treffer, Fehlversuch. Genau das
übt diese Zelle, noch ohne Schleife.`,
      },
      {
        type: "code",
        source: `# Eine einzelne Runde zum Ausprobieren. Führ die Zelle mehrmals
# aus und tippe jedes Mal einen anderen Buchstaben.
wort = "schleife"
geraten = ["s", "e"]
fehler = 1

print(GALGEN[fehler])
print(maske(wort, geraten))

tipp = input("Welcher Buchstabe? ")
tipp = tipp.lower().strip()

if len(tipp) != 1:
    print("Bitte genau einen Buchstaben eingeben.")
elif tipp in geraten:
    print("Den hattest du schon. Schau oben nach.")
elif tipp in wort:
    geraten.append(tipp)
    print("Treffer!", maske(wort, geraten))
else:
    geraten.append(tipp)
    fehler = fehler + 1
    print("Leider daneben. Fehler:", fehler)
    print(GALGEN[fehler])`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe

Führ die Zelle dreimal aus: einmal mit einem Treffer, einmal mit
einem Fehlversuch, einmal mit einem Buchstaben, der schon oben
steht. Alle drei Fälle müssen verschiedene Antworten geben.

Bonus: Was passiert bei \`7\` oder \`!\`? Baue eine Prüfung, die nur
Buchstaben zulässt. (\`tipp.isalpha()\` sagt dir, ob alles Buchstaben
sind - probier es in einer eigenen Zeile aus.)`,
      },
      {
        type: "markdown",
        source: `## Alles zusammen - das fertige Spiel

Jetzt fehlt nur noch die Schleife drumherum: **solange** Fehler
übrig **und** Lücken da sind, weiter raten. Dazu zwei Helfer aus
den Zellen oben (\`GALGEN\` und \`maske\`) - führ die Zellen der Reihe
nach aus, dann kennt Python beide.`,
      },
      {
        type: "code",
        source: `# Das fertige Spiel. import steht hier, damit die Zelle für sich
# läuft - GALGEN und maske kommen aus den Zellen weiter oben.
import random

# choice zieht ein zufälliges Wort aus der Liste.
worte = ["python", "schleife", "variable", "computer",
         "tastatur", "funktion", "abenteuer", "bildschirm"]
wort = random.choice(worte)
geraten = []
fehler = 0
leben = len(GALGEN) - 1

print("Ich denke an ein Wort mit", len(wort), "Buchstaben.")

while fehler < leben:
    print()
    print(GALGEN[fehler])
    print(maske(wort, geraten))
    print("Versucht:", geraten)

    if "_" not in maske(wort, geraten):
        break

    tipp = input("Welcher Buchstabe? ")
    tipp = tipp.lower().strip()

    if len(tipp) != 1:
        print("Bitte genau einen Buchstaben.")
    elif tipp in geraten:
        print("Den hattest du schon.")
    elif tipp in wort:
        geraten.append(tipp)
        print("Treffer!")
    else:
        geraten.append(tipp)
        fehler = fehler + 1
        print("Daneben! Noch", leben - fehler, "Leben.")

print()
if "_" not in maske(wort, geraten):
    print("Gewonnen! Das Wort war:", wort)
else:
    print(GALGEN[fehler])
    print("Verloren. Das Wort war:", wort)`,
      },
      {
        type: "markdown",
        source: `### 🎯 Aufgabe zum Schluss - mach es zu deinem Spiel

1. **Eigene Wörter:** Ersetze die Liste durch dein Thema - Tiere,
   Fußball, deine Klasse (mindestens 8 Wörter, ohne Umlaute, alles
   klein). Warum klein? Weil wir alles mit \`.lower()\` vergleichen.
2. **Schwierigkeit:** Was müsstest du an \`GALGEN\` ändern, um mit
   mehr oder weniger Leben zu spielen?
3. **Komfort:** Zeige nach jedem Treffer, wie viele Buchstaben noch
   fehlen. (Tipp: zähle \`_\` in der Ansicht.)
4. **Fairness:** Was passiert bei Umlauten oder \`ß\`? Verbiete sie
   mit einer Prüfung - oder erlaube sie überall konsequent.

Wer alle vier kann, hat Funktionen, Schleifen, Listen und
Verzweigungen in einem einzigen Programm verbunden. Genau das
heißt es, programmieren zu können.`,
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
    fromExample: spec.key,
    cells: spec.cells.map((c) => {
      const cell = newCell(c.type, c.source);
      return cell;
    }),
  };
}
