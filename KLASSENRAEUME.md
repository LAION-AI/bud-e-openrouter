# Klassenräume (`/my` und `/<pseudonym>`)

Lehrkräfte erstellen unter `/my` einen Klassenraum. Die Schülerseite liegt
direkt unter `/<pseudonym>`, beispielsweise `/schuhmann`. Ein Pseudonym ist
3–24 Zeichen lang, beginnt mit `a`–`z` und enthält sonst nur `a`–`z` oder
`0`–`9`. Technische Pfade wie `my` und `api` sind reserviert.

## Sicherheit und Daten

- Der Anbieter-Key verlässt den Server nicht. Browser sehen nur Anbieter und
  die letzten vier Zeichen. Das Passwort ist mit scrypt und individuellem Salt
  gehasht; der Key ist mit AES-256-GCM verschlüsselt.
- Die Datenbank und der separate 32-Byte-Hauptschlüssel liegen standardmäßig
  unter `/var/lib/bude-classrooms`. Mit `CLASSROOM_DATA_DIR` kann ein
  anderer absoluter Pfad gesetzt werden. Verzeichnis: Modus 0700; Key und
  Datenbank: 0600. **Beide Dateien zusammen sichern**. Ohne `master.key`
  lassen sich bereits gespeicherte Anbieter-Keys nicht mehr verwenden.
- Die Verschlüsselung schützt vor einem reinen Datenbankabfluss. Ein
  kompromittierter Anwendungsserver mit Zugriff auf den Hauptschlüssel kann
  Keys entschlüsseln. Das Passwort dient der Lehrkraft-Anmeldung; die
  Schüleranfragen müssen auch ohne dieses Passwort laufen können.
- Sitzungen sind zufällige, serverseitig gehashte Tokens in `Secure`,
  `HttpOnly`, `SameSite=Strict`-Cookies. Fünf falsche Passwörter sperren
  den betroffenen Zugang für drei Minuten. Registrierungs- und
  Anmeldeanfragen haben zusätzlich globale Kurzzeitlimits.
- Änderungen an der Freigabe werden serverseitig geprüft. Die Klassen-APIs
  akzeptieren weder einen Browser-Key noch ein Browser-Modell oder einen
  Browser-Systemprompt. Eine abgeschaltete Funktion kann nicht durch eine
  selbst gebaute Anfrage aktiviert werden.
- Der Klassenchat speichert keine Unterhaltung auf dem Server. Der Browser
  hält den Verlauf nur während der geöffneten Seite im Speicher. Für
  Anbieter-Datenverarbeitung gelten die Bedingungen des gewählten Modells.
- Schüler können den Verlauf einschließlich komprimierter Bilder als JSON
  exportieren und später auf derselben Klassenchat-Seite wieder importieren.
  Die Exportdatei kann persönliche Chat-Inhalte enthalten und sollte nicht
  öffentlich geteilt werden; API-Key und Lehrkraft-Einstellungen sind nicht
  enthalten. Lernpfade, Python-Notebook, Text- und Slide-Editor sind dieselben
  lokalen Werkzeuge wie auf der Hauptseite. Nach ausdrücklicher Freigabe im
  Editor kann der Klassenchat Docs und Slides lesen, erstellen und bearbeiten.
  Die Freigabe wird vor jeder Aktion erneut im Browser geprüft. Der Chat
  bekommt nur Namen und auf ausdrücklichen Auftrag den Inhalt; maximal sechs
  Werkzeugschritte pro Nachricht. Ergebnisse bieten „im Editor öffnen“ an.
- Der Klassenchat akzeptiert bis zu drei Bilder pro Anfrage und eine PDF-Datei
  bis 2 MB. Bilder erhalten anklickbare IDs; spätere Fragen und Bildgenerator-
  Aufträge können diese IDs referenzieren. Word-/ODT-/RTF-/Text- und PPTX-Dateien
  werden beim Anhängen an den Chat im Browser in Text umgewandelt; bei PPTX
  wird dort nur Folientext übernommen. Für Inhalt und Layout eine PPTX direkt
  im Slide-Editor über „Vom Computer hochladen (.pptx)“ importieren. Nach
  Freigabe bekommt der Assistent beim Lesen auch Positionen und Gestaltung;
  Bildmodelle erhalten zusätzlich bis zu drei schematische Folienvorschauen
  pro Schritt (mit `read` und `slide` gezielt eine beliebige Folie).
  Bilder/PDFs benötigen ein passendes Vision-Modell.
- Das Mikrofon nimmt höchstens 60 Sekunden auf. „Stopp“ transkribiert nur ins
  Eingabefeld, „Absenden“ transkribiert und sendet, „✕“ verwirft ohne
  Transkriptionsaufruf. Die Browserfreigabe für das Mikrofon und eine von der
  Lehrkraft aktivierte ASR-Funktion sind erforderlich.
- `#wikipedia: Suchbegriff` und `#papers: Suchbegriff` holen bis zu drei
  Quellen aus Wikipedia beziehungsweise ORKG und geben sie dem Chatmodell als
  Kontext. Die Quellen werden unter der Antwort verlinkt. „Suche nachprüfen“
  zeigt Suchbegriff, Zeitpunkt, API-URL, HTTP-Status und tatsächliche Rohantwort
  (maximal 60.000 Zeichen je Abfrage; Kürzung wird markiert). Auch Fehler oder
  leere Trefferlisten bleiben sichtbar. Diese Nachweise werden mit exportiert.
  Auf der Hauptseite gibt es ebenfalls eine aufklappbare Rechercheanzeige.
  Werkzeug-Folgeanfragen starten keine erneute Hashtag-Suche aus Dokumenttext.
- Textantworten dürfen bis zu 64.000 Ausgabetokens umfassen. Die live gemeldete
  Modellgrenze und der noch verfügbare Ausgabenrahmen können den tatsächlich
  verwendeten Wert verkleinern. Es gibt keine stille Kürzung bei 30.000 Zeichen
  mehr. Fehlt bei Markdown-Code ein schließender Zaun, erscheint der Inhalt
  trotzdem als kopierbare Codebox mit Warnung.

## Ausgabenrahmen

Ein Klassenraum ist zunächst **geschlossen**. Textchat ist in den
Einstellungen vorausgewählt; TTS, ASR, Bild und Musik sind aus. Erst nach
Modellwahl, Ausgabenrahmen und ausdrücklicher Freigabe wird die Schülerseite
aktiv. Die Lehrkraft wählt entweder eine Dauer (bis zu 30 Tage) oder ein
konkretes Enddatum (höchstens 30 Tage im Voraus). Der Raum bleibt unabhängig
von der Lehrkraft-Anmeldung bis dahin offen, sofern er nicht manuell geschlossen,
der Key gewechselt oder der Ausgabenrahmen erreicht wird. Die Aktivierung wird
erst nach Prüfung des öffentlichen Schülerstatus als erfolgreich angezeigt.

Der lokale Ausgabenrahmen ist eine vorsichtige Schranke in US-Dollar, **kein
garantierter Anbieter-seitiger Kostendeckel**. Textchat rechnet gemeldete
`usage.cost`-Werte ab, wenn der Anbieter sie liefert. Ohne Wert und für
Medienanfragen werden konservative Pauschalen angerechnet. Bis zu 50
Anfragen pro Raum können gleichzeitig laufen; höchstens 90 neue Anfragen
pro Minute werden angenommen. Anbieterpreise, Retries außerhalb der App,
Abbrüche und verzögert eintreffende Kosten können vom lokalen Wert
abweichen. Für eine echte Obergrenze immer einen **eigenen Anbieter-Key mit
Anbieter-seitigem Limit** verwenden und bei Bedarf nach der Stunde auch
beim Anbieter widerrufen.

Google AI Studio: Die API-Liste `/v1beta/models` wird pro Key alle 30 Minuten
neu geladen. Die Rollen Text/Vision, TTS, ASR, Bild und Musik werden aus den
gelisteten Modellnamen und den unterstützten Methoden abgeleitet. Google
liefert dabei **keine Preise und keine Garantie**, dass ein konkreter Key
einen Generierungsaufruf bezahlen darf; deshalb stehen in der UI keine
erfundenen Free-/Preisangaben. Ein Testknopf bzw. eine echte Nutzung markiert
ein Modell für 24 Stunden als erfolgreich oder fehlgeschlagen; erfolgreiche
Modelle stehen in der Liste zuerst. Es laufen **keine automatischen
kostenpflichtigen Massentests**. Die deutschsprachigen TTS-Stimmen kommen aus
`/v1beta/voices` und können durchsucht werden. Für Gemini 3.8 TTS
geht die Regieanweisung in `speech_metadata.style`, bei älteren TTS-Modellen
in den Textprompt.
Der Filter „Nur kostenlose Modelle“ zeigt deshalb bei Google keine Modelle,
solange die Modell-API keinen belastbaren Gratisstatus liefert; bei OpenRouter
und Requesty nutzt er die live gemeldeten Katalogpreise.

OpenRouter: `/api/v1/key` liefert für den gespeicherten Nutzungs-Key dessen
`limit_remaining`, wenn ein Anbieter-Limit gesetzt ist. Das ist **nicht**
das gesamte Kontoguthaben. Das tatsächliche Restguthaben kommt aus
`/api/v1/credits` (`total_credits - total_usage`); dieser Endpunkt benötigt
einen Management-Key. Die Lehrkraft kann ihn einmalig für die Abfrage eingeben;
er wird nicht gespeichert. Für Requesty wird mangels bestätigter
Nutzungs-Key-Abfrage kein Guthaben behauptet. Requesty bietet in dieser
Integration derzeit nur Text-/Bildverständnis-Modelle im Katalog;
TTS/ASR/Bild- und Musikgenerierung sind dort nicht eingebunden.
OpenRouter- und Google-AI-Studio-Keys unterstützen hier alle fünf
Rollen, sofern die jeweilige Google-Modellliste Modelle dafür enthält.
OpenRouter veröffentlicht keine einheitliche Stimmenliste per API; daher kann
die Lehrkraft den modellabhängigen Stimmennamen mit Vorschlägen eingeben und
per Testknopf prüfen.

## Betrieb und Tests

```sh
deno test -A tests/classroomStore_test.ts
deno task build
```

Nach einem Build muss `deno task preview` neu gestartet werden. Neue Routen
werden vom Build in `fresh.gen.ts` eingetragen. `/my` und `/<pseudonym>`
brauchen keine Wildcard-DNS-Einträge; sie liegen unter der vorhandenen Domain.
Die Datenverzeichnisse dürfen niemals als statisches Webverzeichnis
konfiguriert oder ins Repository aufgenommen werden.
