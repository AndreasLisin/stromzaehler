# Stromzähler einrichten – Schritt für Schritt

Dauer: etwa 30 Minuten. Alle Dienste sind kostenlos. Du brauchst **keine Kreditkarte**.
Deine Passwörter gibst du nur selbst auf den Seiten von Cloudflare und GitHub ein, nirgends sonst.

**Was du brauchst:**
- den PC mit dem Ordner `Stromzaehler_09-11-2026` (Node.js ist schon installiert)
- dein GitHub-Konto `AndreasLisin`, das du auch für den Vokabeltrainer nutzt
- ein neues, kostenloses Cloudflare-Konto (Teil A)

---

## Teil A – Cloudflare-Konto anlegen (5 Minuten)

1. Öffne <https://dash.cloudflare.com/sign-up>.
2. Gib deine **private** E-Mail-Adresse und ein **neues** Passwort ein. Am besten nimmst du ein Passwort, das du sonst nirgends verwendest, und speicherst es in deinem Passwort-Manager.
3. Bestätige den Link in der E-Mail von Cloudflare.
4. Wenn Cloudflare dir eine „Domain“ oder einen Tarif anbieten will: überspringen. Du brauchst weder eine Domain noch einen bezahlten Tarif.

## Teil B – Datenbank und Server (Worker) veröffentlichen (10 Minuten)

1. Öffne im Explorer den Ordner `Stromzaehler_09-11-2026\worker`.
2. Klicke oben in die Adresszeile, tippe `powershell` und drücke Enter. Es öffnet sich ein blaues Fenster.
3. Gib ein:
   ```
   node scripts/einrichten.mjs
   ```
4. Das Skript arbeitet in 5 Schritten:
   - **Schritt 1:** Der Browser öffnet sich. Melde dich bei Cloudflare an und klicke auf **„Allow“**. Danach kannst du den Browser-Tab schließen.
   - **Schritt 2–4:** Das Skript legt die Datenbank an. Deine Daten liegen dabei in der EU. Danach schreibt es die Konfiguration und legt die Tabellen an. Du musst nichts tun.
   - **Schritt 5:** Der Worker wird veröffentlicht. Beim ersten Mal kann Cloudflare nach einer **„workers.dev subdomain“** fragen. Tippe einen Namen ein, zum Beispiel `andreas-lisin`, und drücke Enter.
5. Am Ende steht eine Adresse in dieser Form da:
   `https://stromzaehler-api.DEIN-NAME.workers.dev`
   **Notiere sie.** Sie ist kein Geheimnis.
6. Test: Öffne im Browser diese Adresse und hänge `/health` an. Dort muss `"ok":true` und `"datenbank":"ok"` stehen.

> Falls etwas rot erscheint: Fenster offen lassen und Claude ein Foto oder den Text davon schicken.

## Teil C – Zugangscodes anlegen (2 Minuten)

1. Im selben PowerShell-Fenster eingeben (deinen Vornamen einsetzen):
   ```
   node scripts/person-anlegen.mjs "Andreas"
   ```
2. In einem Kasten erscheint ein Code wie `K7PQ2-…-…-…`. **Er wird nur dieses eine Mal angezeigt.** Notiere ihn auf Papier oder in deinem Passwort-Manager. Nicht per Mail oder Chat verschicken.
3. Für weitere Personen im Haushalt kannst du den Befehl mit deren Namen wiederholen. Einfacher geht es später in der App unter **Einstellungen → Person hinzufügen**.
4. Code vergessen? In der App unter **Einstellungen → Neuer Code**. Oder du führst den Befehl erneut mit demselben Namen aus.

**Secrets:** Diese Lösung braucht keine. Die Codes liegen nur als Hash in der Datenbank, und die Bilderkennung läuft über Cloudflare selbst (Workers AI). Nur wenn du später eine externe KI nutzen willst, legst du deren Schlüssel mit `npx wrangler secret put NAME` an. Dann fragt das Programm den Schlüssel ab, und du tippst ihn selbst ein.

## Teil D – App auf GitHub Pages veröffentlichen (5 Minuten)

Das Hochladen übernimmt Claude, sobald du es freigibst: Repository „stromzaehler“ anlegen (öffentlich), Code hochladen und vorher prüfen, dass keine Daten oder Schlüssel enthalten sind. Danach:

1. Öffne <https://github.com/AndreasLisin/stromzaehler> → **Settings** → links **Pages**.
2. Wähle bei „Branch“ **main** und **/ (root)** und klicke **Save**.
3. Nach etwa 1 Minute ist die App unter <https://andreaslisin.github.io/stromzaehler/> erreichbar.
4. Die API-Adresse aus Teil B, Schritt 5 trägt Claude in `index.html` ein (`DEFAULT_API`). Dann musst du sie auf keinem Handy eintippen.

## Teil E – App auf dem Handy (je Gerät 2 Minuten)

**iPhone (Safari):**
1. Öffne <https://andreaslisin.github.io/stromzaehler/> in **Safari** oder scanne den QR-Code aus `Stromzaehler_QR-Code.html`.
2. Tippe auf das Teilen-Symbol (Quadrat mit Pfeil), dann **„Zum Home-Bildschirm“** und **„Hinzufügen“**.
3. **Wichtig:** Öffne die App jetzt über das neue Symbol auf dem Home-Bildschirm und melde dich **dort** mit deinem Code an. Safari und die Home-Bildschirm-App haben getrennte Speicher, das kennst du vom Vokabeltrainer.
4. Beim ersten „Zähler ablesen“ fragt das iPhone, ob die App die Kamera nutzen darf. Bitte erlauben.

**Android (Chrome):**
1. Öffne die Adresse in **Chrome** oder scanne den QR-Code.
2. Menü **⋮** → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“**.
3. Öffne die App und melde dich mit deinem Code an.

## Teil F – Erste Schritte in der App

1. **Zähler anlegen:** Name, zum Beispiel „Hauszähler“, und den Typ wählen: mechanisch (Rollenzähler) oder digital (moderne Messeinrichtung).
2. **Tarif eintragen:** Einstellungen → Tarif. Dort Gültig-ab-Datum, Arbeitspreis in ct/kWh, Grundpreis in €/Monat und Abschlag in €/Monat eintragen. Den Abrechnungsstichtag findest du unter „Zähler & Stichtag“.
3. **Altdaten aus Jahresabrechnungen:** Ablesungen → „Altdaten (CSV)“. Je Zeile `31.12.2023;30512,4`.
4. **Ablesen:** Start → **Zähler ablesen**.
   - Foto machen und den Rahmen um die Ziffern ziehen. Den Rahmen merkt sich die App fürs nächste Mal.
   - Dann **Zählerstand erkennen**, den Wert prüfen und gegebenenfalls korrigieren.
   - Zum Schluss **Speichern**. Ohne deine Bestätigung wird nichts gespeichert.
5. **Ausprobieren ohne echte Daten:** Einstellungen → **Demo-Daten erzeugen** legt einen eigenen Zähler „***TEST*** Demo-Zähler“ mit 3 Jahren erfundener Daten an. Über das Zähler-Feld oben wechselst du zwischen Demo und echten Daten. Mit **Demo-Daten löschen** ist alles wieder weg, deine echten Daten bleiben unberührt.

**Ohne Netz** (zum Beispiel im Keller) speichert die App die Ablesung auf dem Handy. Der Punkt oben rechts wird gelb, und die Startseite zeigt „⏳ wartet“. Sobald wieder Netz da ist, lädt die App die Ablesung automatisch hoch.

## Teil G – Monatliche Sicherung

1. Einstellungen → **Sicherung erstellen** → **Teilen / in OneDrive speichern** → im Teilen-Menü **OneDrive** wählen und einen Ordner in deinem **privaten** OneDrive wählen, zum Beispiel `Stromzähler\Sicherungen`.
2. Du bekommst zwei Dateien:
   - `Stromzaehler_Sicherung_TT-MM-JJJJ.json` enthält alles, auch Fotos und Tarife.
   - `Stromzaehler_Ablesungen_TT-MM-JJJJ.csv` lässt sich direkt in Excel öffnen.
3. **Erinnerung:** Einstellungen → **Monatliche Erinnerung in den Kalender**. Das legt einen Termin am 1. jedes Monats um 19:00 Uhr an. Zusätzlich zeigt die Startseite das Datum der letzten Sicherung. Ist sie älter als 30 Tage, erscheint das Datum rot.
4. **Wiederherstellen:** Einstellungen → **Wiederherstellen** → JSON-Datei wählen. Ablesungen, die schon vorhanden sind, werden automatisch übersprungen.

## Teil H – Für alle Fälle

| Situation | Was tun |
|---|---|
| Handy verloren | Auf einem anderen Gerät: Einstellungen → Angemeldete Geräte → **Abmelden** |
| Code verraten oder vergessen | Einstellungen → Personen → **Neuer Code**. Alle Geräte dieser Person werden dabei abgemeldet. |
| „Zu viele Fehlversuche“ | Die Sperre läuft automatisch ab. Die Uhrzeit steht in der Meldung. |
| App zeigt alte Version | App schließen und neu öffnen. Updates werden beim Öffnen geladen. |
| Zählerwechsel durch den Netzbetreiber | Ablesungen → **Zählerwechsel**: Endstand des alten Zählers und Anfangsstand des neuen eintragen. Die Auswertung läuft durchgehend weiter. |

## Grenzen der Gratis-Tarife (Stand 09.11.2026)

| Dienst | Kostenlos enthalten | Für dich ausreichend? |
|---|---|---|
| GitHub Pages | Seite bis 1 GB, 100 GB Datenverkehr pro Monat. Das Repository muss öffentlich sein. | Ja. Die App hat unter 0,3 MB. |
| Cloudflare Workers | 100.000 Anfragen pro Tag, 10 ms Rechenzeit pro Anfrage | Ja. Pro Tag fallen etwa 50 Anfragen an. |
| Cloudflare D1 | 500 MB pro Datenbank, 5 Mio. gelesene und 100.000 geschriebene Zeilen pro Tag | Ja. Ein Belegfoto hat höchstens 150 KB. Bei einer Ablesung pro Woche reicht der Platz über 40 Jahre. |
| Workers AI | 10.000 „Neurons“ pro Tag | Ja, für einige Ablesungen am Tag. |

Keiner dieser Dienste wird bei Inaktivität pausiert. Die Tageszähler starten um 01:00 Uhr (MEZ) bzw. 02:00 Uhr (MESZ) neu.
Die Fotos liegen in D1 und nicht in R2, weil R2 zum Freischalten eine Zahlungsart verlangt.
