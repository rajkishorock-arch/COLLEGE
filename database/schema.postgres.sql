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
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    'fees', 'notifications', 'audit_log'
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
