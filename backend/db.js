'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const db = new DatabaseSync('database.db');

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    email     TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    role      TEXT NOT NULL CHECK(role IN ('student','organizer','admin')),
    branch    TEXT DEFAULT 'CSE',
    year      INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

 CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    category    TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT,
    venue       TEXT NOT NULL,
    capacity    INTEGER NOT NULL,
    branch      TEXT DEFAULT 'All',
    organizer_id INTEGER REFERENCES users(id),
    created_at  TEXT DEFAULT (datetime('now'))
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

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const pw = hashPassword('password');

const insertUser = db.prepare(`INSERT INTO users(name,email,password,role,branch,year) VALUES(?,?,?,?,?,?)`);


const insertEvent = db.prepare(`INSERT INTO events(title,description,category,date,time,venue,capacity,branch,organizer_id) VALUES(?,?,?,?,?,?,?,?,?)`);


const insertReg = db.prepare(`INSERT OR IGNORE INTO registrations(user_id,event_id,status,attended) VALUES(?,?,?,?)`);


const insertFeedback = db.prepare(`INSERT OR IGNORE INTO feedback(user_id,event_id,rating,comment) VALUES(?,?,?,?)`);

const insertCat = db.prepare(`INSERT OR IGNORE INTO categories(name) VALUES(?)`);
['Workshop','Seminar','Fest','Competition','Cultural','Sports'].forEach(c => insertCat.run(c));

module.exports = { db, hashPassword };
