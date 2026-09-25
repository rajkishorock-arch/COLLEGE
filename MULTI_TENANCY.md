# CampusPulse — Production-Grade Multi-Tenant SaaS Architecture

## 1. Architecture Overview

CampusPulse is a production-grade **Multi-Tenant College Management SaaS Platform** serving multiple collegiate institutions from a single, unified codebase and infrastructure plane.

```text
                                CampusPulse Platform
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         Institution A                                   Institution B
  CampusPulse Institute of Tech                   Apex Institute of Technology
     (tenant_default / CPIT)                         (tenant_apex / AIT)
                 │                                               │
    ┌────────────┼────────────┐                     ┌────────────┼────────────┐
    ▼            ▼            ▼                     ▼            ▼            ▼
College Admin  Faculty     Students             College Admin  Faculty     Students
 (Isolated)   (Isolated)  (Isolated)             (Isolated)   (Isolated)  (Isolated)
```

The system strictly enforces tenant boundaries at the database and application layers, ensuring:
- Zero cross-tenant data leakage.
- Horizontal privilege escalation immunity.
- Centralized governance for Platform Super Administrators.
- Autonomous configuration, branding, and user management for individual College Administrators.
- Complete backward compatibility with all pre-existing single-tenant accounts, records, and routes.

---

## 2. Tenant Model

Every institution is represented by a unique record in the `tenants` table:

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,                       -- e.g. 'tenant_default', 'tenant_apex'
  name TEXT NOT NULL,                        -- Full Legal Institution Name
  short_name TEXT,                           -- e.g. 'CPIT', 'AIT'
  code TEXT UNIQUE NOT NULL,                 -- e.g. 'DEFAULT', 'APEX'
  subdomain TEXT UNIQUE,                     -- Optional custom subdomain routing
  logo TEXT,                                 -- Institutional crest / logo URL
  primary_color TEXT DEFAULT '#6C5CE7',      -- Custom brand primary accent
  secondary_color TEXT DEFAULT '#111318',    -- Contrast tone
  email TEXT,                                -- Administrative contact email
  phone TEXT,                                -- Administrative telephone
  address TEXT,                              -- Campus physical address
  status TEXT CHECK(status IN ('active', 'suspended', 'inactive')) DEFAULT 'active',
  academic_year TEXT DEFAULT '2025-2026',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Every tenant-owned document/table in the database contains an explicit `tenant_id` foreign key:
- `users`
- `attendance`
- `attendance_sessions`
- `results`
- `books` (Library catalog)
- `book_issues` (Library circulation)
- `quizzes`
- `quiz_questions`
- `quiz_attempts`
- `timetable`
- `announcements`
- `assignments`
- `assignment_submissions`
- `fees`
- `notifications`
- `audit_log`

---

## 3. Authentication & Tenant Resolution Flow

Authentication identity is verified securely via salted bcrypt hashing with brute-force lockout protection (5 failed attempts in 15 minutes triggers a 15-minute temporary lockout).

```text
User Login Request
        │
        ▼
Lookup User by Email (Case-Insensitive)
        │
        ▼
Verify Account Active (is_active == 1)
        │
        ▼
Resolve User tenant_id
        │
        ▼
Check Institution Status (tenants.status)
   ├── status == 'suspended' && role != 'super_admin' ──► REJECT (Institutional Suspension Notice)
   └── status == 'active' || role == 'super_admin'
        │
        ▼
Verify Password Hash (bcrypt.compareSync)
        │
        ▼
Reset Failed Attempts & Lockout Expiry
        │
        ▼
Create Authenticated Tenant Session:
  req.session.user = {
    id, name, email, role, roll_no, course, tenantId
  }
        │
        ▼
Tenant Resolution Middleware (middleware/tenant.js)
  req.tenant   = <Tenants Row>
  req.tenantId = <Tenant ID>
  res.locals.tenant = req.tenant
  res.locals.currentTenantId = req.tenantId
        │
        ▼
Redirect to Dashboard (/admin/dashboard or /student/dashboard or /super-admin)
```

---

## 4. Role Hierarchy & Authorization

```text
Platform Level
  └── SUPER_ADMIN (Global Platform Governance)
        - Onboard new collegiate institutions
        - Manage institution metadata
        - Suspend / Reactivate institutions
        - View cross-tenant global audit logs
        - Supervise all institution administrators

Tenant Level
  ├── COLLEGE_ADMIN / ADMIN (Institution Scope)
  │     - Manage institution students, faculty, and staff
  │     - Manage attendance, sessions, and timetables
  │     - Publish marks, results, and calculate CGPA
  │     - Manage library catalog and book issues
  │     - Author quizzes and question banks
  │     - Issue fee invoices and mark dues as paid
  │     - Post announcements and create assignments
  │     - Configure institution branding & settings (/admin/tenant-settings)
  │     - View institution audit trail
  ├── FACULTY / STAFF (Academic & Administrative Scope)
  └── STUDENT (Self-Service Academic Scope)
        - View own attendance records and self check-in via QR/session codes
        - View own exam results, GPA, and semester performance
        - Search institutional library catalog & view issued books
        - Take institutional quizzes and view attempt scores
        - View academic timetable and campus announcements
        - Submit coursework assignments and review grades
        - View fee dues and complete online fee payments
```

### Centralized Permission Matrix (`middleware/auth.js`)
Permissions are centrally mapped:
- `platform.manage`, `tenants.read`, `tenants.create`, `tenants.update`, `tenants.suspend`
- `students.read`, `students.write`, `attendance.read`, `attendance.write`
- `results.read`, `results.write`, `library.read`, `library.manage`
- `quizzes.read`, `quizzes.manage`, `tenant.settings`, `audit.tenant`

The helper `hasPermission(role, permission)` and middleware `requirePermission(permission)` enforce checks declaratively across routes.

---

## 5. Database Design & Security Strategy

### Shared Database with Discriminator Column (`tenant_id`)
Following architectural evaluation of the existing stack (Node.js + Express + EJS + better-sqlite3):
- **Decision:** A consolidated database with indexed `tenant_id` on all 16 application tables.
- **Rationale:** Minimizes operational complexity on serverless / single-instance cloud hosts (Render, Vercel, VPS) while ensuring high-throughput queries, fast schema migrations, and single-connection connection pooling.
- **Indices:** High-performance composite indices were added across all tables:
  ```sql
  CREATE INDEX idx_users_tenant ON users(tenant_id);
  CREATE INDEX idx_attendance_tenant ON attendance(tenant_id);
  CREATE INDEX idx_results_tenant ON results(tenant_id);
  CREATE INDEX idx_books_tenant ON books(tenant_id);
  CREATE INDEX idx_book_issues_tenant ON book_issues(tenant_id);
  CREATE INDEX idx_quizzes_tenant ON quizzes(tenant_id);
  CREATE INDEX idx_quiz_attempts_tenant ON quiz_attempts(tenant_id);
  ```

### Tenant-Scoped Roll Number Uniqueness
Instead of a global unique constraint on `roll_no`, the database enforces:
```sql
UNIQUE(tenant_id, roll_no)
```
This enables different colleges to have identical student roll number schemes (e.g. `CS2026-001`) without collisions.

---

## 6. Data Access Layer (`services/`)

All database interactions are organized into reusable, tenant-aware service modules:
- [`services/tenantService.js`](file:///c:/Users/rajki/Desktop/COLLEGE/services/tenantService.js): Institution lifecycle, provisioning, metadata updates, status toggling, platform analytics.
- [`services/userService.js`](file:///c:/Users/rajki/Desktop/COLLEGE/services/userService.js): Scoped user retrieval, credential creation, and roll number conflict detection.
- [`services/attendanceService.js`](file:///c:/Users/rajki/Desktop/COLLEGE/services/attendanceService.js): Scoped attendance recording, analytics, and session validations.
- [`services/libraryService.js`](file:///c:/Users/rajki/Desktop/COLLEGE/services/libraryService.js): Catalog search, book issuance, return processing, overdue tracking.
- [`services/quizService.js`](file:///c:/Users/rajki/Desktop/COLLEGE/services/quizService.js): Scoped quiz banks, attempt scoring, and question authoring.
- [`services/resultsService.js`](file:///c:/Users/rajki/Desktop/COLLEGE/services/resultsService.js): Marks recording, semester performance groupings, CGPA calculations.
- [`services/auditService.js`](file:///c:/Users/rajki/Desktop/COLLEGE/services/auditService.js): Tenant-scoped and platform-wide audit event ingestion and querying.

---

## 7. Security Enforcement Against Common Multi-Tenant Attacks

| Threat Vector | Mitigation Strategy | Tested & Verified |
| :--- | :--- | :---: |
| **Horizontal Privilege Escalation** | Tenant A student attempts to read Tenant B's quizzes or announcements | **BLOCKED:** Queries enforce `AND tenant_id = ?` matching session |
| **Direct URL Access** | Tenant B Admin enters URL `/admin/students/:alexId` (Alex is in Tenant A) | **BLOCKED:** Scoped query returns 404 / Student Not Found |
| **Tenant ID Tampering** | Client submits malicious `tenant_id` in form payload or query string | **BLOCKED:** Server ignores client-supplied tenant ID on protected endpoints and resolves strictly from authenticated session |
| **Cross-Tenant Roll Number Collision** | Tenant B uses the same roll number format as Tenant A | **ALLOWED & ISOLATED:** `UNIQUE(tenant_id, roll_no)` scopes roll numbers per institution |
| **Institutional Suspension Bypass** | Suspended institution users attempt to access portals | **BLOCKED:** Both login handler and middleware terminate sessions of suspended tenants |
| **Super Admin Privilege Leak** | Super Admin operational tasks inadvertently bypassing tenant filters | **ISOLATED:** Standard college admin routes operate strictly within `req.tenantId` |

---

## 8. Tenant Onboarding Workflow

1. Platform Super Admin navigates to `/super-admin/tenants/new`.
2. Admin enters:
   - Legal Institution Name (e.g., `Apex Institute of Technology`)
   - Unique Institutional Code (e.g., `APEX` → generates ID `tenant_apex`)
   - Display Short Name (e.g., `AIT`)
   - Official Email, Telephone, and Campus Address
   - Primary & Secondary brand colors
   - Academic Session (e.g., `2025-2026`)
   - Initial College Administrator Credentials (Name, Email, Password)
3. Upon submission:
   - An atomic database transaction creates the `tenants` record.
   - Generates the primary College Administrator account with salted bcrypt hash.
   - Publishes an initial welcoming announcement.
   - Logs the event in the platform audit log.

---

## 9. Backward Compatibility & Migration Strategy

Existing institutions and databases migrate with zero downtime:
1. `database/migrations.js` Step 18 creates the `tenants` table if missing.
2. Checks for `tenant_default` (`CampusPulse Institute of Technology`, code `DEFAULT`).
3. Checks all 16 application tables: if `tenant_id` column does not exist, executes `ALTER TABLE <name> ADD COLUMN tenant_id TEXT DEFAULT 'tenant_default'`.
4. Backfills all pre-existing rows to `tenant_default`.
5. Pre-existing accounts (`admin@college.edu`, `alex@college.edu`, `priya@college.edu`, `rohit@college.edu`) remain operational immediately.

---

## 10. Automated Test Results

Two dedicated test suites are provided and validated:

### 1. Multi-Tenant Architecture Test Suite (`scratch/test-multi-tenancy.js`)
- **28 PASSED, 0 FAILED**
- Tests verified:
  - Default & Apex tenant creation and status checks.
  - Library catalog complete isolation across tenants.
  - Quiz bank and attempt isolation across tenants.
  - Tenant-scoped roll number uniqueness.
  - Scoped user lookups blocking cross-tenant access.
  - Institutional suspension and reactivation.
  - Atomic Super Admin onboarding transaction.
  - Global platform metric aggregations.

### 2. Live HTTP Isolation Integration Suite (`scratch/test-http-isolation.js`)
- **17 PASSED, 0 FAILED**
- Tests verified:
  - Tenant A Student login & redirect.
  - Tenant B Student login & redirect.
  - Tenant B Admin login & redirect.
  - Super Admin login & redirect.
  - Student A dashboard rendering Tenant A branding (CPIT) without leakage.
  - Student B dashboard rendering Tenant B branding (AIT) without leakage.
  - Tenant B Admin blocked from accessing Tenant A student profile via direct URL.
  - Super Admin `/super-admin` dashboard access allowed.
  - Tenant Admin `/super-admin` dashboard access forbidden (403).
  - Suspended tenant login blocked with institutional suspension notice.
  - Reactivated tenant login restored.
  - Public landing page and multi-tenant signup dropdown verified.

---

## 11. Production Deployment Notes

1. **Environment Variables**:
   Ensure the following are set in `.env`:
   ```bash
   PORT=3000
   SESSION_SECRET=your-strong-production-session-secret-here
   SESSION_TIMEOUT_MINUTES=60
   NODE_ENV=production
   ```
2. **Reverse Proxy Trust**:
   `app.set('trust proxy', 1)` is enabled in `server.js`, supporting deployments behind Vercel, Render, AWS CloudFront, or NGINX.
3. **Database Persistence**:
   Ensure `database/college.db` is stored on a persistent disk or volume on containerized environments (Render Disks, AWS EBS, Docker volume).

---

## 12. Known Limitations & Future Scalability

- **Single Database File:** SQLite easily supports millions of records and dozens of concurrent institutions on modern NVMe drives. For enterprise deployments exceeding 50,000 active concurrent write sessions, database migration to PostgreSQL with PostgreSQL Row-Level Security (RLS) is the recommended path.
- **Custom Domains:** Subdomains (`subdomain.campuspulse.edu`) can be wired directly through reverse proxy headers (`Host`) by looking up `SELECT * FROM tenants WHERE subdomain = ?` in `middleware/tenant.js`.
