let T=null,U={},EX=null,CUR=null;
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const call=async(fn,...a)=>{try{const r=await fetch('/api/'+fn,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)});const j=await r.json();if(!j.ok)throw new Error(j.error);return j.data}catch(e){alert(e.message);throw e}};
const bar=()=>`<div class="row sp"><button class="g" onclick="logout()">ออกจากระบบ</button></div>`;
function logout(){T=null;U={};$('#who').textContent='';home()}

/* ---------- Login ---------- */
function home(){app.innerHTML=`<div class="box"><p>เลือกวิธีเข้าใช้งาน</p><div class="row">
<button class="big hi" onclick="ask('student')">เข้าสอบ</button>
<button class="big" onclick="ask('teacher')">ครูฝึก</button>
<button class="big g" onclick="ask('admin')">แอดมิน</button></div></div><div id="f"></div>`}
function ask(r){
 $('#f').innerHTML=`<div class="box">
 ${r!='admin'?'<input id="n" placeholder="ชื่อ-นามสกุล">':''}
 ${r=='student'?'<input id="sid" placeholder="รหัสนักเรียน (ถ้ามี)">':'<input id="c" type="password" placeholder="รหัสผ่าน">'}
 <button onclick="doLogin('${r}')">เข้าสู่ระบบ</button></div>`}
async function doLogin(r){
 const res=await call('login',r,$('#n')?$('#n').value:'',$('#c')?$('#c').value:'');
 T=res.token;U=res;U.sid=$('#sid')?$('#sid').value:'';
 $('#who').textContent=({student:'ผู้เข้าสอบ',teacher:'ครูฝึก',admin:'แอดมิน'})[r]+': '+res.name;
 r=='student'?studentHome():manage();
}

/* ---------- Student ---------- */
async function studentHome(){
 const L=await call('listExams',T);
 app.innerHTML=bar()+(L.length?L.map(e=>`<div class="box row sp"><div><b>${esc(e.title)}</b><div class="mut">${e.count} ข้อ • โดย ${esc(e.owner)}</div></div><button onclick="take('${e.id}')">เริ่มสอบ</button></div>`).join(''):'<div class="box">ยังไม่มีข้อสอบที่เปิดอยู่</div>')}
async function take(id){
 CUR=await call('getExam',T,id);
 app.innerHTML=`<h2>${esc(CUR.title)}</h2>`+CUR.questions.map((q,i)=>`<div class="box"><b>${i+1}. ${esc(q.text)}</b> <span class="mut">(${q.points} คะแนน)</span>
 ${q.type=='choice'?q.options.map((o,j)=>`<label class="opt"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join(''):`<input id="q${i}" placeholder="พิมพ์คำตอบ">`}</div>`).join('')+
 `<button onclick="send()">ส่งข้อสอบ</button>`}
async function send(){
 if(!confirm('ยืนยันส่งข้อสอบ?'))return;
 const a=CUR.questions.map((q,i)=>q.type=='choice'?(($(`input[name=q${i}]:checked`)||{}).value??-1):$('#q'+i).value);
 const r=await call('submitExam',T,CUR.id,U.sid,a);
 app.innerHTML=`<div class="box" style="text-align:center"><div class="mut">คะแนนของคุณ</div><div class="score">${r.score} / ${r.total}</div><p class="mut">ข้อเติมคำตอบที่ไม่มีเฉลย ครูจะตรวจเพิ่มเอง</p><button onclick="studentHome()">กลับหน้าแรก</button></div>`}

/* ---------- Teacher / Admin ---------- */
async function manage(){
 const L=await call('listExams',T);
 app.innerHTML=bar()+`<div class="row"><button onclick="edit()">สร้างข้อสอบใหม่</button>
 <button class="g" onclick="results('all')">${U.role=='admin'?'ผลสอบทั้งหมด':'ผลสอบของฉัน'}</button></div>`+
 (L.length?L.map(e=>`<div class="box"><div class="row sp"><div><b>${esc(e.title)}</b> <span class="tag ${e.status=='open'?'':'off'}">${e.status=='open'?'เปิดสอบ':'ปิดแล้ว'}</span>
 <div class="mut">${e.count} ข้อ • เจ้าของ: ${esc(e.owner)}</div></div>
 <div class="row"><button class="g" onclick="setSt('${e.id}','${e.status=='open'?'closed':'open'}')">${e.status=='open'?'ปิดสอบ':'เปิดสอบ'}</button>
 <button class="g" onclick="editId('${e.id}')">แก้ไข</button><button class="g" onclick="results('${e.id}')">ผลสอบ</button>
 <button class="d" onclick="del('${e.id}')">ลบ</button></div></div></div>`).join(''):'<div class="box">ยังไม่มีข้อสอบ กด “สร้างข้อสอบใหม่” เพื่อเริ่ม</div>');
}
async function setSt(id,s){await call('setStatus',T,id,s);manage()}
async function del(id){if(confirm('ลบข้อสอบนี้?')){await call('deleteExam',T,id);manage()}}
async function editId(id){EX=await call('getExam',T,id);drawEdit()}
function edit(){EX={id:'',title:'',questions:[]};addQ();}
function addQ(){EX.questions.push({type:'choice',text:'',options:['','','',''],answer:0,points:1});drawEdit()}
function setType(i,v){const q=EX.questions[i];q.type=v;q.answer=v=='choice'?0:'';drawEdit()}
function drawEdit(){
 app.innerHTML=`<div class="row sp"><button class="g" onclick="manage()">← ยกเลิก</button><button onclick="save()">บันทึกข้อสอบ</button></div>
 <div class="box"><input value="${esc(EX.title)}" placeholder="ชื่อข้อสอบ" oninput="EX.title=this.value"></div>`+
 EX.questions.map((q,i)=>`<div class="box"><div class="row sp"><b>ข้อ ${i+1}</b><button class="d" onclick="EX.questions.splice(${i},1);drawEdit()">ลบข้อ</button></div>
 <textarea rows="2" placeholder="โจทย์" oninput="EX.questions[${i}].text=this.value">${esc(q.text)}</textarea>
 <select onchange="setType(${i},this.value)"><option value="choice" ${q.type=='choice'?'selected':''}>ปรนัย (เลือกตอบ)</option><option value="text" ${q.type=='text'?'selected':''}>เติมคำตอบสั้น</option></select>
 ${q.type=='choice'?q.options.map((o,j)=>`<div class="opt"><input type="radio" name="a${i}" ${q.answer==j?'checked':''} title="เฉลย" onchange="EX.questions[${i}].answer=${j}"><input value="${esc(o)}" placeholder="ตัวเลือก ${j+1} (ติ๊กวงกลมหน้าข้อที่ถูก)" oninput="EX.questions[${i}].options[${j}]=this.value"></div>`).join('')+`<button class="g" onclick="EX.questions[${i}].options.push('');drawEdit()">+ เพิ่มตัวเลือก</button>`
 :`<input placeholder="เฉลย (เว้นว่าง = ตรวจเอง)" value="${esc(q.answer)}" oninput="EX.questions[${i}].answer=this.value">`}
 <label class="mut">คะแนน <input type="number" min="1" style="width:90px" value="${q.points}" oninput="EX.questions[${i}].points=+this.value"></label></div>`).join('')+
 `<button class="g" onclick="addQ()">+ เพิ่มข้อ</button>`}
async function save(){await call('saveExam',T,EX);manage()}
async function results(id){
 const R=await call('getResults',T,id);
 app.innerHTML=`<button class="g" onclick="manage()">← กลับ</button><h2>ผลสอบ</h2><div class="box tbl">${R.length?`<table><tr><th>เวลา</th><th>ข้อสอบ</th><th>ชื่อ</th><th>รหัส</th><th>คะแนน</th></tr>`+R.map(r=>`<tr><td>${esc(r.time)}</td><td>${esc(r.examTitle)}</td><td>${esc(r.student)}</td><td>${esc(r.studentId)}</td><td>${r.score}/${r.total}</td></tr>`).join('')+'</table>':'ยังไม่มีผู้ส่งข้อสอบ'}</div>`}
home();
