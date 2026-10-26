# Scratch Blockeditor im Browser

Scratch öffnet sich neben Python als Overlay im Hauptchat und im Schülerchat.
Der Editor ist vom Preact-Chat getrennt und wird im Hintergrund vorgeladen,
ohne das Overlay zu öffnen. Eine frühe Scratch-Frage wartet auf den aktuellen
Projektstand. Der Editor bleibt beim Einklappen gemountet; Programme und die
Scratch-Laufzeitschleife werden im Hintergrund angehalten.

## Datenhaltung und Freigaben

- Projekte, Bilder, Sounds, Rückgängig-Sicherung und Änderungsvorschläge
  existieren ausschließlich im RAM dieses Browser-Tabs. Es gibt weder
  Projekt-Datenbank noch Server-Upload oder automatischen
  Browser-Projektspeicher.
- Lokales Öffnen liest `.sb3` über File/ArrayBuffer; Speichern erzeugt einen
  Download.
- Vor dem Verlassen muss heruntergeladen werden. `beforeunload` warnt bei
  Änderungen, soweit der Browser solche Warnungen zulässt; es ist kein Ersatz
  für einen Download.
- Scratch-Konten, Cloud-Variablen, Online-Speichern und Community sind
  deaktiviert. CSP blockiert externe Netzwerkziele; Kamera und Mikrofon sind im
  Editor deaktiviert.
- Die Freigabe zum Lesen und auf Bitte Bearbeiten ist standardmäßig an, bleibt
  per Häkchen abschaltbar und gilt
  nur für diesen Tab. Eine konkrete Scratch-Frage oder der Fragebutton fügt
  den aktuellen, begrenzten Code der Figuren/Bühne und Namen der lokal
  verfügbaren Standard-Assets als gekennzeichnete Daten in den Systemprompt
  der aktuellen KI-Anfrage ein. Auch direkte Nachfragen wie „Kannst du das für
  mich machen?“ und kurze Bestätigungen wie „jetzt“, „fertig“ oder „Häkchen
  gesetzt“ bekommen diesen Ausschnitt, wenn die vorherige Unterhaltung von
  Scratch handelt. Nach einem Themenwechsel wird er nicht angehängt.
  Auch „Kannst du den Editor sehen?“ und mehrere aufeinanderfolgende Spiel-
  Nachfragen behalten den Bezug; es gibt keine Grenze von vier Folgefragen.
  Fragen zu anderen Editoren oder einem neuen Thema beenden den Bezug.
- Keine Bilder/Sounds im KI-Kontext; kein Projekt-Snapshot in
  Chat-Speicher/Export. Der eigene Server verarbeitet den freigegebenen
  Ausschnitt nur als Chat-Anfrage. Die Aufbewahrungsregeln des gewählten
  Modellanbieters gelten dennoch.
- Sobald Scratch geladen ist, wird der persistente `/api/debug`-Pfad des
  Hauptchats nicht mehr genutzt. Der Klassenchat protokolliert keine
  Anfrageinhalte.
- Herkunft, Absenderfenster und zufälliger Kanal der `postMessage`-Brücke werden
  geprüft. Die Brücke erhält keine Zugangsdaten und revalidiert ihre
  Lesefreigabe selbst.

## Unterstützte KI Änderungen

Nach der Freigabe setzt ein ausdrücklicher Änderungsauftrag die geprüfte
Änderung direkt um. Dazu zählt „Kannst du das für mich machen?“ nach einer
Scratch-Anleitung. Nach einer Aufforderung zum Freigeben setzt „jetzt“ einen
noch offenen ausdrücklichen Änderungsauftrag fort. Ohne vorherigen Auftrag, nach
einem Themenwechsel oder nach der erfolgreichen Werkzeugbestätigung erlaubt eine
solche Kurzantwort keine automatische Änderung. Die Erkennung prüft die aktuelle
Nutzernachricht und die unmittelbar vorherigen Nutzeraufträge; Modell-JSON
allein erlaubt keine direkte Änderung. Fragen wie „Wie baue ich das?“ ändern
nichts. Ein ausdrücklich verlangter Vorschlag bleibt eine Vorschau mit „Änderung
übernehmen“.

Die Systeminstruktion benennt den eingebetteten Editor und erklärt das echte
JSON-Werkzeugprotokoll ausdrücklich: Eine Antwort mit `scratch` wird im Browser
geprüft und ausgeführt; es ist kein zusätzliches Maus-/Terminal-Werkzeug oder
nativer `function_call` nötig. Für Lesefragen stehen die ausgewählten Blöcke in
`selectedTarget.blocks` und die anderen Figuren in `targets[].code` bereit.
`targets[].blocks` ist nur eine Anzahl. Eine leere Blockliste ist kein fehlender
Editorzugriff. Ein aktueller Datenabschnitt stellt nochmals klar, dass ältere
Verweigerungen im Chat keine Aussage über den jetzigen Zugriff sind.

KI-Änderungen dürfen Zahlen-/Texteingaben vorhandener Blöcke ändern und neue
Blockfolgen mit Tastatursteuerung, Bedingungen, Kollisionen, Zufall,
Bühnenvariablen und Klonen erstellen. `substack` enthält innere Blockfolgen,
`substack2` den zweiten Zweig von `control_if_else`. Reporter werden als
verschachtelte Blockobjekte in `inputs` angegeben. Bis zu 24 bestehende
Blockfolgen, 12 neue Figuren, insgesamt 600 neue Blöcke und 12
Verschachtelungsebenen sind zulässig. Validator und Compiler teilen das Schema
in `static/scratch/blocks.js`; beliebiger Modellcode wird nicht ausgeführt.

`sprites` erzeugt neue Figuren aus exakt benannten lokalen Bibliotheks-Assets;
`backdrop` lädt ein lokales Bühnenbild. Der Katalog enthält 343 Figuren und 85
Bühnenbilder aus dem fest gepinnten Originalpaket. Das Modell bekommt Namen,
keine Bild-/Audiodaten. Die Browser-Brücke ordnet Alias-IDs den echten neuen
Figuren zu und verwendet ausschließlich vertrauenswürdige Bibliotheksdaten.
Externe URLs oder vom Modell gelieferte Asset-Daten sind nicht erlaubt.
`variables` erstellt nicht-Cloud-Bühnenvariablen; `targets` setzt Position,
Größe, Richtung und Sichtbarkeit. Kleine Spiele können dadurch direkt entstehen.

`scripts[].replace` nennt die ID eines vorhandenen obersten Blocks. Nur dessen
zusammenhängende Blockfolge wird ersetzt; andere Skripte, Figuren und Assets
bleiben erhalten. Ein vorhandenes Flaggen-Skript lässt sich so ergänzen, ohne
ein zweites Programm daneben anzulegen. Eine zu große oder ungültige bestehende
Blockfolge wird abgewiesen. Eigene Prozeduren, Listen und nicht im Schema
enthaltene Erweiterungsblöcke sind nicht Teil der KI-Schnittstelle. Kein automatischer
Programmstart, kein Ausführen von JavaScript, keine Löschung ganzer Projekte.

Revisionen verhindern das Überschreiben zwischenzeitlicher Arbeit. Vor jeder
Änderung entsteht eine lokale `.sb3`-Sicherung. Scheitert die Übernahme, wird
das alte Projekt wiederhergestellt. „KI-Änderung rückgängig“ stellt es wieder
her, solange nicht weitergearbeitet wurde.

Vollständige JSON-Antworten werden auch als bloßer Änderungsvorschlag, in
Codeblöcken, doppelt als String codiert oder als `name/tool: scratch` mit
`arguments` erkannt. `jsonrepair@3.15.0` (MIT, fest gepinnt) korrigiert kleinere
Schreibfehler wie fehlende Anführungszeichen und überzählige Kommas. Erst ein
Scanner prüft abgeschlossene Objekte und Arrays; abgeschnittene Aufträge werden
nicht automatisch vervollständigt. Danach gilt weiterhin der vollständige
Block-Validator. Mehrere unterschiedliche Aufträge oder gemischte Werkzeug-
Schlüssel werden abgewiesen.

Bei ungültigem Format oder gescheiterter Prüfung im echten Projekt fordert
der gemeinsame Ablauf höchstens zwei Korrekturen an. Jede erhält die konkrete
Fehlermeldung und einen frischen Projektstand. Korrekturanfragen enthalten
höchstens zwölf Nachrichten, entsprechend dem Schülerchat-API-Limit. Zusätzliche
Modellaufrufe können Kosten verursachen. Nach gültiger Prüfung wird genau einmal
angewendet; ein Timeout beim Anwenden wird niemals automatisch wiederholt.
Danach folgt eine bestätigte Änderung oder eine klare Fehlermeldung statt
unverarbeitetem JSON im Chat. Eine fehlende Freigabe wird nicht übergangen.
Ungültige Änderungen lassen das Projekt unverändert. Bei asynchronen Asset-
Ladevorgängen ist die Arbeitsfläche gesperrt; eine aufgehobene Freigabe führt zur
Wiederherstellung.

Haupt- und Schülerchat teilen denselben sicheren Markdown-Renderer. Nummerierte
Listen, eingerückte Stichpunkte und fett markierte Blocknamen werden formatiert;
Codeblöcke behalten ihre Kopierfunktion. Modell-HTML wird nur als Text
dargestellt, aktive Links wie `javascript:` werden nicht verlinkt.

## Reproduzierbare Abhängigkeit und Lizenz

Version: `@scratch/scratch-gui@15.2.0`, npm SHA-512 in scripts/fetch-scratch.ts.
Upstream-Revision: `970132883d63286762783448d4d487dcefedabf8`. Die zwei
webpack-Public-Paths des npm-Builds werden mechanisch nach `/scratch/vendor/`
verlegt; sonst ist der Standalone-Build unverändert.

```sh
deno run -A scripts/fetch-scratch.ts
```

Das Skript lädt und verifiziert das npm-Paket, kopiert die Runtime und lädt die
unveränderte Standardbibliothek lokal. Ein bereits mit npm verifiziertes,
entpacktes Paket kann als optionales Argument verwendet werden. Neue Versionen
werden nicht automatisch zur Laufzeit nachgeladen, sondern gezielt aktualisiert
und getestet.

Scratch ist AGPL-3.0-only; Lizenz und Markenhinweise liegen im öffentlichen
static/scratch-Verzeichnis. Die vollständige Originalquelle mit
Build-Konfiguration und Lockfile ist über die feste Upstream-Revision im NOTICE
verlinkt. Diese Einbettungsquellen und Bauanleitung werden zusätzlich als
integration-source.tar.gz angeboten. Diese neuen Scratch-Einbettungsdateien
stehen ebenfalls unter AGPL-3.0-only. Scratch-Marken bedeuten keine
Empfehlung/Partnerschaft durch die Scratch Foundation.

Vor einem Deploy: Tests, Build in beiden Produktivrepos, danach
Preview-Instanzen neu starten (auch wegen statischer Dateien). Im Browser
Import/Export, Original-Scratch-Ausführung, Freigabe aus/an, Vorschau, direkte
Änderungsaufträge und Nachfragen, verschachtelte Schleifen, Ersetzen, Revision
und Rückgängig testen.

Die Browserprüfung in `tests/scratchBrowser_test.py` verwendet einen vorhandenen
Pseudonym-Pfad, ersetzt aber die Chat-API durch Testantworten. Sie prüft den
Haupt- und Schülerchat ohne echte Modellanfragen oder Kosten:

```sh
python tests/scratchBrowser_test.py http://127.0.0.1:8161 schuhmann
```

Voraussetzung sind Python Playwright mit Chromium und ein laufender
Preview-Server.

`tests/scratchGameBrowser_test.py` prüft zusätzlich ein Ausweichspiel mit
echten Standard-Assets, Pfeiltastensteuerung, fallendem Hindernis, Punkten,
lokalem SB3-Export und Rückgängig. Der Test fügt danach mit der echten Folgefrage
„mach mir noch nene punktezähler für erfolgreiche ausweichversuche“ einen
Zähler zum selben Projekt hinzu, lässt ihn im Spiel hochzählen und prüft, dass
Rückgängig nur diese zweite Änderung entfernt. Ohne `--real` werden die Modellantworten
simuliert, einschließlich einer Verweigerung, einer ungültigen Figuren-ID und
einer erfolgreichen zweiten Korrektur mit einem bloßen Vorschlag in einem
Codeblock. Die spätere Zählerantwort wird absichtlich abgeschnitten und nach
zwölf vorherigen Chatnachrichten gezielt repariert; der Test erzwingt dabei das
echte API-Nachrichtenlimit.
Vor der Erweiterung prüft dieser Modus sechs aufeinanderfolgende Lesefragen
ohne das Wort Scratch, darunter „Kannst du den Editor sehen?“. Jede erhält den
aktuellen Spielstand, ändert aber keine Blöcke. Der anschließende Änderungsauftrag
bekommt weiterhin den aktuellen Stand und ergänzt denselben Spielzähler.
Mit `--real` wird das vorhandene Modell eines aktiven Klassenchats verwendet;
dies kann Providerkosten verursachen und verändert dessen Nutzungsbudget.
Dieser Modus benötigt HTTPS. Der öffentliche School-Klassenchat `schuhmann`
mit `openai/gpt-6-luna` erzeugte am 07.10.2026 im echten Modelltest ein
funktionsfähiges Ausweichspiel: Pfeiltasten, Hindernisbewegung, Punkte,
SB3-Assets und Wiederherstellung des Ausgangsprojekts wurden geprüft.
Die zusätzliche abgerechnete Nutzung betrug ungefähr 0,00156 US-Dollar.

Für Installationen ohne passenden lokalen Klassenaccount lässt sich mit
`--main` nur der Hauptchat prüfen. Die Modellantworten bleiben dabei simuliert:

```sh
python tests/scratchGameBrowser_test.py https://bud-e.ai schuhmann --main
python tests/scratchGameBrowser_test.py https://school.bud-e.ai schuhmann --real
```

Die Regression „mach bei scratch das die katze im kreis geht“ → Freigabe →
„jetzt“ ist Teil der Browserprüfung: Sie kontrolliert den echten Blockgraphen,
die Scratch-Ausführung, den Erhalt anderer Skripte und Rückgängig.
`tests/scratchApi_test.ts` prüft zusätzlich, dass die tatsächliche Chat-API den
fortgesetzten Auftrag und die jetzt vorhandene Freigabe im Systemprompt an das
Modell weitergibt. Dieser Test ersetzt nur den externen Modellaufruf und nutzt
synthetische Zugangsdaten; reale Schlüssel und Modellguthaben sind nicht nötig.
