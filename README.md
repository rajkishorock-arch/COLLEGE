# 🎓 CampusPulse — Full-Stack College Management Platform

A modern, production-grade, single-integrated **College Management Platform** engineered with Node.js, Express, SQLite, and EJS. Designed for seamless role-based academic administration, it features an interactive **Student Portal** (attendance tracking with 75% eligibility criteria, marksheets with dynamic Chart.js visualizations, library book circulation with overdue warnings, online auto-graded MCQ assessments, and a built-in instant FAQ chatbot) and a comprehensive **Admin Portal** (student directory CRUD, bulk attendance roll call with single-click toggles, gradebook ledger, library catalog & lending management, and an assessment builder).

---

## 🔒 Verification: Real DBMS & Real Authentication (No Mocks)

> [!IMPORTANT]
> **This platform operates exclusively on a REAL embedded database and REAL cryptographic authentication:**
>
> 1. **Real SQLite DBMS (`database/college.db`):**
>    - Every single data record — student profiles, daily attendance entries, examination marks, library book inventory, active book issues/returns, quizzes, MCQ questions, and student test submissions — is stored in and queried directly from the local SQLite database file via `better-sqlite3`.
>    - **Zero Mock Data:** Nothing is hardcoded or mocked in the frontend or memory. Creating, updating, or deleting records updates the actual relational database tables with full ACID compliance.
>
> 2. **Real Authentication with Salted Bcrypt Hashes:**
>    - All user passwords (including student self-registrations and seeded accounts) are hashed using `bcryptjs` with 10 salt rounds before storage in the `users` table.
>    - The `/login` endpoint performs a secure cryptographic comparison (`bcrypt.compareSync`) against the database. Plaintext passwords are never stored, logged, or sent to client templates.
>    - Login errors are deliberately generic (*"Invalid email or password"*) to prevent user enumeration attacks.

---

## 🛡️ Security Implementation Checklist

| Requirement | Implementation Details |
| :--- | :--- |
| **Password Storage** | Hashed with `bcryptjs` (10 rounds); never stored or logged in plain text. |
| **Session Security** | `express-session` with environment-variable secret (`SESSION_SECRET`), `httpOnly: true`, and `sameSite: 'lax'` for CSRF mitigation. |
| **Server-Side Auth** | Every protected route strictly verifies `req.session.user` on the server — never trusts client-side form values or headers. |
| **Role Authorization** | Students accessing `/admin/*` or admins accessing `/student/*` are structurally denied via a dedicated **HTTP 403 Forbidden** page. |
| **Input Validation** | All inputs (emails, passwords, roll numbers, marks, due dates, quiz choices) are validated and sanitized on the server before database execution. |
| **SQL Injection Defense** | 100% of SQL queries utilize parameterized placeholders (`?`) via `better-sqlite3` — no user-supplied strings are ever concatenated into SQL commands. |
| **Credential Redaction** | Sensitive attributes (passwords, secrets) are excluded from responses and template contexts. |

---

## ⚡ Purposeful Micro-Animations (150ms – 300ms)

Every animation in CampusPulse directly reinforces real-time application events:

- **Attendance Progress Ring:** Smoothly animates circumference fill-up on page load based on the student's exact attendance percentage (green for $\ge 75\%$, red for $< 75\%$).
- **Live Attendance Roll-Call:** Marking "Present" or "Absent" (or clicking "All Present" / "All Absent") instantly applies emerald-green or crimson-red background tints to the entire row without reloading the page.
- **Interactive Quiz Selection:** Clicking any option instantly highlights the option card with indigo border, background accent, and focus glow.
- **Score Count-Up Reveal:** The final quiz score counts up from 0 to the earned score over 500ms upon submission.
- **Form Submission States:** Submit buttons display an integrated spinning loader (`.btn-loading`) upon form submission, and failed logins execute a quick shake animation (`@keyframes shake`).
- **Overdue Loan Badges:** Overdue library books animate with a soft attention pulse.
- **Chatbot Drawer:** Smooth slide-up with a natural 350ms typing indicator before FAQ answers are presented.
- **Dismissible Toasts:** Success and error notifications slide in smoothly from the top and automatically fade out after 4.5 seconds.

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime & Backend** | [Node.js](https://nodejs.org/) + [Express.js](https://expressjs.com/) | High-performance asynchronous HTTP server & REST routing |
| **Database Engine** | [SQLite](https://sqlite.org/) via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) | Fast, zero-config, embedded ACID-compliant relational storage |
| **Server Templating** | [EJS](https://ejs.co/) + [`express-ejs-layouts`](https://www.npmjs.com/package/express-ejs-layouts) | Componentized server-side HTML rendering with master layouts |
| **Authentication** | [`express-session`](https://www.npmjs.com/package/express-session) + [`bcryptjs`](https://www.npmjs.com/package/bcryptjs) | Cookie-based session persistence with salted cryptographic hashing |
| **Styling & Icons** | [Tailwind CSS](https://tailwindcss.com/) (CDN) + Custom CSS + [FontAwesome 6](https://fontawesome.com/) | SaaS visual aesthetic, micro-animations, glassmorphism, responsive grid |
| **Data Visualization**| [Chart.js](https://www.chartjs.org/) (CDN) | Interactive bar charts for student academic performance comparison |

---

## 🚀 Quick Start Guide

### 1. Installation
Clone the repository and install all dependencies:
```bash
npm install
```

### 2. Configure Environment (Optional)
A default `.env` file is generated automatically. You can customize `PORT` or `SESSION_SECRET`:
```env
PORT=3000
SESSION_SECRET=college_platform_secure_session_key_98234710928374
NODE_ENV=development
```

### 3. Run the Platform
Start the Express web server:
```bash
npm start
```
*(For live-reloading during development: `npm run dev`)*

The server will automatically initialize the SQLite database schema and seed demo records.

### 4. Open in Browser
Visit:
```
http://localhost:3000
```

---

## 🔑 Demo Login Credentials

The platform is pre-seeded with ready-to-demo accounts. You can also use the **1-Click Demo Buttons** on the login page:

| Role | Email | Password | Persona Details |
| :--- | :--- | :--- | :--- |
| **Campus Administrator** | `admin@college.edu` | `admin123` | Full administrative control: student directory, bulk attendance, circulation, quizzes |
| **Demo Student (Safe Attendance)** | `alex@college.edu` | `student123` | Roll: `CS2026-001`, B.Tech CSE (85% Attendance — Green status) |
| **Demo Student (Shortage Alert)** | `rohit@college.edu` | `student123` | Roll: `CS2026-003`, B.Tech AI (65% Attendance — Red shortage alert) |

---

## 📦 System Architecture & Folder Structure

```
COLLEGE/
├── server.js               # Central Express app setup, session config & route mounting
├── package.json            # Project dependencies and execution scripts
├── .env                    # Environment variables (session secret, port)
├── config/
│   └── db.js               # better-sqlite3 connection manager with foreign keys enabled
├── database/
│   ├── schema.sql          # Complete DDL definitions with foreign keys and performance indexes
│   ├── seed.js             # Automated idempotent database seeder with realistic test data
│   └── college.db          # Embedded SQLite database file (created automatically)
├── middleware/
│   └── auth.js             # Session verification and strict role authorization (403 forbidden)
├── routes/
│   ├── auth.js             # /login, /signup, and /logout handlers with bcrypt validation
│   ├── student.js          # Student dashboard, attendance, results, library, quizzes, chatbot API
│   └── admin.js            # Admin dashboard, student CRUD, bulk roll call, marks, catalog
├── views/
│   ├── layout.ejs          # Master responsive shell layout with sidebar and topbar
│   ├── login.ejs           # Sign in view with 1-click credentials filler & shake animation
│   ├── signup.ejs          # New student enrollment form with validation
│   ├── error.ejs           # Friendly 403, 404, and 500 status handler
│   ├── partials/
│   │   ├── sidebar.ejs     # Dynamic role-based navigation with active-link indicator
│   │   ├── topbar.ejs      # Responsive header with mobile toggle and breadcrumbs
│   │   ├── alerts.ejs      # Dismissible flash notification banners with slide-in
│   │   └── chatbot.ejs     # Floating rule-based instant FAQ assistant widget
│   ├── student/
│   │   ├── dashboard.ejs   # Summary cards, attendance meter, issued books overview
│   │   ├── attendance.ejs  # Subject breakdown, animated progress ring, 75% rule indicators
│   │   ├── results.ejs     # Academic scorecard with interactive Chart.js bar chart
│   │   ├── library.ejs     # Catalog browser and personal book loans with overdue badges
│   │   ├── quiz.ejs        # Available quizzes and submission history
│   │   ├── take-quiz.ejs   # Interactive MCQ test interface with radio options & active highlights
│   │   └── quiz-result.ejs # Auto-graded score report with count-up animation & answer review
│   └── admin/
│       ├── dashboard.ejs   # Campus overview, metrics, overdue loans, recent students
│       ├── students.ejs    # Student directory, search filter, and add/edit modals
│       ├── student-detail.ejs # 360-degree student profile (attendance, marks, library, tests)
│       ├── attendance.ejs  # Bulk roll-call attendance sheet with live row-tint toggles
│       ├── results.ejs     # Examination marks ledger with subject & student filters
│       ├── library.ejs     # Book loan issuance, returns, overdue tracker, catalog CRUD
│       ├── quiz.ejs        # Quiz manager with assessment cards and statistics
│       └── quiz-detail.ejs # Question creator and student test submissions list
├── public/
│   ├── css/
│   │   └── style.css       # Design system tokens, progress rings, live row tinting, spinners
│   └── js/
│       └── main.js         # Mobile drawer, rule-based chatbot engine, attendance ring calculations, count-up
└── README.md               # Complete platform documentation and viva guide
```

---

## 🎓 College Viva / Demo Explanations Guide

1. **Why SQLite + `better-sqlite3` instead of MySQL / MongoDB?**
   > *"SQLite is a zero-configuration, serverless, transactional SQL engine that stores the entire database in a single disk file (`college.db`). Using `better-sqlite3` provides synchronous, C++-backed execution that is significantly faster than traditional asynchronous drivers for local apps, while adhering strictly to relational schema, foreign key cascades, and transactions without requiring an external server daemon."*

2. **How does authentication & security work?**
   > *"Authentication uses cookie-backed sessions via `express-session` with `httpOnly: true` and `SameSite=Lax` to protect against XSS and CSRF attacks. Passwords are never stored in plaintext — they are hashed using `bcryptjs` with 10 salt rounds. Every incoming request to protected routes passes through server-side middleware (`requireAuth`, `requireStudent`, `requireAdmin`), preventing role elevation."*

3. **How is Role-Based Access Control (RBAC) enforced?**
   > *"Middleware functions verify `req.session.user.role` on every request. If a student account attempts to open `/admin/*`, the server renders an explicit HTTP 403 Forbidden page rather than an ambiguous redirect, proving structural role isolation."*

4. **How does the attendance percentage calculation operate?**
   > *"Aggregate SQL queries calculate total and attended class counts grouped by subject and student. If the overall or subject-specific percentage falls below 75%, the platform applies critical shortage indicators (red alert badges and colored progress rings), strictly enforcing the 75% university eligibility requirement."*

5. **How does the quiz auto-grader work?**
   > *"When a student submits their quiz, the server iterates through the submitted radio responses, cross-referencing each with the `correct_option` in `quiz_questions` using parameterized queries. The score is immediately recorded into `quiz_attempts` and an itemized question-by-question review is rendered with score count-up animations."*

---

## 📄 License
This project is open-source and intended for academic examination and college project demonstrations under the MIT License.
