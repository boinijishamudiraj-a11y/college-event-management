'use strict';
const Database = require('better-sqlite3');
const crypto   = require('node:crypto');
const path     = require('node:path');
const fs       = require('node:fs');

// ─── DB PATH ─────────────────────────────────────────────────────────────────
// On Railway: set env var DB_PATH=/data/database.db and mount a volume at /data
// Locally:    falls back to ./database.db next to this file
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');

// Ensure the directory exists (important when using a Railway volume like /data)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode — better concurrency and crash safety
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`📦 SQLite database at: ${DB_PATH}`);

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL CHECK(role IN ('student','organizer','admin')),
    branch     TEXT DEFAULT 'CSE',
    year       INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    category     TEXT NOT NULL,
    date         TEXT NOT NULL,
    time         TEXT,
    venue        TEXT NOT NULL,
    capacity     INTEGER NOT NULL,
    branch       TEXT DEFAULT 'All',
    organizer_id INTEGER REFERENCES users(id),
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    event_id   INTEGER REFERENCES events(id),
    status     TEXT DEFAULT 'registered' CHECK(status IN ('registered','waitlisted','cancelled')),
    attended   INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    event_id   INTEGER REFERENCES events(id),
    rating     INTEGER CHECK(rating BETWEEN 1 AND 5),
    comment    TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );
`);

// ─── HELPER ──────────────────────────────────────────────────────────────────
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'vce_salt_2025').digest('hex');
}

// ─── SEED CATEGORIES (safe — uses INSERT OR IGNORE) ──────────────────────────
const insertCat = db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)');
['Workshop', 'Seminar', 'Fest', 'Competition', 'Cultural', 'Sports'].forEach(c => insertCat.run(c));

// ─── SEED DEFAULT ADMIN (only if no admin exists) ────────────────────────────
// Change these credentials via env vars in Railway dashboard
const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@vce.ac.in';
const adminPassword = process.env.ADMIN_PASSWORD || 'password';
const adminExists   = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
if (!adminExists) {
  db.prepare(
    "INSERT OR IGNORE INTO users(name,email,password,role,branch,year) VALUES(?,?,?,?,?,?)"
  ).run('Dr. Ramesh', adminEmail, hashPassword(adminPassword), 'admin', 'CSE', 0);
  console.log(`🔑 Default admin created: ${adminEmail}`);
}

module.exports = { db, hashPassword };