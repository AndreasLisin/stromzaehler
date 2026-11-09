# ⚡ Stromzähler

Private Web-App zum Erfassen und Auswerten des eigenen Stromverbrauchs: den Zähler fotografieren, den Stand bestätigen lassen und den Verbrauch je Kalenderwoche und Monat mit den Vorjahren vergleichen.

**Dieses Repository enthält nur Programmcode, keine Daten, Fotos, Zugangscodes, Keys oder Tokens.**
Alle Daten liegen in einer Cloudflare-D1-Datenbank, die nur mit gültigem Geräte-Token erreichbar ist.

## Aufbau

| Teil | Datei(en) | Läuft auf |
|---|---|---|
| App (HTML/CSS/JS, kein Build) | `index.html`, `manifest.json`, `service-worker.js`, Icons | GitHub Pages |
| API | `worker/src/index.js` | Cloudflare Workers |
| Datenbank inkl. Belegfotos | `worker/schema.sql` | Cloudflare D1 |
| Zählerstand-Erkennung | Workers AI (`@cf/mistralai/mistral-small-3.1-24b-instruct`) | Cloudflare |

## Sicherheit

- Jede Person hat einen eigenen, zufällig erzeugten Zugangscode (20 Zeichen). Gespeichert wird nur der SHA-256-Hash.
- Ein Gerät meldet sich einmal an und bekommt ein langlebiges Token. Auch das liegt nur als Hash in der Datenbank. In den Einstellungen lassen sich Geräte einzeln abmelden.
- Sperre bei Fehlversuchen: Nach 5 Fehlversuchen je IP wird 15 Minuten gesperrt, danach jeweils doppelt so lang (höchstens 24 Std.). Zusätzlich gibt es eine globale Sperre nach 30 Fehlversuchen pro Stunde.
- Der Worker nimmt nur Anfragen von `https://andreaslisin.github.io` an (CORS-Prüfung über die Origin).
- Fotos haben keine öffentliche URL. Sie werden nur über die API mit Token ausgeliefert.
- Geheimnisse: Diese Lösung braucht keine. Die Datenbank-ID steht nur in der lokalen `worker/wrangler.toml`, die in `.gitignore` steht.

## Einrichtung

Siehe **[ANLEITUNG.md](ANLEITUNG.md)**. Die Anleitung ist für Laien geschrieben.

## Tests (ohne Cloudflare-Konto, mit ***TEST***-Daten)

```bash
cd worker
node test/api-test.mjs     # API: Anmeldung, Sperre, CORS, Fotos, Import, Geräte (47 Prüfungen)
node test/calc-test.mjs    # Rechnung: KW/Monat/Jahr, Zeitumstellung, Kosten, Warnungen (44 Prüfungen)
```

`worker/test/dev-server.mjs` ist ein lokaler Nachbau der API. Er bildet D1 mit `node:sqlite` nach, weil die Cloudflare-Laufzeit `workerd` auf manchen Firmen-PCs gesperrt ist.
