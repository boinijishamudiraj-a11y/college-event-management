'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path   = require('node:path');
const fs     = require('node:fs');

// ─── PERSISTENT PATH ─────────────────────────────────────────────────────────
// On Railway, mount a volume at /data so the DB survives redeploys.
// Locally it falls back to the project root.
const DATA_DIR = process.env.DATA_DIR || "/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH  = path.join(DATA_DIR, 'database.db');

console.log('📂 Database path:', DB_PATH);
const db = new DatabaseSync(DB_PATH);

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

  CREATE TABLE IF NOT EXISTS seed_flags (
    key TEXT PRIMARY KEY
  );
`);

// ─── HELPER ──────────────────────────────────────────────────────────────────
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'vce_salt_2025').digest('hex');
}

// ─── SEED (runs only once per DB file) ───────────────────────────────────────
const alreadySeeded = db.prepare('SELECT key FROM seed_flags WHERE key=?').get('v1');

if (!alreadySeeded) {
  console.log('🌱 Seeding database…');

  const pw = hashPassword('password');

  const insertUser  = db.prepare(`INSERT OR IGNORE INTO users(name,email,password,role,branch,year) VALUES(?,?,?,?,?,?)`);
  const insertEvent = db.prepare(`INSERT OR IGNORE INTO events(title,description,category,date,time,venue,capacity,branch,organizer_id) VALUES(?,?,?,?,?,?,?,?,?)`);
  const insertReg   = db.prepare(`INSERT OR IGNORE INTO registrations(user_id,event_id,status,attended) VALUES(?,?,?,?)`);
  const insertFb    = db.prepare(`INSERT OR IGNORE INTO feedback(user_id,event_id,rating,comment) VALUES(?,?,?,?)`);
  const insertCat   = db.prepare(`INSERT OR IGNORE INTO categories(name) VALUES(?)`);

  ['Workshop','Seminar','Fest','Competition','Cultural','Sports'].forEach(c => insertCat.run(c));

  // Demo users
  insertUser.run('Admin User',   'admin@vce.ac.in',     pw, 'admin',     'Admin',  0);
  insertUser.run('Org User',     'org@vce.ac.in',       pw, 'organizer', 'CSE',    0);
  insertUser.run('Arjun Kumar',  'arjun@vce.ac.in',     pw, 'student',   'CSE',    3);
  insertUser.run('Priya Sharma', 'priya@vce.ac.in',     pw, 'student',   'ECE',    2);
  insertUser.run('Rahul Reddy',  'rahul@vce.ac.in',     pw, 'student',   'MECH',   4);

  const admin  = db.prepare('SELECT id FROM users WHERE email=?').get('admin@vce.ac.in');
  const org    = db.prepare('SELECT id FROM users WHERE email=?').get('org@vce.ac.in');
  const orgId  = org?.id || admin?.id || 1;

  // Helper: today + N days in YYYY-MM-DD
  function daysFromNow(n) {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Events — some today, some future, some past
  insertEvent.run('Tech Fest 2025',          'Annual technology festival',              'Fest',        daysFromNow(0),   '09:00 AM', 'Main Auditorium',  300, 'All',  orgId);
  insertEvent.run('AI/ML Workshop',          'Hands-on machine learning session',       'Workshop',    daysFromNow(1),   '10:00 AM', 'Seminar Hall A',   60,  'CSE',  orgId);
  insertEvent.run('Cultural Night',          'Music, dance and drama performances',     'Cultural',    daysFromNow(2),   '06:00 PM', 'Open Air Theatre', 500, 'All',  orgId);
  insertEvent.run('Coding Competition',      'Competitive programming contest',         'Competition', daysFromNow(3),   '11:00 AM', 'CS Lab 1',         80,  'CSE',  orgId);
  insertEvent.run('ECE Project Expo',        'Showcase of ECE student projects',        'Seminar',     daysFromNow(5),   '10:00 AM', 'ECE Block',        120, 'ECE',  orgId);
  insertEvent.run('Sports Day',              'Inter-branch sports competitions',        'Sports',      daysFromNow(7),   '08:00 AM', 'Sports Ground',    400, 'All',  orgId);
  insertEvent.run('Web Dev Bootcamp',        'Three day web development intensive',     'Workshop',    daysFromNow(-1),  '09:00 AM', 'Seminar Hall B',   40,  'CSE',  orgId);
  insertEvent.run('Guest Lecture: Robotics', 'Industry expert talk on robotics trends', 'Seminar',     daysFromNow(-2),  '02:00 PM', 'Auditorium',       200, 'All',  orgId);

  // Sample registrations for demo users
  const student1 = db.prepare('SELECT id FROM users WHERE email=?').get('arjun@vce.ac.in');
  const student2 = db.prepare('SELECT id FROM users WHERE email=?').get('priya@vce.ac.in');
  const ev1 = db.prepare('SELECT id FROM events WHERE title=?').get('Tech Fest 2025');
  const ev2 = db.prepare('SELECT id FROM events WHERE title=?').get('AI/ML Workshop');
  const ev7 = db.prepare('SELECT id FROM events WHERE title=?').get('Web Dev Bootcamp');
  const ev8 = db.prepare('SELECT id FROM events WHERE title=?').get('Guest Lecture: Robotics');

  if (student1 && ev1) insertReg.run(student1.id, ev1.id, 'registered', 0);
  if (student1 && ev2) insertReg.run(student1.id, ev2.id, 'registered', 0);
  if (student1 && ev7) insertReg.run(student1.id, ev7.id, 'registered', 1); // attended past event
  if (student1 && ev8) insertReg.run(student1.id, ev8.id, 'registered', 1); // attended past event
  if (student2 && ev1) insertReg.run(student2.id, ev1.id, 'registered', 0);

  // Sample feedback for attended events
  if (student1 && ev7) insertFb.run(student1.id, ev7.id, 4, 'Really enjoyed the hands-on sessions!');
  if (student1 && ev8) insertFb.run(student1.id, ev8.id, 5, 'Excellent speaker, very insightful.');

  db.prepare('INSERT OR IGNORE INTO seed_flags(key) VALUES(?)').run('v1');
  console.log('✅ Seed complete');
} else {
  console.log('✅ Database already seeded');
}

module.exports = { db, hashPassword };
