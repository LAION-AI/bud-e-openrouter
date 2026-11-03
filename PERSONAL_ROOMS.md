# Persönliche Räume auf Buddy

Diese Funktion ist auf Buddy und School Bud-E verfügbar. Beide verwenden
dieselbe browserseitige Verschlüsselungsarchitektur, aber getrennte Datenbanken
und Raumadressen. Ein Raum auf bud-e.ai ist nicht automatisch unter derselben
Adresse auf school.bud-e.ai vorhanden. School verwendet standardmäßig
`/var/lib/school-bude-classrooms`, Buddy `/var/lib/bude-classrooms`.
Bestehende Klassenräume bleiben öffentlich nutzbare, von Lehrkräften verwaltete
Räume. Persönliche Räume erfordern bei jedem neuen Öffnen ihr Passwort.

## Bedienung

- `/my` → „Persönlicher Raum“ → Namen, Passwort und Anbieter-Key eintragen.
- Danach Modelle und optionale Bilderzeugung, TTS und ASR einrichten.
- Der Raum liegt unter `/<name>`. Nach Entsperren stehen mehrere Unterhaltungen
  und ihre Bilder auch auf einem anderen Gerät bereit.
- „Sperren“ entfernt den Schlüssel, Key und entschlüsselte Inhalte aus dem
  aktiven UI-Zustand. Der Schlüssel liegt weder in localStorage noch IndexedDB
  oder sessionStorage. Ein noch gültiges Server-Cookie allein entschlüsselt
  nach dem Neuladen keine Inhalte.
- JSON-Export ist ein ausdrücklich ausgelöster, unverschlüsselter Download
  einer Unterhaltung einschließlich ihrer Bilder, ohne Anbieter-Key. Import
  verwendet neue IDs und verschlüsselt den Inhalt vor der Synchronisierung.
- Jede Buddy-Antwort bietet „Neu generieren“, eigene Nachrichten „Bearbeiten“.
  Beide erzeugen eine neue Variante; das Original einschließlich seiner späteren
  Nachrichten bleibt erhalten. Textänderungen werden mit „Speichern & neu
  antworten“ bestätigt. Neue Antworten können Kosten beim KI-Anbieter auslösen.
- „Ab hier abzweigen“ kopiert nur den Verlauf bis einschließlich der gewählten
  Nachricht, ohne KI-Aufruf. Abzweigungen erscheinen eingerückt unter dem
  Ausgangsverlauf; sie sind wiederum verzweigbar. Der Link „Zum Ausgangsverlauf“
  wechselt zurück. Spätere Nachrichten des Originals werden nicht als Kontext
  einer neu erzeugten Antwort mitgeschickt. Auch Bild-Antworten sind regenerierbar;
  entscheidend ist die ursprüngliche Aktion, nicht der aktuelle Composer-Modus.
- Bilder in Abzweigungen teilen verschlüsselte Speicherobjekte. Beim Löschen
  einer Unterhaltung bleiben alle Bilder erhalten, die noch von einer anderen
  Unterhaltung verwendet werden. Abzweigungen überleben auch das Löschen des
  Originals. Die Abstammungsdaten liegen ebenfalls nur im verschlüsselten Index.
- Die Modellauswahl gruppiert alphabetisch nach Anbieter, dann Modellnamen.
  Die Suche berücksichtigt Anbieter, Namen und Modell-ID und zeigt bis zu sechs
  direkt anklickbare Top-Treffer pro Funktion. Wortanfänge werden gegenüber
  bloßen Teiltreffern bevorzugt; mehrere Suchwörter werden gemeinsam gefiltert.
  Ein aktuell gewähltes Modell bleibt sichtbar, auch wenn ein Filter es ausblendet.

## Verschlüsselung und Grenzen

Web Crypto leitet mit PBKDF2-SHA-256 (600.000 Iterationen, zufälliges 16-Byte-Salz)
einen Root-Schlüssel ab. HKDF-SHA-256 trennt daraus Authentifizierung und
Speicherverschlüsselung mit verschiedenen `info`-Werten. Nur das
Authentifizierungsgeheimnis wird über HTTPS zur Anmeldung übertragen. Es erlaubt
keine Ableitung des Speicherschlüssels. Der Server hält davon einen SHA-256-Hash,
keinen Klartext und kein Benutzerpasswort.

Der nicht exportierbare AES-256-GCM-Schlüssel bleibt im Browser. Jedes Objekt
bekommt eine frische 12-Byte-Nonce. Authentifizierte Zusatzdaten binden Format,
Raumnamen und Objekt-ID. Der gespeicherte Datensatz ist Versionbyte, Nonce und
Ciphertext/Authentifizierungstag. JSON wird vor der Verschlüsselung mit gzip
komprimiert; die Entschlüsselung begrenzt die dekomprimierte Größe.

Der Server speichert Einstellungen und Anbieter-Keys im verschlüsselten Index,
Unterhaltungen und JPEG-Bilder in einzelnen verschlüsselten Objekten. Die
serverseitige globale Klassenraum-Verschlüsselung wird dafür nicht verwendet.
Wer lediglich Datenbank, Backup oder den globalen Klassenraum-Schlüssel liest,
kann damit persönliche Inhalte nicht entschlüsseln. Sichtbar bleiben Name,
KDF-Salz, Objekt-IDs, Größen, Revisionen und Zeitpunkte.

Dies ist keine Zusage gegen einen aktiv bösartigen Website-Betreiber oder
kompromittierten Browser: Wer den ausgelieferten JavaScript-Code verändern oder
ein entsperrtes Endgerät kontrollieren kann, könnte zukünftige Eingaben abgreifen.
Es gibt keine Passwort-Wiederherstellung und derzeit keine Passwort-/Namensänderung.
Die v1-KDF-Parameter dürfen nicht ohne eine explizite Migration geändert werden.

## KI-Anbieter

### Agentische Korrekturvorschläge (02.11.2026)

„Korrekturvorschläge“ öffnet einen eigenen Ablauf; `#korrektur` sowie passende
Korrekturanfragen mit Bildern öffnen denselben Dialog. Fotos werden vor dem
Versand komprimiert. PDF/Word/Fotos und ZIP mit solchen Dateien werden lokal
vorbereitet (PDF bis 20 MB, ZIP bis 40 MB, insgesamt 40 MB ursprüngliche Dateien,
bis 300 Seiten/Abschnitte). ZIP-Unterordner werden durchsucht; verschachtelte
ZIP, Pfad-Traversal, verschlüsselte Archive und übergroße Entpackmengen abgewiesen.
PDF wird nach tatsächlichen Seiten geteilt, Word nach expliziten Seitenumbrüchen,
Textabschnitten und eingebetteten Bildern; für exakte Word-Seiten vorher PDF nutzen.

Drei Stufen: bis zu drei Seiten parallel wörtlich abschreiben; ein gemeinsamer
Modellaufruf ordnet alle Seiten zu Schülern und Reihenfolge; nach Prüfung bewertet
je ein Modellaufruf die komplette Arbeit eines Schülers samt Originalen und
gemeinsamen Kriterien, bis zu drei Schüler parallel. Jede Seite muss genau einer
Gruppe zugeordnet sein. Namen, Reihenfolge und Abschriften sind vor der Bewertung
editierbar. Ein Erwartungshorizont kann vorab eingegeben werden; die ausdrückliche
Option „Alle drei Stufen automatisch durchführen“ überspringt die Prüf-Pause.
Fortschritt und Aufrufstufen sind einsehbar. Kein fehlender Punkte-/Notenschlüssel
wird erfunden; Ergebnisse sind überprüfbare Vorschläge, keine verbindlichen Noten.

Alle privaten Modellanfragen laufen weiterhin direkt zum Anbieter, auch PDFs
(OpenRouter/Requesty-Dateifelder bzw. Google-inlineData). Nur der fertige gemeinsame
Bericht wird als verschlüsseltes Chatobjekt gespeichert; Upload-Originale und
Abschriften bleiben im Dialog. Word (DOCX) und PDF für alle Schüler werden erst
auf Wunsch im Browser erzeugt; deren Inhalt ist dann
auf dem eigenen Gerät unverschlüsselt. Er bleibt nach Entsperren über den
gespeicherten Bericht erneut herunterladbar. Originaldateien und
Zwischenstände bleiben nur im geöffneten Dialog, nicht im Server-Klartext.
Schließen oder Sperren bricht weitere Agentenschritte ab. Laufende Anfragen können
trotz Abbruch Kosten verursachen. Keine Korrektur wird als verbindliche Note oder
automatische Änderung der Schülerarbeit übernommen.

Der gemeinsame Ablauf liegt in `utils/roomGrading.ts` und
`components/RoomGrading.tsx`; Klassenräume verwenden dieselbe Oberfläche, aber
jeder Modellschritt durchläuft `/api/classroom` samt Freigabe und Budgetkontrolle.
Die ursprüngliche Einzelarbeits-Probe mit Caveat-Schrift bestand mit echtem
OpenRouter-Modell in beiden Raumtypen. Der neue Stapelablauf wurde mit sechs
durcheinanderliegenden PDF-Seiten/drei Schülergruppen sowie ZIP mit PDF, Word
und Fotos geprüft: parallele Aufrufe, vollständige DOCX/PDF-Exporte, Prüf-Pause,
Auto-Modus und private verschlüsselte Wiederherstellung. Browser-Anbieter hierfür
simuliert. Inzwischen zusätzlicher echter Stapeltest mit zwei Testarbeiten:
Abschrift, Zuordnung, Einzelbewertungen, DOCX/PDF und private Wiederherstellung
bestanden; nicht die realen 8d-Arbeiten, deren Dateien/Prompt hier fehlen.

### Recovery und Zwischenstandsdateien

Fertige Seiten werden sofort behalten. Fehlerhafte Format-/Netzwerkantworten
werden je Schritt höchstens dreimal versucht; ein endgültig fehlerhafter Schritt
verwirft die anderen Ergebnisse nicht. „Noch einmal versuchen“ setzt bei den
fehlenden Schritten fort. Bewertungen sind einzelne Schülerjobs und können über
mehrere begrenzte Antwortabschnitte fortgesetzt werden; fertige Schüler werden
bei unveränderten Kriterien/Inhalten nicht neu angefragt. Kriterienänderungen
können neue Bewertungen und damit weitere Kosten auslösen.

Jede Arbeit erhält zusätzlich eine separate Modell-Zweitprüfung am Original,
die Lesung, Musterlösung und Punktesummen kontrollieren soll. Diese Prüfung ist
ebenfalls ein KI-Vorschlag, keine Zuverlässigkeitsgarantie. `cache.checked`
unterscheidet geprüfte Fassungen von bloßen Entwürfen. Ein Fehler oder Budgetstopp
in der Zweitprüfung behält den Entwurf und setzt später nur die Prüfung fort.
Alte ungeprüfte Berichte werden beim Import nicht als bereits zweitgeprüft
angezeigt. Es entstehen zusätzliche, weiterhin budgetierte Modellaufrufe.
Begründet ausgeschlossene Vorlagen/Rückseiten werden mitgeführt (`ignored`),
aber nicht bewertet. Benannte leere Hauptarbeiten nicht pauschal ignorieren.
Klassenraum-PDFs werden für Korrekturen als echte Seitenbilder gerendert;
private Direktprovider-Räume behalten ihre direkte Dateischnittstelle ohne
Klartext-Upload an einen Buddy-Konvertierungsdienst.

„Zwischenstand herunterladen“ erzeugt eine lokale JSON-Datei inklusive
Original-Seiten, Abschriften, Zuordnung/Entwürfen, Kriterien/Feedback sowie
fertigen und angefangenen Bewertungen. Auch während der Verarbeitung möglich.
„Zwischenstand laden“ prüft die Datei (max. 180 MB) und lädt sie ohne automatische
Modellanfrage; vor der Bewertung Zuordnung und Kriterien erneut bestätigen.
Keine API-Keys/Passwörter/Raumeinstellungen im Export. ACHTUNG: Arbeiten und
Rückmeldungen stehen in dieser Datei unverschlüsselt; geschützt aufbewahren,
nicht an Schüler weitergeben. Kein neues automatisches Speichern von Schülerdaten
auf dem Server oder im Browser-Dauerspeicher. Vor Neuladen/Schließen herunterladen;
ein alter vor dieser Änderung fehlgeschlagener Durchlauf lässt sich nicht
nachträglich aus dem Server rekonstruieren.

Chat, Bilder, Audio und Katalogabfragen gehen aus dem Browser direkt zu
OpenRouter, Requesty, Google oder der gewählten OpenAI-kompatiblen HTTPS-API.
Persönliche Chats nutzen weder `/api/chat` noch die Buddy-Medien-/Debug-Proxys.
Ein Anbieter ohne passende CORS-Freigabe meldet einen verständlichen Fehler;
es wird kein unbemerkter Server-Proxy eingeschaltet. Der Anbieter erhält die
für den Auftrag ausgewählten Texte/Bilder/Audiodaten und kann Kosten berechnen.

Modelle werden vom Anbieter geladen. Native OpenRouter-ASR-Modelle werden auch
über `output_modalities=transcription` entdeckt. Nicht bekannte Medienpreise und
Google-Freikontingente werden nicht als kostenlos versprochen. TTS berücksichtigt
modellabhängige Stimmen, Instruktionsfelder und PCM/WAV-Konvertierung.

## Speicher und Konflikte

Die Tabellen `personal_rooms`, `personal_objects`, `personal_sessions` und
`personal_limits` liegen in der bestehenden SQLite-Datenbank unter
`CLASSROOM_DATA_DIR` (Standard `/var/lib/bude-classrooms`). Der Ordner und seine
Backups bleiben privat; keine Datenbank oder Schlüsseldatei gehört ins Git.
Namens-Trigger verhindern Überschneidungen mit Klassenraum-Adressen, auch wenn
mehrere Serverprozesse gleichzeitig registrieren.

Jeder Raum darf höchstens 100 MiB aktuelle Ciphertext-Daten halten. SQLite-
Metadaten, WAL und Backups sind nicht Teil dieser logischen Anwendungsquote.
Transaktionen prüfen Quote und erwartete Revisionen vor einer gemeinsamen
Änderung. Ein konkurrierender Schreibzugriff erhält HTTP 409. Der Browser hält
die lokale Fassung und bietet Export bzw. Laden des neueren Standes an.
Es gibt kein stilles Überschreiben. Ein 15-Sekunden-Abgleich lädt neue Stände
nur dann automatisch, wenn keine lokalen ungespeicherten Änderungen vorliegen.

Bilder werden im Browser auf höchstens 1600 Pixel Kantenlänge normalisiert,
auf Weiß abgeflacht und als JPEG komprimiert. Es werden keine originalen PNGs
zum persönlichen Speicher hochgeladen. Objekte sind auf 2 MiB verschlüsselt,
Speicherpakete auf 8 MiB und 16 Schreibobjekte begrenzt. Bis zu 5.000 Löschungen
passen atomar in ein Paket, damit auch lange Bild-Unterhaltungen löschbar bleiben.
Passwortversuche sind nach
fünf Fehlern drei Minuten gesperrt; Sitzungen nutzen sichere HttpOnly-Cookies.

## Prüfen

```sh
deno test -A tests
deno check fresh.gen.ts
deno task build
```

`tests/personalBrowser_test.py` verwendet zwei frische Browserprofile, echte
Browser-Verschlüsselung und einen isolierten Testserver. Nur KI-Anbieter werden
simuliert. Der lokale Server braucht ein eigenes `CLASSROOM_DATA_DIR`.

Am 26.10.2026 bestand außerdem ein echter OpenRouter-Browsertest mit kurzzeitig
übergebenem Key: Gemini Flash Lite für Chat, Grok Voice für TTS, Whisper für ASR
und Gemini Flash Lite Image für Bilder. Der erzeugte JPEG-Inhalt wurde auf einem
zweiten Browser nach Passwort-Eingabe aus dem verschlüsselten Speicher geladen.
Der Key wurde nicht in Quelldateien oder Browser-Storage geschrieben.
