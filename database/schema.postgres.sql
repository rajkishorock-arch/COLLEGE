-- ====================================================================
-- CampusPulse — Production PostgreSQL Multi-Tenant Database Schema
-- Dialect: PostgreSQL 14+
-- Features: Row-Level Security (RLS), Compound Tenant Indexes,
--           Foreign Key Cascades, Strong Constraints
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. APPLICATION ROLES & RLS CONTEXT ARCHITECTURE
-- campuspulse_app: The unprivileged runtime user used by the application pool.
-- campuspulse_admin: The migration & maintenance role (bypasses RLS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campuspulse_app') THEN
    CREATE ROLE campuspulse_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campuspulse_admin') THEN
    CREATE ROLE campuspulse_admin WITH LOGIN SUPERUSER CREATEDB CREATEROLE INHERIT;
  END IF;
END $$;

-- ====================================================================
-- 3. CORE PLATFORM TABLES
-- ====================================================================

-- 3.1 Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(64),
  code VARCHAR(32) UNIQUE NOT NULL,
  subdomain VARCHAR(64) UNIQUE,
  logo TEXT,
  primary_color VARCHAR(16) DEFAULT '#6C5CE7',
  secondary_color VARCHAR(16) DEFAULT '#111318',
  email VARCHAR(255),
  phone VARCHAR(32),
  address TEXT,
  status VARCHAR(16) CHECK (status IN ('active', 'suspended', 'inactive')) DEFAULT 'active',
  academic_year VARCHAR(32) DEFAULT '2025-2026',
  owner_user_id BIGINT,
  institution_type VARCHAR(64) DEFAULT 'college',
  data_region VARCHAR(64) DEFAULT 'in-west-mumbai',
  plan_tier VARCHAR(64) DEFAULT 'professional',
  verification_status VARCHAR(64) DEFAULT 'verified',
  aicte_code VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.1B Email Verifications
CREATE TABLE IF NOT EXISTS email_verifications (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(16) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_verified SMALLINT DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.2 Departments (Tenant Organizational Hierarchy)
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(32) NOT NULL,
  head_of_department VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, code)
);

-- 3.3 Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(32) CHECK (role IN ('student', 'admin', 'college_admin', 'faculty', 'staff', 'super_admin')) NOT NULL DEFAULT 'student',
  roll_no VARCHAR(64),
  course VARCHAR(255),
  profile_photo TEXT,
  security_question TEXT,
  security_answer TEXT,
  is_active SMALLINT NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, roll_no)
);

-- 3.4 Invitations (Tenant-Scoped Team & Student Invitations)
CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'student',
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, email, token_hash)
);

-- 3.5 Attendance Sessions (Check-In Codes)
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  session_code VARCHAR(64) NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, session_code)
);

-- 3.6 Attendance Records
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  status VARCHAR(16) CHECK (status IN ('Present', 'Absent')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.7 Academic Results
CREATE TABLE IF NOT EXISTS results (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  marks_obtained NUMERIC(5,2) NOT NULL,
  max_marks NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  exam_type VARCHAR(64) NOT NULL,
  semester VARCHAR(64) DEFAULT 'Semester 1',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.8 Books Catalog
CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255) NOT NULL,
  category VARCHAR(128) NOT NULL,
  total_copies INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.9 Book Issues (Circulation)
CREATE TABLE IF NOT EXISTS book_issues (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  return_date DATE,
  status VARCHAR(16) CHECK (status IN ('Issued', 'Returned')) NOT NULL DEFAULT 'Issued',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.10 Quizzes
CREATE TABLE IF NOT EXISTS quizzes (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.11 Quiz Questions
CREATE TABLE IF NOT EXISTS quiz_questions (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option VARCHAR(4) CHECK (correct_option IN ('a', 'b', 'c', 'd')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.12 Quiz Attempts
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.13 Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  posted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority VARCHAR(16) DEFAULT 'normal',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.14 Timetable
CREATE TABLE IF NOT EXISTS timetable (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  subject VARCHAR(255) NOT NULL,
  day_of_week VARCHAR(16) NOT NULL,
  start_time VARCHAR(16) NOT NULL,
  end_time VARCHAR(16) NOT NULL,
  room VARCHAR(64),
  course VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.15 Assignments
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.16 Assignment Submissions
CREATE TABLE IF NOT EXISTS assignment_submissions (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path TEXT,
  grade VARCHAR(16),
  feedback TEXT,
  submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.17 Fees
CREATE TABLE IF NOT EXISTS fees (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term VARCHAR(64) NOT NULL,
  amount_due NUMERIC(10,2) NOT NULL,
  amount_paid NUMERIC(10,2) DEFAULT 0.00,
  due_date DATE,
  status VARCHAR(16) DEFAULT 'Pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.18 Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type VARCHAR(32) DEFAULT 'general',
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3.19 Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(128) NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- 3.20 TIER-3 ADVANCED ENTERPRISE PLATFORM TABLES (Features 21 - 28)
-- ====================================================================

-- Feature 21: Predictive Academic Intelligence & Intervention System
CREATE TABLE IF NOT EXISTS student_predictions (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  predicted_gpa NUMERIC(4,2) NOT NULL,
  current_cgpa NUMERIC(4,2),
  risk_level VARCHAR(16) CHECK (risk_level IN ('GREEN', 'YELLOW', 'RED', 'CRITICAL')) NOT NULL,
  failure_probability NUMERIC(4,2) DEFAULT 0.00,
  key_risk_factors TEXT,
  model_version VARCHAR(32) DEFAULT 'xgboost-v3.2',
  confidence_score NUMERIC(4,2) DEFAULT 0.88,
  last_calculated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, student_id)
);

CREATE TABLE IF NOT EXISTS academic_interventions (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code VARCHAR(32),
  risk_level VARCHAR(16) CHECK (risk_level IN ('YELLOW', 'RED', 'CRITICAL')) NOT NULL,
  intervention_type VARCHAR(32) CHECK (intervention_type IN ('faculty_counseling', 'peer_tutoring', 'remedial_quiz', 'parent_meeting', 'study_plan')) NOT NULL,
  status VARCHAR(16) CHECK (status IN ('recommended', 'in_progress', 'completed', 'dismissed')) DEFAULT 'recommended',
  assigned_faculty_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recommendation_notes TEXT,
  outcome_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS study_recommendations (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  weak_topic VARCHAR(255) NOT NULL,
  recommendation_type VARCHAR(32) CHECK (recommendation_type IN ('video', 'problem_set', 'reading', 'peer_group')) NOT NULL,
  title VARCHAR(255) NOT NULL,
  resource_url TEXT,
  difficulty_level VARCHAR(16) CHECK (difficulty_level IN ('Easy', 'Medium', 'Hard')) DEFAULT 'Medium',
  is_completed SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS placement_readiness (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  readiness_score INTEGER NOT NULL,
  academic_score NUMERIC(5,2) DEFAULT 0.00,
  communication_score NUMERIC(5,2) DEFAULT 0.00,
  technical_score NUMERIC(5,2) DEFAULT 0.00,
  internship_score NUMERIC(5,2) DEFAULT 0.00,
  certification_score NUMERIC(5,2) DEFAULT 0.00,
  cocurricular_score NUMERIC(5,2) DEFAULT 0.00,
  skill_gaps TEXT,
  recommended_certifications TEXT,
  assessed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, student_id)
);

-- Feature 22: Advanced Curriculum & Course Analytics
CREATE TABLE IF NOT EXISTS course_topics (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  topic_name VARCHAR(255) NOT NULL,
  difficulty_index NUMERIC(4,2) DEFAULT 0.50,
  difficulty_category VARCHAR(16) CHECK (difficulty_category IN ('Easy', 'Medium', 'Hard', 'Very Hard')) DEFAULT 'Medium',
  topic_failure_rate NUMERIC(5,2) DEFAULT 0.00,
  avg_quiz_score NUMERIC(5,2) DEFAULT 70.00,
  avg_time_spent_mins INTEGER DEFAULT 45,
  UNIQUE(tenant_id, subject, topic_name)
);

CREATE TABLE IF NOT EXISTS faculty_teaching_analytics (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  term VARCHAR(64) NOT NULL,
  student_satisfaction_rating NUMERIC(3,2) DEFAULT 4.00,
  course_completion_pct NUMERIC(5,2) DEFAULT 85.00,
  teaching_effectiveness_score NUMERIC(5,2) DEFAULT 82.00,
  student_pass_rate_pct NUMERIC(5,2) DEFAULT 88.00,
  feedback_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS learning_outcomes (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  course_code VARCHAR(32) NOT NULL,
  co_code VARCHAR(16) NOT NULL,
  description TEXT NOT NULL,
  target_attainment_pct NUMERIC(5,2) DEFAULT 75.00,
  actual_attainment_pct NUMERIC(5,2) DEFAULT 70.00,
  accreditation_standard VARCHAR(64) DEFAULT 'NAAC/NBA',
  UNIQUE(tenant_id, course_code, co_code)
);

-- Feature 23: Dynamic Timetable Optimization & Smart Room Management
CREATE TABLE IF NOT EXISTS campus_rooms (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_number VARCHAR(32) NOT NULL,
  building VARCHAR(128) NOT NULL,
  room_type VARCHAR(32) CHECK (room_type IN ('lecture_hall', 'classroom', 'lab', 'seminar_hall')) NOT NULL,
  capacity INTEGER NOT NULL,
  has_projector SMALLINT DEFAULT 1,
  has_wifi SMALLINT DEFAULT 1,
  is_accessible SMALLINT DEFAULT 1,
  status VARCHAR(16) CHECK (status IN ('available', 'occupied', 'maintenance')) DEFAULT 'available',
  UNIQUE(tenant_id, room_number, building)
);

CREATE TABLE IF NOT EXISTS room_resources (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES campus_rooms(id) ON DELETE CASCADE,
  resource_name VARCHAR(128) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  quantity INTEGER DEFAULT 1,
  status VARCHAR(32) DEFAULT 'operational',
  last_inspected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS online_class_sessions (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_url TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  is_recorded SMALLINT DEFAULT 0,
  recording_url TEXT,
  attendance_count INTEGER DEFAULT 0,
  status VARCHAR(16) CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled')) DEFAULT 'scheduled'
);

-- Feature 24: Smart Library 2.0 & Digital Knowledge Management
CREATE TABLE IF NOT EXISTS digital_learning_materials (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  subject VARCHAR(255) NOT NULL,
  file_type VARCHAR(32) NOT NULL,
  file_url TEXT NOT NULL,
  author_name VARCHAR(128),
  version VARCHAR(16) DEFAULT 'v1.0',
  access_level VARCHAR(16) CHECK (access_level IN ('public', 'department', 'enrolled')) DEFAULT 'public',
  download_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS faculty_publications (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  journal_or_conference VARCHAR(255) NOT NULL,
  publication_year INTEGER NOT NULL,
  doi VARCHAR(128),
  citations_count INTEGER DEFAULT 0,
  impact_factor NUMERIC(4,2) DEFAULT 1.00,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Feature 25: Multi-Institutional Insights & Federation
CREATE TABLE IF NOT EXISTS consortium_benchmarks (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  institution_category VARCHAR(128) NOT NULL,
  benchmark_metric VARCHAR(128) NOT NULL,
  college_value NUMERIC(8,2) NOT NULL,
  peer_group_avg NUMERIC(8,2) NOT NULL,
  national_avg NUMERIC(8,2) NOT NULL,
  top_decile_val NUMERIC(8,2) NOT NULL,
  period VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inter_institutional_transfers (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_name VARCHAR(128) NOT NULL,
  student_roll_no VARCHAR(64),
  source_institution VARCHAR(255) NOT NULL,
  target_institution VARCHAR(255) NOT NULL,
  credits_transferred INTEGER NOT NULL,
  status VARCHAR(16) CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  cryptographic_transcript_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Feature 26: Industry & Placement Management 2.0
CREATE TABLE IF NOT EXISTS job_openings (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  job_title VARCHAR(255) NOT NULL,
  role_type VARCHAR(64) NOT NULL,
  ctc_lpa NUMERIC(6,2) NOT NULL,
  min_cgpa NUMERIC(4,2) DEFAULT 6.50,
  location VARCHAR(128) NOT NULL,
  required_skills TEXT NOT NULL,
  deadline_date DATE NOT NULL,
  drive_date DATE,
  status VARCHAR(16) CHECK (status IN ('open', 'interviewing', 'closed')) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_applications (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fit_probability_pct INTEGER DEFAULT 75,
  application_status VARCHAR(32) CHECK (application_status IN ('applied', 'shortlisted', 'interview_scheduled', 'offered', 'rejected')) DEFAULT 'applied',
  applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  interview_feedback TEXT,
  UNIQUE(tenant_id, job_id, student_id)
);

CREATE TABLE IF NOT EXISTS alumni_network (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  graduation_year INTEGER NOT NULL,
  current_company VARCHAR(128) NOT NULL,
  current_role VARCHAR(128) NOT NULL,
  mentorship_domain VARCHAR(128),
  contact_email VARCHAR(255) NOT NULL,
  linkedin_url TEXT,
  is_mentor_available SMALLINT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Feature 27: Parent/Guardian Engagement Portal
CREATE TABLE IF NOT EXISTS parent_profiles (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_name VARCHAR(128) NOT NULL,
  relationship VARCHAR(16) CHECK (relationship IN ('Father', 'Mother', 'Guardian')) DEFAULT 'Father',
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(255) NOT NULL,
  access_pin_hash VARCHAR(255) NOT NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, student_id)
);

CREATE TABLE IF NOT EXISTS parent_alerts (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES parent_profiles(id) ON DELETE CASCADE,
  alert_type VARCHAR(32) CHECK (alert_type IN ('attendance_low', 'grade_risk', 'fee_due', 'achievement', 'general')) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  priority VARCHAR(16) CHECK (priority IN ('normal', 'urgent', 'critical')) DEFAULT 'normal',
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parent_teacher_messages (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES parent_profiles(id) ON DELETE CASCADE,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role VARCHAR(16) CHECK (sender_role IN ('parent', 'faculty')) NOT NULL,
  message TEXT NOT NULL,
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Feature 28: Competency-Based Learning Pathways
CREATE TABLE IF NOT EXISTS competencies (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(16) CHECK (category IN ('technical', 'soft_skill', 'domain')) NOT NULL,
  description TEXT,
  max_level VARCHAR(32) DEFAULT 'Master',
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS student_competencies (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competency_id INTEGER NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  current_level VARCHAR(16) CHECK (current_level IN ('Novice', 'Intermediate', 'Advanced', 'Master')) DEFAULT 'Novice',
  score_pct NUMERIC(5,2) DEFAULT 50.00,
  badge_awarded VARCHAR(64),
  verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, student_id, competency_id)
);

CREATE TABLE IF NOT EXISTS learning_pathways (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  role_target VARCHAR(128) NOT NULL,
  description TEXT,
  total_milestones INTEGER DEFAULT 5,
  required_skills TEXT,
  is_active SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS student_pathway_progress (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pathway_id INTEGER NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,
  current_milestone INTEGER DEFAULT 1,
  completion_pct NUMERIC(5,2) DEFAULT 20.00,
  status VARCHAR(16) CHECK (status IN ('active', 'completed', 'paused')) DEFAULT 'active',
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, student_id, pathway_id)
);

-- ====================================================================
-- 4. PERFORMANCE & TENANT SCOPED COMPOUND INDEXES
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_users_tenant_course ON users(tenant_id, course);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments(tenant_id);

CREATE INDEX IF NOT EXISTS idx_attendance_tenant_student ON attendance(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON attendance(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_subject ON attendance(tenant_id, subject, date);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_lookup ON attendance_sessions(tenant_id, session_code);

CREATE INDEX IF NOT EXISTS idx_results_tenant_student ON results(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_results_semester ON results(tenant_id, semester);

CREATE INDEX IF NOT EXISTS idx_books_tenant_category ON books(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_book_issues_tenant_student ON book_issues(tenant_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_book_issues_due ON book_issues(tenant_id, due_date, status);

CREATE INDEX IF NOT EXISTS idx_quizzes_tenant ON quizzes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(tenant_id, quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(tenant_id, student_id);

CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timetable_tenant_course ON timetable(tenant_id, course);
CREATE INDEX IF NOT EXISTS idx_assignments_tenant ON assignments(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_assignment_subs_lookup ON assignment_submissions(tenant_id, assignment_id, student_id);

CREATE INDEX IF NOT EXISTS idx_fees_tenant_student ON fees(tenant_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user ON notifications(tenant_id, user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);

-- Tier-3 Compound Indexes
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

-- ====================================================================
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable RLS on all tenant-owned resources
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Tier-3 Tables RLS
ALTER TABLE student_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE placement_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_teaching_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_learning_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE consortium_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inter_institutional_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE alumni_network ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_teacher_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_pathways ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_pathway_progress ENABLE ROW LEVEL SECURITY;

-- Helper macro function for RLS check
-- Returns TRUE if current user is Super Admin OR if row's tenant_id matches current_setting('app.current_tenant_id')
CREATE OR REPLACE FUNCTION check_tenant_access(row_tenant_id VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR NULLIF(current_setting('app.current_tenant_id', true), '') = row_tenant_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Apply Row-Level Security Policies across all tenant tables
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'departments', 'users', 'invitations', 'attendance', 'attendance_sessions',
    'results', 'books', 'book_issues', 'quizzes', 'quiz_questions', 'quiz_attempts',
    'announcements', 'timetable', 'assignments', 'assignment_submissions',
    'fees', 'notifications', 'audit_log',
    'student_predictions', 'academic_interventions', 'study_recommendations', 'placement_readiness',
    'course_topics', 'faculty_teaching_analytics', 'learning_outcomes',
    'campus_rooms', 'room_resources', 'online_class_sessions',
    'digital_learning_materials', 'faculty_publications',
    'consortium_benchmarks', 'inter_institutional_transfers',
    'job_openings', 'job_applications', 'alumni_network',
    'parent_profiles', 'parent_alerts', 'parent_teacher_messages',
    'competencies', 'student_competencies', 'learning_pathways', 'student_pathway_progress'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant_isolation ON %I;', t, t);
    EXECUTE format('
      CREATE POLICY rls_%I_tenant_isolation ON %I
      FOR ALL
      USING (check_tenant_access(tenant_id))
      WITH CHECK (check_tenant_access(tenant_id));
    ', t, t);
  END LOOP;
END $$;

-- 6. GRANT PERMISSIONS TO UNPRIVILEGED APPLICATION ROLE
GRANT CONNECT ON DATABASE campuspulse TO campuspulse_app;
GRANT USAGE ON SCHEMA public TO campuspulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO campuspulse_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO campuspulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO campuspulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO campuspulse_app;
