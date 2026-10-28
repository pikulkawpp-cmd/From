const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { APPS_SCRIPT_URL, API_SECRET, TEACHER_CODE, ADMIN_CODE } = process.env;
if (!APPS_SCRIPT_URL || !API_SECRET || !TEACHER_CODE || !ADMIN_CODE) {
  console.error('ต้องตั้ง Environment: APPS_SCRIPT_URL, API_SECRET, TEACHER_CODE, ADMIN_CODE');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const OPEN = new Set(['listExams', 'getExam', 'saveExam', 'setStatus', 'deleteExam', 'submitExam', 'getResults']);
const SESSION_MS = 6 * 60 * 60 * 1000;

/* ---- โทเคนแบบเซ็นลายเซ็น (ไม่ต้องเก็บในหน่วยความจำ รีสตาร์ตแล้วยังใช้ได้) ---- */
const hmac = d => crypto.createHmac('sha256', API_SECRET).update(d).digest('base64url');
const sign = p => { const d = Buffer.from(JSON.stringify(p)).toString('base64url'); return d + '.' + hmac(d); };
function verify(t) {
  try {
    const [d, s] = String(t).split('.');
    const e = hmac(d);
    if (!d || !s || s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
    const p = JSON.parse(Buffer.from(d, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
const same = (a, b) => {
  const h = x => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

/* ---- ล็อกอิน: ตรวจรหัสจาก Environment ของ Render ---- */
const fails = new Map(); // ip -> {n, t}
app.post('/api/login', (req, res) => {
  const [role, name, code] = Array.isArray(req.body) ? req.body : [];
  let f = fails.get(req.ip);
  if (!f || Date.now() - f.t > 15 * 60 * 1000) f = { n: 0, t: Date.now() };
  if (f.n >= 10) return res.status(429).json({ ok: false, error: 'ลองผิดหลายครั้ง กรุณารอ 15 นาที' });

  const bad = msg => { f.n++; fails.set(req.ip, f); return res.json({ ok: false, error: msg }); };
  let n = String(name || '').trim().slice(0, 80);
  if (role === 'teacher' && !same(code, TEACHER_CODE)) return bad('รหัสครูฝึกไม่ถูกต้อง');
  if (role === 'admin' && !same(code, ADMIN_CODE)) return bad('รหัสแอดมินไม่ถูกต้อง');
  if (!['student', 'teacher', 'admin'].includes(role)) return res.status(400).json({ ok: false, error: 'คำขอไม่ถูกต้อง' });
  if (role === 'admin') n = 'admin';
  if (!n) return res.json({ ok: false, error: 'กรุณากรอกชื่อ' });

  const token = sign({ role, name: n, exp: Date.now() + SESSION_MS });
  res.json({ ok: true, data: { token, role, name: n } });
});

/* ---- ฟังก์ชันอื่น: ตรวจโทเคน แล้วส่งต่อให้ Apps Script พร้อมสิทธิ์ที่ยืนยันแล้ว ---- */
app.post('/api/:fn', async (req, res) => {
  const fn = req.params.fn;
  if (!OPEN.has(fn) || !Array.isArray(req.body)) return res.status(400).json({ ok: false, error: 'คำขอไม่ถูกต้อง' });
  const s = verify(req.body[0]);
  if (!s) return res.status(401).json({ ok: false, error: 'หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่' });
  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: API_SECRET, fn, args: req.body, session: { role: s.role, name: s.name } }),
      redirect: 'follow'
    });
    res.json(await r.json());
  } catch (e) {
    console.error(e);
    res.status(502).json({ ok: false, error: 'เชื่อมต่อ Google Sheet ไม่ได้ ลองใหม่อีกครั้ง' });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('running'));
