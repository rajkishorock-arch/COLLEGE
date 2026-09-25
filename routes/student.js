const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireStudent } = require('../middleware/auth');
const { createNotification } = require('../utils/notify');
const { avatarUpload, assignmentUpload } = require('../utils/upload');

// Apply student authorization to all routes in this file
router.use(requireStudent);

// Ensure tenant context is set for all student queries
router.use((req, res, next) => {
  req.tenantId = req.tenantId || (req.session.user && req.session.user.tenantId) || 'tenant_default';
  next();
});

/**
 * Helper to compute grade from percentage
 */
function calculateGrade(percentage) {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B';
  if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'D';
  return 'F';
}

/**
 * GET /student/dashboard
 */
router.get('/dashboard', (req, res) => {
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';
  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Attendance summary
  const attendanceStats = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
    FROM attendance
    WHERE student_id = ? AND tenant_id = ?
  `).get(studentId, tenantId);

  const totalClasses = attendanceStats.total || 0;
  const attendedClasses = attendanceStats.present || 0;
  const attendancePercentage = totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 0;

  // 2. Results summary
  const results = db.prepare(`
    SELECT * FROM results 
    WHERE student_id = ? 
    ORDER BY id DESC
  `).all(studentId);

  let averageMarks = 0;
  if (results.length > 0) {
    const totalPercentage = results.reduce((acc, r) => acc + ((r.marks_obtained / r.max_marks) * 100), 0);
    averageMarks = Math.round(totalPercentage / results.length);
  }

  // 3. Books currently issued
  const issuedBooks = db.prepare(`
    SELECT bi.*, b.title, b.author, b.category
    FROM book_issues bi
    JOIN books b ON bi.book_id = b.id
    WHERE bi.student_id = ? AND bi.status = 'Issued' AND bi.tenant_id = ?
    ORDER BY bi.due_date ASC
  `).all(studentId, tenantId);

  // Check for overdue books
  const issuedBooksWithOverdue = issuedBooks.map(item => ({
    ...item,
    isOverdue: item.due_date < todayStr
  }));

  // 4. Available Quizzes & Attempts
  const totalQuizzes = db.prepare(`SELECT COUNT(*) AS count FROM quizzes WHERE tenant_id = ?`).get(tenantId).count;
  const attemptedQuizzes = db.prepare(`
    SELECT COUNT(DISTINCT quiz_id) AS count 
    FROM quiz_attempts 
    WHERE student_id = ? AND tenant_id = ?
  `).get(studentId, tenantId).count;

  // 5. Recent attendance records
  const recentAttendance = db.prepare(`
    SELECT subject, date, status 
    FROM attendance 
    WHERE student_id = ? AND tenant_id = ?
    ORDER BY date DESC, id DESC 
    LIMIT 5
  `).all(studentId, tenantId);

  // 6. Recent announcements
  const announcements = db.prepare(`
    SELECT a.*, u.name as author_name 
    FROM announcements a
    JOIN users u ON a.posted_by = u.id
    WHERE a.tenant_id = ?
    ORDER BY a.priority DESC, a.created_at DESC
    LIMIT 3
  `).all(tenantId);

  // 7. Recent assignments
  const recentAssignments = db.prepare(`
    SELECT a.*, s.submitted_at, s.grade, s.feedback
    FROM assignments a
    LEFT JOIN assignment_submissions s ON a.id = s.assignment_id AND s.student_id = ?
    WHERE a.tenant_id = ?
    ORDER BY a.due_date ASC
    LIMIT 3
  `).all(studentId, tenantId);

  res.render('student/dashboard', {
    title: 'Student Dashboard - College Portal',
    pageName: 'dashboard',
    stats: {
      attendancePercentage,
      totalClasses,
      attendedClasses,
      averageMarks,
      issuedBooksCount: issuedBooks.length,
      availableQuizzesCount: Math.max(0, totalQuizzes - attemptedQuizzes),
      totalQuizzes
    },
    results: results.slice(0, 4).map(r => ({
      ...r,
      percentage: Math.round((r.marks_obtained / r.max_marks) * 100),
      grade: calculateGrade((r.marks_obtained / r.max_marks) * 100)
    })),
    issuedBooks: issuedBooksWithOverdue,
    recentAttendance,
    announcements,
    recentAssignments
  });
});

/**
 * GET /student/attendance
 */
router.get('/attendance', (req, res) => {
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  // Subject-wise attendance calculation
  const subjectBreakdown = db.prepare(`
    SELECT 
      subject,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS missed
    FROM attendance
    WHERE student_id = ? AND tenant_id = ?
    GROUP BY subject
    ORDER BY subject ASC
  `).all(studentId, tenantId);

  let grandTotal = 0;
  let grandAttended = 0;

  const subjectsWithStats = subjectBreakdown.map(subj => {
    grandTotal += subj.total;
    grandAttended += subj.attended;
    const percentage = subj.total > 0 ? Math.round((subj.attended / subj.total) * 100) : 0;
    return {
      ...subj,
      percentage,
      isShortage: percentage < 75
    };
  });

  const overallPercentage = grandTotal > 0 ? Math.round((grandAttended / grandTotal) * 100) : 0;

  // Detailed records (optionally filter by subject)
  const selectedSubject = req.query.subject || '';
  let recordsQuery = `
    SELECT subject, date, status 
    FROM attendance 
    WHERE student_id = ? AND tenant_id = ?
  `;
  const queryParams = [studentId, tenantId];

  if (selectedSubject) {
    recordsQuery += ` AND subject = ?`;
    queryParams.push(selectedSubject);
  }
  recordsQuery += ` ORDER BY date DESC, id DESC LIMIT 50`;

  const detailedRecords = db.prepare(recordsQuery).all(...queryParams);

  res.render('student/attendance', {
    title: 'My Attendance - College Portal',
    pageName: 'attendance',
    overallPercentage,
    grandTotal,
    grandAttended,
    grandMissed: grandTotal - grandAttended,
    isOverallShortage: overallPercentage < 75,
    subjectBreakdown: subjectsWithStats,
    detailedRecords,
    selectedSubject,
    subjectsList: subjectBreakdown.map(s => s.subject)
  });
});

/**
 * GET /student/results
 */
router.get('/results', (req, res) => {
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  const rawResults = db.prepare(`
    SELECT * FROM results 
    WHERE student_id = ? AND tenant_id = ?
    ORDER BY exam_type ASC, subject ASC
  `).all(studentId, tenantId);

  const results = rawResults.map(r => {
    const percentage = Math.round((r.marks_obtained / r.max_marks) * 100);
    return {
      ...r,
      percentage,
      grade: calculateGrade(percentage)
    };
  });

  // Group results by semester (#7 CGPA & History)
  const semesterGroups = {};
  results.forEach(r => {
    const sem = r.semester || 'Semester 1';
    if (!semesterGroups[sem]) {
      semesterGroups[sem] = {
        semester: sem,
        records: [],
        totalMarks: 0,
        totalMax: 0,
        gpa: '0.00'
      };
    }
    semesterGroups[sem].records.push(r);
    semesterGroups[sem].totalMarks += r.marks_obtained;
    semesterGroups[sem].totalMax += r.max_marks;
  });

  // Calculate semester GPAs (10.0 scale)
  Object.keys(semesterGroups).forEach(sem => {
    const group = semesterGroups[sem];
    const semPct = group.totalMax > 0 ? (group.totalMarks / group.totalMax) * 100 : 0;
    group.percentage = Math.round(semPct);
    group.gpa = (semPct / 10).toFixed(2);
    group.grade = calculateGrade(group.percentage);
  });

  const semKeys = Object.keys(semesterGroups);
  const totalGpaSum = semKeys.reduce((acc, sem) => acc + parseFloat(semesterGroups[sem].gpa), 0);
  const cgpa = semKeys.length > 0 ? (totalGpaSum / semKeys.length).toFixed(2) : '0.00';

  // Calculate overall metrics
  const totalMarksObtained = results.reduce((acc, r) => acc + r.marks_obtained, 0);
  const totalMaxMarks = results.reduce((acc, r) => acc + r.max_marks, 0);
  const averagePercentage = totalMaxMarks > 0 ? Math.round((totalMarksObtained / totalMaxMarks) * 100) : 0;
  const overallGrade = calculateGrade(averagePercentage);

  // Prepare chart data (distinct by subject, take highest or average)
  const chartLabels = [];
  const chartMarks = [];
  const chartMax = [];

  results.forEach(r => {
    chartLabels.push(`${r.subject} (${r.semester || 'Sem 1'})`);
    chartMarks.push(r.marks_obtained);
    chartMax.push(r.max_marks);
  });

  res.render('student/results', {
    title: 'My Results & CGPA - College Portal',
    pageName: 'results',
    results,
    semesterGroups,
    cgpa,
    summary: {
      totalSubjects: results.length,
      averagePercentage,
      overallGrade,
      cgpa,
      totalMarksObtained,
      totalMaxMarks
    },
    chartData: {
      labels: chartLabels,
      marks: chartMarks,
      maxMarks: chartMax
    }
  });
});

/**
 * GET /student/library
 */
router.get('/library', (req, res) => {
  const studentId = req.session.user.id;
  const searchQuery = (req.query.q || '').trim();
  const todayStr = new Date().toISOString().split('T')[0];

  // Books issued to this student
  const myIssuedBooks = db.prepare(`
    SELECT bi.*, b.title, b.author, b.category
    FROM book_issues bi
    JOIN books b ON bi.book_id = b.id
    WHERE bi.student_id = ?
    ORDER BY bi.status DESC, bi.due_date ASC
  `).all(studentId).map(item => ({
    ...item,
    isOverdue: item.status === 'Issued' && item.due_date < todayStr
  }));

  // Catalog search
  let booksQuery = `SELECT * FROM books`;
  let booksParams = [];

  if (searchQuery) {
    booksQuery += ` WHERE title LIKE ? OR author LIKE ? OR category LIKE ?`;
    const searchPattern = `%${searchQuery}%`;
    booksParams.push(searchPattern, searchPattern, searchPattern);
  }
  booksQuery += ` ORDER BY title ASC`;

  const allBooks = db.prepare(booksQuery).all(...booksParams);

  res.render('student/library', {
    title: 'Library Portal - College Portal',
    pageName: 'library',
    myIssuedBooks,
    allBooks,
    searchQuery
  });
});

/**
 * GET /student/quiz
 */
router.get('/quiz', (req, res) => {
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  // Fetch all quizzes with question count
  const quizzes = db.prepare(`
    SELECT 
      q.*,
      COUNT(qq.id) AS question_count,
      (SELECT MAX(score) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.student_id = ?) AS user_high_score,
      (SELECT total FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.student_id = ? ORDER BY qa.id DESC LIMIT 1) AS last_total,
      (SELECT COUNT(*) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.student_id = ?) AS attempts_count
    FROM quizzes q
    LEFT JOIN quiz_questions qq ON q.id = qq.quiz_id
    GROUP BY q.id
    ORDER BY q.id DESC
  `).all(studentId, studentId, studentId);

  // Past attempt history
  const attempts = db.prepare(`
    SELECT 
      qa.*,
      q.title AS quiz_title,
      q.subject AS quiz_subject
    FROM quiz_attempts qa
    JOIN quizzes q ON qa.quiz_id = q.id
    WHERE qa.student_id = ?
    ORDER BY qa.attempted_at DESC
  `).all(studentId).map(att => ({
    ...att,
    percentage: Math.round((att.score / att.total) * 100)
  }));

  res.render('student/quiz', {
    title: 'Online Quizzes - College Portal',
    pageName: 'quiz',
    quizzes,
    attempts,
    success: req.query.success || null
  });
});

/**
 * GET /student/quiz/:id - Take a quiz
 */
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

  const questions = db.prepare(`
    SELECT id, quiz_id, question, option_a, option_b, option_c, option_d 
    FROM quiz_questions 
    WHERE quiz_id = ?
    ORDER BY id ASC
  `).all(quizId);

  if (questions.length === 0) {
    return res.render('error', {
      statusCode: 400,
      title: 'Quiz Has No Questions',
      message: 'This quiz does not have any questions yet. Please check back later.',
      user: req.session.user
    });
  }

  res.render('student/take-quiz', {
    title: `Take Quiz: ${quiz.title}`,
    pageName: 'quiz',
    quiz,
    questions
  });
});

/**
 * POST /student/quiz/:id/submit - Auto-grade quiz and store attempt
 */
router.post('/quiz/:id/submit', (req, res) => {
  const quizId = parseInt(req.params.id, 10);
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ? AND tenant_id = ?').get(quizId, tenantId);
  if (!quiz) {
    return res.redirect('/student/quiz');
  }

  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? AND tenant_id = ? ORDER BY id ASC').all(quizId, tenantId);
  const total = questions.length;
  let score = 0;

  const userAnswers = req.body;
  const breakdown = [];

  questions.forEach((q, idx) => {
    const fieldName = `question_${q.id}`;
    const selected = (userAnswers[fieldName] || '').toLowerCase();
    const isCorrect = selected === q.correct_option.toLowerCase();

    if (isCorrect) {
      score++;
    }

    breakdown.push({
      number: idx + 1,
      question: q.question,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      selectedOption: selected || 'Not Answered',
      correctOption: q.correct_option.toLowerCase(),
      isCorrect
    });
  });

  // Save attempt
  const insertAttempt = db.prepare(`
    INSERT INTO quiz_attempts (quiz_id, student_id, score, total)
    VALUES (?, ?, ?, ?)
  `);
  insertAttempt.run(quizId, studentId, score, total);

  const percentage = Math.round((score / total) * 100);

  res.render('student/quiz-result', {
    title: `Quiz Result: ${quiz.title}`,
    pageName: 'quiz',
    quiz,
    score,
    total,
    percentage,
    passed: percentage >= 50,
    breakdown
  });
});

/**
 * API: Rule-based FAQ Chatbot
 */
router.post('/api/chatbot', (req, res) => {
  const userMessage = (req.body.message || '').trim().toLowerCase();

  const faqs = [
    {
      keywords: ['attendance', 'present', 'absent', 'percentage', '75', 'shortage'],
      response: 'You can monitor your subject-wise and overall attendance under "My Attendance" (/student/attendance). Per academic policy, a minimum of 75% attendance is required to be eligible for final examinations.'
    },
    {
      keywords: ['result', 'marks', 'grade', 'score', 'exam', 'gpa', 'cgpa', 'midterm', 'final'],
      response: 'Your marks, grades, and interactive performance charts are available in "My Results" (/student/results). You can view scores for mid-terms, final exams, and quizzes.'
    },
    {
      keywords: ['library', 'book', 'issue', 'borrow', 'return', 'due date', 'overdue', 'fine'],
      response: 'You can explore available books and track currently borrowed titles under "Library" (/student/library). Books can be issued by the librarian and must be returned before the due date to avoid overdue flags.'
    },
    {
      keywords: ['quiz', 'test', 'mcq', 'examination', 'attempt'],
      response: 'Visit the "Quiz" section (/student/quiz) to take online self-assessment quizzes. Quizzes are automatically graded instantly upon submission, and your score history is preserved.'
    },
    {
      keywords: ['contact admin', 'admin office', 'contact', 'helpdesk', 'office hours', 'support', 'help'],
      response: 'The College Administrative Office is open Monday to Friday, 9:00 AM - 4:30 PM. You can visit Room 102, Academic Block, or reach out via email.'
    },
    {
      keywords: ['admin email', 'email', 'mail', 'write to admin'],
      response: 'You can email the college administration directly at: admin@college.edu. Please mention your full name and Roll Number in the email subject line.'
    },
    {
      keywords: ['course', 'syllabus', 'subjects', 'department'],
      response: 'Your enrolled course is displayed in your profile header. For detailed syllabus guidelines, please consult your department faculty or the college library repository.'
    },
    {
      keywords: ['hi', 'hello', 'hey', 'greetings'],
      response: 'Hello! I am your College Assistant bot. You can ask me about attendance criteria, viewing exam results, library books, taking quizzes, or contacting the admin.'
    }
  ];

  // Match keyword in user message
  let matchedFaq = null;
  for (const faq of faqs) {
    const hasMatch = faq.keywords.some(kw => userMessage.includes(kw));
    if (hasMatch) {
      matchedFaq = faq.response;
      break;
    }
  }

  if (matchedFaq) {
    return res.json({ reply: matchedFaq, success: true });
  }

  // Friendly fallback response
  return res.json({
    reply: "I couldn't quite find an answer for that. You can ask me: 'How to check attendance?', 'How to see results?', 'How to issue library books?', 'How to take a quiz?', or 'What is the admin email?'",
    success: false
  });
});

// GET /student/checkin - Student live self check-in page
router.get('/checkin', (req, res) => {
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  const activeSessions = db.prepare(`
    SELECT s.*, u.name AS creator_name,
      CAST((julianday(valid_until) - julianday('now')) * 1440 AS INTEGER) AS minutes_remaining
    FROM attendance_sessions s
    JOIN users u ON s.created_by = u.id
    WHERE s.valid_until > datetime('now') AND s.tenant_id = ?
    ORDER BY s.id DESC
  `).all(tenantId);

  const recentCheckins = db.prepare(`
    SELECT * FROM attendance
    WHERE student_id = ?
    ORDER BY date DESC, id DESC
    LIMIT 6
  `).all(studentId);

  res.render('student/checkin', {
    title: 'Classroom Self Check-In - Student Portal',
    pageName: 'checkin',
    activeSessions,
    recentCheckins,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /student/checkin - Validate code & mark attendance
router.post('/checkin', (req, res) => {
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';
  const rawCode = (req.body.session_code || '').trim().toUpperCase();

  if (!rawCode) {
    return res.redirect('/student/checkin?error=' + encodeURIComponent('Please enter a session code.'));
  }

  try {
    const session = db.prepare("SELECT * FROM attendance_sessions WHERE UPPER(session_code) = ? AND tenant_id = ?").get(rawCode, tenantId);

    if (!session) {
      return res.redirect('/student/checkin?error=' + encodeURIComponent('Invalid session code. Please verify the code displayed by your instructor.'));
    }

    // Check expiry
    const isExpired = db.prepare("SELECT datetime('now') > datetime(?) AS expired").get(session.valid_until).expired;
    if (isExpired) {
      return res.redirect('/student/checkin?error=' + encodeURIComponent('This attendance session code has expired (15-minute window closed). Please speak with your instructor.'));
    }

    // Check if student already marked for this subject and date
    const existing = db.prepare("SELECT id, status FROM attendance WHERE student_id = ? AND subject = ? AND date = ? AND tenant_id = ?").get(studentId, session.subject, session.date, tenantId);
    if (existing) {
      return res.redirect('/student/checkin?error=' + encodeURIComponent(`You have already been recorded as ${existing.status} for ${session.subject} on ${session.date}.`));
    }

    // Insert attendance record
    db.prepare(`
      INSERT INTO attendance (tenant_id, student_id, subject, date, status)
      VALUES (?, ?, ?, ?, 'Present')
    `).run(tenantId, studentId, session.subject, session.date);

    createNotification(studentId, `✅ Attendance verified! You were marked Present for ${session.subject} on ${session.date}.`, 'attendance');

    res.redirect('/student/checkin?success=' + encodeURIComponent(`Attendance successfully verified for ${session.subject}! You have been marked Present.`));
  } catch (err) {
    console.error('[Student:CheckIn]', err.message);
    res.redirect('/student/checkin?error=' + encodeURIComponent('Failed to process check-in. Please try again.'));
  }
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
    ORDER BY a.priority = 'urgent' DESC, a.id DESC
  `).all();

  res.render('student/announcements', {
    title: 'Notices & Announcements - Student Portal',
    pageName: 'announcements',
    announcements
  });
});

/**
 * ==========================================
 * TIMETABLE / CLASS SCHEDULE (#4)
 * ==========================================
 */
router.get('/timetable', (req, res) => {
  const student = db.prepare("SELECT course FROM users WHERE id = ?").get(req.session.user.id);
  const studentCourse = student ? student.course : 'B.Tech Computer Science';

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
  `).all(studentCourse);

  // Group by day for the visual grid
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timetableByDay = {};
  days.forEach(d => {
    timetableByDay[d] = slots.filter(s => s.day_of_week === d);
  });

  res.render('student/timetable', {
    title: 'Weekly Timetable - Student Portal',
    pageName: 'timetable',
    studentCourse,
    days,
    timetableByDay,
    totalSlots: slots.length
  });
});

/**
 * ==========================================
 * ASSIGNMENTS & SUBMISSION (#8)
 * ==========================================
 */
router.get('/assignments', (req, res) => {
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  const rawAssignments = db.prepare(`
    SELECT a.*, u.name AS creator_name,
      sub.id AS submission_id, sub.file_path, sub.submitted_at, sub.grade, sub.feedback,
      CASE WHEN datetime('now') > datetime(a.due_date) THEN 1 ELSE 0 END AS is_past_due
    FROM assignments a
    JOIN users u ON a.created_by = u.id
    LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = ?
    ORDER BY a.id DESC
  `).all(studentId);

  const assignments = rawAssignments.map(asg => {
    const isSubmitted = !!asg.submission_id;
    const isLate = isSubmitted && new Date(asg.submitted_at) > new Date(asg.due_date);
    return {
      ...asg,
      isSubmitted,
      isLate
    };
  });

  res.render('student/assignments', {
    title: 'Assignments & Coursework - Student Portal',
    pageName: 'assignments',
    assignments,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/assignments/submit/:id', assignmentUpload.single('file'), (req, res) => {
  const assignmentId = parseInt(req.params.id, 10);
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  if (!req.file) {
    return res.redirect('/student/assignments?error=' + encodeURIComponent('Please select a file to submit (PDF, DOC, ZIP up to 10MB).'));
  }

  try {
    const assignment = db.prepare("SELECT * FROM assignments WHERE id = ? AND tenant_id = ?").get(assignmentId, tenantId);
    if (!assignment) {
      return res.redirect('/student/assignments?error=' + encodeURIComponent('Assignment not found.'));
    }

    const filePath = '/uploads/assignments/' + req.file.filename;

    // Check if already submitted - update or insert (preserve history or replace deliverable)
    const existing = db.prepare("SELECT id FROM assignment_submissions WHERE assignment_id = ? AND student_id = ? AND tenant_id = ?").get(assignmentId, studentId, tenantId);
    if (existing) {
      db.prepare(`
        UPDATE assignment_submissions
        SET file_path = ?, submitted_at = datetime('now')
        WHERE id = ?
      `).run(filePath, existing.id);
    } else {
      db.prepare(`
        INSERT INTO assignment_submissions (assignment_id, student_id, file_path, submitted_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(assignmentId, studentId, filePath);
    }

    createNotification(studentId, `📤 File submitted for "${assignment.title}". Faculty evaluation pending.`, 'assignment');

    res.redirect('/student/assignments?success=' + encodeURIComponent('Assignment deliverable uploaded successfully!'));
  } catch (err) {
    console.error('Submit assignment error:', err);
    res.redirect('/student/assignments?error=' + encodeURIComponent('Failed to submit assignment: ' + err.message));
  }
});

/**
 * ==========================================
 * FEE MANAGEMENT & DEMO PAY (#5)
 * ==========================================
 */
router.get('/fees', (req, res) => {
  const studentId = req.session.user.id;

  const fees = db.prepare(`
    SELECT * FROM fees
    WHERE student_id = ?
    ORDER BY id DESC
  `).all(studentId);

  const totalDue = fees.reduce((acc, f) => acc + (f.status !== 'Paid' ? (f.amount_due - f.amount_paid) : 0), 0);
  const totalPaid = fees.reduce((acc, f) => acc + f.amount_paid, 0);

  res.render('student/fees', {
    title: 'Tuition Fees & Payments - Student Portal',
    pageName: 'fees',
    fees,
    totalDue,
    totalPaid,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/fees/pay/:id', (req, res) => {
  const feeId = parseInt(req.params.id, 10);
  const studentId = req.session.user.id;
  const tenantId = req.tenantId || 'tenant_default';

  try {
    const fee = db.prepare("SELECT * FROM fees WHERE id = ? AND student_id = ? AND tenant_id = ?").get(feeId, studentId, tenantId);
    if (!fee) {
      return res.redirect('/student/fees?error=' + encodeURIComponent('Fee invoice not found.'));
    }

    // Simulate instant payment success
    db.prepare(`
      UPDATE fees
      SET amount_paid = amount_due, status = 'Paid', paid_at = datetime('now')
      WHERE id = ?
    `).run(feeId);

    createNotification(studentId, `✅ Demo Transaction Approved: Paid ₹${fee.amount_due} for ${fee.term}. Payment recorded.`, 'fee');

    res.redirect('/student/fees?success=' + encodeURIComponent(`Demo transaction of ₹${fee.amount_due.toLocaleString('en-IN')} approved! Payment recorded for ${fee.term}.`));
  } catch (err) {
    console.error('Pay fee error:', err);
    res.redirect('/student/fees?error=' + encodeURIComponent('Transaction simulation failed.'));
  }
});

/**
 * ==========================================
 * STUDENT PROFILE & PHOTO UPLOAD (#7)
 * ==========================================
 */
router.get('/profile', (req, res) => {
  const student = db.prepare("SELECT id, name, email, roll_no, course, profile_photo, created_at FROM users WHERE id = ?").get(req.session.user.id);
  res.render('student/profile', {
    title: 'My Profile - Student Portal',
    pageName: 'profile',
    student,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/profile', avatarUpload.single('profile_photo'), (req, res) => {
  const studentId = req.session.user.id;
  const { name, course, current_password, new_password } = req.body;

  try {
    const currentUser = db.prepare("SELECT * FROM users WHERE id = ?").get(studentId);

    let photoPath = currentUser.profile_photo;
    if (req.file) {
      photoPath = '/uploads/avatars/' + req.file.filename;
    }

    // Password change check
    let newHash = currentUser.password;
    if (new_password) {
      if (!current_password) {
        return res.redirect('/student/profile?error=' + encodeURIComponent('Current password is required to change password.'));
      }
      const match = bcrypt.compareSync(current_password, currentUser.password);
      if (!match) {
        return res.redirect('/student/profile?error=' + encodeURIComponent('Current password was incorrect.'));
      }
      if (new_password.length < 6) {
        return res.redirect('/student/profile?error=' + encodeURIComponent('New password must be at least 6 characters.'));
      }
      newHash = bcrypt.hashSync(new_password, bcrypt.genSaltSync(10));
    }

    db.prepare(`
      UPDATE users 
      SET name = ?, course = ?, password = ?, profile_photo = ?
      WHERE id = ?
    `).run(name.trim(), course ? course.trim() : currentUser.course, newHash, photoPath, studentId);

    req.session.user.name = name.trim();
    req.session.user.profile_photo = photoPath;

    res.redirect('/student/profile?success=' + encodeURIComponent('Profile updated successfully!'));
  } catch (err) {
    console.error('Update student profile error:', err);
    res.redirect('/student/profile?error=' + encodeURIComponent('Failed to update profile: ' + err.message));
  }
});

/**
 * ==========================================
 * EXPORT STUDENT REPORT CSV (#10)
 * ==========================================
 */
router.get('/export/report.csv', (req, res) => {
  const studentId = req.session.user.id;
  const student = db.prepare("SELECT name, roll_no, course FROM users WHERE id = ?").get(studentId);
  const results = db.prepare("SELECT * FROM results WHERE student_id = ? ORDER BY id DESC").all(studentId);
  const attendance = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) AS attended FROM attendance WHERE student_id = ?").get(studentId);

  const attPct = attendance.total > 0 ? Math.round((attendance.attended / attendance.total) * 100) : 0;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="academic-summary-${student.roll_no}.csv"`);

  let csv = `Academic Progress Report for ${student.name} (${student.roll_no})\n`;
  csv += `Course,${student.course}\n`;
  csv += `Overall Attendance,${attPct}%\n\n`;
  csv += `Semester,Subject,Marks Obtained,Max Marks,Percentage,Exam Type\n`;
  results.forEach(r => {
    const pct = Math.round((r.marks_obtained / r.max_marks) * 100);
    csv += `"${r.semester || 'Semester 1'}","${r.subject}",${r.marks_obtained},${r.max_marks},${pct}%,"${r.exam_type}"\n`;
  });

  res.send(csv);
});

// Notifications mark read for student
router.post('/notifications/read-all', (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.session.user.id);
  res.redirect('back');
});

module.exports = router;
