const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const db = require('./db');

const app = express();
const SECRET = process.env.JWT_SECRET || 'sges-slu-kafin-hausa-2024-secret';

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(h.slice(7), SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}
function staffOnly(req, res, next) {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Staff only' });
  next();
}

// AUTH
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.getUserByEmail(email.toLowerCase().trim());
  if (!user || !db.verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, avatar_initials: user.avatar_initials } });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, department, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  if (!['lecturer','student'].includes(role)) return res.status(400).json({ error: 'Role must be lecturer or student' });
  try {
    const id = db.createUser({ name, email: email.toLowerCase().trim(), password, role, department, phone });
    res.json({ success: true, id });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/me', auth, (req, res) => res.json(db.getUserById(req.user.id)));

// USERS
app.get('/api/users', auth, adminOnly, (req, res) => res.json(db.getAllUsers(req.query.role)));
app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, email, password, role, department, phone } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  try {
    const id = db.createUser({ name, email: email.toLowerCase().trim(), password, role, department, phone });
    res.json({ success: true, id });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email exists' });
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/users/:id', auth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) return res.status(403).json({ error: 'Forbidden' });
  const allowed = ['name','department','phone','bio'];
  const data = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
  db.updateUser(req.params.id, data);
  res.json({ success: true });
});
app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.deleteUser(req.params.id);
  res.json({ success: true });
});

// COURSES
app.get('/api/courses', auth, (req, res) => {
  if (req.user.role === 'admin') return res.json(db.getAllCourses());
  if (req.user.role === 'lecturer') return res.json(db.getCoursesByLecturer(req.user.id));
  res.json(db.getCoursesByStudent(req.user.id));
});
app.get('/api/courses/all', auth, (req, res) => res.json(db.getAllCourses()));
app.post('/api/courses', auth, staffOnly, (req, res) => {
  const { title, code, description, lecturer_id, credit_units, level, semester } = req.body;
  if (!title || !code) return res.status(400).json({ error: 'Title and code required' });
  const lid = req.user.role === 'admin' ? (lecturer_id || req.user.id) : req.user.id;
  try {
    const id = db.createCourse({ title, code: code.toUpperCase(), description, lecturer_id: lid, credit_units, level, semester });
    res.json({ success: true, id });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Code exists' });
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/courses/:id', auth, staffOnly, (req, res) => { db.updateCourse(req.params.id, req.body); res.json({ success: true }); });
app.delete('/api/courses/:id', auth, staffOnly, (req, res) => { db.deleteCourse(req.params.id); res.json({ success: true }); });
app.post('/api/courses/:id/enroll', auth, (req, res) => {
  if (req.user.role !== 'student') return res.status(400).json({ error: 'Students only' });
  db.enrollStudent(req.user.id, parseInt(req.params.id));
  res.json({ success: true });
});

// MATERIALS
app.get('/api/courses/:id/materials', auth, (req, res) => res.json(db.getMaterialsByCourse(req.params.id)));
app.get('/api/materials', auth, (req, res) => res.json(db.getAllMaterials()));
app.post('/api/materials', auth, staffOnly, (req, res) => {
  const { title, description, type, file_name, file_size, content, course_id } = req.body;
  if (!title || !type || !course_id) return res.status(400).json({ error: 'Title, type, course_id required' });
  const id = db.createMaterial({ title, description, type, file_name, file_size, content, course_id, uploaded_by: req.user.id });
  res.json({ success: true, id });
});
app.delete('/api/materials/:id', auth, staffOnly, (req, res) => { db.deleteMaterial(req.params.id); res.json({ success: true }); });
app.post('/api/materials/:id/download', auth, (req, res) => { db.incrementDownload(req.params.id); res.json({ success: true }); });

// REPOSITORY
app.get('/api/repository', auth, (req, res) => {
  const approved = req.user.role === 'admin' ? undefined : true;
  res.json(db.getRepository(approved));
});
app.post('/api/repository', auth, (req, res) => {
  const { title, abstract, authors, category, file_name, keywords, year } = req.body;
  if (!title || !category) return res.status(400).json({ error: 'Title and category required' });
  const id = db.createRepoEntry({ title, abstract, authors, category, file_name, keywords, year, submitted_by: req.user.id });
  res.json({ success: true, id });
});
app.post('/api/repository/:id/approve', auth, adminOnly, (req, res) => { db.approveRepo(req.params.id, req.user.id); res.json({ success: true }); });
app.delete('/api/repository/:id', auth, staffOnly, (req, res) => { db.deleteRepo(req.params.id); res.json({ success: true }); });

// STAFF DEV
app.get('/api/staff-development', auth, (req, res) => {
  const uid = req.user.role === 'admin' ? undefined : req.user.id;
  res.json(db.getStaffDev(uid));
});
app.post('/api/staff-development', auth, staffOnly, (req, res) => {
  const data = { ...req.body, user_id: req.user.role === 'admin' && req.body.user_id ? req.body.user_id : req.user.id };
  const id = db.createStaffDev(data);
  res.json({ success: true, id });
});
app.put('/api/staff-development/:id', auth, staffOnly, (req, res) => { db.updateStaffDev(req.params.id, req.body); res.json({ success: true }); });
app.delete('/api/staff-development/:id', auth, staffOnly, (req, res) => { db.deleteStaffDev(req.params.id); res.json({ success: true }); });

// ANNOUNCEMENTS
app.get('/api/announcements', auth, (req, res) => res.json(db.getAnnouncements(req.user.role)));
app.post('/api/announcements', auth, (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Forbidden' });
  const { title, body, target_role } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  const id = db.createAnnouncement({ title, body, target_role, posted_by: req.user.id });
  res.json({ success: true, id });
});
app.delete('/api/announcements/:id', auth, adminOnly, (req, res) => { db.deleteAnnouncement(req.params.id); res.json({ success: true }); });

// STATS & MISC
app.get('/api/stats', auth, adminOnly, (req, res) => res.json(db.getStats()));
app.get('/api/lecturers', auth, (req, res) => res.json(db.getAllUsers('lecturer').map(u => ({ id: u.id, name: u.name, department: u.department }))));
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Vercel requires module.exports for serverless
module.exports = app;

// Local dev
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`SGES API on :${PORT}`));
}
