const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { createNotification, broadcastToStudents } = require('../utils/notify');
const { avatarUpload } = require('../utils/upload');

// Apply admin authorization to all routes in this file
router.use(requireAdmin);

// Ensure tenant context is set for all admin queries
router.use((req, res, next) => {
  req.tenantId = req.tenantId || (req.session.user && req.session.user.tenantId) || 'tenant_default';
  next();
});

/**
 * GET /admin/dashboard
 */
router.get('/dashboard', (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const tenantId = req.tenantId || 'tenant_default';

  // 1. Total students
  const totalStudents = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'student' AND tenant_id = ?").get(tenantId).count;

  // 2. Total books & total copies
  const bookStats = db.prepare(`
    SELECT 
      COUNT(*) AS totalTitles, 
      COALESCE(SUM(total_copies), 0) AS totalCopies,
      COALESCE(SUM(available_copies), 0) AS availableCopies
    FROM books
    WHERE tenant_id = ?
  `).get(tenantId);

  // 3. Books currently issued & overdue
  const issuedStats = db.prepare(`
    SELECT 
      COUNT(*) AS totalIssued,
      SUM(CASE WHEN due_date < ? AND status = 'Issued' THEN 1 ELSE 0 END) AS overdueCount
    FROM book_issues
    WHERE status = 'Issued' AND tenant_id = ?
  `).get(todayStr, tenantId);

  // 4. Campus-wide average attendance
  const attendanceStats = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present
    FROM attendance
    WHERE tenant_id = ?
  `).get(tenantId);

  const averageAttendance = attendanceStats.total > 0
    ? Math.round((attendanceStats.present / attendanceStats.total) * 100)
    : 0;

  // 5. Recent student registrations
  const recentStudents = db.prepare(`
    SELECT id, name, email, roll_no, course, created_at 
    FROM users 
    WHERE role = 'student' AND tenant_id = ?
    ORDER BY id DESC 
    LIMIT 5
  `).all(tenantId);

  // 6. Currently issued books with student info
  const recentIssuedBooks = db.prepare(`
    SELECT 
      bi.id, bi.issue_date, bi.due_date, bi.status,
      b.title, b.author,
      u.name AS student_name, u.roll_no
    FROM book_issues bi
    JOIN books b ON bi.book_id = b.id
    JOIN users u ON bi.student_id = u.id
    WHERE bi.status = 'Issued' AND bi.tenant_id = ?
    ORDER BY bi.due_date ASC
    LIMIT 6
  `).all(tenantId).map(item => ({
    ...item,
    isOverdue: item.due_date < todayStr
  }));

  res.render('admin/dashboard', {
    title: 'Admin Dashboard - College Portal',
    pageName: 'dashboard',
    stats: {
      totalStudents,
      totalBooks: bookStats.totalCopies,
      totalTitles: bookStats.totalTitles,
      booksIssued: issuedStats.totalIssued || 0,
      overdueCount: issuedStats.overdueCount || 0,
      averageAttendance
    },
    recentStudents,
    recentIssuedBooks
  });
});

/**
 * ==========================================
 * STUDENT MANAGEMENT
 * ==========================================
 */

// GET /admin/students - List students
router.get('/students', (req, res) => {
  const tenantId = req.tenantId || 'tenant_default';
  const searchQuery = (req.query.q || '').trim();
  let query = `SELECT * FROM users WHERE role = 'student' AND tenant_id = ?`;
  let params = [tenantId];

  if (searchQuery) {
    query += ` AND (name LIKE ? OR email LIKE ? OR roll_no LIKE ? OR course LIKE ?)`;
    const searchPattern = `%${searchQuery}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }
  query += ` ORDER BY id DESC`;

  const students = db.prepare(query).all(...params);

  res.render('admin/students', {
    title: 'Manage Students - Admin Portal',
    pageName: 'students',
    students,
    searchQuery,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /admin/students/add - Create a student
router.post('/students/add', (req, res) => {
  const { name, email, password, roll_no, course } = req.body;

  if (!name || !email || !password || !roll_no || !course) {
    return res.redirect('/admin/students?error=' + encodeURIComponent('All fields are required.'));
  }

  try {
    const tenantId = req.tenantId || 'tenant_default';
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR (LOWER(roll_no) = LOWER(?) AND tenant_id = ?)')
      .get(email.trim(), roll_no.trim(), tenantId);
    if (existing) {
      return res.redirect('/admin/students?error=' + encodeURIComponent('Email or Roll Number already exists.'));
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    db.prepare(`
      INSERT INTO users (tenant_id, name, email, password, role, roll_no, course)
      VALUES (?, ?, ?, ?, 'student', ?, ?)
    `).run(tenantId, name.trim(), email.trim().toLowerCase(), hash, roll_no.trim().toUpperCase(), course.trim());

    res.redirect('/admin/students?success=' + encodeURIComponent('Student added successfully!'));
  } catch (err) {
    console.error('Add student error:', err);
    res.redirect('/admin/students?error=' + encodeURIComponent('Failed to add student.'));
  }
});

// POST /admin/students/edit/:id - Update student details with credential edit protection
router.post('/students/edit/:id', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const { name, email, roll_no, course, admin_password } = req.body;
  const actingAdmin = req.session.user;

  if (!name || !email || !roll_no || !course) {
    return res.redirect('/admin/students?error=' + encodeURIComponent('All fields are required.'));
  }

  try {
    const tenantId = req.tenantId || 'tenant_default';
    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student' AND tenant_id = ?").get(studentId, tenantId);
    if (!student) {
      return res.redirect('/admin/students?error=' + encodeURIComponent('Student record not found.'));
    }

    const emailChanged = email.trim().toLowerCase() !== student.email.toLowerCase();

    // Credential Protection: changing email requires acting admin's current password
    if (emailChanged) {
      if (!admin_password) {
        return res.redirect('/admin/students?error=' + encodeURIComponent('Security Confirmation Required: Enter your Admin Password to change a student email.'));
      }

      const actingUser = db.prepare("SELECT password FROM users WHERE id = ?").get(actingAdmin.id);
      if (!bcrypt.compareSync(admin_password, actingUser.password)) {
        logAudit(
          actingAdmin.id,
          'Unauthorized Credential Edit Attempt',
          `Admin ${actingAdmin.email} provided invalid password attempting to change email for student ${student.name} (ID: ${studentId}).`,
          studentId
        );
        return res.redirect('/admin/students?error=' + encodeURIComponent('Security Verification Failed: Incorrect Admin Password. Email change aborted.'));
      }
    }

    // Check if email/roll belongs to another user
    const conflict = db.prepare(`
      SELECT id FROM users 
      WHERE (LOWER(email) = LOWER(?) OR (LOWER(roll_no) = LOWER(?) AND tenant_id = ?)) AND id != ?
    `).get(email.trim(), roll_no.trim(), tenantId, studentId);

    if (conflict) {
      return res.redirect('/admin/students?error=' + encodeURIComponent('Email or Roll Number is already used by another student.'));
    }

    db.prepare(`
      UPDATE users 
      SET name = ?, email = ?, roll_no = ?, course = ?
      WHERE id = ? AND role = 'student' AND tenant_id = ?
    `).run(name.trim(), email.trim().toLowerCase(), roll_no.trim().toUpperCase(), course.trim(), studentId, tenantId);

    if (emailChanged) {
      logAudit(
        actingAdmin.id,
        'Student Email Changed',
        `Admin ${actingAdmin.email} changed email for student ${student.name} from "${student.email}" to "${email.trim().toLowerCase()}".`,
        studentId
      );
    } else {
      logAudit(
        actingAdmin.id,
        'Student Profile Updated',
        `Admin ${actingAdmin.email} updated profile details for student ${student.name} (${student.roll_no}).`,
        studentId
      );
    }

    res.redirect('/admin/students?success=' + encodeURIComponent('Student details updated successfully!'));
  } catch (err) {
    console.error('Edit student error:', err);
    res.redirect('/admin/students?error=' + encodeURIComponent('Failed to update student: ' + err.message));
  }
});

// POST /admin/students/reset-password/:id - Reset student password (requires acting admin password)
router.post('/students/reset-password/:id', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const tenantId = req.tenantId || 'tenant_default';
  const { new_password, admin_password } = req.body;
  const actingAdmin = req.session.user;

  if (!new_password || !admin_password) {
    return res.redirect('/admin/students?error=' + encodeURIComponent('Both new student password and your admin password are required.'));
  }

  if (new_password.length < 6) {
    return res.redirect('/admin/students?error=' + encodeURIComponent('New student password must be at least 6 characters long.'));
  }

  try {
    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(studentId);
    if (!student) {
      return res.redirect('/admin/students?error=' + encodeURIComponent('Student not found.'));
    }

    // Verify acting admin's password
    const actingUser = db.prepare("SELECT password FROM users WHERE id = ?").get(actingAdmin.id);
    if (!bcrypt.compareSync(admin_password, actingUser.password)) {
      logAudit(
        actingAdmin.id,
        'Unauthorized Password Reset Attempt',
        `Admin ${actingAdmin.email} provided invalid admin password attempting to reset password for student ${student.name} (ID: ${studentId}).`,
        studentId
      );
      return res.redirect('/admin/students?error=' + encodeURIComponent('Security Verification Failed: Incorrect Admin Password. Password reset aborted.'));
    }

    // Hash new password and update
    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(new_password, salt);

    db.prepare("UPDATE users SET password = ? WHERE id = ? AND role = 'student' AND tenant_id = ?").run(newHash, studentId, tenantId);

    // Audit log (NEVER log the actual password value)
    logAudit(
      actingAdmin.id,
      'Student Password Reset',
      `Admin ${actingAdmin.email} reset login password for student ${student.name} (${student.email}, Roll: ${student.roll_no}).`,
      studentId
    );

    res.redirect('/admin/students?success=' + encodeURIComponent(`Password for student ${student.name} was successfully reset.`));
  } catch (err) {
    console.error('Reset student password error:', err);
    res.redirect('/admin/students?error=' + encodeURIComponent('Failed to reset student password: ' + err.message));
  }
});

// POST /admin/students/delete/:id - Delete student
router.post('/students/delete/:id', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const tenantId = req.tenantId || 'tenant_default';
  const actingAdmin = req.session.user;
  try {
    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student' AND tenant_id = ?").get(studentId, tenantId);
    if (student) {
      db.prepare("DELETE FROM users WHERE id = ? AND role = 'student' AND tenant_id = ?").run(studentId, tenantId);
      logAudit(
        actingAdmin.id,
        'Student Record Deleted',
        `Admin ${actingAdmin.email} permanently deleted student ${student.name} (${student.email}, Roll: ${student.roll_no}).`,
        studentId
      );
    }
    res.redirect('/admin/students?success=' + encodeURIComponent('Student deleted successfully.'));
  } catch (err) {
    console.error('Delete student error:', err);
    res.redirect('/admin/students?error=' + encodeURIComponent('Failed to delete student.'));
  }
});

// GET /admin/students/:id - View 360 Student Profile
router.get('/students/:id', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const tenantId = req.tenantId || 'tenant_default';
  const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student' AND tenant_id = ?").get(studentId, tenantId);

  if (!student) {
    return res.status(404).render('error', {
      statusCode: 404,
      title: 'Student Not Found',
      message: 'No student matches the provided identifier.',
      user: req.session.user
    });
  }

  // Attendance breakdown
  const attendanceStats = db.prepare(`
    SELECT 
      subject,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS missed
    FROM attendance
    WHERE student_id = ?
    GROUP BY subject
  `).all(studentId);

  let totalClasses = 0;
  let totalPresent = 0;
  const attendanceWithPercentages = attendanceStats.map(s => {
    totalClasses += s.total;
    totalPresent += s.attended;
    return {
      ...s,
      percentage: s.total > 0 ? Math.round((s.attended / s.total) * 100) : 0
    };
  });

  const overallAttendance = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;

  // Results
  const results = db.prepare(`
    SELECT * FROM results 
    WHERE student_id = ? 
    ORDER BY id DESC
  `).all(studentId).map(r => ({
    ...r,
    percentage: Math.round((r.marks_obtained / r.max_marks) * 100)
  }));

  // Issued books
  const todayStr = new Date().toISOString().split('T')[0];
  const books = db.prepare(`
    SELECT bi.*, b.title, b.author
    FROM book_issues bi
    JOIN books b ON bi.book_id = b.id
    WHERE bi.student_id = ?
    ORDER BY bi.issue_date DESC
  `).all(studentId).map(b => ({
    ...b,
    isOverdue: b.status === 'Issued' && b.due_date < todayStr
  }));

  // Quiz attempts
  const quizAttempts = db.prepare(`
    SELECT qa.*, q.title AS quiz_title
    FROM quiz_attempts qa
    JOIN quizzes q ON qa.quiz_id = q.id
    WHERE qa.student_id = ?
    ORDER BY qa.attempted_at DESC
  `).all(studentId);

  res.render('admin/student-detail', {
    title: `Student Profile: ${student.name}`,
    pageName: 'students',
    student,
    overallAttendance,
    attendanceStats: attendanceWithPercentages,
    results,
    books,
    quizAttempts
  });
});

/**
 * ==========================================
 * ATTENDANCE MANAGEMENT
 * ==========================================
 */

// GET /admin/attendance
router.get('/attendance', (req, res) => {
  const selectedDate = req.query.date || new Date().toISOString().split('T')[0];
  const selectedSubject = req.query.subject || 'Data Structures & Algorithms';

  const tenantId = req.tenantId || 'tenant_default';
  // Get all active students
  const students = db.prepare(`
    SELECT id, name, roll_no, course 
    FROM users 
    WHERE role = 'student' AND tenant_id = ?
    ORDER BY roll_no ASC
  `).all(tenantId);

  // Get attendance status for selected subject and date
  const existingRecords = db.prepare(`
    SELECT student_id, status 
    FROM attendance 
    WHERE subject = ? AND date = ? AND tenant_id = ?
  `).all(selectedSubject, selectedDate, tenantId);

  const statusMap = {};
  existingRecords.forEach(r => {
    statusMap[r.student_id] = r.status;
  });

  const studentsWithStatus = students.map(st => ({
    ...st,
    status: statusMap[st.id] || 'Present' // Default to Present for convenience
  }));

  // Subjects list
  const subjects = [
    'Data Structures & Algorithms',
    'Database Management Systems',
    'Operating Systems',
    'Computer Networks',
    'Web Technologies',
    'Software Engineering',
    'Artificial Intelligence'
  ];

  // Recent attendance entries for overview table
  const recentLogs = db.prepare(`
    SELECT 
      subject, date,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS presentCount,
      SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absentCount
    FROM attendance
    WHERE tenant_id = ?
    GROUP BY subject, date
    ORDER BY date DESC, subject ASC
    LIMIT 10
  `).all(tenantId);

  // Active check-in sessions
  const activeSessions = db.prepare(`
    SELECT s.*, u.name AS creator_name,
      CAST((julianday(valid_until) - julianday('now')) * 1440 AS INTEGER) AS minutes_remaining
    FROM attendance_sessions s
    JOIN users u ON s.created_by = u.id
    WHERE s.valid_until > datetime('now') AND s.tenant_id = ?
    ORDER BY s.id DESC
  `).all(tenantId);

  res.render('admin/attendance', {
    title: 'Manage Attendance - Admin Portal',
    pageName: 'attendance',
    students: studentsWithStatus,
    selectedDate,
    selectedSubject,
    subjects,
    recentLogs,
    activeSessions,
    isAlreadyMarked: existingRecords.length > 0,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /admin/attendance - Bulk mark/update attendance
router.post('/attendance', (req, res) => {
  const { date, subject } = req.body;

  if (!date || !subject) {
    return res.redirect('/admin/attendance?error=' + encodeURIComponent('Date and subject are required.'));
  }

  try {
    const tenantId = req.tenantId || 'tenant_default';
    const students = db.prepare("SELECT id FROM users WHERE role = 'student' AND tenant_id = ?").all(tenantId);

    // Use a transaction for fast & consistent bulk updates
    const saveTransaction = db.transaction(() => {
      // Remove any existing records for this subject and date to prevent duplicate entries
      db.prepare("DELETE FROM attendance WHERE subject = ? AND date = ? AND tenant_id = ?").run(subject, date, tenantId);

      const insert = db.prepare(`
        INSERT INTO attendance (tenant_id, student_id, subject, date, status)
        VALUES (?, ?, ?, ?, ?)
      `);

      students.forEach(st => {
        // Flat status_<id> extraction directly from req.body
        const rawStatus = req.body[`status_${st.id}`];
        
        // Strictly match selection: if 'Absent' then 'Absent', else 'Present'
        const status = (rawStatus && String(rawStatus).trim().toLowerCase() === 'absent') ? 'Absent' : 'Present';
        insert.run(tenantId, st.id, subject, date, status);
      });
    });

    saveTransaction();

    logAudit(req.session.user.id, 'Saved Roll Call Attendance', `Subject: ${subject}, Date: ${date}, Students: ${students.length}`);

    res.redirect(`/admin/attendance?date=${encodeURIComponent(date)}&subject=${encodeURIComponent(subject)}&success=` + encodeURIComponent('Attendance records saved successfully!'));
  } catch (err) {
    console.error('[Admin:SaveAttendance] Error:', err.message);
    res.redirect('/admin/attendance?error=' + encodeURIComponent('Failed to save attendance records.'));
  }
});

// POST /admin/attendance/start-session - Start 15-minute live self check-in session
router.post('/attendance/start-session', (req, res) => {
  const { subject, date } = req.body;
  if (!subject || !date) {
    return res.redirect('/admin/attendance?error=' + encodeURIComponent('Subject and date are required to start a session.'));
  }

  try {
    const initials = subject.split(' ').map(w => w[0]).join('').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'CLS';
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const sessionCode = `${initials}-${randNum}`;

    db.prepare(`
      INSERT INTO attendance_sessions (subject, session_code, created_by, date, valid_from, valid_until)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+15 minutes'))
    `).run(subject, sessionCode, req.session.user.id, date);

    logAudit(req.session.user.id, 'Started Check-In Session', `Code: ${sessionCode}, Subject: ${subject}, Date: ${date} (Valid 15m)`);
    broadcastToStudents(`Live attendance check-in session started for ${subject}! Code: ${sessionCode} (Valid 15m)`, 'attendance');

    res.redirect(`/admin/attendance?date=${encodeURIComponent(date)}&subject=${encodeURIComponent(subject)}&success=` + encodeURIComponent(`Active check-in session started! Code: ${sessionCode}`));
  } catch (err) {
    console.error('[Admin:StartSession]', err.message);
    res.redirect('/admin/attendance?error=' + encodeURIComponent('Failed to generate attendance session code.'));
  }
});

// POST /admin/attendance/end-session/:id - End check-in session early
router.post('/attendance/end-session/:id', (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  try {
    const tenantId = req.tenantId || 'tenant_default';
    const session = db.prepare("SELECT * FROM attendance_sessions WHERE id = ? AND tenant_id = ?").get(sessionId, tenantId);
    if (session) {
      db.prepare("UPDATE attendance_sessions SET valid_until = datetime('now', '-1 second') WHERE id = ? AND tenant_id = ?").run(sessionId, tenantId);
      logAudit(req.session.user.id, 'Ended Check-In Session', `Code: ${session.session_code}, Subject: ${session.subject}`);
    }
    res.redirect('/admin/attendance?success=' + encodeURIComponent('Attendance check-in session ended.'));
  } catch (err) {
    console.error('[Admin:EndSession]', err.message);
    res.redirect('/admin/attendance?error=' + encodeURIComponent('Failed to end session.'));
  }
});

/**
 * ==========================================
 * RESULTS MANAGEMENT
 * ==========================================
 */

// GET /admin/results
router.get('/results', (req, res) => {
  const filterStudent = req.query.student_id ? parseInt(req.query.student_id, 10) : null;
  const filterSubject = req.query.subject || '';

  let query = `
    SELECT r.*, u.name AS student_name, u.roll_no, u.course
    FROM results r
    JOIN users u ON r.student_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (filterStudent) {
    query += ` AND r.student_id = ?`;
    params.push(filterStudent);
  }
  if (filterSubject) {
    query += ` AND r.subject = ?`;
    params.push(filterSubject);
  }
  query += ` ORDER BY r.id DESC`;

  const results = db.prepare(query).all(...params).map(r => ({
    ...r,
    percentage: Math.round((r.marks_obtained / r.max_marks) * 100)
  }));

  const allStudents = db.prepare("SELECT id, name, roll_no FROM users WHERE role = 'student' AND tenant_id = ? ORDER BY name ASC").all(tenantId);

  const subjects = [
    'Data Structures & Algorithms',
    'Database Management Systems',
    'Operating Systems',
    'Computer Networks',
    'Web Technologies',
    'Software Engineering',
    'Artificial Intelligence'
  ];

  res.render('admin/results', {
    title: 'Manage Results - Admin Portal',
    pageName: 'results',
    results,
    students: allStudents,
    subjects,
    filterStudent,
    filterSubject,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /admin/results/add - Add marks
router.post('/results/add', (req, res) => {
  const { student_id, subject, marks_obtained, max_marks, exam_type, semester } = req.body;

  if (!student_id || !subject || marks_obtained === undefined || !max_marks || !exam_type) {
    return res.redirect('/admin/results?error=' + encodeURIComponent('All fields are required.'));
  }

  const marks = parseFloat(marks_obtained);
  const max = parseFloat(max_marks);
  const chosenSemester = semester || 'Semester 1';

  if (isNaN(marks) || isNaN(max) || marks < 0 || max <= 0 || marks > max) {
    return res.redirect('/admin/results?error=' + encodeURIComponent('Invalid marks: Marks obtained must be between 0 and Maximum Marks.'));
  }

  try {
    const student = db.prepare('SELECT name FROM users WHERE id = ?').get(student_id);
    const studentName = student ? student.name : `Student #${student_id}`;

    db.prepare(`
      INSERT INTO results (student_id, subject, marks_obtained, max_marks, exam_type, semester)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(parseInt(student_id, 10), subject.trim(), marks, max, exam_type.trim(), chosenSemester);

    logAudit(req.session.user.id, 'Recorded Student Result', `${studentName} — ${subject.trim()} (${chosenSemester}): ${marks}/${max}`);
    createNotification(student_id, `New assessment marks published for ${subject.trim()} (${chosenSemester}): ${marks}/${max} marks`, 'assignment');

    res.redirect('/admin/results?success=' + encodeURIComponent('Result recorded successfully!'));
  } catch (err) {
    console.error('Add result error:', err);
    res.redirect('/admin/results?error=' + encodeURIComponent('Failed to save result.'));
  }
});

// POST /admin/results/delete/:id - Delete result
router.post('/results/delete/:id', (req, res) => {
  const resultId = parseInt(req.params.id, 10);
  try {
    const tenantId = req.tenantId || 'tenant_default';
    const record = db.prepare('SELECT * FROM results WHERE id = ? AND tenant_id = ?').get(resultId, tenantId);
    db.prepare('DELETE FROM results WHERE id = ? AND tenant_id = ?').run(resultId, tenantId);
    if (record) {
      logAudit(req.session.user.id, 'Deleted Student Result', `Result ID: ${resultId} (Student ID: ${record.student_id}, Subject: ${record.subject})`);
    }
    res.redirect('/admin/results?success=' + encodeURIComponent('Result record deleted.'));
  } catch (err) {
    console.error('Delete result error:', err);
    res.redirect('/admin/results?error=' + encodeURIComponent('Failed to delete result.'));
  }
});

/**
 * ==========================================
 * LIBRARY MANAGEMENT
 * ==========================================
 */

// GET /admin/library
router.get('/library', (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];

  // All books
  const books = db.prepare(`SELECT * FROM books ORDER BY title ASC`).all();

  // Active & overdue issues
  const issuedBooks = db.prepare(`
    SELECT 
      bi.*, 
      b.title AS book_title, b.author AS book_author,
      u.name AS student_name, u.roll_no AS student_roll
    FROM book_issues bi
    JOIN books b ON bi.book_id = b.id
    JOIN users u ON bi.student_id = u.id
    ORDER BY bi.status DESC, bi.due_date ASC
  `).all().map(item => ({
    ...item,
    isOverdue: item.status === 'Issued' && item.due_date < todayStr
  }));

  // Active students for issue dropdown
  const students = db.prepare("SELECT id, name, roll_no FROM users WHERE role = 'student' AND tenant_id = ? ORDER BY name ASC").all(tenantId);

  // Books available for issue
  const availableBooks = books.filter(b => b.available_copies > 0);

  res.render('admin/library', {
    title: 'Manage Library - Admin Portal',
    pageName: 'library',
    books,
    issuedBooks,
    students,
    availableBooks,
    todayStr,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /admin/library/add - Add Book
router.post('/library/add', (req, res) => {
  const { title, author, category, total_copies } = req.body;
  const copies = parseInt(total_copies, 10);

  if (!title || !author || !category || isNaN(copies) || copies <= 0) {
    return res.redirect('/admin/library?error=' + encodeURIComponent('Please provide valid book details and quantity.'));
  }

  try {
    const tenantId = req.tenantId || 'tenant_default';
    db.prepare(`
      INSERT INTO books (tenant_id, title, author, category, total_copies, available_copies)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tenantId, title.trim(), author.trim(), category.trim(), copies, copies);

    res.redirect('/admin/library?success=' + encodeURIComponent('New book added to library catalog!'));
  } catch (err) {
    console.error('Add book error:', err);
    res.redirect('/admin/library?error=' + encodeURIComponent('Failed to add book.'));
  }
});

// POST /admin/library/issue - Issue book to student
router.post('/library/issue', (req, res) => {
  const { book_id, student_id, due_date } = req.body;
  const bookId = parseInt(book_id, 10);
  const studentId = parseInt(student_id, 10);
  const todayStr = new Date().toISOString().split('T')[0];

  if (!bookId || !studentId || !due_date) {
    return res.redirect('/admin/library?error=' + encodeURIComponent('All fields are required to issue a book.'));
  }

  try {
    // Check if book has available copies
    const tenantId = req.tenantId || 'tenant_default';
    const book = db.prepare('SELECT available_copies FROM books WHERE id = ? AND tenant_id = ?').get(bookId, tenantId);
    if (!book || book.available_copies <= 0) {
      return res.redirect('/admin/library?error=' + encodeURIComponent('Selected book currently has 0 available copies.'));
    }

    const issueTransaction = db.transaction(() => {
      // Record issue
      db.prepare(`
        INSERT INTO book_issues (book_id, student_id, issue_date, due_date, status)
        VALUES (?, ?, ?, ?, 'Issued')
      `).run(bookId, studentId, todayStr, due_date);

      // Decrement available copies
      db.prepare(`
        UPDATE books 
        SET available_copies = available_copies - 1 
        WHERE id = ?
      `).run(bookId);
    });

    issueTransaction();

    res.redirect('/admin/library?success=' + encodeURIComponent('Book issued successfully!'));
  } catch (err) {
    console.error('Issue book error:', err);
    res.redirect('/admin/library?error=' + encodeURIComponent('Failed to issue book.'));
  }
});

// POST /admin/library/return/:id - Mark book as returned
router.post('/library/return/:id', (req, res) => {
  const issueId = parseInt(req.params.id, 10);
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const tenantId = req.tenantId || 'tenant_default';
    const issue = db.prepare('SELECT * FROM book_issues WHERE id = ? AND tenant_id = ?').get(issueId, tenantId);
    if (!issue || issue.status === 'Returned') {
      return res.redirect('/admin/library?error=' + encodeURIComponent('Book issue record not found or already returned.'));
    }

    const returnTransaction = db.transaction(() => {
      // Update issue record
      db.prepare(`
        UPDATE book_issues 
        SET status = 'Returned', return_date = ? 
        WHERE id = ? AND tenant_id = ?
      `).run(todayStr, issueId, tenantId);

      // Increment available copies
      db.prepare(`
        UPDATE books 
        SET available_copies = available_copies + 1 
        WHERE id = ?
      `).run(issue.book_id);
    });

    returnTransaction();

    res.redirect('/admin/library?success=' + encodeURIComponent('Book marked as returned!'));
  } catch (err) {
    console.error('Return book error:', err);
    res.redirect('/admin/library?error=' + encodeURIComponent('Failed to process book return.'));
  }
});

// POST /admin/library/delete/:id - Delete book
router.post('/library/delete/:id', (req, res) => {
  const bookId = parseInt(req.params.id, 10);
  try {
    // Check if any copies are currently issued
    const tenantId = req.tenantId || 'tenant_default';
    const activeIssues = db.prepare("SELECT COUNT(*) AS count FROM book_issues WHERE book_id = ? AND status = 'Issued' AND tenant_id = ?").get(bookId, tenantId);
    if (activeIssues.count > 0) {
      return res.redirect('/admin/library?error=' + encodeURIComponent('Cannot delete book while copies are currently issued to students.'));
    }

    db.prepare('DELETE FROM books WHERE id = ? AND tenant_id = ?').run(bookId, tenantId);
    res.redirect('/admin/library?success=' + encodeURIComponent('Book deleted from catalog.'));
  } catch (err) {
    console.error('Delete book error:', err);
    res.redirect('/admin/library?error=' + encodeURIComponent('Failed to delete book.'));
  }
});

/**
 * ==========================================
 * QUIZ MANAGEMENT
 * ==========================================
 */

// GET /admin/quiz - List quizzes
router.get('/quiz', (req, res) => {
  const quizzes = db.prepare(`
    SELECT 
      q.*,
      COUNT(DISTINCT qq.id) AS question_count,
      COUNT(DISTINCT qa.id) AS attempts_count,
      COALESCE(AVG(qa.score * 100.0 / qa.total), 0) AS average_score
    FROM quizzes q
    LEFT JOIN quiz_questions qq ON q.id = qq.quiz_id
    LEFT JOIN quiz_attempts qa ON q.id = qa.quiz_id
    GROUP BY q.id
    ORDER BY q.id DESC
  `).all().map(q => ({
    ...q,
    average_score: Math.round(q.average_score)
  }));

  const subjects = [
    'Data Structures & Algorithms',
    'Database Management Systems',
    'Operating Systems',
    'Computer Networks',
    'Web Technologies',
    'Software Engineering',
    'Artificial Intelligence'
  ];

  res.render('admin/quiz', {
    title: 'Manage Quizzes - Admin Portal',
    pageName: 'quiz',
    quizzes,
    subjects,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /admin/quiz/create - Create new quiz
router.post('/quiz/create', (req, res) => {
  const tenantId = req.tenantId || 'tenant_default';
  const { title, subject } = req.body;

  if (!title || !subject) {
    return res.redirect('/admin/quiz?error=' + encodeURIComponent('Quiz title and subject are required.'));
  }

  try {
    const result = db.prepare('INSERT INTO quizzes (tenant_id, title, subject) VALUES (?, ?, ?)').run(tenantId, title.trim(), subject.trim());
    res.redirect(`/admin/quiz/${result.lastInsertRowid}?success=` + encodeURIComponent('Quiz created! Now add MCQ questions below.'));
  } catch (err) {
    console.error('Create quiz error:', err);
    res.redirect('/admin/quiz?error=' + encodeURIComponent('Failed to create quiz.'));
  }
});

// GET /admin/quiz/:id - Quiz details, questions & student attempts
router.get('/quiz/:id', (req, res) => {
  const quizId = parseInt(req.params.id, 10);
  const tenantId = req.tenantId || 'tenant_default';
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ? AND tenant_id = ?').get(quizId, tenantId);

  if (!quiz) {
    return res.status(404).render('error', {
      statusCode: 404,
      title: 'Quiz Not Found',
      message: 'The requested quiz does not exist.',
      user: req.session.user
    });
  }

  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? AND tenant_id = ? ORDER BY id ASC').all(quizId, tenantId);

  const attempts = db.prepare(`
    SELECT qa.*, u.name AS student_name, u.roll_no
    FROM quiz_attempts qa
    JOIN users u ON qa.student_id = u.id
    WHERE qa.quiz_id = ?
    ORDER BY qa.attempted_at DESC
  `).all(quizId).map(att => ({
    ...att,
    percentage: Math.round((att.score / att.total) * 100)
  }));

  res.render('admin/quiz-detail', {
    title: `Quiz Management: ${quiz.title}`,
    pageName: 'quiz',
    quiz,
    questions,
    attempts,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /admin/quiz/:id/questions/add - Add question to quiz
router.post('/quiz/:id/questions/add', (req, res) => {
  const quizId = parseInt(req.params.id, 10);
  const { question, option_a, option_b, option_c, option_d, correct_option } = req.body;

  if (!question || !option_a || !option_b || !option_c || !option_d || !correct_option) {
    return res.redirect(`/admin/quiz/${quizId}?error=` + encodeURIComponent('Question text, all 4 options, and correct option are required.'));
  }

  const validOptions = ['a', 'b', 'c', 'd'];
  const correct = correct_option.toLowerCase().trim();

  if (!validOptions.includes(correct)) {
    return res.redirect(`/admin/quiz/${quizId}?error=` + encodeURIComponent('Correct option must be one of: A, B, C, or D.'));
  }

  try {
    const tenantId = req.tenantId || 'tenant_default';
    db.prepare(`
      INSERT INTO quiz_questions (tenant_id, quiz_id, question, option_a, option_b, option_c, option_d, correct_option)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, quizId, question.trim(), option_a.trim(), option_b.trim(), option_c.trim(), option_d.trim(), correct);

    res.redirect(`/admin/quiz/${quizId}?success=` + encodeURIComponent('Question added successfully!'));
  } catch (err) {
    console.error('Add question error:', err);
    res.redirect(`/admin/quiz/${quizId}?error=` + encodeURIComponent('Failed to add question.'));
  }
});

// POST /admin/quiz/:quizId/questions/delete/:id - Delete question
router.post('/quiz/:quizId/questions/delete/:id', (req, res) => {
  const quizId = parseInt(req.params.quizId, 10);
  const questionId = parseInt(req.params.id, 10);

  try {
    const tenantId = req.tenantId || 'tenant_default';
    db.prepare('DELETE FROM quiz_questions WHERE id = ? AND quiz_id = ? AND tenant_id = ?').run(questionId, quizId, tenantId);
    res.redirect(`/admin/quiz/${quizId}?success=` + encodeURIComponent('Question deleted.'));
  } catch (err) {
    console.error('Delete question error:', err);
    res.redirect(`/admin/quiz/${quizId}?error=` + encodeURIComponent('Failed to delete question.'));
  }
});

// POST /admin/quiz/delete/:id - Delete whole quiz
router.post('/quiz/delete/:id', (req, res) => {
  const quizId = parseInt(req.params.id, 10);
  try {
    const tenantId = req.tenantId || 'tenant_default';
    db.prepare('DELETE FROM quizzes WHERE id = ? AND tenant_id = ?').run(quizId, tenantId);
    logAudit(req.session.user.id, 'Deleted Whole Quiz', `Quiz ID: ${quizId}`);
    res.redirect('/admin/quiz?success=' + encodeURIComponent('Quiz deleted successfully.'));
  } catch (err) {
    console.error('Delete quiz error:', err);
    res.redirect('/admin/quiz?error=' + encodeURIComponent('Failed to delete quiz.'));
  }
});

/**
 * ==========================================
 * AUDIT LOG (#2)
 * ==========================================
 */
router.get('/audit-log', (req, res) => {
  const filterAction = req.query.action || '';
  const filterAdmin = req.query.admin_id ? parseInt(req.query.admin_id, 10) : null;
  const search = req.query.search ? req.query.search.trim() : '';

  let query = `
    SELECT a.*, u.name AS admin_name, u.email AS admin_email
    FROM audit_log a
    JOIN users u ON a.admin_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (filterAction) {
    query += ` AND a.action = ?`;
    params.push(filterAction);
  }
  if (filterAdmin) {
    query += ` AND a.admin_id = ?`;
    params.push(filterAdmin);
  }
  if (search) {
    query += ` AND (a.details LIKE ? OR a.action LIKE ? OR u.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY a.id DESC LIMIT 150`;

  const logs = db.prepare(query).all(...params);
  const actionTypes = db.prepare("SELECT DISTINCT action FROM audit_log WHERE tenant_id = ? ORDER BY action ASC").all(tenantId).map(a => a.action);
  const admins = db.prepare("SELECT id, name, email FROM users WHERE role IN ('admin', 'super_admin') AND tenant_id = ? ORDER BY name ASC").all(tenantId);

  res.render('admin/audit-log', {
    title: 'Audit Log - Admin Portal',
    pageName: 'audit-log',
    logs,
    actionTypes,
    admins,
    selectedAction: filterAction,
    selectedAdmin: filterAdmin,
    searchQuery: search
  });
});

/**
 * ==========================================
 * ANNOUNCEMENTS / NOTICE BOARD (#3)
 * ==========================================
 */
router.get('/announcements', (req, res) => {
  const announcements = db.prepare(`
    SELECT a.*, u.name AS posted_by_name
    FROM announcements a
    JOIN users u ON a.posted_by = u.id
    ORDER BY a.id DESC
  `).all();

  res.render('admin/announcements', {
    title: 'Manage Announcements - Admin Portal',
    pageName: 'announcements',
    announcements,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/announcements/create', (req, res) => {
  const { title, body, priority } = req.body;
  if (!title || !body) {
    return res.redirect('/admin/announcements?error=' + encodeURIComponent('Title and body are required.'));
  }

  try {
    const p = (priority === 'urgent') ? 'urgent' : 'normal';
    db.prepare(`
      INSERT INTO announcements (title, body, posted_by, priority, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(title.trim(), body.trim(), req.session.user.id, p);

    logAudit(req.session.user.id, 'Posted Announcement', `Title: "${title.trim()}", Priority: ${p}`);
    broadcastToStudents(`📢 Notice: ${title.trim()}`, 'announcement');

    res.redirect('/admin/announcements?success=' + encodeURIComponent('Announcement published successfully!'));
  } catch (err) {
    console.error('Create announcement error:', err);
    res.redirect('/admin/announcements?error=' + encodeURIComponent('Failed to publish announcement.'));
  }
});

router.post('/announcements/delete/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const tenantId = req.tenantId || 'tenant_default';
    const ann = db.prepare("SELECT title FROM announcements WHERE id = ? AND tenant_id = ?").get(id, tenantId);
    db.prepare("DELETE FROM announcements WHERE id = ? AND tenant_id = ?").run(id, tenantId);
    if (ann) {
      logAudit(req.session.user.id, 'Deleted Announcement', `Title: "${ann.title}"`);
    }
    res.redirect('/admin/announcements?success=' + encodeURIComponent('Announcement deleted.'));
  } catch (err) {
    console.error('Delete announcement error:', err);
    res.redirect('/admin/announcements?error=' + encodeURIComponent('Failed to delete announcement.'));
  }
});

/**
 * ==========================================
 * TIMETABLE MANAGEMENT (#4)
 * ==========================================
 */
router.get('/timetable', (req, res) => {
  const filterCourse = req.query.course || 'B.Tech Computer Science';

  const slots = db.prepare(`
    SELECT * FROM timetable
    WHERE course = ?
    ORDER BY 
      CASE day_of_week
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        ELSE 7
      END,
      start_time ASC
  `).all(filterCourse);

  const subjects = [
    'Data Structures & Algorithms',
    'Database Management Systems',
    'Operating Systems',
    'Computer Networks',
    'Web Technologies',
    'Software Engineering',
    'Artificial Intelligence'
  ];

  const courses = [
    'B.Tech Computer Science',
    'B.Tech Information Technology',
    'B.Tech AI & Data Science',
    'B.Tech Electronics & Communication',
    'B.Tech Mechanical Engineering',
    'BCA / MCA'
  ];

  res.render('admin/timetable', {
    title: 'Manage Timetable - Admin Portal',
    pageName: 'timetable',
    slots,
    subjects,
    courses,
    selectedCourse: filterCourse,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/timetable/create', (req, res) => {
  const { subject, day_of_week, start_time, end_time, room, course } = req.body;
  if (!subject || !day_of_week || !start_time || !end_time || !course) {
    return res.redirect('/admin/timetable?error=' + encodeURIComponent('All timetable slot fields are required.'));
  }

  try {
    const tenantId = req.tenantId || 'tenant_default';
    db.prepare(`
      INSERT INTO timetable (tenant_id, subject, day_of_week, start_time, end_time, room, course)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, subject, day_of_week, start_time, end_time, room || 'Classroom', course);

    logAudit(req.session.user.id, 'Added Timetable Slot', `${subject} on ${day_of_week} (${start_time}-${end_time}, Room: ${room || 'TBA'}, Course: ${course})`);

    res.redirect(`/admin/timetable?course=${encodeURIComponent(course)}&success=` + encodeURIComponent('Class slot added to schedule!'));
  } catch (err) {
    console.error('Create timetable error:', err);
    res.redirect('/admin/timetable?error=' + encodeURIComponent('Failed to add timetable slot.'));
  }
});

router.post('/timetable/delete/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const tenantId = req.tenantId || 'tenant_default';
    const slot = db.prepare("SELECT * FROM timetable WHERE id = ? AND tenant_id = ?").get(id, tenantId);
    db.prepare("DELETE FROM timetable WHERE id = ? AND tenant_id = ?").run(id, tenantId);
    if (slot) {
      logAudit(req.session.user.id, 'Deleted Timetable Slot', `${slot.subject} on ${slot.day_of_week} (${slot.course})`);
    }
    res.redirect(`/admin/timetable?course=${encodeURIComponent(slot ? slot.course : '')}&success=` + encodeURIComponent('Timetable slot removed.'));
  } catch (err) {
    console.error('Delete timetable error:', err);
    res.redirect('/admin/timetable?error=' + encodeURIComponent('Failed to delete timetable slot.'));
  }
});

/**
 * ==========================================
 * ASSIGNMENT MANAGEMENT (#8)
 * ==========================================
 */
router.get('/assignments', (req, res) => {
  const assignments = db.prepare(`
    SELECT a.*, u.name AS creator_name,
      COUNT(DISTINCT sub.id) AS submission_count,
      COUNT(DISTINCT CASE WHEN sub.grade IS NOT NULL THEN sub.id END) AS graded_count
    FROM assignments a
    JOIN users u ON a.created_by = u.id
    LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id
    GROUP BY a.id
    ORDER BY a.id DESC
  `).all();

  // If viewing specific assignment submissions
  const selectedAssignmentId = req.query.id ? parseInt(req.query.id, 10) : (assignments.length > 0 ? assignments[0].id : null);
  let submissions = [];
  let currentAssignment = null;

  if (selectedAssignmentId) {
    currentAssignment = db.prepare("SELECT * FROM assignments WHERE id = ? AND tenant_id = ?").get(selectedAssignmentId, tenantId);
    submissions = db.prepare(`
      SELECT sub.*, u.name AS student_name, u.roll_no, u.course,
        CASE WHEN datetime(sub.submitted_at) > datetime(a.due_date) THEN 1 ELSE 0 END AS is_late
      FROM assignment_submissions sub
      JOIN users u ON sub.student_id = u.id
      JOIN assignments a ON sub.assignment_id = a.id
      WHERE sub.assignment_id = ?
      ORDER BY sub.id DESC
    `).all(selectedAssignmentId);
  }

  const subjects = [
    'Data Structures & Algorithms',
    'Database Management Systems',
    'Operating Systems',
    'Computer Networks',
    'Web Technologies',
    'Software Engineering',
    'Artificial Intelligence'
  ];

  res.render('admin/assignments', {
    title: 'Manage Assignments - Admin Portal',
    pageName: 'assignments',
    assignments,
    submissions,
    currentAssignment,
    subjects,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/assignments/create', (req, res) => {
  const { title, subject, description, due_date } = req.body;
  if (!title || !subject || !due_date) {
    return res.redirect('/admin/assignments?error=' + encodeURIComponent('Title, subject, and due date are required.'));
  }

  try {
    db.prepare(`
      INSERT INTO assignments (title, subject, description, due_date, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(title.trim(), subject, description || '', due_date, req.session.user.id);

    logAudit(req.session.user.id, 'Created Assignment', `Title: "${title.trim()}", Subject: ${subject}, Due: ${due_date}`);
    broadcastToStudents(`📝 New Assignment: ${title.trim()} (${subject}). Due: ${due_date}`, 'assignment');

    res.redirect('/admin/assignments?success=' + encodeURIComponent('Assignment posted to student portals!'));
  } catch (err) {
    console.error('Create assignment error:', err);
    res.redirect('/admin/assignments?error=' + encodeURIComponent('Failed to create assignment.'));
  }
});

router.post('/assignments/grade/:submissionId', (req, res) => {
  const submissionId = parseInt(req.params.submissionId, 10);
  const { grade, feedback, assignment_id } = req.body;

  try {
    const sub = db.prepare(`
      SELECT sub.*, a.title AS assignment_title, a.subject 
      FROM assignment_submissions sub
      JOIN assignments a ON sub.assignment_id = a.id
      WHERE sub.id = ?
    `).get(submissionId);

    if (!sub) {
      return res.redirect('/admin/assignments?error=' + encodeURIComponent('Submission not found.'));
    }

    db.prepare(`
      UPDATE assignment_submissions
      SET grade = ?, feedback = ?
      WHERE id = ?
    `).run(grade.trim(), feedback || '', submissionId);

    logAudit(req.session.user.id, 'Graded Assignment Submission', `Student ID: ${sub.student_id}, Grade: ${grade}, Assignment: ${sub.assignment_title}`);
    createNotification(sub.student_id, `📊 Your submission for "${sub.assignment_title}" has been graded: ${grade}. Check feedback in portal.`, 'assignment');

    res.redirect(`/admin/assignments?id=${assignment_id || sub.assignment_id}&success=` + encodeURIComponent('Submission graded and feedback sent to student!'));
  } catch (err) {
    console.error('Grade assignment error:', err);
    res.redirect('/admin/assignments?error=' + encodeURIComponent('Failed to record grade.'));
  }
});

router.post('/assignments/delete/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const tenantId = req.tenantId || 'tenant_default';
    const a = db.prepare("SELECT title FROM assignments WHERE id = ? AND tenant_id = ?").get(id, tenantId);
    db.prepare("DELETE FROM assignments WHERE id = ? AND tenant_id = ?").run(id, tenantId);
    if (a) {
      logAudit(req.session.user.id, 'Deleted Assignment', `Title: "${a.title}"`);
    }
    res.redirect('/admin/assignments?success=' + encodeURIComponent('Assignment removed.'));
  } catch (err) {
    console.error('Delete assignment error:', err);
    res.redirect('/admin/assignments?error=' + encodeURIComponent('Failed to delete assignment.'));
  }
});

/**
 * ==========================================
 * FEE MANAGEMENT (#5)
 * ==========================================
 */
router.get('/fees', (req, res) => {
  const filterStatus = req.query.status || '';
  const filterTerm = req.query.term || '';

  let query = `
    SELECT f.*, u.name AS student_name, u.roll_no, u.course
    FROM fees f
    JOIN users u ON f.student_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (filterStatus) {
    query += ` AND f.status = ?`;
    params.push(filterStatus);
  }
  if (filterTerm) {
    query += ` AND f.term = ?`;
    params.push(filterTerm);
  }

  query += ` ORDER BY f.id DESC`;

  const fees = db.prepare(query).all(...params);

  // Summary stats
  const totalDue = db.prepare("SELECT COALESCE(SUM(amount_due), 0) AS total FROM fees WHERE tenant_id = ?").get(tenantId).total;
  const totalCollected = db.prepare("SELECT COALESCE(SUM(amount_paid), 0) AS total FROM fees WHERE tenant_id = ?").get(tenantId).total;
  const pendingCount = db.prepare("SELECT COUNT(*) AS count FROM fees WHERE status != 'Paid' AND tenant_id = ?").get(tenantId).count;

  const students = db.prepare("SELECT id, name, roll_no, course FROM users WHERE role = 'student' AND tenant_id = ? ORDER BY name ASC").all(tenantId);

  res.render('admin/fees', {
    title: 'Manage Fees - Admin Portal',
    pageName: 'fees',
    fees,
    totalDue,
    totalCollected,
    pendingCount,
    students,
    selectedStatus: filterStatus,
    selectedTerm: filterTerm,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/fees/create', (req, res) => {
  const { student_id, term, amount_due, due_date } = req.body;
  if (!student_id || !term || !amount_due) {
    return res.redirect('/admin/fees?error=' + encodeURIComponent('Student, term, and amount due are required.'));
  }

  try {
    const stId = parseInt(student_id, 10);
    const amt = parseInt(amount_due, 10);
    db.prepare(`
      INSERT INTO fees (student_id, term, amount_due, amount_paid, due_date, status)
      VALUES (?, ?, ?, 0, ?, 'Pending')
    `).run(stId, term.trim(), amt, due_date || null);

    logAudit(req.session.user.id, 'Assigned Student Fee Dues', `Student ID: ${stId}, Term: ${term}, Amount: ₹${amt}`);
    createNotification(stId, `💳 Fee invoice generated for ${term}: ₹${amt} due on ${due_date || 'scheduled deadline'}.`, 'fee');

    res.redirect('/admin/fees?success=' + encodeURIComponent('Fee invoice generated for student!'));
  } catch (err) {
    console.error('Create fee error:', err);
    res.redirect('/admin/fees?error=' + encodeURIComponent('Failed to assign fee.'));
  }
});

router.post('/fees/mark-paid/:id', (req, res) => {
  const feeId = parseInt(req.params.id, 10);
  try {
    const tenantId = req.tenantId || 'tenant_default';
    const fee = db.prepare("SELECT * FROM fees WHERE id = ? AND tenant_id = ?").get(feeId, tenantId);
    if (!fee) {
      return res.redirect('/admin/fees?error=' + encodeURIComponent('Fee record not found.'));
    }

    db.prepare(`
      UPDATE fees
      SET amount_paid = amount_due, status = 'Paid', paid_at = datetime('now')
      WHERE id = ?
    `).run(feeId);

    logAudit(req.session.user.id, 'Marked Fee Paid (Manual/Offline)', `Fee ID: ${feeId}, Student ID: ${fee.student_id}, Amount: ₹${fee.amount_due}`);
    createNotification(fee.student_id, `✅ Fee payment confirmed! Receipt generated for ${fee.term} (₹${fee.amount_due}). Status: Paid.`, 'fee');

    res.redirect('/admin/fees?success=' + encodeURIComponent('Fee record marked as Paid.'));
  } catch (err) {
    console.error('Mark fee paid error:', err);
    res.redirect('/admin/fees?error=' + encodeURIComponent('Failed to update fee record.'));
  }
});

/**
 * ==========================================
 * ADMIN PROFILE & PHOTO UPLOAD (#7)
 * ==========================================
 */
router.get('/profile', (req, res) => {
  const admin = db.prepare("SELECT id, name, email, profile_photo, created_at FROM users WHERE id = ?").get(req.session.user.id);
  res.render('admin/profile', {
    title: 'Admin Profile - College Portal',
    pageName: 'profile',
    admin,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/profile', avatarUpload.single('profile_photo'), (req, res) => {
  const adminId = req.session.user.id;
  const { name, current_password, new_password } = req.body;

  try {
    const currentUser = db.prepare("SELECT * FROM users WHERE id = ?").get(adminId);

    let photoPath = currentUser.profile_photo;
    if (req.file) {
      photoPath = '/uploads/avatars/' + req.file.filename;
    }

    // Password change check
    let newHash = currentUser.password;
    if (new_password) {
      if (!current_password) {
        return res.redirect('/admin/profile?error=' + encodeURIComponent('Current password is required to set a new password.'));
      }
      const match = bcrypt.compareSync(current_password, currentUser.password);
      if (!match) {
        return res.redirect('/admin/profile?error=' + encodeURIComponent('Current password was incorrect.'));
      }
      if (new_password.length < 6) {
        return res.redirect('/admin/profile?error=' + encodeURIComponent('New password must be at least 6 characters.'));
      }
      newHash = bcrypt.hashSync(new_password, bcrypt.genSaltSync(10));
    }

    db.prepare(`
      UPDATE users 
      SET name = ?, password = ?, profile_photo = ?
      WHERE id = ?
    `).run(name.trim(), newHash, photoPath, adminId);

    req.session.user.name = name.trim();
    req.session.user.profile_photo = photoPath;

    logAudit(adminId, 'Updated Admin Profile', `Name: ${name.trim()}, Photo: ${req.file ? 'Updated' : 'Unchanged'}`);

    res.redirect('/admin/profile?success=' + encodeURIComponent('Profile updated successfully!'));
  } catch (err) {
    console.error('Update admin profile error:', err);
    res.redirect('/admin/profile?error=' + encodeURIComponent('Failed to update profile: ' + err.message));
  }
});

/**
 * ==========================================
 * EXPORT REPORTS CSV (#10)
 * ==========================================
 */
router.get('/export/:type.csv', (req, res) => {
  const type = req.params.type;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-report-${new Date().toISOString().split('T')[0]}.csv"`);

  if (type === 'students') {
    const rows = db.prepare("SELECT id, name, roll_no, email, course, created_at FROM users WHERE role = 'student' ORDER BY roll_no ASC").all();
    let csv = 'ID,Name,Roll Number,Email,Course,Registered Date\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.name}","${r.roll_no}","${r.email}","${r.course}","${r.created_at}"\n`;
    });
    return res.send(csv);
  }

  if (type === 'attendance') {
    const rows = db.prepare(`
      SELECT a.id, u.name, u.roll_no, a.subject, a.date, a.status
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      ORDER BY a.date DESC, a.subject ASC
    `).all();
    let csv = 'Record ID,Student Name,Roll Number,Subject,Date,Status\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.name}","${r.roll_no}","${r.subject}","${r.date}","${r.status}"\n`;
    });
    return res.send(csv);
  }

  if (type === 'results') {
    const rows = db.prepare(`
      SELECT r.id, u.name, u.roll_no, r.semester, r.subject, r.marks_obtained, r.max_marks, r.exam_type
      FROM results r
      JOIN users u ON r.student_id = u.id
      ORDER BY r.id DESC
    `).all();
    let csv = 'Result ID,Student Name,Roll Number,Semester,Subject,Marks Obtained,Max Marks,Percentage,Exam Type\n';
    rows.forEach(r => {
      const pct = Math.round((r.marks_obtained / r.max_marks) * 100);
      csv += `"${r.id}","${r.name}","${r.roll_no}","${r.semester || 'Semester 1'}","${r.subject}",${r.marks_obtained},${r.max_marks},${pct}%,"${r.exam_type}"\n`;
    });
    return res.send(csv);
  }

  if (type === 'library') {
    const rows = db.prepare(`
      SELECT bi.id, b.title, b.author, u.name AS student_name, u.roll_no, bi.issue_date, bi.due_date, bi.return_date, bi.status
      FROM book_issues bi
      JOIN books b ON bi.book_id = b.id
      JOIN users u ON bi.student_id = u.id
      ORDER BY bi.id DESC
    `).all();
    let csv = 'Issue ID,Book Title,Author,Student Name,Roll Number,Issue Date,Due Date,Return Date,Status\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.title}","${r.author}","${r.student_name}","${r.roll_no}","${r.issue_date}","${r.due_date}","${r.return_date || 'N/A'}","${r.status}"\n`;
    });
    return res.send(csv);
  }

  if (type === 'audit') {
    const rows = db.prepare(`
      SELECT a.id, a.created_at, u.name AS admin_name, a.action, a.details
      FROM audit_log a
      JOIN users u ON a.admin_id = u.id
      ORDER BY a.id DESC
    `).all();
    let csv = 'Log ID,Timestamp,Administrator,Action,Details\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.created_at}","${r.admin_name}","${r.action}","${(r.details || '').replace(/"/g, '""')}"\n`;
    });
    return res.send(csv);
  }

  res.send('Invalid export type requested');
});

// Notifications mark read for admin
router.post('/notifications/read-all', (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.session.user.id);
  res.redirect('back');
});

/**
 * ==========================================
 * SUPER ADMIN: MANAGE ADMIN ACCOUNTS
 * ==========================================
 */

// GET /admin/manage-admins - Super Admin Only
router.get('/manage-admins', requireSuperAdmin, (req, res) => {
  const admins = db.prepare(`
    SELECT id, name, email, role, is_active, created_at, failed_attempts, locked_until, last_failed_at
    FROM users 
    WHERE role IN ('admin', 'super_admin')
    ORDER BY CASE WHEN role = 'super_admin' THEN 1 ELSE 2 END, id ASC
  `).all();

  const totalAdmins = admins.length;
  const superAdminCount = admins.filter(a => a.role === 'super_admin').length;
  const staffAdminCount = admins.filter(a => a.role === 'admin').length;
  const activeCount = admins.filter(a => a.is_active === 1).length;

  res.render('admin/manage-admins', {
    title: 'Admin Hierarchy & Access Control - Super Admin',
    pageName: 'manage-admins',
    admins,
    stats: {
      totalAdmins,
      superAdminCount,
      staffAdminCount,
      activeCount
    },
    currentUserId: req.session.user.id,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /admin/manage-admins/add - Super Admin creates new Admin / Super Admin
router.post('/manage-admins/add', requireSuperAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  const actingAdmin = req.session.user;

  if (!name || !email || !password || !role) {
    return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('All fields are required.'));
  }

  // Strict role enforcement: only 'admin' or 'super_admin'
  if (role !== 'admin' && role !== 'super_admin') {
    return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Invalid role selection. Must be Admin or Super Admin.'));
  }

  if (password.length < 6) {
    return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Password must be at least 6 characters long.'));
  }

  try {
    const existing = db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email.trim());
    if (existing) {
      return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('An account with this email already exists.'));
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const result = db.prepare(`
      INSERT INTO users (name, email, password, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(name.trim(), email.trim().toLowerCase(), hash, role);

    const newAdminId = result.lastInsertRowid;
    const roleLabel = role === 'super_admin' ? 'Super Administrator' : 'Administrator (Staff)';

    logAudit(
      actingAdmin.id,
      'Admin Account Created',
      `Super Admin ${actingAdmin.email} created new ${roleLabel} account for ${name.trim()} (${email.trim().toLowerCase()}).`,
      newAdminId
    );

    res.redirect('/admin/manage-admins?success=' + encodeURIComponent(`New ${roleLabel} account for ${name.trim()} created successfully!`));
  } catch (err) {
    console.error('Create admin error:', err);
    res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Failed to create admin account: ' + err.message));
  }
});

// POST /admin/manage-admins/toggle-status/:id - Deactivate or Reactivate Admin account
router.post('/manage-admins/toggle-status/:id', requireSuperAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const actingAdmin = req.session.user;

  // Cannot deactivate self (prevent accidental lockout)
  if (targetId === actingAdmin.id) {
    return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Security Protection: You cannot deactivate your own Super Admin account.'));
  }

  try {
    const target = db.prepare("SELECT id, name, email, role, is_active FROM users WHERE id = ? AND role IN ('admin', 'super_admin')").get(targetId);
    if (!target) {
      return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Admin account not found.'));
    }

    const newStatus = target.is_active === 1 ? 0 : 1;
    db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(newStatus, targetId);

    const actionTitle = newStatus === 1 ? 'Admin Account Reactivated' : 'Admin Account Deactivated';
    logAudit(
      actingAdmin.id,
      actionTitle,
      `Super Admin ${actingAdmin.email} ${newStatus === 1 ? 'reactivated' : 'deactivated'} account for ${target.name} (${target.email}, Role: ${target.role}).`,
      targetId
    );

    res.redirect('/admin/manage-admins?success=' + encodeURIComponent(`Account for ${target.name} ${newStatus === 1 ? 'reactivated' : 'deactivated'} successfully.`));
  } catch (err) {
    console.error('Toggle admin status error:', err);
    res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Failed to update account status: ' + err.message));
  }
});

// POST /admin/manage-admins/delete/:id - Delete Admin account
router.post('/manage-admins/delete/:id', requireSuperAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const actingAdmin = req.session.user;

  // Cannot delete self (prevent accidental lockout)
  if (targetId === actingAdmin.id) {
    return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Security Protection: You cannot delete your own Super Admin account.'));
  }

  try {
    const target = db.prepare("SELECT id, name, email, role FROM users WHERE id = ? AND role IN ('admin', 'super_admin')").get(targetId);
    if (!target) {
      return res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Admin account not found.'));
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(targetId);

    logAudit(
      actingAdmin.id,
      'Admin Account Deleted',
      `Super Admin ${actingAdmin.email} permanently deleted admin account for ${target.name} (${target.email}, Role: ${target.role}).`,
      targetId
    );

    res.redirect('/admin/manage-admins?success=' + encodeURIComponent(`Admin account for ${target.name} deleted successfully.`));
  } catch (err) {
    console.error('Delete admin error:', err);
    res.redirect('/admin/manage-admins?error=' + encodeURIComponent('Failed to delete admin account: ' + err.message));
  }
});


/**
 * ==========================================
 * INSTITUTION / TENANT SETTINGS
 * ==========================================
 */
router.get('/tenant-settings', (req, res) => {
  const tenantId = req.tenantId || 'tenant_default';
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);

  res.render('admin/tenant-settings', {
    title: 'Institution Settings - Admin Portal',
    pageName: 'tenant-settings',
    tenant,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/tenant-settings', (req, res) => {
  const tenantId = req.tenantId || 'tenant_default';
  const { name, short_name, email, phone, address, academic_year, primary_color, secondary_color } = req.body;

  if (!name) {
    return res.redirect('/admin/tenant-settings?error=' + encodeURIComponent('Institution Name is required.'));
  }

  try {
    db.prepare(`
      UPDATE tenants 
      SET name = ?, short_name = ?, email = ?, phone = ?, address = ?, 
          academic_year = ?, primary_color = ?, secondary_color = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name.trim(),
      (short_name || '').trim(),
      (email || '').trim(),
      (phone || '').trim(),
      (address || '').trim(),
      (academic_year || '2025-2026').trim(),
      primary_color || '#6C5CE7',
      secondary_color || '#111318',
      tenantId
    );

    logAudit(
      req.session.user.id,
      'Institution Settings Updated',
      `Admin ${req.session.user.email} updated institutional profile and branding for ${name}.`,
      null,
      tenantId
    );

    res.redirect('/admin/tenant-settings?success=' + encodeURIComponent('Institution settings updated successfully!'));
  } catch (err) {
    console.error('Update tenant settings error:', err);
    res.redirect('/admin/tenant-settings?error=' + encodeURIComponent('Failed to update institution settings: ' + err.message));
  }
});

module.exports = router;
