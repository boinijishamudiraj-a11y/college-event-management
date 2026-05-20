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
//insertUser.run('Arjun Kumar',   'student@vce.ac.in', pw, 'student',   'CSE', 3);
//insertUser.run('Priya Sharma',  'student2@vce.ac.in', pw, 'student',  'ECE', 2);
//insertUser.run('Ravi Organizer','org@vce.ac.in',     pw, 'organizer', 'CSE', 4);
//insertUser.run('Dr. Ramesh',    'admin@vce.ac.in',   pw, 'admin',     'CSE', 0);

const insertEvent = db.prepare(`INSERT INTO events(title,description,category,date,time,venue,capacity,branch,organizer_id) VALUES(?,?,?,?,?,?,?,?,?)`);
//insertEvent.run('National Tech Fest 2025',   'Annual technology festival with coding contests, robotics, and paper presentations.', 'Fest',        '2025-08-15','09:00 AM','Main Auditorium',  300,'All',3);
//insertEvent.run('Machine Learning Workshop', 'Hands-on workshop covering ML fundamentals, scikit-learn, and neural networks.',       'Workshop',    '2025-07-20','10:00 AM','Computer Lab 1',    40,'CSE',3);
//insertEvent.run('Resume Building Seminar',   'Industry experts guide students on crafting impactful resumes for placements.',        'Seminar',     '2025-07-10','02:00 PM','Seminar Hall B',   120,'ECE',3);
//insertEvent.run('Hackathon 2025',            '24-hour coding marathon. Build innovative solutions for real-world problems.',         'Competition', '2025-09-05','08:00 AM','Innovation Lab',    50,'CSE',3);
//insertEvent.run('Cultural Night',            'Showcase your talents in music, dance, drama. Inter-branch competition.',             'Cultural',    '2025-08-28','06:00 PM','Open Air Stage',   200,'All',3);
//insertEvent.run('Data Structures Deep Dive', 'Advanced workshop on trees, graphs, and dynamic programming with practice problems.',  'Workshop',    '2025-07-25','11:00 AM','Computer Lab 2',    30,'CSE',3);

const insertReg = db.prepare(`INSERT OR IGNORE INTO registrations(user_id,event_id,status,attended) VALUES(?,?,?,?)`);
//insertReg.run(1, 2, 'registered', 1); // Arjun attended ML Workshop
//insertReg.run(1, 3, 'registered', 0); // Arjun registered Resume Seminar
//insertReg.run(1, 5, 'registered', 1); // Arjun attended Cultural Night
//insertReg.run(2, 1, 'registered', 0); // Priya registered Tech Fest

const insertFeedback = db.prepare(`INSERT OR IGNORE INTO feedback(user_id,event_id,rating,comment) VALUES(?,?,?,?)`);
//insertFeedback.run(1, 2, 5, 'Excellent hands-on workshop! Learned a lot about scikit-learn.');
//insertFeedback.run(1, 5, 4, 'Amazing cultural night. Great performances from all branches!');

const insertCat = db.prepare(`INSERT OR IGNORE INTO categories(name) VALUES(?)`);
['Workshop','Seminar','Fest','Competition','Cultural','Sports'].forEach(c => insertCat.run(c));

module.exports = { db, hashPassword };