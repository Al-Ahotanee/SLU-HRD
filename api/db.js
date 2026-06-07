const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join('/tmp', 'sges.db');

let _db = null;
let _SQL = null;
let _ready = false;
let _queue = [];

async function initDb() {
  _SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new _SQL.Database(buf);
  } else {
    _db = new _SQL.Database();
  }
  bootstrap();
  _ready = true;
  _queue.forEach(fn => fn());
  _queue = [];
  // Persist every 30s
  setInterval(persist, 30000);
}

function persist() {
  if (!_db) return;
  try { fs.writeFileSync(DB_PATH, Buffer.from(_db.export())); } catch(e) {}
}

function bootstrap() {
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      avatar_initials TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      lecturer_id INTEGER,
      credit_units INTEGER DEFAULT 3,
      level TEXT DEFAULT '100',
      semester TEXT DEFAULT '1st',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      course_id INTEGER,
      enrolled_at TEXT DEFAULT (datetime('now')),
      UNIQUE(student_id, course_id)
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL,
      file_name TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      content TEXT DEFAULT '',
      course_id INTEGER,
      uploaded_by INTEGER,
      downloads INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS repository (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      abstract TEXT DEFAULT '',
      authors TEXT DEFAULT '',
      category TEXT NOT NULL,
      file_name TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      year INTEGER,
      approved INTEGER DEFAULT 0,
      approved_by INTEGER,
      submitted_by INTEGER,
      views INTEGER DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS staff_development (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'training',
      organizer TEXT DEFAULT '',
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      status TEXT DEFAULT 'planned',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target_role TEXT DEFAULT 'all',
      posted_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT DEFAULT '',
      entity_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const admin = get('SELECT id FROM users WHERE email=?', ['admin@sges.edu.ng']);
  if (!admin) {
    seed();
  }
}

function seed() {
  const aHash = bcrypt.hashSync('Admin@1234', 10);
  run('INSERT INTO users (name,email,password_hash,role,department,avatar_initials) VALUES (?,?,?,?,?,?)',
    ['Super Admin','admin@sges.edu.ng',aHash,'admin','Administration','SA']);

  const lHash = bcrypt.hashSync('Lecturer@1234', 10);
  run('INSERT INTO users (name,email,password_hash,role,department,avatar_initials) VALUES (?,?,?,?,?,?)',
    ['Dr. Amina Bello','amina.bello@sges.edu.ng',lHash,'lecturer','Entrepreneurship','AB']);

  const sHash = bcrypt.hashSync('Student@1234', 10);
  run('INSERT INTO users (name,email,password_hash,role,department,avatar_initials) VALUES (?,?,?,?,?,?)',
    ['Ibrahim Musa','ibrahim.musa@sges.edu.ng',sHash,'student','General Studies','IM']);

  const lecId = get('SELECT id FROM users WHERE email=?',['amina.bello@sges.edu.ng']).id;
  const adminId = get('SELECT id FROM users WHERE email=?',['admin@sges.edu.ng']).id;
  const stuId = get('SELECT id FROM users WHERE email=?',['ibrahim.musa@sges.edu.ng']).id;

  const courses = [
    ['Introduction to Entrepreneurship','ENT101','Fundamentals of entrepreneurship and business creation',lecId,3,'100','1st'],
    ['Business Communication','BUS201','Professional communication in business contexts',lecId,2,'200','1st'],
    ['General Studies: Use of English','GST101','Academic writing and communication skills',lecId,2,'100','2nd'],
    ['ICT for Entrepreneurship','ENT301','Applying technology in business environments',lecId,3,'300','2nd'],
  ];
  courses.forEach(c => run('INSERT OR IGNORE INTO courses (title,code,description,lecturer_id,credit_units,level,semester) VALUES (?,?,?,?,?,?,?)',c));

  const c1 = get('SELECT id FROM courses WHERE code=?',['ENT101']);
  if (c1) {
    run('INSERT INTO materials (title,type,content,course_id,uploaded_by,description) VALUES (?,?,?,?,?,?)',
      ['Week 1: Introduction to Entrepreneurship','note','This lecture covers the definition of entrepreneurship, types of entrepreneurs, and the role of entrepreneurship in economic development. Key topics: innovation, risk-taking, value creation.',c1.id,lecId,'Introductory lecture notes']);
    run('INSERT INTO materials (title,type,content,course_id,uploaded_by,description) VALUES (?,?,?,?,?,?)',
      ['Assignment 1: Business Idea Proposal','assignment','Prepare a 2-page business idea proposal covering: problem statement, solution, target market, and revenue model. Submission deadline: end of week 3.',c1.id,lecId,'First assignment']);
  }

  run('INSERT INTO repository (title,abstract,authors,category,keywords,year,approved,approved_by,submitted_by) VALUES (?,?,?,?,?,?,?,?,?)',
    ['Impact of ICT on Learning Outcomes in Nigerian Universities','This study examines how ICT adoption affects academic performance in Nigerian universities...','Amina Bello, Suleiman Dankano','research','ICT, education, Nigeria',2023,1,adminId,lecId]);
  run('INSERT INTO repository (title,abstract,authors,category,keywords,year,approved,approved_by,submitted_by) VALUES (?,?,?,?,?,?,?,?,?)',
    ['Entrepreneurship as a Tool for Youth Empowerment in Northern Nigeria','A comprehensive analysis of entrepreneurship programs targeting youth unemployment...','Dr. Amina Bello','thesis','entrepreneurship, youth, northern Nigeria',2024,1,adminId,lecId]);

  run('INSERT INTO staff_development (user_id,title,type,organizer,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?,?,?)',
    [lecId,'Advanced Teaching Methodologies Workshop','workshop','NUC','2024-03-10','2024-03-12','completed','Covered active learning and flipped classroom models']);
  run('INSERT INTO staff_development (user_id,title,type,organizer,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?,?,?)',
    [lecId,'Google Educator Certification','certification','Google','2024-06-01','2024-06-30','planned','Online self-paced program']);

  run('INSERT INTO announcements (title,body,target_role,posted_by) VALUES (?,?,?,?)',
    ['Welcome to SGES Digital Platform','We are pleased to launch the new integrated HDRRC system. All staff and students can now access courseware, submit documents, and track development activities online.','all',adminId]);
  run('INSERT INTO announcements (title,body,target_role,posted_by) VALUES (?,?,?,?)',
    ['Second Semester Registration Open','Students are reminded to complete course registration for the 2024/2025 second semester before the deadline.','student',adminId]);

  const allCourses = all('SELECT id FROM courses',[]);
  allCourses.forEach(c => {
    try { run('INSERT OR IGNORE INTO enrollments (student_id,course_id) VALUES (?,?)',[stuId,c.id]); } catch(e){}
  });

  persist();
}

// ─── CORE HELPERS ─────────────────────────────────────────────────────────────
function exec(sql) { _db.run(sql); }

function run(sql, params=[]) {
  _db.run(sql, params);
  const r = _db.exec('SELECT last_insert_rowid() as id');
  return r[0] ? { lastInsertRowid: r[0].values[0][0] } : { lastInsertRowid: null };
}

function get(sql, params=[]) {
  const res = _db.exec(sql, params);
  if (!res[0] || !res[0].values[0]) return null;
  const cols = res[0].columns;
  const vals = res[0].values[0];
  const obj = {};
  cols.forEach((c,i) => obj[c] = vals[i]);
  return obj;
}

function all(sql, params=[]) {
  const res = _db.exec(sql, params);
  if (!res[0]) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c,i) => obj[c] = row[i]);
    return obj;
  });
}

// ─── EXPRESS MIDDLEWARE WRAPPER ───────────────────────────────────────────────
function withDb(handler) {
  return (req, res) => {
    if (_ready) return handler(req, res);
    _queue.push(() => handler(req, res));
  };
}

// ─── API METHODS ──────────────────────────────────────────────────────────────
const db = { withDb, run, get, all, exec, persist };

db.getUserByEmail = (email) => get('SELECT * FROM users WHERE email=?', [email]);
db.getUserById = (id) => get('SELECT id,name,email,role,department,phone,bio,avatar_initials,created_at FROM users WHERE id=?', [id]);
db.getAllUsers = (role) => role ? all('SELECT id,name,email,role,department,phone,created_at FROM users WHERE role=? ORDER BY created_at DESC',[role]) : all('SELECT id,name,email,role,department,phone,created_at FROM users ORDER BY created_at DESC',[]);
db.createUser = (data) => {
  const hash = bcrypt.hashSync(data.password, 10);
  const initials = data.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
  const r = run('INSERT INTO users (name,email,password_hash,role,department,phone,avatar_initials) VALUES (?,?,?,?,?,?,?)',
    [data.name, data.email, hash, data.role, data.department||'', data.phone||'', initials]);
  persist();
  return r.lastInsertRowid;
};
db.updateUser = (id, data) => {
  const keys = Object.keys(data);
  if (!keys.length) return;
  run(`UPDATE users SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`, [...keys.map(k=>data[k]), id]);
  persist();
};
db.deleteUser = (id) => { run('DELETE FROM users WHERE id=?',[id]); persist(); };
db.verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

db.getAllCourses = () => all(`
  SELECT c.*,u.name as lecturer_name,
    (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) as enrollment_count,
    (SELECT COUNT(*) FROM materials WHERE course_id=c.id) as material_count
  FROM courses c LEFT JOIN users u ON c.lecturer_id=u.id ORDER BY c.created_at DESC`,[]);
db.getCoursesByLecturer = (lid) => all(`
  SELECT c.*, (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) as enrollment_count,
    (SELECT COUNT(*) FROM materials WHERE course_id=c.id) as material_count
  FROM courses c WHERE c.lecturer_id=? ORDER BY c.created_at DESC`,[lid]);
db.getCoursesByStudent = (sid) => all(`
  SELECT c.*, u.name as lecturer_name,
    (SELECT COUNT(*) FROM materials WHERE course_id=c.id) as material_count
  FROM courses c JOIN enrollments e ON c.id=e.course_id LEFT JOIN users u ON c.lecturer_id=u.id
  WHERE e.student_id=? ORDER BY c.title`,[sid]);
db.createCourse = (data) => {
  const r = run('INSERT INTO courses (title,code,description,lecturer_id,credit_units,level,semester) VALUES (?,?,?,?,?,?,?)',
    [data.title,data.code,data.description||'',data.lecturer_id||null,data.credit_units||3,data.level||'100',data.semester||'1st']);
  persist(); return r.lastInsertRowid;
};
db.updateCourse = (id, data) => {
  const keys = ['title','code','description','lecturer_id','credit_units','level','semester','status'].filter(k=>data[k]!==undefined);
  if (!keys.length) return;
  run(`UPDATE courses SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,[...keys.map(k=>data[k]),id]); persist();
};
db.deleteCourse = (id) => { run('DELETE FROM courses WHERE id=?',[id]); persist(); };

db.getMaterialsByCourse = (cid) => all(`SELECT m.*,u.name as uploader_name FROM materials m LEFT JOIN users u ON m.uploaded_by=u.id WHERE m.course_id=? ORDER BY m.created_at DESC`,[cid]);
db.getAllMaterials = () => all(`SELECT m.*,u.name as uploader_name,c.title as course_title,c.code as course_code FROM materials m LEFT JOIN users u ON m.uploaded_by=u.id LEFT JOIN courses c ON m.course_id=c.id ORDER BY m.created_at DESC`,[]);
db.createMaterial = (data) => {
  const r = run('INSERT INTO materials (title,description,type,file_name,file_size,content,course_id,uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
    [data.title,data.description||'',data.type,data.file_name||'',data.file_size||0,data.content||'',data.course_id,data.uploaded_by]);
  persist(); return r.lastInsertRowid;
};
db.deleteMaterial = (id) => { run('DELETE FROM materials WHERE id=?',[id]); persist(); };
db.incrementDownload = (id) => { run('UPDATE materials SET downloads=downloads+1 WHERE id=?',[id]); persist(); };

db.getRepository = (approved) => {
  if (approved === undefined) return all(`SELECT r.*,u.name as submitter_name FROM repository r LEFT JOIN users u ON r.submitted_by=u.id ORDER BY r.created_at DESC`,[]);
  return all(`SELECT r.*,u.name as submitter_name FROM repository r LEFT JOIN users u ON r.submitted_by=u.id WHERE r.approved=? ORDER BY r.created_at DESC`,[approved?1:0]);
};
db.createRepoEntry = (data) => {
  const r = run('INSERT INTO repository (title,abstract,authors,category,file_name,keywords,year,submitted_by) VALUES (?,?,?,?,?,?,?,?)',
    [data.title,data.abstract||'',data.authors||'',data.category,data.file_name||'',data.keywords||'',data.year||new Date().getFullYear(),data.submitted_by]);
  persist(); return r.lastInsertRowid;
};
db.approveRepo = (id, by) => { run('UPDATE repository SET approved=1,approved_by=? WHERE id=?',[by,id]); persist(); };
db.deleteRepo = (id) => { run('DELETE FROM repository WHERE id=?',[id]); persist(); };
db.incrementRepoDownload = (id) => { run('UPDATE repository SET downloads=downloads+1 WHERE id=?',[id]); persist(); };

db.getStaffDev = (uid) => uid
  ? all('SELECT sd.*,u.name as staff_name FROM staff_development sd JOIN users u ON sd.user_id=u.id WHERE sd.user_id=? ORDER BY sd.created_at DESC',[uid])
  : all('SELECT sd.*,u.name as staff_name,u.department FROM staff_development sd JOIN users u ON sd.user_id=u.id ORDER BY sd.created_at DESC',[]);
db.createStaffDev = (data) => {
  const r = run('INSERT INTO staff_development (user_id,title,type,organizer,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?,?,?)',
    [data.user_id,data.title,data.type||'training',data.organizer||'',data.start_date||'',data.end_date||'',data.status||'planned',data.notes||'']);
  persist(); return r.lastInsertRowid;
};
db.updateStaffDev = (id, data) => {
  const keys = ['title','type','organizer','start_date','end_date','status','notes'].filter(k=>data[k]!==undefined);
  if (!keys.length) return;
  run(`UPDATE staff_development SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,[...keys.map(k=>data[k]),id]); persist();
};
db.deleteStaffDev = (id) => { run('DELETE FROM staff_development WHERE id=?',[id]); persist(); };

db.getAnnouncements = (role) => !role||role==='admin'
  ? all('SELECT a.*,u.name as poster_name FROM announcements a LEFT JOIN users u ON a.posted_by=u.id ORDER BY a.created_at DESC',[])
  : all("SELECT a.*,u.name as poster_name FROM announcements a LEFT JOIN users u ON a.posted_by=u.id WHERE a.target_role='all' OR a.target_role=? ORDER BY a.created_at DESC",[role]);
db.createAnnouncement = (data) => {
  const r = run('INSERT INTO announcements (title,body,target_role,posted_by) VALUES (?,?,?,?)',
    [data.title,data.body,data.target_role||'all',data.posted_by]);
  persist(); return r.lastInsertRowid;
};
db.deleteAnnouncement = (id) => { run('DELETE FROM announcements WHERE id=?',[id]); persist(); };

db.getStats = () => ({
  total_users: (get('SELECT COUNT(*) as n FROM users')||{n:0}).n,
  total_lecturers: (get("SELECT COUNT(*) as n FROM users WHERE role='lecturer'")||{n:0}).n,
  total_students: (get("SELECT COUNT(*) as n FROM users WHERE role='student'")||{n:0}).n,
  total_courses: (get('SELECT COUNT(*) as n FROM courses')||{n:0}).n,
  total_materials: (get('SELECT COUNT(*) as n FROM materials')||{n:0}).n,
  total_repo: (get('SELECT COUNT(*) as n FROM repository')||{n:0}).n,
  pending_repo: (get('SELECT COUNT(*) as n FROM repository WHERE approved=0')||{n:0}).n,
  total_staff_dev: (get('SELECT COUNT(*) as n FROM staff_development')||{n:0}).n,
  enrollments: (get('SELECT COUNT(*) as n FROM enrollments')||{n:0}).n,
});

db.log = (uid, action, entity, eid) => {
  try { run('INSERT INTO activity_log (user_id,action,entity,entity_id) VALUES (?,?,?,?)',[uid,action,entity||'',eid||null]); } catch(e){}
};

db.enrollStudent = (sid, cid) => {
  try { run('INSERT OR IGNORE INTO enrollments (student_id,course_id) VALUES (?,?)',[sid,cid]); persist(); return true; }
  catch(e){ return false; }
};

// Init on load
initDb().catch(e => console.error('DB init failed:', e));

module.exports = db;
