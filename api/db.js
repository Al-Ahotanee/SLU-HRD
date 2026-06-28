// ─── PERSISTENT DATABASE LAYER (PostgreSQL) ───────────────────────────────────
// Why this replaces the old sql.js + /tmp file approach:
// Vercel serverless functions are stateless and ephemeral. Each invocation can
// land on a brand-new container with its own private /tmp, and multiple
// concurrent invocations can run as separate instances at the same time, each
// with its own copy of an in-memory database. That caused exactly the symptoms
// reported: records appearing then vanishing, different browsers/refreshes
// showing different user counts, and data not surviving logout/login.
// A real external database (Postgres) is shared by every instance and request,
// so all of that goes away. Works great with Neon, Supabase, Railway, or
// Vercel Postgres — anything that gives you a DATABASE_URL.
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it in your Vercel project env vars (Settings → Environment Variables).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
    ? undefined // already specified in the connection string
    : { rejectUnauthorized: false },
});

let _readyPromise = null;

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res;
}

async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

async function run(sql, params = []) {
  const res = await query(sql, params);
  return { lastInsertRowid: res.rows[0] ? res.rows[0].id : null, rowCount: res.rowCount };
}

// Builds "col1=$2, col2=$3" style SET clauses starting at a given param index.
function buildSet(keys, startIndex) {
  return keys.map((k, i) => `${k}=$${startIndex + i}`).join(',');
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      avatar_initials TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      lecturer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      credit_units INTEGER DEFAULT 3,
      level TEXT DEFAULT '100',
      semester TEXT DEFAULT '1st',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      enrolled_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_id, course_id)
    );
    CREATE TABLE IF NOT EXISTS materials (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL,
      file_name TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      content TEXT DEFAULT '',
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      downloads INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS repository (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      abstract TEXT DEFAULT '',
      authors TEXT DEFAULT '',
      category TEXT NOT NULL,
      file_name TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      year INTEGER,
      approved INTEGER DEFAULT 0,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      views INTEGER DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS staff_development (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'training',
      organizer TEXT DEFAULT '',
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      status TEXT DEFAULT 'planned',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target_role TEXT DEFAULT 'all',
      posted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT DEFAULT '',
      entity_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const admin = await get('SELECT id FROM users WHERE email=$1', ['admin@sges.edu.ng']);
  if (!admin) {
    await seed();
  }
}

async function seed() {
  const aHash = bcrypt.hashSync('Admin@1234', 10);
  await run('INSERT INTO users (name,email,password_hash,role,department,avatar_initials) VALUES ($1,$2,$3,$4,$5,$6)',
    ['Super Admin', 'admin@sges.edu.ng', aHash, 'admin', 'Administration', 'SA']);

  const lHash = bcrypt.hashSync('Lecturer@1234', 10);
  await run('INSERT INTO users (name,email,password_hash,role,department,avatar_initials) VALUES ($1,$2,$3,$4,$5,$6)',
    ['Dr. Amina Bello', 'amina.bello@sges.edu.ng', lHash, 'lecturer', 'Entrepreneurship', 'AB']);

  const sHash = bcrypt.hashSync('Student@1234', 10);
  await run('INSERT INTO users (name,email,password_hash,role,department,avatar_initials) VALUES ($1,$2,$3,$4,$5,$6)',
    ['Ibrahim Musa', 'ibrahim.musa@sges.edu.ng', sHash, 'student', 'General Studies', 'IM']);

  const lecId = (await get('SELECT id FROM users WHERE email=$1', ['amina.bello@sges.edu.ng'])).id;
  const adminId = (await get('SELECT id FROM users WHERE email=$1', ['admin@sges.edu.ng'])).id;
  const stuId = (await get('SELECT id FROM users WHERE email=$1', ['ibrahim.musa@sges.edu.ng'])).id;

  const courses = [
    ['Introduction to Entrepreneurship', 'ENT101', 'Fundamentals of entrepreneurship and business creation', lecId, 3, '100', '1st'],
    ['Business Communication', 'BUS201', 'Professional communication in business contexts', lecId, 2, '200', '1st'],
    ['General Studies: Use of English', 'GST101', 'Academic writing and communication skills', lecId, 2, '100', '2nd'],
    ['ICT for Entrepreneurship', 'ENT301', 'Applying technology in business environments', lecId, 3, '300', '2nd'],
  ];
  for (const c of courses) {
    await run('INSERT INTO courses (title,code,description,lecturer_id,credit_units,level,semester) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING', c);
  }

  const c1 = await get('SELECT id FROM courses WHERE code=$1', ['ENT101']);
  if (c1) {
    await run('INSERT INTO materials (title,type,content,course_id,uploaded_by,description) VALUES ($1,$2,$3,$4,$5,$6)',
      ['Week 1: Introduction to Entrepreneurship', 'note', 'This lecture covers the definition of entrepreneurship, types of entrepreneurs, and the role of entrepreneurship in economic development. Key topics: innovation, risk-taking, value creation.', c1.id, lecId, 'Introductory lecture notes']);
    await run('INSERT INTO materials (title,type,content,course_id,uploaded_by,description) VALUES ($1,$2,$3,$4,$5,$6)',
      ['Assignment 1: Business Idea Proposal', 'assignment', 'Prepare a 2-page business idea proposal covering: problem statement, solution, target market, and revenue model. Submission deadline: end of week 3.', c1.id, lecId, 'First assignment']);
  }

  await run('INSERT INTO repository (title,abstract,authors,category,keywords,year,approved,approved_by,submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    ['Impact of ICT on Learning Outcomes in Nigerian Universities', 'This study examines how ICT adoption affects academic performance in Nigerian universities...', 'Amina Bello, Suleiman Dankano', 'research', 'ICT, education, Nigeria', 2023, 1, adminId, lecId]);
  await run('INSERT INTO repository (title,abstract,authors,category,keywords,year,approved,approved_by,submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    ['Entrepreneurship as a Tool for Youth Empowerment in Northern Nigeria', 'A comprehensive analysis of entrepreneurship programs targeting youth unemployment...', 'Dr. Amina Bello', 'thesis', 'entrepreneurship, youth, northern Nigeria', 2024, 1, adminId, lecId]);

  await run('INSERT INTO staff_development (user_id,title,type,organizer,start_date,end_date,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [lecId, 'Advanced Teaching Methodologies Workshop', 'workshop', 'NUC', '2024-03-10', '2024-03-12', 'completed', 'Covered active learning and flipped classroom models']);
  await run('INSERT INTO staff_development (user_id,title,type,organizer,start_date,end_date,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [lecId, 'Google Educator Certification', 'certification', 'Google', '2024-06-01', '2024-06-30', 'planned', 'Online self-paced program']);

  await run('INSERT INTO announcements (title,body,target_role,posted_by) VALUES ($1,$2,$3,$4)',
    ['Welcome to SGES Digital Platform', 'We are pleased to launch the new integrated HDRRC system. All staff and students can now access courseware, submit documents, and track development activities online.', 'all', adminId]);
  await run('INSERT INTO announcements (title,body,target_role,posted_by) VALUES ($1,$2,$3,$4)',
    ['Second Semester Registration Open', 'Students are reminded to complete course registration for the 2024/2025 second semester before the deadline.', 'student', adminId]);

  const allCourses = await all('SELECT id FROM courses', []);
  for (const c of allCourses) {
    await run('INSERT INTO enrollments (student_id,course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [stuId, c.id]);
  }
}

// Ensures the schema/seed exist before the first query of each cold start.
// Cheap on warm invocations since it's just an in-memory promise re-check.
function ready() {
  if (!_readyPromise) _readyPromise = initDb().catch(e => { _readyPromise = null; throw e; });
  return _readyPromise;
}

// ─── EXPRESS MIDDLEWARE WRAPPER ───────────────────────────────────────────────
// Every request waits for the schema/seed check to resolve before running its
// handler. Errors are forwarded to Express's error handler instead of hanging.
function withDb(handler) {
  return (req, res, next) => {
    ready().then(() => handler(req, res, next)).catch(next);
  };
}

// ─── API METHODS ──────────────────────────────────────────────────────────────
const db = { withDb, run, get, all, query, ready };

db.getUserByEmail = (email) => get('SELECT * FROM users WHERE email=$1', [email]);
db.getUserById = (id) => get('SELECT id,name,email,role,department,phone,bio,avatar_initials,created_at FROM users WHERE id=$1', [id]);
db.getAllUsers = (role) => role
  ? all('SELECT id,name,email,role,department,phone,created_at FROM users WHERE role=$1 ORDER BY created_at DESC', [role])
  : all('SELECT id,name,email,role,department,phone,created_at FROM users ORDER BY created_at DESC', []);
db.createUser = async (data) => {
  const hash = bcrypt.hashSync(data.password, 10);
  const initials = data.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const r = await run('INSERT INTO users (name,email,password_hash,role,department,phone,avatar_initials) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [data.name, data.email, hash, data.role, data.department || '', data.phone || '', initials]);
  return r.lastInsertRowid;
};
db.updateUser = async (id, data) => {
  const keys = Object.keys(data);
  if (!keys.length) return;
  await run(`UPDATE users SET ${buildSet(keys, 1)} WHERE id=$${keys.length + 1}`, [...keys.map(k => data[k]), id]);
};
db.deleteUser = (id) => run('DELETE FROM users WHERE id=$1', [id]);
db.verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

db.getAllCourses = () => all(`
  SELECT c.*,u.name as lecturer_name,
    (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) as enrollment_count,
    (SELECT COUNT(*) FROM materials WHERE course_id=c.id) as material_count
  FROM courses c LEFT JOIN users u ON c.lecturer_id=u.id ORDER BY c.created_at DESC`, []);
db.getCoursesByLecturer = (lid) => all(`
  SELECT c.*, (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) as enrollment_count,
    (SELECT COUNT(*) FROM materials WHERE course_id=c.id) as material_count
  FROM courses c WHERE c.lecturer_id=$1 ORDER BY c.created_at DESC`, [lid]);
db.getCoursesByStudent = (sid) => all(`
  SELECT c.*, u.name as lecturer_name,
    (SELECT COUNT(*) FROM materials WHERE course_id=c.id) as material_count
  FROM courses c JOIN enrollments e ON c.id=e.course_id LEFT JOIN users u ON c.lecturer_id=u.id
  WHERE e.student_id=$1 ORDER BY c.title`, [sid]);
db.createCourse = async (data) => {
  const r = await run('INSERT INTO courses (title,code,description,lecturer_id,credit_units,level,semester) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [data.title, data.code, data.description || '', data.lecturer_id || null, data.credit_units || 3, data.level || '100', data.semester || '1st']);
  return r.lastInsertRowid;
};
db.updateCourse = async (id, data) => {
  const keys = ['title', 'code', 'description', 'lecturer_id', 'credit_units', 'level', 'semester', 'status'].filter(k => data[k] !== undefined);
  if (!keys.length) return;
  await run(`UPDATE courses SET ${buildSet(keys, 1)} WHERE id=$${keys.length + 1}`, [...keys.map(k => data[k]), id]);
};
db.deleteCourse = (id) => run('DELETE FROM courses WHERE id=$1', [id]);

db.getMaterialsByCourse = (cid) => all(`SELECT m.*,u.name as uploader_name FROM materials m LEFT JOIN users u ON m.uploaded_by=u.id WHERE m.course_id=$1 ORDER BY m.created_at DESC`, [cid]);
db.getAllMaterials = () => all(`SELECT m.*,u.name as uploader_name,c.title as course_title,c.code as course_code FROM materials m LEFT JOIN users u ON m.uploaded_by=u.id LEFT JOIN courses c ON m.course_id=c.id ORDER BY m.created_at DESC`, []);
db.createMaterial = async (data) => {
  const r = await run('INSERT INTO materials (title,description,type,file_name,file_size,content,course_id,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [data.title, data.description || '', data.type, data.file_name || '', data.file_size || 0, data.content || '', data.course_id, data.uploaded_by]);
  return r.lastInsertRowid;
};
db.deleteMaterial = (id) => run('DELETE FROM materials WHERE id=$1', [id]);
db.incrementDownload = (id) => run('UPDATE materials SET downloads=downloads+1 WHERE id=$1', [id]);

db.getRepository = (approved) => {
  if (approved === undefined) return all(`SELECT r.*,u.name as submitter_name FROM repository r LEFT JOIN users u ON r.submitted_by=u.id ORDER BY r.created_at DESC`, []);
  return all(`SELECT r.*,u.name as submitter_name FROM repository r LEFT JOIN users u ON r.submitted_by=u.id WHERE r.approved=$1 ORDER BY r.created_at DESC`, [approved ? 1 : 0]);
};
db.createRepoEntry = async (data) => {
  const r = await run('INSERT INTO repository (title,abstract,authors,category,file_name,keywords,year,submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [data.title, data.abstract || '', data.authors || '', data.category, data.file_name || '', data.keywords || '', data.year || new Date().getFullYear(), data.submitted_by]);
  return r.lastInsertRowid;
};
db.approveRepo = (id, by) => run('UPDATE repository SET approved=1,approved_by=$1 WHERE id=$2', [by, id]);
db.deleteRepo = (id) => run('DELETE FROM repository WHERE id=$1', [id]);
db.incrementRepoDownload = (id) => run('UPDATE repository SET downloads=downloads+1 WHERE id=$1', [id]);

db.getStaffDev = (uid) => uid
  ? all('SELECT sd.*,u.name as staff_name FROM staff_development sd JOIN users u ON sd.user_id=u.id WHERE sd.user_id=$1 ORDER BY sd.created_at DESC', [uid])
  : all('SELECT sd.*,u.name as staff_name,u.department FROM staff_development sd JOIN users u ON sd.user_id=u.id ORDER BY sd.created_at DESC', []);
db.createStaffDev = async (data) => {
  const r = await run('INSERT INTO staff_development (user_id,title,type,organizer,start_date,end_date,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [data.user_id, data.title, data.type || 'training', data.organizer || '', data.start_date || '', data.end_date || '', data.status || 'planned', data.notes || '']);
  return r.lastInsertRowid;
};
db.updateStaffDev = async (id, data) => {
  const keys = ['title', 'type', 'organizer', 'start_date', 'end_date', 'status', 'notes'].filter(k => data[k] !== undefined);
  if (!keys.length) return;
  await run(`UPDATE staff_development SET ${buildSet(keys, 1)} WHERE id=$${keys.length + 1}`, [...keys.map(k => data[k]), id]);
};
db.deleteStaffDev = (id) => run('DELETE FROM staff_development WHERE id=$1', [id]);

db.getAnnouncements = (role) => (!role || role === 'admin')
  ? all('SELECT a.*,u.name as poster_name FROM announcements a LEFT JOIN users u ON a.posted_by=u.id ORDER BY a.created_at DESC', [])
  : all("SELECT a.*,u.name as poster_name FROM announcements a LEFT JOIN users u ON a.posted_by=u.id WHERE a.target_role='all' OR a.target_role=$1 ORDER BY a.created_at DESC", [role]);
db.createAnnouncement = async (data) => {
  const r = await run('INSERT INTO announcements (title,body,target_role,posted_by) VALUES ($1,$2,$3,$4) RETURNING id',
    [data.title, data.body, data.target_role || 'all', data.posted_by]);
  return r.lastInsertRowid;
};
db.deleteAnnouncement = (id) => run('DELETE FROM announcements WHERE id=$1', [id]);

db.getStats = async () => {
  const [totalUsers, totalLecturers, totalStudents, totalCourses, totalMaterials, totalRepo, pendingRepo, totalStaffDev, enrollments] = await Promise.all([
    get('SELECT COUNT(*) as n FROM users'),
    get("SELECT COUNT(*) as n FROM users WHERE role='lecturer'"),
    get("SELECT COUNT(*) as n FROM users WHERE role='student'"),
    get('SELECT COUNT(*) as n FROM courses'),
    get('SELECT COUNT(*) as n FROM materials'),
    get('SELECT COUNT(*) as n FROM repository'),
    get('SELECT COUNT(*) as n FROM repository WHERE approved=0'),
    get('SELECT COUNT(*) as n FROM staff_development'),
    get('SELECT COUNT(*) as n FROM enrollments'),
  ]);
  return {
    total_users: Number(totalUsers.n),
    total_lecturers: Number(totalLecturers.n),
    total_students: Number(totalStudents.n),
    total_courses: Number(totalCourses.n),
    total_materials: Number(totalMaterials.n),
    total_repo: Number(totalRepo.n),
    pending_repo: Number(pendingRepo.n),
    total_staff_dev: Number(totalStaffDev.n),
    enrollments: Number(enrollments.n),
  };
};

db.log = async (uid, action, entity, eid) => {
  try { await run('INSERT INTO activity_log (user_id,action,entity,entity_id) VALUES ($1,$2,$3,$4)', [uid, action, entity || '', eid || null]); } catch (e) {}
};

db.enrollStudent = async (sid, cid) => {
  try { await run('INSERT INTO enrollments (student_id,course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sid, cid]); return true; }
  catch (e) { return false; }
};

module.exports = db;
