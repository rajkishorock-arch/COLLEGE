const db = require('../config/db');
const bcrypt = require('bcryptjs');

function runMigrations() {
  console.log('🔄 Running database migrations & schema enhancements...');

  // 1. Table: attendance_sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      session_code TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      date TEXT NOT NULL,
      valid_from DATETIME NOT NULL,
      valid_until DATETIME NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // 2. Table: audit_log
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES users(id)
    );
  `);

  // 3. Table: announcements
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      posted_by INTEGER NOT NULL,
      priority TEXT DEFAULT 'normal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (posted_by) REFERENCES users(id)
    );
  `);

  // 4. Table: timetable
  db.exec(`
    CREATE TABLE IF NOT EXISTS timetable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      room TEXT,
      course TEXT
    );
  `);

  // 5. Table: assignments & assignment_submissions
  db.exec(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT,
      due_date DATETIME NOT NULL,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      file_path TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      grade TEXT,
      feedback TEXT,
      FOREIGN KEY (assignment_id) REFERENCES assignments(id),
      FOREIGN KEY (student_id) REFERENCES users(id)
    );
  `);

  // 6. Table: fees
  db.exec(`
    CREATE TABLE IF NOT EXISTS fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      amount_due INTEGER NOT NULL,
      amount_paid INTEGER DEFAULT 0,
      due_date TEXT,
      status TEXT DEFAULT 'Pending',
      paid_at DATETIME,
      FOREIGN KEY (student_id) REFERENCES users(id)
    );
  `);

  // 7. Table: notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      type TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // 8. Safely upgrade users table schema for 'super_admin' role & security columns
  const userTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (userTableInfo && !userTableInfo.sql.includes('super_admin')) {
    console.log('🔄 Upgrading users table schema to support super_admin and security columns...');
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT CHECK(role IN ('student', 'admin', 'super_admin')) NOT NULL DEFAULT 'student',
        roll_no TEXT UNIQUE,
        course TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        profile_photo TEXT,
        security_question TEXT,
        security_answer TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until DATETIME,
        last_failed_at DATETIME
      );
      INSERT INTO users_new (id, name, email, password, role, roll_no, course, created_at, profile_photo, security_question, security_answer)
        SELECT id, name, email, password, role, roll_no, course, created_at, profile_photo, security_question, security_answer FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Ensure security columns exist in users table
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userColumns.includes('profile_photo')) {
    db.exec("ALTER TABLE users ADD COLUMN profile_photo TEXT;");
  }
  if (!userColumns.includes('security_question')) {
    db.exec("ALTER TABLE users ADD COLUMN security_question TEXT;");
  }
  if (!userColumns.includes('security_answer')) {
    db.exec("ALTER TABLE users ADD COLUMN security_answer TEXT;");
  }
  if (!userColumns.includes('is_active')) {
    db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
  }
  if (!userColumns.includes('failed_attempts')) {
    db.exec("ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;");
  }
  if (!userColumns.includes('locked_until')) {
    db.exec("ALTER TABLE users ADD COLUMN locked_until DATETIME;");
  }
  if (!userColumns.includes('last_failed_at')) {
    db.exec("ALTER TABLE users ADD COLUMN last_failed_at DATETIME;");
  }

  // Update seeded primary admin to super_admin
  db.prepare("UPDATE users SET role = 'super_admin' WHERE email = 'admin@college.edu'").run();

  // Ensure audit_log has target_user_id
  const auditColumns = db.prepare("PRAGMA table_info(audit_log)").all().map(c => c.name);
  if (!auditColumns.includes('target_user_id')) {
    db.exec("ALTER TABLE audit_log ADD COLUMN target_user_id INTEGER;");
  }

  // 9. Safely add semester column to results
  const resultColumns = db.prepare("PRAGMA table_info(results)").all().map(c => c.name);
  if (!resultColumns.includes('semester')) {
    db.exec("ALTER TABLE results ADD COLUMN semester TEXT DEFAULT 'Semester 1';");
  }

  // 10. Seed default security question for existing users if not set
  const salt = bcrypt.genSaltSync(10);
  const defaultAnswerHash = bcrypt.hashSync('computer science', salt);
  db.prepare(`
    UPDATE users 
    SET security_question = COALESCE(security_question, 'What is your favorite subject?'),
        security_answer = COALESCE(security_answer, ?)
    WHERE security_answer IS NULL
  `).run(defaultAnswerHash);

  // 11. Seed initial sample announcements if empty
  const announceCount = db.prepare("SELECT COUNT(*) as count FROM announcements").get().count;
  if (announceCount === 0) {
    const admin = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1").get();
    const adminId = admin ? admin.id : 1;
    const insertAnnounce = db.prepare(`
      INSERT INTO announcements (title, body, posted_by, priority, created_at)
      VALUES (?, ?, ?, ?, datetime('now', ?))
    `);
    insertAnnounce.run('Mid-Semester Examination Schedule Announced', 'All students must verify their examination halls and schedules. Admit cards can be downloaded from the student portal starting next Monday.', adminId, 'urgent', '-2 hours');
    insertAnnounce.run('Annual Technical Symposium Registrations Open', 'Registration for HackSprint 2026 is officially live. Teams of 2-4 can register for algorithmic hackathons, AI showcases, and paper presentations.', adminId, 'normal', '-1 day');
    insertAnnounce.run('Library Working Hours Extended for Finals', 'The Central Library and Reading Rooms will remain open until 11:00 PM throughout the examination month.', adminId, 'normal', '-3 days');
  }

  // 12. Seed timetable slots if empty
  const timetableCount = db.prepare("SELECT COUNT(*) as count FROM timetable").get().count;
  if (timetableCount === 0) {
    const insertTimetable = db.prepare(`
      INSERT INTO timetable (subject, day_of_week, start_time, end_time, room, course)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const slots = [
      ['Data Structures & Algorithms', 'Monday', '09:00', '10:30', 'Hall A-101', 'B.Tech Computer Science'],
      ['Database Management Systems', 'Monday', '10:45', '12:15', 'Lab CS-2', 'B.Tech Computer Science'],
      ['Operating Systems', 'Monday', '13:15', '14:45', 'Hall B-204', 'B.Tech Computer Science'],
      ['Web Technologies', 'Tuesday', '09:00', '10:30', 'Lab CS-1', 'B.Tech Computer Science'],
      ['Computer Networks', 'Tuesday', '10:45', '12:15', 'Hall A-102', 'B.Tech Computer Science'],
      ['Data Structures & Algorithms', 'Wednesday', '09:00', '10:30', 'Hall A-101', 'B.Tech Computer Science'],
      ['Software Engineering', 'Wednesday', '10:45', '12:15', 'Hall C-301', 'B.Tech Computer Science'],
      ['Artificial Intelligence', 'Thursday', '09:00', '10:30', 'AI Lab', 'B.Tech Computer Science'],
      ['Database Management Systems', 'Thursday', '10:45', '12:15', 'Lab CS-2', 'B.Tech Computer Science'],
      ['Operating Systems', 'Friday', '09:00', '10:30', 'Hall B-204', 'B.Tech Computer Science'],
      ['Computer Networks', 'Friday', '10:45', '12:15', 'Lab CS-3', 'B.Tech Computer Science'],
    ];
    slots.forEach(s => insertTimetable.run(...s));
  }

  // 13. Seed sample assignments if empty
  const assignmentCount = db.prepare("SELECT COUNT(*) as count FROM assignments").get().count;
  if (assignmentCount === 0) {
    const admin = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1").get();
    const adminId = admin ? admin.id : 1;
    const insertAssign = db.prepare(`
      INSERT INTO assignments (title, subject, description, due_date, created_by, created_at)
      VALUES (?, ?, ?, datetime('now', ?), ?, datetime('now', ?))
    `);
    insertAssign.run(
      'Balanced Search Trees Implementation',
      'Data Structures & Algorithms',
      'Implement an AVL tree and Red-Black tree with insertion, deletion, and rotation visualizations in Java or C++. Submit code archive with documentation.',
      '+5 days',
      adminId,
      '-2 days'
    );
    insertAssign.run(
      'Relational Database Normalization Case Study',
      'Database Management Systems',
      'Analyze the provided unnormalized hospital management dataset. Produce 1NF, 2NF, 3NF schemas with ER diagrams and SQL DDL scripts.',
      '+10 days',
      adminId,
      '-1 day'
    );
    insertAssign.run(
      'Process Synchronization and Semaphores Lab',
      'Operating Systems',
      'Solve the classic Dining Philosophers and Reader-Writer problems using POSIX mutexes and condition variables.',
      '-1 day', // Past due for late testing
      adminId,
      '-7 days'
    );
  }

  // 14. Seed sample fees if empty
  const feesCount = db.prepare("SELECT COUNT(*) as count FROM fees").get().count;
  if (feesCount === 0) {
    const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all();
    const insertFee = db.prepare(`
      INSERT INTO fees (student_id, term, amount_due, amount_paid, due_date, status, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    students.forEach((st, idx) => {
      if (idx === 0) {
        // Alex: Semester 5 paid, Semester 6 pending
        insertFee.run(st.id, 'Semester 5', 45000, 45000, '2026-01-15', 'Paid', '2026-01-10 14:22:00');
        insertFee.run(st.id, 'Semester 6', 45000, 0, '2026-10-15', 'Pending', null);
      } else if (idx === 1) {
        insertFee.run(st.id, 'Semester 6', 45000, 20000, '2026-10-15', 'Partial', '2026-09-01 11:30:00');
      } else {
        insertFee.run(st.id, 'Semester 6', 45000, 0, '2026-10-15', 'Pending', null);
      }
    });
  }

  // 15. Seed sample notifications if empty
  const notifCount = db.prepare("SELECT COUNT(*) as count FROM notifications").get().count;
  if (notifCount === 0) {
    const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all();
    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, message, type, is_read, created_at)
      VALUES (?, ?, ?, ?, datetime('now', ?))
    `);
    students.forEach(st => {
      insertNotif.run(st.id, 'New announcement posted: Mid-Semester Examination Schedule Announced', 'announcement', 0, '-2 hours');
      insertNotif.run(st.id, 'New assignment posted in Data Structures & Algorithms: Balanced Search Trees Implementation', 'assignment', 0, '-5 hours');
      insertNotif.run(st.id, 'Fee reminder: Semester 6 tuition dues are scheduled for October 15, 2026', 'fee', 1, '-1 day');
    });
  }

  // 16. Seed sample audit logs if empty
  const auditCount = db.prepare("SELECT COUNT(*) as count FROM audit_log").get().count;
  if (auditCount === 0) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const adminId = admin ? admin.id : 1;
    const insertAudit = db.prepare(`
      INSERT INTO audit_log (admin_id, action, details, created_at)
      VALUES (?, ?, ?, datetime('now', ?))
    `);
    insertAudit.run(adminId, 'System Initialized', 'Database and security permissions initialized successfully.', '-3 days');
    insertAudit.run(adminId, 'Posted Announcement', 'Published "Mid-Semester Examination Schedule Announced".', '-2 hours');
    insertAudit.run(adminId, 'Created Assignment', 'Added Balanced Search Trees assignment for DSA.', '-5 hours');
  }

  // 17. Seed multi-semester results if existing results only have Semester 1
  const existingResults = db.prepare("SELECT id, semester FROM results").all();
  if (existingResults.length > 0 && !existingResults.some(r => r.semester === 'Semester 2' || r.semester === 'Semester 3')) {
    const updateResult = db.prepare("UPDATE results SET semester = ? WHERE id = ?");
    existingResults.forEach((r, idx) => {
      if (idx % 3 === 0) updateResult.run('Semester 3', r.id);
      else if (idx % 2 === 0) updateResult.run('Semester 2', r.id);
      else updateResult.run('Semester 1', r.id);
    });
  }

  // 18. Multi-Tenant Architecture Migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      code TEXT UNIQUE NOT NULL,
      subdomain TEXT UNIQUE,
      logo TEXT,
      primary_color TEXT DEFAULT '#6C5CE7',
      secondary_color TEXT DEFAULT '#111318',
      email TEXT,
      phone TEXT,
      address TEXT,
      status TEXT CHECK(status IN ('active', 'suspended', 'inactive')) DEFAULT 'active',
      academic_year TEXT DEFAULT '2025-2026',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure default tenant exists
  const defaultTenant = db.prepare("SELECT id FROM tenants WHERE id = 'tenant_default'").get();
  if (!defaultTenant) {
    db.prepare(`
      INSERT INTO tenants (id, name, short_name, code, subdomain, email, phone, address, status, academic_year, primary_color, secondary_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'tenant_default',
      'CampusPulse Institute of Technology',
      'CPIT',
      'DEFAULT',
      'default',
      'contact@college.edu',
      '+1 (555) 234-5678',
      '100 University Boulevard, Tech Campus',
      'active',
      '2025-2026',
      '#6C5CE7',
      '#111318'
    );
  }

  // Ensure tenant_id exists across all application tables
  const appTables = [
    'users', 'attendance', 'attendance_sessions', 'results',
    'books', 'book_issues', 'quizzes', 'quiz_questions', 'quiz_attempts',
    'announcements', 'timetable', 'assignments', 'assignment_submissions',
    'fees', 'notifications', 'audit_log'
  ];

  appTables.forEach(tableName => {
    const tableInfo = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
    if (tableInfo) {
      const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
      if (!cols.includes('tenant_id')) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN tenant_id TEXT DEFAULT 'tenant_default';`);
        db.exec(`UPDATE ${tableName} SET tenant_id = 'tenant_default' WHERE tenant_id IS NULL;`);
      }
    }
  });

  // Seed secondary tenant 'tenant_apex' for multi-tenant isolation testing & demonstration
  const apexTenant = db.prepare("SELECT id FROM tenants WHERE id = 'tenant_apex'").get();
  if (!apexTenant) {
    db.prepare(`
      INSERT INTO tenants (id, name, short_name, code, subdomain, email, phone, address, status, academic_year, primary_color, secondary_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'tenant_apex',
      'Apex Institute of Technology',
      'AIT',
      'APEX',
      'apex',
      'contact@apex.edu',
      '+1 (555) 876-5432',
      '404 Innovation Way, Silicon Valley',
      'active',
      '2025-2026',
      '#00B894',
      '#0F172A'
    );

    // Seed Apex Admin & Student
    const apexPassHash = bcrypt.hashSync('admin123', salt);
    const apexStudentPassHash = bcrypt.hashSync('student123', salt);

    const existingApexAdmin = db.prepare("SELECT id FROM users WHERE email = 'admin@apex.edu'").get();
    if (!existingApexAdmin) {
      db.prepare(`
        INSERT INTO users (tenant_id, name, email, password, role, is_active, security_question, security_answer)
        VALUES ('tenant_apex', 'Apex College Admin', 'admin@apex.edu', ?, 'admin', 1, 'What is your favorite subject?', ?)
      `).run(apexPassHash, defaultAnswerHash);
    }

    const existingApexStudent = db.prepare("SELECT id FROM users WHERE email = 'student@apex.edu'").get();
    let apexStudentId = existingApexStudent ? existingApexStudent.id : null;
    if (!existingApexStudent) {
      const res = db.prepare(`
        INSERT INTO users (tenant_id, name, email, password, role, roll_no, course, is_active, security_question, security_answer)
        VALUES ('tenant_apex', 'Sarah Connor', 'student@apex.edu', ?, 'student', 'AIT-2026-001', 'B.Tech Robotics & AI', 1, 'What is your favorite subject?', ?)
      `).run(apexStudentPassHash, defaultAnswerHash);
      apexStudentId = res.lastInsertRowid;
    }

    // Seed sample Apex Books
    const apexBook = db.prepare(`
      INSERT INTO books (tenant_id, title, author, category, total_copies, available_copies)
      VALUES ('tenant_apex', ?, ?, ?, ?, ?)
    `);
    apexBook.run('Robotics: Modelling, Planning and Control', 'Bruno Siciliano', 'Robotics', 5, 5);
    apexBook.run('Deep Learning for Computer Vision', 'Ian Goodfellow', 'Artificial Intelligence', 4, 3);

    // Seed sample Apex Announcement
    db.prepare(`
      INSERT INTO announcements (tenant_id, title, body, posted_by, priority)
      VALUES ('tenant_apex', 'Welcome to Apex Institute Fall Semester', 'Apex Institute of Technology welcomes all engineering students to the 2026 academic term.', 1, 'urgent')
    `).run();

    // Seed sample Apex Quiz
    const apexQuiz = db.prepare(`
      INSERT INTO quizzes (tenant_id, title, subject)
      VALUES ('tenant_apex', 'Introduction to Autonomous Robotics', 'Robotics')
    `).run();

    db.prepare(`
      INSERT INTO quiz_questions (tenant_id, quiz_id, question, option_a, option_b, option_c, option_d, correct_option)
      VALUES ('tenant_apex', ?, 'What sensor is commonly used in autonomous robot mapping?', 'LiDAR', 'Barometer', 'Hydrometer', 'Thermopile', 'a')
    `).run(apexQuiz.lastInsertRowid);
  }

  console.log('✅ Migrations complete: all 11 modules and multi-tenant SaaS architecture initialized successfully.');
}

module.exports = runMigrations;
