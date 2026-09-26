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
      owner_user_id INTEGER,
      institution_type TEXT DEFAULT 'college',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure owner_user_id and institution_type columns exist in tenants
  // Ensure owner_user_id, institution_type, data_region, plan_tier, verification_status, and aicte_code columns exist in tenants
  try {
    const tenantCols = db.prepare("PRAGMA table_info(tenants)").all().map(c => c.name);
    if (!tenantCols.includes('owner_user_id')) {
      db.exec("ALTER TABLE tenants ADD COLUMN owner_user_id INTEGER;");
    }
    if (!tenantCols.includes('institution_type')) {
      db.exec("ALTER TABLE tenants ADD COLUMN institution_type TEXT DEFAULT 'college';");
    }
    if (!tenantCols.includes('data_region')) {
      db.exec("ALTER TABLE tenants ADD COLUMN data_region TEXT DEFAULT 'in-west-mumbai';");
    }
    if (!tenantCols.includes('plan_tier')) {
      db.exec("ALTER TABLE tenants ADD COLUMN plan_tier TEXT DEFAULT 'professional';");
    }
    if (!tenantCols.includes('verification_status')) {
      db.exec("ALTER TABLE tenants ADD COLUMN verification_status TEXT DEFAULT 'verified';");
    }
    if (!tenantCols.includes('aicte_code')) {
      db.exec("ALTER TABLE tenants ADD COLUMN aicte_code TEXT;");
    }
  } catch (err) {
    // Non-fatal
  }

  // Create email_verifications table for OTP verification
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      is_verified INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_verif_lookup ON email_verifications(email, otp_code);
  `);

  // Ensure default tenant exists
  const defaultTenant = db.prepare("SELECT id FROM tenants WHERE id = 'tenant_default'").get();
  if (!defaultTenant) {
    db.prepare(`
      INSERT INTO tenants (id, name, short_name, code, subdomain, email, phone, address, status, academic_year, primary_color, secondary_color, institution_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      '#111318',
      'technology_institute'
    );
  }

  // Backfill default tenant owner if empty
  const defaultAdmin = db.prepare("SELECT id FROM users WHERE tenant_id = 'tenant_default' AND role IN ('admin', 'super_admin') ORDER BY id ASC LIMIT 1").get();
  if (defaultAdmin) {
    db.prepare("UPDATE tenants SET owner_user_id = ? WHERE id = 'tenant_default' AND owner_user_id IS NULL").run(defaultAdmin.id);
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

    const apexAdmin = db.prepare("SELECT id FROM users WHERE email = 'admin@apex.edu'").get();
    if (apexAdmin) {
      db.prepare("UPDATE tenants SET owner_user_id = ? WHERE id = 'tenant_apex' AND owner_user_id IS NULL").run(apexAdmin.id);
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

  // 19. Phase 3: Departments & Invitations Architecture
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      head_of_department TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, code)
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      token_hash TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, email, token_hash)
    );
  `);

  // Optional department_id columns
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes('department_id')) {
      db.exec("ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;");
    }
    const ttCols = db.prepare("PRAGMA table_info(timetable)").all().map(c => c.name);
    if (!ttCols.includes('department_id')) {
      db.exec("ALTER TABLE timetable ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;");
    }
    const asgCols = db.prepare("PRAGMA table_info(assignments)").all().map(c => c.name);
    if (!asgCols.includes('department_id')) {
      db.exec("ALTER TABLE assignments ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;");
    }
  } catch (colErr) {
    // Non-fatal if already present
  }

  // 20. Tier-3 Advanced Enterprise Features Suite (Features 21 - 28)
  console.log('🚀 Running Tier-3 Advanced Enterprise Features schema migration...');

  // 20.1 Feature 21: Predictive Academic Intelligence & Intervention System
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      predicted_gpa REAL NOT NULL,
      current_cgpa REAL,
      risk_level TEXT CHECK(risk_level IN ('GREEN', 'YELLOW', 'RED', 'CRITICAL')) NOT NULL,
      failure_probability REAL DEFAULT 0.0,
      key_risk_factors TEXT,
      model_version TEXT DEFAULT 'xgboost-v3.2',
      confidence_score REAL DEFAULT 0.88,
      last_calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS academic_interventions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_code TEXT,
      risk_level TEXT CHECK(risk_level IN ('YELLOW', 'RED', 'CRITICAL')) NOT NULL,
      intervention_type TEXT CHECK(intervention_type IN ('faculty_counseling', 'peer_tutoring', 'remedial_quiz', 'parent_meeting', 'study_plan')) NOT NULL,
      status TEXT CHECK(status IN ('recommended', 'in_progress', 'completed', 'dismissed')) DEFAULT 'recommended',
      assigned_faculty_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      recommendation_notes TEXT,
      outcome_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS study_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      weak_topic TEXT NOT NULL,
      recommendation_type TEXT CHECK(recommendation_type IN ('video', 'problem_set', 'reading', 'peer_group')) NOT NULL,
      title TEXT NOT NULL,
      resource_url TEXT,
      difficulty_level TEXT CHECK(difficulty_level IN ('Easy', 'Medium', 'Hard')) DEFAULT 'Medium',
      is_completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS placement_readiness (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      readiness_score INTEGER NOT NULL,
      academic_score REAL DEFAULT 0,
      communication_score REAL DEFAULT 0,
      technical_score REAL DEFAULT 0,
      internship_score REAL DEFAULT 0,
      certification_score REAL DEFAULT 0,
      cocurricular_score REAL DEFAULT 0,
      skill_gaps TEXT,
      recommended_certifications TEXT,
      assessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, student_id)
    );
  `);

  // 20.2 Feature 22: Advanced Curriculum & Course Analytics
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      topic_name TEXT NOT NULL,
      difficulty_index REAL DEFAULT 0.5,
      difficulty_category TEXT CHECK(difficulty_category IN ('Easy', 'Medium', 'Hard', 'Very Hard')) DEFAULT 'Medium',
      topic_failure_rate REAL DEFAULT 0.0,
      avg_quiz_score REAL DEFAULT 70.0,
      avg_time_spent_mins INTEGER DEFAULT 45,
      UNIQUE(tenant_id, subject, topic_name)
    );

    CREATE TABLE IF NOT EXISTS faculty_teaching_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      term TEXT NOT NULL,
      student_satisfaction_rating REAL DEFAULT 4.0,
      course_completion_pct REAL DEFAULT 85.0,
      teaching_effectiveness_score REAL DEFAULT 82.0,
      student_pass_rate_pct REAL DEFAULT 88.0,
      feedback_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS learning_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      course_code TEXT NOT NULL,
      co_code TEXT NOT NULL,
      description TEXT NOT NULL,
      target_attainment_pct REAL DEFAULT 75.0,
      actual_attainment_pct REAL DEFAULT 70.0,
      accreditation_standard TEXT DEFAULT 'NAAC/NBA',
      UNIQUE(tenant_id, course_code, co_code)
    );
  `);

  // 20.3 Feature 23: Dynamic Timetable Optimization & Smart Room Management
  db.exec(`
    CREATE TABLE IF NOT EXISTS campus_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      room_number TEXT NOT NULL,
      building TEXT NOT NULL,
      room_type TEXT CHECK(room_type IN ('lecture_hall', 'classroom', 'lab', 'seminar_hall')) NOT NULL,
      capacity INTEGER NOT NULL,
      has_projector INTEGER DEFAULT 1,
      has_wifi INTEGER DEFAULT 1,
      is_accessible INTEGER DEFAULT 1,
      status TEXT CHECK(status IN ('available', 'occupied', 'maintenance')) DEFAULT 'available',
      UNIQUE(tenant_id, room_number, building)
    );

    CREATE TABLE IF NOT EXISTS room_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES campus_rooms(id) ON DELETE CASCADE,
      resource_name TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'operational',
      last_inspected_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS online_class_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      title TEXT NOT NULL,
      faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      meeting_url TEXT NOT NULL,
      scheduled_at DATETIME NOT NULL,
      duration_minutes INTEGER DEFAULT 60,
      is_recorded INTEGER DEFAULT 0,
      recording_url TEXT,
      attendance_count INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('scheduled', 'live', 'completed', 'cancelled')) DEFAULT 'scheduled'
    );
  `);

  // 20.4 Feature 24: Smart Library 2.0 & Digital Knowledge Management
  db.exec(`
    CREATE TABLE IF NOT EXISTS digital_learning_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      author_name TEXT,
      version TEXT DEFAULT 'v1.0',
      access_level TEXT CHECK(access_level IN ('public', 'department', 'enrolled')) DEFAULT 'public',
      download_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS faculty_publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      journal_or_conference TEXT NOT NULL,
      publication_year INTEGER NOT NULL,
      doi TEXT,
      citations_count INTEGER DEFAULT 0,
      impact_factor REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 20.5 Feature 25: Multi-Institutional Insights & Federation
  db.exec(`
    CREATE TABLE IF NOT EXISTS consortium_benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      institution_category TEXT NOT NULL,
      benchmark_metric TEXT NOT NULL,
      college_value REAL NOT NULL,
      peer_group_avg REAL NOT NULL,
      national_avg REAL NOT NULL,
      top_decile_val REAL NOT NULL,
      period TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inter_institutional_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      student_roll_no TEXT,
      source_institution TEXT NOT NULL,
      target_institution TEXT NOT NULL,
      credits_transferred INTEGER NOT NULL,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      cryptographic_transcript_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 20.6 Feature 26: Industry & Placement Management 2.0
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_openings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      role_type TEXT NOT NULL,
      ctc_lpa REAL NOT NULL,
      min_cgpa REAL DEFAULT 6.5,
      location TEXT NOT NULL,
      required_skills TEXT NOT NULL,
      deadline_date TEXT NOT NULL,
      drive_date TEXT,
      status TEXT CHECK(status IN ('open', 'interviewing', 'closed')) DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS job_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fit_probability_pct INTEGER DEFAULT 75,
      application_status TEXT CHECK(application_status IN ('applied', 'shortlisted', 'interview_scheduled', 'offered', 'rejected')) DEFAULT 'applied',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      interview_feedback TEXT,
      UNIQUE(tenant_id, job_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS alumni_network (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      graduation_year INTEGER NOT NULL,
      current_company TEXT NOT NULL,
      current_role TEXT NOT NULL,
      mentorship_domain TEXT,
      contact_email TEXT NOT NULL,
      linkedin_url TEXT,
      is_mentor_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 20.7 Feature 27: Parent/Guardian Engagement Portal
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_name TEXT NOT NULL,
      relationship TEXT CHECK(relationship IN ('Father', 'Mother', 'Guardian')) DEFAULT 'Father',
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      access_pin_hash TEXT NOT NULL,
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS parent_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES parent_profiles(id) ON DELETE CASCADE,
      alert_type TEXT CHECK(alert_type IN ('attendance_low', 'grade_risk', 'fee_due', 'achievement', 'general')) NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT CHECK(priority IN ('normal', 'urgent', 'critical')) DEFAULT 'normal',
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parent_teacher_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id INTEGER NOT NULL REFERENCES parent_profiles(id) ON DELETE CASCADE,
      faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_role TEXT CHECK(sender_role IN ('parent', 'faculty')) NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 20.8 Feature 28: Competency-Based Learning Pathways
  db.exec(`
    CREATE TABLE IF NOT EXISTS competencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT CHECK(category IN ('technical', 'soft_skill', 'domain')) NOT NULL,
      description TEXT,
      max_level TEXT DEFAULT 'Master',
      UNIQUE(tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS student_competencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      competency_id INTEGER NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
      current_level TEXT CHECK(current_level IN ('Novice', 'Intermediate', 'Advanced', 'Master')) DEFAULT 'Novice',
      score_pct REAL DEFAULT 50.0,
      badge_awarded TEXT,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, student_id, competency_id)
    );

    CREATE TABLE IF NOT EXISTS learning_pathways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      role_target TEXT NOT NULL,
      description TEXT,
      total_milestones INTEGER DEFAULT 5,
      required_skills TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS student_pathway_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pathway_id INTEGER NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,
      current_milestone INTEGER DEFAULT 1,
      completion_pct REAL DEFAULT 20.0,
      status TEXT CHECK(status IN ('active', 'completed', 'paused')) DEFAULT 'active',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, student_id, pathway_id)
    );
  `);

  // Tier-3 Performance & Isolation Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_student_predictions_tenant_risk ON student_predictions(tenant_id, risk_level);
    CREATE INDEX IF NOT EXISTS idx_academic_interventions_tenant_student ON academic_interventions(tenant_id, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_study_recommendations_student ON study_recommendations(tenant_id, student_id, is_completed);
    CREATE INDEX IF NOT EXISTS idx_placement_readiness_score ON placement_readiness(tenant_id, readiness_score DESC);
    CREATE INDEX IF NOT EXISTS idx_course_topics_subject ON course_topics(tenant_id, subject);
    CREATE INDEX IF NOT EXISTS idx_faculty_teaching_analytics_faculty ON faculty_teaching_analytics(tenant_id, faculty_id);
    CREATE INDEX IF NOT EXISTS idx_learning_outcomes_course ON learning_outcomes(tenant_id, course_code);
    CREATE INDEX IF NOT EXISTS idx_campus_rooms_status ON campus_rooms(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_job_openings_deadline ON job_openings(tenant_id, deadline_date, status);
    CREATE INDEX IF NOT EXISTS idx_job_applications_student ON job_applications(tenant_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_parent_profiles_student ON parent_profiles(tenant_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_parent_alerts_parent ON parent_alerts(tenant_id, parent_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_student_competencies_student ON student_competencies(tenant_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_pathway_progress_student ON student_pathway_progress(tenant_id, student_id);
  `);

  // 20.9 Seed Initial Tier-3 Sample Data if empty
  const predCount = db.prepare("SELECT COUNT(*) as count FROM student_predictions").get().count;
  if (predCount === 0) {
    console.log('🌱 Seeding rich Tier-3 analytical records and benchmark metrics...');

    const alex = db.prepare("SELECT id FROM users WHERE email = 'alex@college.edu'").get();
    const priya = db.prepare("SELECT id FROM users WHERE email = 'priya@college.edu'").get();
    const rohit = db.prepare("SELECT id FROM users WHERE email = 'rohit@college.edu'").get();
    const faculty = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1").get();
    const facultyId = faculty ? faculty.id : 1;

    // A) Seed Student Predictions
    const insertPrediction = db.prepare(`
      INSERT INTO student_predictions (tenant_id, student_id, predicted_gpa, current_cgpa, risk_level, failure_probability, key_risk_factors, model_version, confidence_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (alex) {
      insertPrediction.run('tenant_default', alex.id, 8.92, 8.85, 'GREEN', 0.02, JSON.stringify([]), 'xgboost-v3.2', 0.94);
    }
    if (priya) {
      insertPrediction.run('tenant_default', priya.id, 7.15, 7.20, 'YELLOW', 0.15, JSON.stringify(['Midterm dip in Computer Networks', '2 resubmitted assignments']), 'xgboost-v3.2', 0.89);
    }
    if (rohit) {
      insertPrediction.run('tenant_default', rohit.id, 5.20, 5.65, 'CRITICAL', 0.72, JSON.stringify(['Attendance below 65% in DBMS', 'Failed Quiz 1 in AI', '3 missed assignment deadlines']), 'xgboost-v3.2', 0.91);
    }

    // B) Seed Academic Interventions
    const insertIntervention = db.prepare(`
      INSERT INTO academic_interventions (tenant_id, student_id, course_code, risk_level, intervention_type, status, assigned_faculty_id, recommendation_notes, outcome_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);

    if (rohit) {
      insertIntervention.run('tenant_default', rohit.id, 'CS301-DBMS', 'CRITICAL', 'faculty_counseling', 'in_progress', facultyId, 'Student struggling with SQL relational normal forms. Scheduled 1-on-1 bi-weekly guidance session.', null, '-3 days');
      insertIntervention.run('tenant_default', rohit.id, 'CS302-AI', 'CRITICAL', 'remedial_quiz', 'recommended', facultyId, 'Assign practice mock tests covering A* search and alpha-beta pruning before mid-term exams.', null, '-1 day');
      insertIntervention.run('tenant_default', rohit.id, 'CS301-DBMS', 'CRITICAL', 'parent_meeting', 'recommended', facultyId, 'Inform guardian of low attendance (64%) and arrange counseling review.', null, '-12 hours');
    }
    if (priya) {
      insertIntervention.run('tenant_default', priya.id, 'CS303-CN', 'YELLOW', 'peer_tutoring', 'completed', facultyId, 'Paired with Alex Johnson for socket programming and packet tracer lab assignments.', 'Lab submission grade improved from 65% to 88%.', '-2 weeks');
    }

    // C) Seed Study Recommendations
    const insertStudyRec = db.prepare(`
      INSERT INTO study_recommendations (tenant_id, student_id, subject, weak_topic, recommendation_type, title, resource_url, difficulty_level, is_completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (rohit) {
      insertStudyRec.run('tenant_default', rohit.id, 'Database Management Systems', 'Normalization & 3NF/BCNF', 'video', 'MIT OpenCourseWare: Relational Normalization Masterclass', 'https://ocw.mit.edu/courses/electrical-engineering-and-computer-science', 'Medium', 0);
      insertStudyRec.run('tenant_default', rohit.id, 'Operating Systems', 'Process Synchronization & Semaphores', 'problem_set', 'Interactive Dining Philosophers Deadlock Simulator', 'https://visualgo.net/en', 'Hard', 0);
      insertStudyRec.run('tenant_default', rohit.id, 'Artificial Intelligence', 'Heuristic State-Space Search', 'reading', 'Russell & Norvig Chapter 3: Informed Search Algorithms', 'https://aima.cs.berkeley.edu', 'Medium', 0);
    }
    if (priya) {
      insertStudyRec.run('tenant_default', priya.id, 'Computer Networks', 'TCP Congestion Control & Sliding Window', 'video', 'Stanford CS144: TCP Sliding Window In-Depth', 'https://cs144.github.io', 'Medium', 1);
      insertStudyRec.run('tenant_default', priya.id, 'Software Engineering', 'CI/CD Pipeline Design', 'problem_set', 'GitHub Actions Automated Testing Lab', 'https://lab.github.com', 'Easy', 0);
    }
    if (alex) {
      insertStudyRec.run('tenant_default', alex.id, 'Data Structures & Algorithms', 'Segment Trees & Fenwick Trees', 'problem_set', 'Competitive Programming 4: Range Query Problems', 'https://cp-algorithms.com', 'Hard', 1);
    }

    // D) Seed Placement Readiness
    const insertPlacementReadiness = db.prepare(`
      INSERT INTO placement_readiness (tenant_id, student_id, readiness_score, academic_score, communication_score, technical_score, internship_score, certification_score, cocurricular_score, skill_gaps, recommended_certifications)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (alex) {
      insertPlacementReadiness.run('tenant_default', alex.id, 94, 92.0, 90.0, 96.0, 95.0, 90.0, 95.0, JSON.stringify(['Large-Scale Distributed Systems']), JSON.stringify(['AWS Certified Solutions Architect', 'CKA Kubernetes']));
    }
    if (priya) {
      insertPlacementReadiness.run('tenant_default', priya.id, 76, 75.0, 78.0, 80.0, 70.0, 75.0, 70.0, JSON.stringify(['System Design Interview', 'Docker Containerization']), JSON.stringify(['Docker Certified Associate', 'AWS Cloud Practitioner']));
    }
    if (rohit) {
      insertPlacementReadiness.run('tenant_default', rohit.id, 46, 55.0, 50.0, 48.0, 30.0, 30.0, 40.0, JSON.stringify(['Data Structures Mastery', 'Resume Projects Overhaul', 'Mock Technical Interviews']), JSON.stringify(['Meta Front-End Specialization', 'Oracle SQL Associate']));
    }

    // E) Seed Course Topics & Analytics
    const insertTopic = db.prepare(`
      INSERT INTO course_topics (tenant_id, subject, topic_name, difficulty_index, difficulty_category, topic_failure_rate, avg_quiz_score, avg_time_spent_mins)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTopic.run('tenant_default', 'Data Structures & Algorithms', 'Arrays, Strings & Two Pointers', 0.25, 'Easy', 8.5, 84.0, 35);
    insertTopic.run('tenant_default', 'Data Structures & Algorithms', 'Balanced Binary Search Trees (AVL/Red-Black)', 0.65, 'Hard', 38.0, 64.5, 75);
    insertTopic.run('tenant_default', 'Data Structures & Algorithms', 'Dynamic Programming & Memoization', 0.88, 'Very Hard', 62.0, 48.0, 110);
    insertTopic.run('tenant_default', 'Database Management Systems', 'SQL Queries & Relational Algebra', 0.30, 'Easy', 12.0, 78.5, 40);
    insertTopic.run('tenant_default', 'Database Management Systems', 'Schema Normalization (1NF to BCNF)', 0.72, 'Hard', 44.5, 59.0, 85);
    insertTopic.run('tenant_default', 'Database Management Systems', 'Transaction Concurrency & Strict 2PL', 0.82, 'Very Hard', 56.0, 52.0, 95);
    insertTopic.run('tenant_default', 'Operating Systems', 'Process Scheduling & Context Switching', 0.35, 'Easy', 14.0, 76.0, 45);
    insertTopic.run('tenant_default', 'Operating Systems', 'Virtual Memory & Page Replacement', 0.60, 'Medium', 32.0, 67.0, 65);

    // F) Seed Faculty Teaching Analytics
    const insertFacultyAnalytics = db.prepare(`
      INSERT INTO faculty_teaching_analytics (tenant_id, faculty_id, subject, term, student_satisfaction_rating, course_completion_pct, teaching_effectiveness_score, student_pass_rate_pct, feedback_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertFacultyAnalytics.run('tenant_default', facultyId, 'Data Structures & Algorithms', 'Fall 2025', 4.8, 96.0, 94.5, 92.0, 'Exceptional algorithmic visualizations and helpful office hours.');
    insertFacultyAnalytics.run('tenant_default', facultyId, 'Database Management Systems', 'Fall 2025', 4.5, 91.0, 88.0, 86.5, 'Strong practical SQL exercises; suggested adding more examples on BCNF decomposition.');

    // G) Seed Learning Outcomes
    const insertLO = db.prepare(`
      INSERT INTO learning_outcomes (tenant_id, course_code, co_code, description, target_attainment_pct, actual_attainment_pct, accreditation_standard)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertLO.run('tenant_default', 'CS201', 'CO1', 'Understand core linear and non-linear data structures and operations.', 75.0, 84.5, 'NAAC/NBA');
    insertLO.run('tenant_default', 'CS201', 'CO2', 'Implement self-balancing search trees and graph traversal algorithms.', 70.0, 72.0, 'NAAC/NBA');
    insertLO.run('tenant_default', 'CS201', 'CO3', 'Analyze worst-case and amortized time/space complexity using Big-O notation.', 75.0, 78.5, 'NAAC/NBA');
    insertLO.run('tenant_default', 'CS201', 'CO4', 'Synthesize optimal greedy and dynamic programming solutions for computational problems.', 65.0, 68.0, 'NAAC/NBA');

    // H) Seed Campus Rooms & Resources
    const insertRoom = db.prepare(`
      INSERT INTO campus_rooms (tenant_id, room_number, building, room_type, capacity, has_projector, has_wifi, is_accessible, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const r1 = insertRoom.run('tenant_default', 'Hall A-101', 'Turing Academic Block', 'lecture_hall', 120, 1, 1, 1, 'available');
    const r2 = insertRoom.run('tenant_default', 'Lab CS-1', 'Babbage Computing Center', 'lab', 40, 1, 1, 1, 'available');
    const r3 = insertRoom.run('tenant_default', 'Auditorium Alpha', 'Main Convention Complex', 'seminar_hall', 300, 1, 1, 1, 'available');

    const insertResource = db.prepare(`
      INSERT INTO room_resources (tenant_id, room_id, resource_name, resource_type, quantity, status, last_inspected_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);

    insertResource.run('tenant_default', r1.lastInsertRowid, 'Laser 4K Projector', 'Audio-Visual', 1, 'operational', '-10 days');
    insertResource.run('tenant_default', r2.lastInsertRowid, 'High-Performance GPU Workstations', 'IT Equipment', 40, 'operational', '-5 days');

    // I) Seed Digital Learning Materials
    const insertMaterial = db.prepare(`
      INSERT INTO digital_learning_materials (tenant_id, title, description, subject, file_type, file_url, author_name, version, access_level, download_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMaterial.run('tenant_default', 'Advanced Graph Algorithms & Maximum Flow Handbook', 'Comprehensive lecture deck including Ford-Fulkerson and Edmonds-Karp implementations.', 'Data Structures & Algorithms', 'PDF', '/uploads/materials/graphs_v2.pdf', 'Dr. Alan Vance', 'v2.1', 'public', 342);
    insertMaterial.run('tenant_default', 'Distributed Database Concurrency & Two-Phase Commit', 'Video recording and presentation slides from advanced systems seminar.', 'Database Management Systems', 'Video', '/uploads/materials/db_concurrency.mp4', 'Prof. Elena Rostova', 'v1.0', 'department', 198);

    // J) Seed Consortium Benchmarks
    const insertBenchmark = db.prepare(`
      INSERT INTO consortium_benchmarks (tenant_id, institution_category, benchmark_metric, college_value, peer_group_avg, national_avg, top_decile_val, period)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertBenchmark.run('tenant_default', 'Engineering Institutes', 'Average Student CGPA', 7.42, 7.18, 6.85, 8.35, '2025-2026');
    insertBenchmark.run('tenant_default', 'Engineering Institutes', 'Campus Placement Rate (%)', 86.4, 78.2, 64.5, 96.0, '2025-2026');
    insertBenchmark.run('tenant_default', 'Engineering Institutes', 'Average Placement CTC (LPA)', 9.8, 7.6, 5.8, 16.5, '2025-2026');
    insertBenchmark.run('tenant_default', 'Engineering Institutes', 'Faculty with Ph.D. (%)', 68.0, 54.0, 42.0, 88.0, '2025-2026');
    insertBenchmark.run('tenant_default', 'Engineering Institutes', 'Accredited Program Outcomes Attainment (%)', 76.5, 71.0, 62.5, 89.0, '2025-2026');

    // K) Seed Job Openings & Applications
    const insertJob = db.prepare(`
      INSERT INTO job_openings (tenant_id, company_name, job_title, role_type, ctc_lpa, min_cgpa, location, required_skills, deadline_date, drive_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const j1 = insertJob.run('tenant_default', 'Google Cloud', 'Associate Cloud Solutions Engineer', 'Full-Time', 24.5, 8.0, 'Bengaluru / Hyderabad', 'Distributed Systems, Python, Kubernetes, Networking', '2026-11-30', '2026-12-10', 'open');
    const j2 = insertJob.run('tenant_default', 'Microsoft India', 'Software Engineering Associate', 'Full-Time', 21.0, 7.5, 'Bengaluru', 'Data Structures, C++/C#, Algorithms, Azure', '2026-11-15', '2026-12-05', 'open');
    const j3 = insertJob.run('tenant_default', 'Zoho Corporation', 'Full-Stack Software Engineer', 'Full-Time', 9.5, 6.5, 'Chennai', 'JavaScript, Node.js, PostgreSQL, REST APIs', '2026-10-31', '2026-11-12', 'open');

    const insertJobApp = db.prepare(`
      INSERT INTO job_applications (tenant_id, job_id, student_id, fit_probability_pct, application_status, applied_at, interview_feedback)
      VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?)
    `);

    if (alex) {
      insertJobApp.run('tenant_default', j1.lastInsertRowid, alex.id, 94, 'shortlisted', '-3 days', 'Shortlisted for Round 1 technical coding assessment.');
    }
    if (priya) {
      insertJobApp.run('tenant_default', j3.lastInsertRowid, priya.id, 82, 'interview_scheduled', '-2 days', 'Cleared initial screening; technical interview scheduled for Nov 2.');
    }

    // L) Seed Alumni Mentors
    const insertAlumni = db.prepare(`
      INSERT INTO alumni_network (tenant_id, name, graduation_year, current_company, current_role, mentorship_domain, contact_email, linkedin_url, is_mentor_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertAlumni.run('tenant_default', 'Aravind Nair', 2022, 'Amazon Web Services', 'Senior Cloud Solutions Architect', 'Cloud Architecture & Distributed Systems', 'aravind.nair@alumni.college.edu', 'https://linkedin.com/in/aravind-nair-demo', 1);
    insertAlumni.run('tenant_default', 'Meera Krishnan', 2021, 'Uber', 'Product Manager - Core Infrastructure', 'Product Management & Interview Prep', 'meera.k@alumni.college.edu', 'https://linkedin.com/in/meera-krishnan-demo', 1);
    insertAlumni.run('tenant_default', 'Devon Vance', 2023, 'Stripe', 'Security Operations Engineer', 'Cybersecurity, Cryptography & Penetration Testing', 'devon.v@alumni.college.edu', 'https://linkedin.com/in/devon-vance-demo', 1);

    // M) Seed Parent Profiles & Alerts
    const insertParent = db.prepare(`
      INSERT INTO parent_profiles (tenant_id, student_id, parent_name, relationship, phone, email, access_pin_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const parentPinHash = bcrypt.hashSync('1234', salt);

    if (rohit) {
      const parentRohit = insertParent.run('tenant_default', rohit.id, 'Suresh Verma', 'Father', '+91 98765 43210', 'suresh.verma@example.com', parentPinHash);
      const insertAlert = db.prepare(`
        INSERT INTO parent_alerts (tenant_id, student_id, parent_id, alert_type, title, message, priority, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
      `);
      insertAlert.run('tenant_default', rohit.id, parentRohit.lastInsertRowid, 'attendance_low', 'Low Attendance Alert: 64% in DBMS', 'Rohit Verma currently holds 64% attendance in Database Systems, below the mandatory 75% university policy.', 'urgent', 0, '-1 day');
      insertAlert.run('tenant_default', rohit.id, parentRohit.lastInsertRowid, 'grade_risk', 'Academic Intervention Notice: Critical GPA Risk', 'Academic counseling has been requested due to low mid-term scores. Faculty mentorship has been assigned.', 'critical', 0, '-4 hours');
    }

    if (alex) {
      const parentAlex = insertParent.run('tenant_default', alex.id, 'David Johnson', 'Father', '+1 555 892 4432', 'david.johnson@example.com', parentPinHash);
      const insertAlert = db.prepare(`
        INSERT INTO parent_alerts (tenant_id, student_id, parent_id, alert_type, title, message, priority, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
      `);
      insertAlert.run('tenant_default', alex.id, parentAlex.lastInsertRowid, 'achievement', 'Dean\'s Honor Roll Commendation', 'Alex has achieved a 9.20 semester average and is nominated for Academic Excellence Award.', 'normal', 1, '-5 days');
    }

    // N) Seed Competencies & Learning Pathways
    const insertComp = db.prepare(`
      INSERT INTO competencies (tenant_id, name, category, description, max_level)
      VALUES (?, ?, ?, ?, ?)
    `);

    const c1 = insertComp.run('tenant_default', 'Data Structures & Algorithms', 'technical', 'Mastery of trees, graphs, sorting, searching, and complexity analysis.', 'Master');
    const c2 = insertComp.run('tenant_default', 'Full-Stack Web Development', 'technical', 'Building modern web apps with Node.js, React, relational databases and APIs.', 'Master');
    const c3 = insertComp.run('tenant_default', 'Cloud Computing & DevOps', 'technical', 'Containerization, orchestration, CI/CD pipelines, and cloud architecture.', 'Master');
    const c4 = insertComp.run('tenant_default', 'Technical Communication', 'soft_skill', 'Effective presentations, project documentation, and peer technical reviews.', 'Advanced');

    const insertStudentComp = db.prepare(`
      INSERT INTO student_competencies (tenant_id, student_id, competency_id, current_level, score_pct, badge_awarded)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    if (alex) {
      insertStudentComp.run('tenant_default', alex.id, c1.lastInsertRowid, 'Advanced', 94.0, 'DSA Grandmaster');
      insertStudentComp.run('tenant_default', alex.id, c2.lastInsertRowid, 'Advanced', 92.0, 'Full-Stack Ninja');
    }
    if (priya) {
      insertStudentComp.run('tenant_default', priya.id, c3.lastInsertRowid, 'Intermediate', 78.0, 'Cloud Practitioner');
    }
    if (rohit) {
      insertStudentComp.run('tenant_default', rohit.id, c1.lastInsertRowid, 'Novice', 48.0, 'Bronze Learner');
    }

    const insertPathway = db.prepare(`
      INSERT INTO learning_pathways (tenant_id, title, role_target, description, total_milestones, required_skills, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const p1 = insertPathway.run('tenant_default', 'Full-Stack Software Architect Track', 'Full-Stack Engineer', 'End-to-end curriculum from core DSA to distributed microservices and production monitoring.', 5, JSON.stringify(['JavaScript', 'Node.js', 'PostgreSQL', 'Docker', 'System Design']), 1);
    const p2 = insertPathway.run('tenant_default', 'AI & Machine Learning Engineer Track', 'ML Engineer', 'Rigorous pathway in mathematical modeling, deep neural networks, and scalable model serving.', 5, JSON.stringify(['Python', 'PyTorch', 'Data Pipelines', 'Model Deployment']), 1);

    const insertPathwayProgress = db.prepare(`
      INSERT INTO student_pathway_progress (tenant_id, student_id, pathway_id, current_milestone, completion_pct, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    if (alex) {
      insertPathwayProgress.run('tenant_default', alex.id, p1.lastInsertRowid, 4, 80.0, 'active');
    }
    if (priya) {
      insertPathwayProgress.run('tenant_default', priya.id, p1.lastInsertRowid, 2, 45.0, 'active');
    }
  }

  console.log('✅ Migrations complete: all 11 modules and multi-tenant SaaS architecture initialized successfully.');
}

module.exports = runMigrations;
