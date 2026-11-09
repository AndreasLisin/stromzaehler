-- Stromzähler – Datenbankschema (Cloudflare D1 / SQLite)
-- Enthält KEINE Daten. Einmalig ausführen:
--   npx wrangler d1 execute stromzaehler --remote --file schema.sql

-- Personen: der Zugangscode liegt nur als SHA-256-Hash vor (Code = 20 Zufallszeichen).
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  code_hash   TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);

-- Angemeldete Geräte: langlebiges Token, ebenfalls nur als Hash.
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  name        TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  revoked_at  TEXT
);

-- Fehlversuche bei der Anmeldung (je IP und global).
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0
);

-- Zähler (vorbereitet für mehrere: Bezug 1.8.0, Einspeisung 2.8.0, Wärmepumpe …).
CREATE TABLE IF NOT EXISTS meters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  art         TEXT NOT NULL DEFAULT 'bezug',
  obis        TEXT DEFAULT '1.8.0',
  typ         TEXT DEFAULT 'mechanisch',
  stichtag    TEXT DEFAULT '12-31',
  is_demo     INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);

-- Ablesungen. kind='wechsel': Zählerwechsel, old_value = Endstand alter Zähler,
-- value = Anfangsstand neuer Zähler.
CREATE TABLE IF NOT EXISTS readings (
  id          TEXT PRIMARY KEY,
  meter_id    TEXT NOT NULL,
  ts          TEXT NOT NULL,
  value       REAL NOT NULL,
  old_value   REAL,
  kind        TEXT NOT NULL DEFAULT 'normal',
  source      TEXT NOT NULL DEFAULT 'hand',
  ai_value    REAL,
  note        TEXT,
  photo_id    TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_meter_ts ON readings(meter_id, ts);

-- Belegfotos (verkleinert, Base64-JPEG, max. ca. 150 KB).
CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  reading_id  TEXT,
  mime        TEXT NOT NULL DEFAULT 'image/jpeg',
  data        TEXT NOT NULL,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_reading ON photos(reading_id);

-- Tarife mit Gültig-ab-Datum.
CREATE TABLE IF NOT EXISTS tariffs (
  id               TEXT PRIMARY KEY,
  meter_id         TEXT NOT NULL,
  valid_from       TEXT NOT NULL,
  arbeitspreis_ct  REAL NOT NULL,
  grundpreis_monat REAL NOT NULL DEFAULT 0,
  abschlag_monat   REAL NOT NULL DEFAULT 0,
  note             TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL
);

-- Einstellungen (z. B. Datum der letzten Sicherung).
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_by  TEXT,
  updated_at  TEXT
);
