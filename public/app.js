const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCREENS = ['home', 'teacher-login', 'teacher-dash', 'student-join', 'student-hub', 'quiz', 'result'];

async function api(path, body, token) {
    const opt = { method: body === undefined ? 'GET' : 'POST', headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    let r, data = {};
    try { r = await fetch(path, opt); } catch { throw Object.assign(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'), { status: 0 }); }
    try { data = await r.json(); } catch { /* ignore */ }
    if (!r.ok) throw Object.assign(new Error(data.error || 'เกิดข้อผิดพลาด'), { status: r.status });
    return data;
}

let pollTimer = null;
function show(name) {
    SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== name));
    $('main-container').classList.toggle('wide', name === 'teacher-dash');
    clearInterval(pollTimer);
    window.scrollTo({ top: 0 });
}
const mmss = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

/* ====================== ครูฝึก ====================== */
const T = { token: sessionStorage.getItem('tt') || '', room: sessionStorage.getItem('tr') || '', last: null, loaded: false };

function showTeacherLogin() {
    if (T.token) return openDash();
    $('t-login-err').textContent = '';
    show('teacher-login');
    $('t-password').focus();
}

async function teacherLogin(e) {
    e.preventDefault();
    try {
        const r = await api('/api/teacher/login', { password: $('t-password').value });
        T.token = r.token;
        sessionStorage.setItem('tt', T.token);
        $('t-password').value = '';
        openDash();
    } catch (err) { $('t-login-err').textContent = err.message; }
}

function teacherLogout() {
    T.token = ''; T.room = ''; T.loaded = false;
    sessionStorage.removeItem('tt'); sessionStorage.removeItem('tr');
    show('home');
}

function openDash() {
    show('teacher-dash');
    const has = !!T.room;
    if (!has) checkBank();
    $('dash-create').classList.toggle('hidden', has);
    $('dash-room').classList.toggle('hidden', !has);
    if (has) {
        $('room-code').textContent = T.room;
        pollTeacher();
        pollTimer = setInterval(pollTeacher, 2000);
    }
}

const bankText = (d) => (d.ok === false
    ? '⚠️ ' + d.error
    : `✅ ภาคที่ 1: ${d.counts[1]} ข้อ • ภาคที่ 2: ${d.counts[2]} ข้อ • แหล่งข้อสอบ: ${d.source === 'sheets' ? 'Google Sheets' : 'ไฟล์สำรองในระบบ (ยังไม่ได้ตั้ง Google Sheets)'}`);

async function checkBank() {
    const el = $('bank-line');
    el.className = 'bank-line'; el.textContent = 'กำลังตรวจข้อสอบ...';
    try {
        const d = await api('/api/teacher/bank', undefined, T.token);
        el.className = 'bank-line ' + (d.ok === false ? 'bad' : 'good');
        el.textContent = bankText(d);
    } catch (err) {
        if (err.status === 401) return teacherLogout();
        el.className = 'bank-line bad'; el.textContent = '⚠️ ' + err.message;
    }
}

async function reloadBank() {
    const el = $('reload-msg');
    el.style.color = ''; el.textContent = 'กำลังโหลด...';
    try {
        T.last = await api('/api/teacher/reload', { code: T.room }, T.token);
        renderTeacher(T.last);
        el.style.color = '#34d399'; el.textContent = 'โหลดข้อสอบล่าสุดแล้ว';
        setTimeout(() => { el.textContent = ''; }, 3000);
    } catch (err) {
        if (err.status === 401) return teacherLogout();
        el.textContent = err.message;
    }
}

async function createRoom() {
    try {
        const d = await api('/api/teacher/room', { p1: $('new-p1').value, p2: $('new-p2').value, mode: $('new-mode').value }, T.token);
        T.room = d.code; T.loaded = false;
        sessionStorage.setItem('tr', T.room);
        openDash();
    } catch (err) {
        if (err.status === 401) return teacherLogout();
        $('create-err').textContent = err.message;
        checkBank();
    }
}

async function pollTeacher() {
    try {
        const d = await api('/api/teacher/room?code=' + encodeURIComponent(T.room), undefined, T.token);
        T.last = d;
        renderTeacher(d);
    } catch (err) {
        if (err.status === 401) teacherLogout();
        else if (err.status === 404) { T.room = ''; sessionStorage.removeItem('tr'); openDash(); }
    }
}

function partCell(p, id, allowed) {
    if (!allowed) return '<span class="dim">— ไม่ได้รับสิทธิ์</span>';
    if (p.status === 'new') return '<span class="dim">ยังไม่สอบ</span>';
    if (p.status === 'running') return `<span class="part-status part-wait">⏱ ${mmss(p.remainingMs)}</span><div class="dim">ตอบแล้ว ${p.answered}/${p.total}</div>`;
    const pass = p.score >= (T.last ? T.last.passScore : 70);
    return `<span class="part-status ${pass ? 'part-pass' : 'part-fail'}">${p.score}/100</span>${p.auto ? '<div class="dim">หมดเวลา</div>' : ''}`
        + `<div><button class="link-btn" data-act="reset" data-id="${id}" data-part="${p.part}">ให้สอบใหม่</button></div>`;
}

function modeSelect(s) {
    const o = (v, t) => `<option value="${v}" ${s.mode === v ? 'selected' : ''}>${t}</option>`;
    return `<select class="mode-select" data-act="mode" data-id="${s.id}">${o('both', 'ทั้ง 2 ภาค')}${o('1', 'เฉพาะภาค 1')}${o('2', 'เฉพาะภาค 2')}</select>`;
}

function renderTeacher(d) {
    // กำลังเลือกสิทธิ์ในตารางอยู่ ห้ามวาดตารางใหม่ (ไม่งั้นเมนูหุบ)
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('mode-select')) return;
    if (!T.loaded) {
        $('set-p1').value = d.minutes[1]; $('set-p2').value = d.minutes[2]; $('set-mode').value = d.mode;
        T.loaded = true;
    }
    $('room-bank').className = 'bank-line good';
    $('room-bank').textContent = bankText(d.bank) + ' • โหลดเมื่อ ' + new Date(d.bank.loadedAt).toLocaleTimeString('th-TH');
    const waiting = d.students.filter((s) => !s.approved).length;
    $('dash-count').textContent = `ผู้เข้าสอบ ${d.students.length} คน • รออนุญาต ${waiting} คน`;
    $('students-body').innerHTML = d.students.length ? d.students.map((s) => {
        s.parts[1].part = 1; s.parts[2].part = 2;
        return `<tr>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${s.approved ? '<span class="part-status part-pass">อนุญาตแล้ว</span>' : '<span class="part-status part-wait">รออนุญาต</span>'}</td>
            <td>${modeSelect(s)}</td>
            <td>${partCell(s.parts[1], s.id, s.mode !== '2')}</td>
            <td>${partCell(s.parts[2], s.id, s.mode !== '1')}</td>
            <td class="act-cell">
                <button class="btn-small ${s.approved ? '' : 'solid'}" data-act="approve" data-id="${s.id}" data-allow="${!s.approved}">${s.approved ? 'ถอนสิทธิ์' : 'อนุญาต'}</button>
                <button class="link-btn danger-text" data-act="remove" data-id="${s.id}">ลบ</button>
            </td></tr>`;
    }).join('') : '<tr><td colspan="6" class="dim" style="text-align:center;padding:24px;">ยังไม่มีผู้เข้าสอบ — แจ้งรหัสห้องให้ผู้เข้าสอบ</td></tr>';
}

async function tPost(path, body) {
    try {
        T.last = await api(path, { code: T.room, ...body }, T.token);
        renderTeacher(T.last);
    } catch (err) {
        if (err.status === 401) teacherLogout(); else alert(err.message);
    }
}

document.addEventListener('click', (e) => {
    const b = e.target.closest('#students-body [data-act]');
    if (!b) return;
    const { act, id, part, allow } = b.dataset;
    if (act === 'approve') tPost('/api/teacher/approve', { id, allow: allow === 'true' });
    if (act === 'reset' && confirm(`ให้ผู้เข้าสอบทำภาคที่ ${part} ใหม่ใช่หรือไม่? คะแนนเดิมของภาคนี้จะถูกลบ`)) tPost('/api/teacher/reset', { id, part });
    if (act === 'remove' && confirm('ลบผู้เข้าสอบคนนี้ออกจากห้อง? ผลสอบของเขาจะหายไป')) tPost('/api/teacher/remove', { id });
});

document.addEventListener('change', (e) => {
    const s = e.target.closest('#students-body select[data-act="mode"]');
    if (s) { s.blur(); tPost('/api/teacher/mode', { id: s.dataset.id, mode: s.value }); }
});

const approveAll = () => tPost('/api/teacher/approve', { all: true });

async function saveSettings() {
    try {
        T.last = await api('/api/teacher/settings', { code: T.room, p1: $('set-p1').value, p2: $('set-p2').value, mode: $('set-mode').value }, T.token);
        $('set-msg').style.color = '#34d399'; $('set-msg').textContent = 'บันทึกเวลาแล้ว';
        setTimeout(() => ($('set-msg').textContent = ''), 2500);
    } catch (err) { $('set-msg').style.color = ''; $('set-msg').textContent = err.message; }
}

async function closeRoom() {
    if (!confirm('ปิดห้องสอบนี้? ข้อมูลผลสอบทั้งหมดจะหายไป (ควรดาวน์โหลด CSV ก่อน)')) return;
    try { await api('/api/teacher/close', { code: T.room }, T.token); } catch { /* ignore */ }
    T.room = ''; T.loaded = false; sessionStorage.removeItem('tr');
    openDash();
}

function exportCsv() {
    if (!T.last) return;
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const cell = (p) => (p.status === 'done' ? p.score : '');
    const rows = [['ยศ-ชื่อ', 'ภาค1', 'ผลภาค1', 'ภาค2', 'ผลภาค2', 'รวม', 'ผลรวม']];
    T.last.students.forEach((s) => {
        const [a, b] = [s.parts[1], s.parts[2]];
        const res = (p) => (p.status !== 'done' ? '-' : p.score >= T.last.passScore ? 'ผ่าน' : 'ไม่ผ่าน');
        const need = s.mode === 'both' ? [a, b] : s.mode === '1' ? [a] : [b];
        const complete = need.every((p) => p.status === 'done');
        const sum = need.reduce((t, p) => t + (p.score || 0), 0);
        const note = s.mode === 'both' ? '' : ` (สอบเฉพาะภาค ${s.mode})`;
        rows.push([s.name, s.mode === '2' ? 'ไม่ได้สอบ' : cell(a), s.mode === '2' ? '-' : res(a), s.mode === '1' ? 'ไม่ได้สอบ' : cell(b), s.mode === '1' ? '-' : res(b),
            complete ? sum : '', complete ? (need.every((p) => p.score >= T.last.passScore) ? 'ผ่านการคัดเลือก' : 'ไม่ผ่าน') + note : 'สอบไม่ครบ' + note]);
    });
    const csv = '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ผลสอบ_ห้อง${T.room}.csv`;
    a.click();
}

/* ====================== ผู้เข้าสอบ ====================== */
let S = JSON.parse(localStorage.getItem('stu') || 'null'); // {code, sid, name}
let state = null;
let quiz = null; // {part, answers, endAt, timer, busy}

function showStudentJoin() {
    if (S) return enterHub();
    $('join-err').textContent = '';
    show('student-join');
}

async function studentJoin(e) {
    e.preventDefault();
    try {
        const r = await api('/api/join', { code: $('join-code').value.trim(), name: $('join-name').value.trim() });
        S = { code: r.code, sid: r.sid, name: r.name };
        localStorage.setItem('stu', JSON.stringify(S));
        state = r.state;
        enterHub();
    } catch (err) { $('join-err').textContent = err.message; }
}

function leaveRoom(silent, msg) {
    if (!silent && !confirm('ออกจากห้องสอบ? (หากยังสอบไม่เสร็จ ต้องให้ครูฝึกลบชื่อเดิมก่อนจึงจะเข้าใหม่ได้)')) return;
    S = null; state = null; localStorage.removeItem('stu');
    show('home');
    if (msg) alert(msg);
}

function enterHub() {
    if (!S) return show('home');
    show('student-hub');
    $('hub-name').textContent = `ผู้สอบ: ${S.name}`;
    $('hub-err').textContent = '';
    loadHub();
    pollTimer = setInterval(loadHub, 2000);
}

async function loadHub() {
    try {
        state = await api(`/api/state?code=${encodeURIComponent(S.code)}&sid=${encodeURIComponent(S.sid)}`);
        if (state.current) return startQuiz(state);
        renderHub(state);
    } catch (err) {
        if (err.status === 404) leaveRoom(true, err.message);
        else $('hub-err').textContent = err.message;
    }
}

function renderHub(st) {
    $('hub-wait').classList.toggle('hidden', st.approved);
    $('hub-parts').classList.toggle('hidden', !st.approved);
    $('hub-result-btn').classList.toggle('hidden', !st.allowed.some((p) => st.parts[p].status === 'done'));
    if (!st.approved) return;
    $('part-cards').innerHTML = st.allowed.map((p) => {
        const m = st.meta[p], r = st.parts[p];
        const body = r.status === 'done'
            ? `<div class="part-score">${r.score} / 100</div><span class="part-status ${r.score >= st.passScore ? 'part-pass' : 'part-fail'}">${r.score >= st.passScore ? 'ผ่านเกณฑ์' : 'ไม่ผ่าน'}</span>`
            : `<button type="button" class="btn-primary-link" onclick="startPart(${p})"><span>เริ่มสอบภาคที่ ${p}</span></button>`;
        return `<div class="part-pick"><div class="part-title">ภาคที่ ${p}: ${esc(m.title)}</div>
            <div class="pick-meta">${m.count} ข้อ • เวลา ${m.minutes} นาที • ผ่านเมื่อได้ ${st.passScore} คะแนนขึ้นไป</div>${body}</div>`;
    }).join('');
}

async function startPart(p) {
    const m = state.meta[p];
    if (!confirm(`เริ่มสอบภาคที่ ${p} (${m.count} ข้อ / ${m.minutes} นาที)?\nเมื่อกดตกลง เวลาจะเริ่มนับทันที`)) return;
    try {
        state = await api('/api/start', { code: S.code, sid: S.sid, part: p });
        startQuiz(state);
    } catch (err) { $('hub-err').textContent = err.message; }
}

function startQuiz(st) {
    if (quiz && quiz.timer) clearInterval(quiz.timer);
    const cur = st.current;
    quiz = { part: cur.part, answers: { ...cur.answers }, endAt: performance.now() + cur.remainingMs, total: cur.questions.length, busy: false };
    show('quiz');
    $('user-greeting').textContent = `ผู้สอบ: ${S.name}`;
    $('timer-part').textContent = `ภาคที่ ${cur.part}: ${st.meta[cur.part].title}`;
    $('quiz-err').textContent = '';
    renderQuiz(cur.questions);
    updateProgress();
    tick();
    quiz.timer = setInterval(tick, 250);
}

function renderQuiz(questions) {
    const c = $('questions-container');
    c.innerHTML = '';
    let sec = '';
    const prefixes = ['ก', 'ข', 'ค', 'ง'];
    questions.forEach((q) => {
        if (q.section !== sec) {
            sec = q.section;
            const h = document.createElement('div');
            h.className = 'section-header';
            h.textContent = sec;
            c.appendChild(h);
        }
        const card = document.createElement('div');
        card.className = 'question-card';
        card.innerHTML = `<div class="question-text">${q.id}. ${esc(q.title)}</div><div class="options">` +
            q.options.map((o, i) => `<label><input type="radio" name="q${q.id}" value="${prefixes[i]}" ${quiz.answers[q.id] === prefixes[i] ? 'checked' : ''}><strong>${prefixes[i]}.</strong>&nbsp;${esc(o)}</label>`).join('') + '</div>';
        card.addEventListener('change', (e) => onAnswer(q.id, e.target.value));
        c.appendChild(card);
    });
}

function onAnswer(qid, val) {
    quiz.answers[qid] = val;
    updateProgress();
    api('/api/answer', { code: S.code, sid: S.sid, q: qid, choice: val }).catch(() => { /* จะส่งซ้ำพร้อมตอนส่งข้อสอบ */ });
}

function updateProgress() {
    $('timer-progress').textContent = `ตอบแล้ว ${Object.keys(quiz.answers).length}/${quiz.total} ข้อ`;
}

function tick() {
    const ms = quiz.endAt - performance.now();
    $('timer-clock').textContent = mmss(ms);
    const bar = $('timer-bar');
    bar.classList.toggle('warn', ms < 300000 && ms >= 60000);
    bar.classList.toggle('danger', ms < 60000);
    if (ms <= 0 && !quiz.busy) submitQuiz(true);
}

async function submitQuiz(auto) {
    if (quiz.busy) return;
    if (!auto) {
        const n = Object.keys(quiz.answers).length;
        const msg = n < quiz.total ? `ท่านยังทำไม่ครบ (ทำไป ${n}/${quiz.total} ข้อ) ต้องการส่งข้อสอบเลยหรือไม่?` : 'ยืนยันส่งข้อสอบ?';
        if (!confirm(msg)) return;
    }
    quiz.busy = true;
    $('submit-btn').disabled = true;
    try {
        state = await api('/api/submit', { code: S.code, sid: S.sid, answers: quiz.answers, auto });
        clearInterval(quiz.timer);
        showResult(state, auto ? 'หมดเวลา ระบบส่งข้อสอบให้อัตโนมัติ' : '');
    } catch (err) {
        quiz.busy = false;
        $('submit-btn').disabled = false;
        $('quiz-err').textContent = err.message + ' — กดส่งข้อสอบอีกครั้ง';
    }
}

function showResultFromState() { showResult(state, ''); }

function showResult(st, note) {
    show('result');
    $('result-name').textContent = `ยศ-ชื่อ: ${S.name}`;
    $('result-note').textContent = note;
    const need = st.allowed;
    let total = 0, done = 0, allPass = true;
    [1, 2].forEach((p) => {
        const r = st.parts[p], sc = $(`part${p}-score-text`), tx = $(`part${p}-status-text`);
        if (!need.includes(p)) {
            sc.textContent = '—';
            tx.className = 'part-status part-wait';
            tx.textContent = 'ไม่ได้อยู่ในสิทธิ์สอบ';
        } else if (r.status === 'done') {
            const pass = r.score >= st.passScore;
            done++; total += r.score; if (!pass) allPass = false;
            sc.textContent = `${r.score} / 100`;
            tx.className = 'part-status ' + (pass ? 'part-pass' : 'part-fail');
            tx.textContent = `${pass ? 'ผ่านเกณฑ์' : 'ไม่ผ่าน'} (ถูก ${r.correct}/${r.total} ข้อ)`;
        } else {
            allPass = false;
            sc.textContent = '- / 100';
            tx.className = 'part-status part-wait';
            tx.textContent = 'ยังไม่ได้สอบ';
        }
    });
    const scope = need.length === 2 ? 'ทั้ง 2 ภาค' : `ภาคที่ ${need[0]}`;
    const badge = $('status-badge');
    badge.style.cssText = 'font-size:16px;padding:12px 20px;';
    if (done < need.length) { badge.className = 'part-status part-wait'; badge.textContent = `สอบแล้ว ${done}/${need.length} ภาค — ต้องสอบให้ครบ${scope}`; }
    else if (allPass) { badge.className = 'part-status part-pass'; badge.textContent = `🎉 ผ่านการคัดเลือก (ผ่านเกณฑ์${scope})`; }
    else { badge.className = 'part-status part-fail'; badge.textContent = `❌ ไม่ผ่านการคัดเลือก (ต้องได้ ${st.passScore} คะแนนขึ้นไปใน${scope})`; }
    const max = need.length * 100;
    $('total-score-box').innerHTML = `${total} <span style="font-size:18px;color:#64748b;">/ ${max}</span>`;
    $('total-percentage-box').textContent = `คิดเป็นคะแนนรวม: ${((total / max) * 100).toFixed(1)}%`;
}

function downloadResultImage() {
    html2canvas($('capture-area'), { scale: 2, useCORS: true, backgroundColor: '#0b1329' }).then((canvas) => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `ผลการสอบ_ครูฝึกนายเรือ_${S ? S.name : ''}.png`;
        link.click();
    });
}

// จำนวนข้อบนหน้าแรกตามข้อสอบจริง
api('/api/info').then((d) => {
    if (d.counts) { $('cnt1').textContent = d.counts[1]; $('cnt2').textContent = d.counts[2]; }
}).catch(() => {});

// เปิดหน้าซ้ำ (รีเฟรช) → กลับเข้าห้องเดิมต่อเวลาเดิม
if (S) enterHub();
