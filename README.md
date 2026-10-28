# ระบบข้อสอบออนไลน์ (Render + Google Sheet)

โครงสร้าง
- `public/` หน้าเว็บ (index.html, style.css, app.js)
- `server.js` Node/Express เสิร์ฟหน้าเว็บ และส่งต่อคำขอ /api ไป Apps Script
- `apps-script/Code.gs` โค้ดที่วางใน Google Sheet (เก็บข้อมูล ตรวจข้อสอบ สิทธิ์ผู้ใช้)

## 1) Google Sheet + Apps Script
1. สร้าง Google Sheet ใหม่ > Extensions > Apps Script วางโค้ดจาก `apps-script/Code.gs`
2. Project Settings > Script properties > เพิ่ม `API_SECRET` = kfdsFDF4fds1g9aFds4
3. รันฟังก์ชัน `setup` หนึ่งครั้ง (อนุญาตสิทธิ์) จะได้แท็บ Exams และ Results
4. Deploy > New deployment > Web app: Execute as = Me, Who has access = Anyone > คัดลอก URL (ลงท้าย /exec)
5. แก้โค้ดภายหลังต้อง Deploy version ใหม่

## 2) GitHub
```
git init && git add . && git commit -m "init"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## 3) Render
New > Web Service > เลือก repo
- Build Command: `npm install`
- Start Command: `npm start`
- Environment (4 ตัว):
  - `APPS_SCRIPT_URL` = URL จากข้อ 1.4
  - `API_SECRET` = ค่าเดียวกับข้อ 1.2
  - `TEACHER_CODE` = รหัสครูฝึก
  - `ADMIN_CODE` = รหัสแอดมิน

เปลี่ยนรหัสภายหลัง: Render > Environment > แก้ค่า > Save (เว็บรีสตาร์ตเอง)

รหัสครูฝึก/แอดมินตั้งใน Render เท่านั้น ไม่มีรหัสเริ่มต้น และไม่ถูกเก็บใน Google Sheet หรือ GitHub
