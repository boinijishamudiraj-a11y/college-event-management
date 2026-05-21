'use strict';
const http    = require('node:http');
const url     = require('node:url');
const { db, hashPassword } = require('./db');
const { sign, authMiddleware } = require('./auth');
const PORT = process.env.PORT || 3001;

// ─── MINI ROUTER ─────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { res(data ? JSON.parse(data) : {}); }
      catch { res({}); }
    });
    req.on('error', rej);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(body);
}

function ok(res, data)  { send(res, 200, data); }
function created(res, d){ send(res, 201, d); }
function err(res, msg, status=400) { send(res, status, { error: msg }); }
function unauth(res)    { err(res, 'Unauthorized', 401); }
function notFound(res)  { err(res, 'Not found', 404); }

// ─── ROUTES ──────────────────────────────────────────────────────────────────
async function router(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method;
  const query    = parsed.query;

  // ── PUBLIC ROUTES (no auth required) ──

  if (method === 'POST' && pathname === '/api/auth/login') {
    const { email, password, role } = await readBody(req);
    if (!email || !password) return err(res, 'Email and password required');
    const hashed = hashPassword(password);
    const user = db.prepare('SELECT * FROM users WHERE email=? AND password=? AND role=?').get(email, hashed, role || 'student');
    if (!user) return err(res, 'Invalid credentials', 401);
    const token = sign({ id: user.id, role: user.role, exp: Date.now() + 24*60*60*1000 });
    const { password: _, ...safe } = user;
    return ok(res, { token, user: safe });
  }

  // FIX: register moved before auth middleware — users need no token to sign up
  if (method === 'POST' && pathname === '/api/auth/register') {
    const { name, email, password, role='student', branch='CSE', year=1 } = await readBody(req);
    if (!name || !email || !password) return err(res, 'Name, email and password required');
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (existing) return err(res, 'Email already registered');
    const hashed = hashPassword(password);
    const result = db.prepare('INSERT INTO users(name,email,password,role,branch,year) VALUES(?,?,?,?,?,?)').run(name, email, hashed, role, branch, year);
    const user = db.prepare('SELECT id,name,email,role,branch,year FROM users WHERE id=?').get(result.lastInsertRowid);
    const token = sign({ id: user.id, role: user.role, exp: Date.now() + 24*60*60*1000 });
    return created(res, { token, user });
  }

  // FIX: single /api/categories route here (removed duplicate after auth check)
  if (method === 'GET' && pathname === '/api/categories') {
    return ok(res, db.prepare('SELECT name FROM categories').all().map(r => r.name));
  }

  // ── AUTH GUARD — all routes below require a valid token ──
  const payload = authMiddleware(req);
  if (!payload) return unauth(res);
  const userId = payload.id;
  const userRole = payload.role;

  // ── EVENTS ──
  if (method === 'GET' && pathname === '/api/events') {
    const cat  = query.category;
    const rows = cat && cat !== 'All'
      ? db.prepare('SELECT * FROM events WHERE category=? ORDER BY date').all(cat)
      : db.prepare('SELECT * FROM events ORDER BY date').all();

    const events = rows.map(e => {
      const regCount  = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE event_id=? AND status='registered'").get(e.id).c;
      const waitCount = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE event_id=? AND status='waitlisted'").get(e.id).c;
      const avgRating = db.prepare('SELECT AVG(rating) as avg FROM feedback WHERE event_id=?').get(e.id).avg;
      const myReg     = db.prepare('SELECT status,attended FROM registrations WHERE user_id=? AND event_id=?').get(userId, e.id);
      return { ...e, registered_count: regCount, waitlist_count: waitCount, avg_rating: avgRating ? +avgRating.toFixed(1) : null, my_status: myReg?.status || null, my_attended: myReg?.attended || 0 };
    });
    return ok(res, events);
  }

  if (method === 'GET' && pathname.match(/^\/api\/events\/\d+$/)) {
    const eid = +pathname.split('/')[3];
    const e = db.prepare('SELECT * FROM events WHERE id=?').get(eid);
    if (!e) return notFound(res);
    const regCount  = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE event_id=? AND status='registered'").get(eid).c;
    const waitCount = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE event_id=? AND status='waitlisted'").get(eid).c;
    const feedbacks = db.prepare('SELECT f.*,u.name,u.branch FROM feedback f JOIN users u ON f.user_id=u.id WHERE f.event_id=?').all(eid);
    const avgRating = db.prepare('SELECT AVG(rating) as avg FROM feedback WHERE event_id=?').get(eid).avg;
    return ok(res, { ...e, registered_count: regCount, waitlist_count: waitCount, feedbacks, avg_rating: avgRating ? +avgRating.toFixed(1) : null });
  }

  if (method === 'POST' && pathname === '/api/events') {
    if (userRole !== 'organizer' && userRole !== 'admin') return err(res, 'Forbidden', 403);
    const { title, description, category, date, time, venue, capacity, branch='All' } = await readBody(req);
    if (!title || !category || !date || !venue || !capacity) return err(res, 'Missing required fields');
    const r = db.prepare('INSERT INTO events(title,description,category,date,time,venue,capacity,branch,organizer_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(title, description||'', category, date, time||'', venue, +capacity, branch, userId);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(r.lastInsertRowid);
    return created(res, event);
  }

  if (method === 'DELETE' && pathname.match(/^\/api\/events\/\d+$/)) {
    if (userRole !== 'organizer' && userRole !== 'admin') return err(res, 'Forbidden', 403);
    const eid = +pathname.split('/')[3];
    db.prepare('DELETE FROM feedback WHERE event_id=?').run(eid);
    db.prepare('DELETE FROM registrations WHERE event_id=?').run(eid);
    db.prepare('DELETE FROM events WHERE id=?').run(eid);
    return ok(res, { message: 'Event deleted' });
  }

  // ── REGISTRATIONS ──
  if (method === 'POST' && pathname.match(/^\/api\/events\/\d+\/register$/)) {
    const eid = +pathname.split('/')[3];
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(eid);
    if (!event) return notFound(res);

    const existing = db.prepare('SELECT * FROM registrations WHERE user_id=? AND event_id=?').get(userId, eid);
    if (existing && existing.status !== 'cancelled') return err(res, 'Already registered or waitlisted');

    const regCount = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE event_id=? AND status='registered'").get(eid).c;
    const status = regCount >= event.capacity ? 'waitlisted' : 'registered';

    if (existing) {
      db.prepare("UPDATE registrations SET status=?,attended=0 WHERE user_id=? AND event_id=?").run(status, userId, eid);
    } else {
      db.prepare('INSERT INTO registrations(user_id,event_id,status) VALUES(?,?,?)').run(userId, eid, status);
    }
    return created(res, { status, message: status === 'waitlisted' ? 'Added to waitlist' : 'Registered successfully! Confirmation email sent.' });
  }

  if (method === 'DELETE' && pathname.match(/^\/api\/events\/\d+\/register$/)) {
    const eid = +pathname.split('/')[3];
    const reg = db.prepare("SELECT * FROM registrations WHERE user_id=? AND event_id=? AND status='registered'").get(userId, eid);
    if (!reg) return err(res, 'Registration not found');
    db.prepare("UPDATE registrations SET status='cancelled' WHERE user_id=? AND event_id=?").run(userId, eid);

    // Promote waitlisted user
    const next = db.prepare("SELECT * FROM registrations WHERE event_id=? AND status='waitlisted' ORDER BY created_at LIMIT 1").get(eid);
    if (next) {
      db.prepare("UPDATE registrations SET status='registered' WHERE id=?").run(next.id);
    }
    return ok(res, { message: 'Registration cancelled' + (next ? '. Waitlisted student promoted.' : '') });
  }

  // ── ATTENDANCE (QR mark) ──
  if (method === 'POST' && pathname.match(/^\/api\/events\/\d+\/attend$/)) {
    const eid = +pathname.split('/')[3];
    const reg = db.prepare("SELECT * FROM registrations WHERE user_id=? AND event_id=? AND status='registered'").get(userId, eid);
    if (!reg) return err(res, 'No active registration found');
    if (reg.attended) return err(res, 'Already marked as attended');
    db.prepare('UPDATE registrations SET attended=1 WHERE user_id=? AND event_id=?').run(userId, eid);
    return ok(res, { message: 'Attendance marked successfully!' });
  }

  // ── MY REGISTRATIONS ──
  if (method === 'GET' && pathname === '/api/my/registrations') {
    const rows = db.prepare(`
      SELECT r.*, e.title, e.date, e.time, e.venue, e.category,
             (SELECT COUNT(*) FROM feedback WHERE user_id=? AND event_id=e.id) as feedback_given
      FROM registrations r
      JOIN events e ON r.event_id = e.id
      WHERE r.user_id=? AND r.status != 'cancelled'
      ORDER BY e.date
    `).all(userId, userId);
    return ok(res, rows);
  }

  // ── FEEDBACK ──
  if (method === 'POST' && pathname.match(/^\/api\/events\/\d+\/feedback$/)) {
    const eid = +pathname.split('/')[3];
    const { rating, comment } = await readBody(req);
    if (!rating || rating < 1 || rating > 5) return err(res, 'Rating must be 1-5');
    const attended = db.prepare("SELECT attended FROM registrations WHERE user_id=? AND event_id=? AND status='registered'").get(userId, eid);
    if (!attended || !attended.attended) return err(res, 'You must attend the event before giving feedback');
    const existing = db.prepare('SELECT id FROM feedback WHERE user_id=? AND event_id=?').get(userId, eid);
    if (existing) return err(res, 'Feedback already submitted');
    db.prepare('INSERT INTO feedback(user_id,event_id,rating,comment) VALUES(?,?,?,?)').run(userId, eid, rating, comment||'');
    return created(res, { message: 'Feedback submitted! Thank you.' });
  }

  // ── AI RECOMMENDATIONS ──
  if (method === 'GET' && pathname === '/api/recommendations') {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    const history = db.prepare(`
      SELECT e.category FROM registrations r JOIN events e ON r.event_id=e.id
      WHERE r.user_id=? AND r.status='registered'
    `).all(userId).map(r => r.category);

    const catCount = history.reduce((a, c) => { a[c] = (a[c]||0)+1; return a; }, {});
    const topCats = Object.entries(catCount).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);

    const registered = db.prepare("SELECT event_id FROM registrations WHERE user_id=? AND status!='cancelled'").all(userId).map(r=>r.event_id);
    const excludeStr = registered.length ? registered.join(',') : '0';

    let recs = db.prepare(`
      SELECT * FROM events
      WHERE id NOT IN (${excludeStr})
      AND (category IN (${topCats.map(()=>'?').join(',')}) OR branch=? OR branch='All')
      ORDER BY date LIMIT 5
    `).all(...topCats, user.branch);

    if (recs.length === 0) {
      recs = db.prepare(`SELECT * FROM events WHERE id NOT IN (${excludeStr}) ORDER BY date LIMIT 3`).all();
    }

    recs = recs.map(e => ({
      ...e,
      registered_count: db.prepare("SELECT COUNT(*) as c FROM registrations WHERE event_id=? AND status='registered'").get(e.id).c,
      reason: topCats.includes(e.category) ? `Based on your interest in ${e.category}` : `Matches your ${user.branch} branch`
    }));

    return ok(res, { recommendations: recs, top_categories: topCats, user_branch: user.branch });
  }

  // ── ORGANIZER / ADMIN ──
  if (method === 'GET' && pathname === '/api/admin/registrations') {
    if (userRole !== 'organizer' && userRole !== 'admin') return err(res, 'Forbidden', 403);
    const rows = db.prepare(`
      SELECT r.*, u.name as user_name, u.email, u.branch, u.year,
             e.title as event_title, e.date, e.category
      FROM registrations r
      JOIN users u ON r.user_id=u.id
      JOIN events e ON r.event_id=e.id
      WHERE r.status != 'cancelled'
      ORDER BY r.created_at DESC
    `).all();
    return ok(res, rows);
  }

  if (method === 'GET' && pathname === '/api/admin/analytics') {
    if (userRole !== 'admin') return err(res, 'Forbidden', 403);
    const totalEvents  = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
    const totalUsers   = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='student'").get().c;
    const totalRegs    = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status='registered'").get().c;
    const totalAttend  = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE attended=1').get().c;
    const totalFeedback= db.prepare('SELECT COUNT(*) as c FROM feedback').get().c;
    const avgRating    = db.prepare('SELECT AVG(rating) as avg FROM feedback').get().avg;
    const byCategory   = db.prepare(`SELECT e.category, COUNT(*) as event_count,
      SUM((SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.status='registered')) as reg_count
      FROM events e GROUP BY e.category`).all();
    const topEvents    = db.prepare(`
      SELECT e.title, COUNT(*) as reg_count FROM registrations r
      JOIN events e ON r.event_id=e.id WHERE r.status='registered'
      GROUP BY r.event_id ORDER BY reg_count DESC LIMIT 5`).all();
    return ok(res, { totalEvents, totalUsers, totalRegs, totalAttend, totalFeedback, avgRating: avgRating ? +avgRating.toFixed(1):0, byCategory, topEvents });
  }

  if (method === 'GET' && pathname === '/api/admin/users') {
    if (userRole !== 'admin') return err(res, 'Forbidden', 403);
    const users = db.prepare('SELECT id,name,email,role,branch,year,created_at FROM users').all();
    return ok(res, users);
  }

  if (method === 'GET' && pathname === '/api/admin/feedback') {
    if (userRole !== 'admin' && userRole !== 'organizer') return err(res, 'Forbidden', 403);
    const rows = db.prepare(`
      SELECT f.*, u.name as user_name, e.title as event_title
      FROM feedback f JOIN users u ON f.user_id=u.id JOIN events e ON f.event_id=e.id
      ORDER BY f.created_at DESC
    `).all();
    return ok(res, rows);
  }

  // 404
  notFound(res);
}

// ─── START ───────────────────────────────────────────────────────────────────
const server = http.createServer(router);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
console.log("PORT FROM RAILWAY =", PORT);