# Eigene Lernpfade schreiben

Ein Lernpfad ist eine Datei. Du legst sie in einen Ordner, lädst die Seite neu,
und sie ist da — ohne dass jemand am Quelltext von Bud-E etwas ändern muss.

Das funktioniert für jedes Fach. Informatische Grundbildung ist nur dasjenige,
das mitgeliefert wird; Physik, Biologie, Geschichte oder Musik entstehen genauso.

---

## Der schnellste Weg zum ersten Pfad

```
learning-paths/
  physik/
    _subject.json      ← beschreibt das Fach (die Kachel)
    schall.json        ← ein Lernpfad
    optik.json         ← noch einer
  biologie/
    _subject.json
    zellen.json
```

Ein Ordner ist ein Fach. Jede `.json`-Datei darin ist ein Lernpfad. Fertig.

Im Repository liegt unter `learning-paths/physik/` ein vollständiges Beispiel,
das du kopieren und umschreiben kannst. Das ist der empfohlene Anfang.

### Wo der Ordner liegt

Neben `main.ts`, im Wurzelverzeichnis der Anwendung. Ein anderer Ort geht über
die Umgebungsvariable `LEARNING_PATHS_DIR`:

```bash
LEARNING_PATHS_DIR=/srv/lernpfade deno task preview
```

### Wann Änderungen sichtbar werden

Der Server sieht höchstens alle 30 Sekunden im Ordner nach. Beim Schreiben
willst du nicht warten — dann hilft:

```
http://localhost:8000/api/learning-paths?reload=1
```

Das liest sofort neu ein und zeigt dir gleichzeitig alle Fehler und Warnungen
als JSON. Danach die Seite neu laden.

### Wenn ein Pfad nicht auftaucht

Er hat die Prüfung nicht bestanden. Wo es klemmt, steht

* in der Antwort von `/api/learning-paths?reload=1`,
* in der Konsole des Browsers (Taste F12), und
* im Log des Servers.

Die Meldungen nennen Datei, Stelle und Grund, zum Beispiel:

```
physik/optik.json - screens[2].blocks[0].rows[1]: the table has 3 headings but this row has 2 cells
```

Ein fehlerhafter Pfad wird übersprungen. Alle anderen laufen weiter — du kannst
also nichts kaputt machen.

---

## Aufbau einer Fach-Datei

`_subject.json` beschreibt die Kachel auf der Startseite. Sie ist optional;
ohne sie heißt das Fach wie der Ordner.

```json
{
  "key": "physik",
  "title": { "de": "Physik", "en": "Physics" },
  "description": {
    "de": "Wie die Welt funktioniert, wenn man genau hinsieht.",
    "en": "How the world works when you look closely."
  },
  "icon": "🔭",
  "accent": "violet"
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `key` | nein | Kennung. Ohne Angabe der Ordnername. Gleicher `key` wie ein bestehendes Fach → die Pfade werden dort einsortiert. |
| `title` | **ja** | Name auf der Kachel |
| `description` | nein | Ein bis zwei Sätze unter dem Namen |
| `icon` | nein | Ein Emoji. Vorgabe: 📚 |
| `accent` | nein | Farbe, siehe unten |

---

## Aufbau einer Lernpfad-Datei

```json
{
  "key": "schall-und-hoeren",
  "title": { "de": "Warum Blitz und Donner nicht zusammen ankommen", "en": "..." },
  "summary": { "de": "Ein Satz, der neugierig macht.", "en": "..." },
  "icon": "⚡",
  "accent": "violet",
  "minutes": 12,
  "screens": [ … ],
  "exercises": [ … ]
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `key` | **ja** | Kleinbuchstaben, Ziffern, Bindestriche. Gleicher `key` wie ein mitgelieferter Pfad → **ersetzt** ihn. So korrigierst du einen vorhandenen Pfad, ohne den Quelltext anzufassen. |
| `title` | **ja** | Überschrift |
| `summary` | **ja** | Ein Satz auf der Übersicht |
| `icon` | nein | Emoji. Vorgabe: 📘 |
| `accent` | nein | Farbe, siehe unten |
| `minutes` | nein | Geschätzte Lesezeit. Vorgabe: 10 |
| `screens` | **ja** | Die Bildschirme, mindestens einer |
| `exercises` | nein | Die drei Abschlussaufgaben |

### Farben

`indigo`, `emerald`, `amber`, `rose`, `sky`, `violet`, `teal`

### Zweisprachigkeit

Jeder Text ist ein Objekt mit `de` und `en`:

```json
"title": { "de": "Schall", "en": "Sound" }
```

Eine einzelne Zeichenkette wird ebenfalls angenommen und für beide Sprachen
verwendet — praktisch beim Schreiben, du bekommst aber eine Warnung, damit es
nicht unbemerkt so bleibt:

```json
"title": "Schall"
```

---

## Bildschirme

Ein Bildschirm ist eine Seite, durch die geblättert wird. Vier bis fünf sind
ein guter Umfang.

```json
{
  "key": "die-luecke",
  "title": { "de": "Die Lücke zwischen Sehen und Hören", "en": "…" },
  "blocks": [ … ]
}
```

`key` ist optional (sonst `screen-1`, `screen-2`, …). `title` und mindestens
ein Block sind Pflicht.

---

## Die Bausteine

Jeder Block hat ein `kind`. Das sind alle:

### `lead` — der Einstiegsabsatz

Etwas größer gesetzt. Gehört an den Anfang eines Bildschirms.

```json
{ "kind": "lead", "text": { "de": "…", "en": "…" } }
```

### `paragraph` — normaler Fließtext

```json
{ "kind": "paragraph", "text": { "de": "…", "en": "…" } }
```

### `heading` — Zwischenüberschrift

```json
{ "kind": "heading", "text": { "de": "Und in Wasser?", "en": "And in water?" } }
```

### `list` — Aufzählung

`"ordered": true` macht daraus eine nummerierte Liste.

```json
{
  "kind": "list",
  "items": [
    { "de": "Erster Punkt", "en": "First point" },
    { "de": "Zweiter Punkt", "en": "Second point" }
  ]
}
```

### `steps` — nummerierte Schritte mit Überschrift

Für Abläufe: „erst dies, dann das".

```json
{
  "kind": "steps",
  "items": [
    {
      "title": { "de": "Der Blitz", "en": "The flash" },
      "text": { "de": "Licht braucht praktisch keine Zeit.", "en": "…" }
    }
  ]
}
```

### `callout` — hervorgehobener Kasten

```json
{
  "kind": "callout",
  "tone": "tip",
  "icon": "🧮",
  "title": { "de": "Die Faustregel", "en": "The rule of thumb" },
  "text": { "de": "Sekunden zählen, durch drei teilen.", "en": "…" }
}
```

`tone` bestimmt die Farbe: `tip`, `note`, `try`, `fact`, `warn`.
`title` und `icon` sind optional.

### `table` — Tabelle

**Jede Zeile muss genau so viele Zellen haben wie es Überschriften gibt.**
Das ist der häufigste Fehler; die Prüfung sagt dir Zeile und Anzahl.

```json
{
  "kind": "table",
  "highlightFirst": true,
  "caption": { "de": "Schall in verschiedenen Stoffen.", "en": "…" },
  "head": [
    { "de": "Stoff", "en": "Material" },
    { "de": "Geschwindigkeit", "en": "Speed" }
  ],
  "rows": [
    [{ "de": "Luft", "en": "air" }, { "de": "343 m/s", "en": "343 m/s" }],
    [{ "de": "Wasser", "en": "water" }, { "de": "1480 m/s", "en": "1480 m/s" }]
  ]
}
```

### `stats` — große Zahlen nebeneinander

```json
{
  "kind": "stats",
  "entries": [
    {
      "value": "343 m/s",
      "label": { "de": "in Luft", "en": "in air" },
      "hint": { "de": "bei 20 °C", "en": "at 20 °C" }
    }
  ]
}
```

### `timeline` — Zeitstrahl

```json
{
  "kind": "timeline",
  "entries": [
    {
      "year": "1687",
      "title": { "de": "Newton rechnet nach", "en": "Newton does the sums" },
      "text": { "de": "…", "en": "…" }
    }
  ]
}
```

### `quote` — Zitat

```json
{
  "kind": "quote",
  "text": { "de": "…", "en": "…" },
  "source": { "de": "Galileo Galilei, 1638", "en": "Galileo Galilei, 1638" }
}
```

### `caption` — kleine Bildunterschrift

```json
{ "kind": "caption", "text": { "de": "Vereinfachte Darstellung.", "en": "…" } }
```

### `sources` — Quellenangaben

Gehört ans Ende des letzten Bildschirms. Adressen müssen mit `http://` oder
`https://` beginnen.

```json
{
  "kind": "sources",
  "items": [
    {
      "label": { "de": "NIST: Schallgeschwindigkeit", "en": "NIST: speed of sound" },
      "url": "https://www.nist.gov/pml"
    }
  ]
}
```

---

## Die drei Aufgaben

Jeder mitgelieferte Pfad endet mit genau drei Aufgaben in steigender
Schwierigkeit. Halte dich daran — die Reihenfolge ist Absicht.

**Lösungen werden nirgends gespeichert.** Im Pfad nachzuschlagen ist der Sinn
der Sache; ein Lösungsteil lädt nur dazu ein, gleich dorthin zu springen.

### 1. `cloze` — Lückentext

Fasst den ganzen Pfad in acht bis elf Sätzen zusammen. Die Lücken sind
**drei Unterstriche** `___`, und es sind die Substantive, die fehlen.

```json
{
  "kind": "cloze",
  "title": { "de": "1. Lückentext", "en": "1. Fill in the blanks" },
  "intro": { "de": "Setze die fehlenden Wörter ein.", "en": "…" },
  "text": {
    "de": "Schall breitet sich in Luft mit etwa ___ Metern pro Sekunde aus.",
    "en": "Sound travels through air at about ___ metres per second."
  }
}
```

Beide Sprachen sollten gleich viele Lücken haben, sonst unterscheiden sich die
gedruckten Arbeitsblätter. Fang nicht mit einer Lücke an — ohne Kontext davor
lässt sie sich nicht füllen.

### 2. `compare` — vergleichen und begründen

Anforderungsbereich II: zwei Dinge zueinander in Beziehung setzen, was sich
durch bloßes Nachschlagen nicht beantworten lässt. `hint` ist erlaubt — ein
Denkanstoß, nie die Antwort.

```json
{
  "kind": "compare",
  "title": { "de": "2. Vergleiche", "en": "2. Compare" },
  "intro": { "de": "Setze zwei Beobachtungen zueinander in Beziehung.", "en": "…" },
  "text": { "de": "In Stahl ist Schall siebzehnmal schneller als in Luft. Erkläre, …", "en": "…" },
  "hint": { "de": "Denk daran, wie dicht die Teilchen beieinander liegen.", "en": "…" }
}
```

Praktisch: Hier passt auch eine Aufgabe mit einem Handlungsteil — etwa „lege
dir ein Postfach an und beschreibe dann, was dabei passiert ist".

### 3. `reflect` — offene Frage

Keine richtige Antwort. Verbindet das Thema mit der Lebenswelt.

```json
{
  "kind": "reflect",
  "title": { "de": "3. Zum Nachdenken", "en": "3. Something to think about" },
  "intro": { "de": "Auf diese Frage gibt es keine richtige Antwort.", "en": "…" },
  "text": { "de": "Fledermäuse benutzen Schall, um zu sehen. Überlege, …", "en": "…" }
}
```

---

## Was einen guten Pfad ausmacht

Das ist kein Formfehler, wenn du davon abweichst — aber die mitgelieferten
Pfade halten sich daran, und sie lesen sich deshalb wie aus einem Guss.

* **Fang bei etwas an, das die Schülerin kennt.** Nicht „Schall ist eine
  longitudinale Welle", sondern „du zählst nach dem Blitz".
* **Rechne vor, statt zu behaupten.** Eine Zahl, die man selbst nachrechnen
  kann, bleibt hängen; eine, die man glauben muss, nicht.
* **Sag auch, wo die Regel nicht gilt.** Die Faustregel „durch drei" ist gut
  genug — dass sie eine Näherung ist, gehört dazu.
* **Duze und rede direkt.** Die Pfade sind für 12- bis 18-Jährige geschrieben.
* **Belege, was belegbar ist.** Ein `sources`-Block am Ende kostet fünf
  Minuten und macht den Unterschied zwischen Unterricht und Behauptung.
* **Vier bis fünf Bildschirme.** Länger wird selten zu Ende gelesen.

---

## Was automatisch mitkommt

Sobald der Pfad geladen ist, funktioniert alles Weitere ohne dein Zutun:

* die Kachel auf der Startseite,
* das Blättern samt Fortschrittsbalken,
* das Merken der zuletzt gelesenen Seite,
* der Wechsel zwischen Deutsch und Englisch,
* die Aufgaben auf einem eigenen Abschlussbildschirm,
* und das **druckbare Arbeitsblatt** über das PDF-Symbol — mit Linien zum
  Schreiben und Lücken in der richtigen Breite.

---

## Prüfliste vor dem Hochladen

1. Ist die Datei gültiges JSON? (Ein fehlendes Komma ist der häufigste Fehler.
   Jeder Editor zeigt es an.)
2. Hat jede Tabellenzeile so viele Zellen wie die Überschrift?
3. Hat der Lückentext in beiden Sprachen gleich viele `___`?
4. Beginnen alle Quellen-Adressen mit `https://`?
5. Ist `key` klein geschrieben und ohne Leerzeichen?
6. `/api/learning-paths?reload=1` aufgerufen und die Antwort auf `errors`
   und `warnings` durchgesehen?
