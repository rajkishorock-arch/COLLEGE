-- College Management Platform Database Schema (Multi-Tenant Architecture)
-- SQLite Engine

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

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT CHECK(role IN ('student', 'admin', 'college_admin', 'faculty', 'staff', 'super_admin')) NOT NULL DEFAULT 'student',
  roll_no TEXT,
  course TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  profile_photo TEXT,
  security_question TEXT,
  security_answer TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until DATETIME,
  last_failed_at DATETIME,
  UNIQUE(tenant_id, roll_no)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT CHECK(status IN ('Present', 'Absent')) NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  marks_obtained REAL NOT NULL,
  max_marks REAL NOT NULL DEFAULT 100,
  exam_type TEXT NOT NULL,
  semester TEXT DEFAULT 'Semester 1'
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  category TEXT NOT NULL,
  total_copies INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS book_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  return_date TEXT,
  status TEXT CHECK(status IN ('Issued', 'Returned')) NOT NULL DEFAULT 'Issued'
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT CHECK(correct_option IN ('a', 'b', 'c', 'd')) NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id),
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indices for performance & tenant isolation
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON attendance(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_subject_date ON attendance(subject, date);
CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_tenant ON results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_books_tenant ON books(tenant_id);
CREATE INDEX IF NOT EXISTS idx_book_issues_student ON book_issues(student_id);
CREATE INDEX IF NOT EXISTS idx_book_issues_book ON book_issues(book_id);
CREATE INDEX IF NOT EXISTS idx_book_issues_tenant ON book_issues(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_tenant ON quizzes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_tenant ON quiz_attempts(tenant_id);

-- ====================================================================
-- Tier-3 Advanced Enterprise Features Schema (Features 21 - 28)
-- ====================================================================

-- Feature 21: Predictive Academic Intelligence & Intervention System
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

-- Feature 22: Advanced Curriculum & Course Analytics
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

-- Feature 23: Dynamic Timetable Optimization & Smart Room Management
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

-- Feature 24: Smart Library 2.0 & Digital Knowledge Management
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

-- Feature 25: Multi-Institutional Insights & Federation
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

-- Feature 26: Industry & Placement Management 2.0
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

-- Feature 27: Parent/Guardian Engagement Portal
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

-- Feature 28: Competency-Based Learning Pathways
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

-- Indices for Tier-3 Features
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

