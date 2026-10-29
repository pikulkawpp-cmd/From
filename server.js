// เซิร์ฟเวอร์ระบบสอบครูฝึก รร.นายเรือ — ไม่ใช้แพ็กเกจภายนอก (Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QUESTIONS = require('./questions');

const PORT = process.env.PORT || 3000;
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD;
if (!TEACHER_PASSWORD) {
  console.error('ไม่พบ TEACHER_PASSWORD — ตั้งรหัสครูฝึกใน Environment ของ Render (หรือ export TEACHER_PASSWORD=... ตอนทดสอบในเครื่อง)');
  process.exit(1);
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const PASS_SCORE = 70;
const GRACE_MS = 12000; // เผื่อเวลาเน็ตหน่วงตอนส่งอัตโนมัติ
const LETTERS = ['ก', 'ข', 'ค', 'ง'];

const PART_META = {
  1: { title: 'การบริหาร การฝึก และภาวะผู้นำ' },
  2: { title: 'ประมวลกฎหมายอาญา' },
};
for (const p of [1, 2]) {
  PART_META[p].questions = QUESTIONS.filter((q) => q.part === p);
  PART_META[p].count = PART_META[p].questions.length;
  PART_META[p].perQ = 100 / PART_META[p].count; // ภาคละ 100 คะแนนเต็ม
}

const rooms = new Map(); // code -> room
const tokens = new Map(); // token -> expiry
const loginFails = new Map(); // ip -> {n, until}

const now = () => Date.now();
const rid = (n) => crypto.randomBytes(n).toString('hex');

// ---------- ตรวจคะแนน / เวลา ----------
function grade(a, auto) {
  const qs = PART_META[a.part].questions;
  let correct = 0;
  for (const q of qs) if (a.answers[q.id] === q.answer) correct++;
  a.submitted = true;
  a.auto = !!auto;
  a.submittedAt = now();
  a.correct = correct;
  a.total = qs.length;
  a.score = Math.round(correct * PART_META[a.part].perQ);
}

function finalizeStudent(st) {
  for (const p of [1, 2]) {
    const a = st.attempts[p];
    if (a && !a.submitted && now() > a.deadline + GRACE_MS) grade(a, true);
  }
}

function runningAttempt(st) {
  return [1, 2].map((p) => st.attempts[p]).find((a) => a && !a.submitted) || null;
}

// ---------- มุมมองข้อมูล ----------
function partSummary(st, p) {
  const a = st.attempts[p];
  if (!a) return { status: 'new' };
  if (a.submitted) return { status: 'done', score: a.score, correct: a.correct, total: a.total, auto: a.auto };
  return {
    status: 'running',
    remainingMs: Math.max(0, a.deadline - now()),
    answered: Object.keys(a.answers).length,
    total: PART_META[p].count,
  };
}

function studentView(room, st) {
  finalizeStudent(st);
  const parts = { 1: partSummary(st, 1), 2: partSummary(st, 2) };
  const run = runningAttempt(st);
  const meta = {};
  for (const p of [1, 2]) meta[p] = { title: PART_META[p].title, count: PART_META[p].count, minutes: room.minutes[p] };
  let current = null;
  if (run) {
    current = {
      part: run.part,
      remainingMs: Math.max(0, run.deadline - now()),
      answers: run.answers,
      // ส่งเฉพาะโจทย์ ไม่ส่งเฉลย
      questions: PART_META[run.part].questions.map((q) => ({ id: q.id, section: q.section, title: q.title, options: q.options })),
    };
  }
  return { name: st.name, approved: st.approved, allowed: st.allowed, passScore: PASS_SCORE, meta, parts, current };
}

function teacherView(room) {
  const students = [...room.students.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((st) => {
      finalizeStudent(st);
      return { id: st.id, name: st.name, approved: st.approved, mode: modeOf(st.allowed), parts: { 1: partSummary(st, 1), 2: partSummary(st, 2) } };
    });
  return { code: room.code, minutes: room.minutes, mode: modeOf(room.allowed), passScore: PASS_SCORE, students };
}

// ---------- ตัวช่วย HTTP ----------
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 100000) { reject(new HttpError(413, 'ข้อมูลใหญ่เกินไป')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireTeacher(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const exp = tokens.get(t);
  if (!t || !exp || exp < now()) throw new HttpError(401, 'กรุณาเข้าสู่ระบบครูฝึกใหม่');
}

function getRoom(code) {
  const room = rooms.get(String(code || '').trim());
  if (!room) throw new HttpError(404, 'ไม่พบห้องสอบนี้ (อาจถูกปิดแล้ว)');
  return room;
}

function getStudent(room, sid) {
  for (const st of room.students.values()) if (safeEqual(st.sid, sid || '')) return st;
  throw new HttpError(404, 'ไม่พบข้อมูลของท่านในห้องนี้ กรุณาเข้าห้องใหม่');
}

function parseMode(v) {
  if (v === 'both' || v === undefined) return [1, 2];
  if (v === '1') return [1];
  if (v === '2') return [2];
  throw new HttpError(400, 'ตัวเลือกภาคสอบไม่ถูกต้อง');
}
const modeOf = (arr) => (arr.length === 2 ? 'both' : String(arr[0]));

function parseMinutes(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 180) throw new HttpError(400, `เวลา${label}ต้องเป็นตัวเลข 1–180 นาที`);
  return n;
}

// ---------- API ----------
const routes = {
  // ===== ครูฝึก =====
  'POST /api/teacher/login': async (req, res, b) => {
    const ip = clientIp(req);
    const f = loginFails.get(ip);
    if (f && f.n >= 5 && f.until > now()) throw new HttpError(429, 'กรอกรหัสผิดหลายครั้ง กรุณารอ 1 นาทีแล้วลองใหม่');
    if (!safeEqual(b.password || '', TEACHER_PASSWORD)) {
      loginFails.set(ip, { n: (f && f.until > now() ? f.n : 0) + 1, until: now() + 60000 });
      throw new HttpError(401, 'รหัสครูฝึกไม่ถูกต้อง');
    }
    loginFails.delete(ip);
    const token = rid(24);
    tokens.set(token, now() + 12 * 3600 * 1000);
    send(res, 200, { token });
  },

  'POST /api/teacher/room': async (req, res, b) => {
    requireTeacher(req);
    let code;
    do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
    const room = {
      code,
      createdAt: now(),
      minutes: { 1: parseMinutes(b.p1, 'ภาคที่ 1'), 2: parseMinutes(b.p2, 'ภาคที่ 2') },
      allowed: parseMode(b.mode),
      students: new Map(),
    };
    rooms.set(code, room);
    send(res, 200, teacherView(room));
  },

  'GET /api/teacher/room': async (req, res, _b, q) => {
    requireTeacher(req);
    send(res, 200, teacherView(getRoom(q.get('code'))));
  },

  'POST /api/teacher/settings': async (req, res, b) => {
    requireTeacher(req);
    const room = getRoom(b.code);
    room.minutes = { 1: parseMinutes(b.p1, 'ภาคที่ 1'), 2: parseMinutes(b.p2, 'ภาคที่ 2') };
    if (b.mode !== undefined) {
      room.allowed = parseMode(b.mode); // ใช้กับผู้เข้าสอบทุกคนในห้อง (ปรับรายคนต่อได้)
      for (const st of room.students.values()) st.allowed = [...room.allowed];
    }
    send(res, 200, teacherView(room));
  },

  'POST /api/teacher/approve': async (req, res, b) => {
    requireTeacher(req);
    const room = getRoom(b.code);
    if (b.all) {
      for (const st of room.students.values()) st.approved = true;
    } else {
      const st = room.students.get(b.id);
      if (!st) throw new HttpError(404, 'ไม่พบผู้เข้าสอบ');
      st.approved = !!b.allow;
    }
    send(res, 200, teacherView(room));
  },

  'POST /api/teacher/mode': async (req, res, b) => {
    requireTeacher(req);
    const room = getRoom(b.code);
    const st = room.students.get(b.id);
    if (!st) throw new HttpError(404, 'ไม่พบผู้เข้าสอบ');
    st.allowed = parseMode(b.mode);
    send(res, 200, teacherView(room));
  },

  'POST /api/teacher/reset': async (req, res, b) => {
    requireTeacher(req);
    const room = getRoom(b.code);
    const st = room.students.get(b.id);
    if (!st || ![1, 2].includes(Number(b.part))) throw new HttpError(404, 'ไม่พบข้อมูล');
    delete st.attempts[Number(b.part)]; // ให้สอบภาคนั้นใหม่
    send(res, 200, teacherView(room));
  },

  'POST /api/teacher/remove': async (req, res, b) => {
    requireTeacher(req);
    const room = getRoom(b.code);
    room.students.delete(b.id);
    send(res, 200, teacherView(room));
  },

  'POST /api/teacher/close': async (req, res, b) => {
    requireTeacher(req);
    rooms.delete(String(b.code || ''));
    send(res, 200, { ok: true });
  },

  // ===== ผู้เข้าสอบ =====
  'POST /api/join': async (_req, res, b) => {
    const room = getRoom(b.code);
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) throw new HttpError(400, 'กรุณากรอก ยศ - ชื่อ Roblox');
    for (const s of room.students.values()) {
      if (s.name.toLowerCase() === name.toLowerCase()) throw new HttpError(409, 'ชื่อนี้มีผู้ใช้งานในห้องแล้ว (หากเป็นท่านเอง ให้แจ้งครูฝึกลบชื่อเดิมก่อน)');
    }
    const st = { id: rid(4), sid: rid(16), name, approved: false, allowed: [...room.allowed], joinedAt: now(), attempts: {} };
    room.students.set(st.id, st);
    send(res, 200, { code: room.code, sid: st.sid, name: st.name, state: studentView(room, st) });
  },

  'GET /api/state': async (_req, res, _b, q) => {
    const room = getRoom(q.get('code'));
    send(res, 200, studentView(room, getStudent(room, q.get('sid'))));
  },

  'POST /api/start': async (_req, res, b) => {
    const room = getRoom(b.code);
    const st = getStudent(room, b.sid);
    finalizeStudent(st);
    const part = Number(b.part);
    if (![1, 2].includes(part)) throw new HttpError(400, 'ภาคไม่ถูกต้อง');
    if (!st.approved) throw new HttpError(403, 'ครูฝึกยังไม่อนุญาตให้เริ่มสอบ');
    if (!st.allowed.includes(part)) throw new HttpError(403, 'ครูฝึกไม่ได้อนุญาตให้สอบภาคนี้');
    if (runningAttempt(st)) throw new HttpError(409, 'ท่านมีภาคที่กำลังสอบอยู่');
    if (st.attempts[part]) throw new HttpError(409, 'ท่านสอบภาคนี้แล้ว');
    const ms = room.minutes[part] * 60000;
    st.attempts[part] = { part, startedAt: now(), deadline: now() + ms, answers: {}, submitted: false };
    send(res, 200, studentView(room, st));
  },

  'POST /api/answer': async (_req, res, b) => {
    const room = getRoom(b.code);
    const st = getStudent(room, b.sid);
    finalizeStudent(st);
    const a = runningAttempt(st);
    if (!a || now() > a.deadline + GRACE_MS) throw new HttpError(409, 'หมดเวลาหรือส่งข้อสอบแล้ว');
    const q = PART_META[a.part].questions.find((x) => x.id === Number(b.q));
    if (!q || !LETTERS.includes(b.choice)) throw new HttpError(400, 'ข้อมูลคำตอบไม่ถูกต้อง');
    a.answers[q.id] = b.choice;
    send(res, 200, { ok: true });
  },

  'POST /api/submit': async (_req, res, b) => {
    const room = getRoom(b.code);
    const st = getStudent(room, b.sid);
    finalizeStudent(st);
    const a = runningAttempt(st);
    if (a) {
      // รวมคำตอบฉบับสมบูรณ์จากเครื่องผู้สอบ (กันกรณีบันทึกระหว่างทางตกหล่น) ถ้ายังอยู่ในเวลา
      if (b.answers && typeof b.answers === 'object' && now() <= a.deadline + GRACE_MS) {
        for (const q of PART_META[a.part].questions) {
          const c = b.answers[q.id];
          if (LETTERS.includes(c)) a.answers[q.id] = c;
        }
      }
      grade(a, !!b.auto);
    }
    send(res, 200, studentView(room, st));
  },
};

// ---------- ไฟล์หน้าเว็บ ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ไม่พบหน้านี้'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname.startsWith('/api/')) {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) throw new HttpError(404, 'ไม่พบ API');
      const body = req.method === 'POST' ? await readBody(req) : {};
      return await handler(req, res, body, url.searchParams);
    }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'เซิร์ฟเวอร์ผิดพลาด' });
  }
});

// ล้างข้อมูลเก่าและตัดส่งข้อสอบที่หมดเวลา ทุก 15 วินาที
setInterval(() => {
  for (const [code, room] of rooms) {
    if (now() - room.createdAt > 24 * 3600 * 1000) { rooms.delete(code); continue; }
    for (const st of room.students.values()) finalizeStudent(st);
  }
  for (const [t, exp] of tokens) if (exp < now()) tokens.delete(t);
}, 15000).unref();

server.listen(PORT, () => console.log(`ระบบสอบทำงานที่พอร์ต ${PORT}`));
