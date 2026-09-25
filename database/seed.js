const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

function seedDatabase() {
  console.log('⚡ Initializing database schema...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  // Check if admin already exists
  const existingAdmin = db.prepare("SELECT * FROM users WHERE email = ?").get('admin@college.edu');
  if (existingAdmin) {
    console.log('✓ Database already seeded. Skipping initial seeding.');
    return;
  }

  console.log('🌱 Seeding initial records...');

  const salt = bcrypt.genSaltSync(10);
  const adminPassHash = bcrypt.hashSync('admin123', salt);
  const studentPassHash = bcrypt.hashSync('student123', salt);

  // 1. Insert Admin & Students
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, role, roll_no, course)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const adminResult = insertUser.run('Campus Administrator', 'admin@college.edu', adminPassHash, 'super_admin', null, null);
  const student1 = insertUser.run('Alex Johnson', 'alex@college.edu', studentPassHash, 'student', 'CS2026-001', 'B.Tech Computer Science');
  const student2 = insertUser.run('Priya Sharma', 'priya@college.edu', studentPassHash, 'student', 'CS2026-002', 'B.Tech Information Technology');
  const student3 = insertUser.run('Rohit Verma', 'rohit@college.edu', studentPassHash, 'student', 'CS2026-003', 'B.Tech AI & Data Science');

  const student1Id = student1.lastInsertRowid;
  const student2Id = student2.lastInsertRowid;
  const student3Id = student3.lastInsertRowid;

  // 2. Insert Sample Books
  const insertBook = db.prepare(`
    INSERT INTO books (title, author, category, total_copies, available_copies)
    VALUES (?, ?, ?, ?, ?)
  `);

  const book1 = insertBook.run('Introduction to Algorithms (CLRS)', 'Thomas H. Cormen', 'Computer Science', 5, 4);
  const book2 = insertBook.run('Operating System Concepts', 'Abraham Silberschatz', 'Computer Science', 4, 3);
  const book3 = insertBook.run('Database System Concepts', 'Silberschatz & Korth', 'Information Systems', 6, 5);
  const book4 = insertBook.run('Computer Networking: A Top-Down Approach', 'Kurose & Ross', 'Networking', 4, 3);
  const book5 = insertBook.run('Artificial Intelligence: A Modern Approach', 'Stuart Russell', 'AI & ML', 3, 2);
  const book6 = insertBook.run('Clean Code: Agile Software Craftsmanship', 'Robert C. Martin', 'Software Eng', 5, 5);

  // 3. Insert Book Issues
  const insertIssue = db.prepare(`
    INSERT INTO book_issues (book_id, student_id, issue_date, due_date, return_date, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const today = new Date();
  const formatIsoDate = (d) => d.toISOString().split('T')[0];

  const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000);
  const nineDaysLater = new Date(today.getTime() + 9 * 24 * 60 * 60 * 1000);
  const twentyDaysAgo = new Date(today.getTime() - 20 * 24 * 60 * 60 * 1000);
  const fourDaysAgo = new Date(today.getTime() - 4 * 24 * 60 * 60 * 1000);
  const sixDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

  // Alex: Active book within due date
  insertIssue.run(book1.lastInsertRowid, student1Id, formatIsoDate(fiveDaysAgo), formatIsoDate(nineDaysLater), null, 'Issued');
  // Alex: Returned book
  insertIssue.run(book6.lastInsertRowid, student1Id, formatIsoDate(twentyDaysAgo), formatIsoDate(sixDaysAgo), formatIsoDate(fourDaysAgo), 'Returned');
  // Rohit: Overdue book (Due date was 4 days ago)
  insertIssue.run(book4.lastInsertRowid, student3Id, formatIsoDate(twentyDaysAgo), formatIsoDate(fourDaysAgo), null, 'Issued');
  // Priya: Active book
  insertIssue.run(book2.lastInsertRowid, student2Id, formatIsoDate(fiveDaysAgo), formatIsoDate(nineDaysLater), null, 'Issued');

  // 4. Insert Sample Attendance
  const insertAttendance = db.prepare(`
    INSERT INTO attendance (student_id, subject, date, status)
    VALUES (?, ?, ?, ?)
  `);

  const subjects = [
    'Data Structures & Algorithms',
    'Database Management Systems',
    'Operating Systems',
    'Computer Networks',
    'Web Technologies'
  ];

  // Populate last 10 days of classes
  // Alex will have ~85% attendance (overall green)
  // Rohit will have ~65% attendance (overall red to demonstrate requirement)
  for (let i = 12; i >= 1; i--) {
    const classDate = formatIsoDate(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
    subjects.forEach((subj, sIdx) => {
      // Alex attendance pattern: mostly present, occasional absent
      const alexStatus = (i % 5 === 0 && sIdx % 2 === 0) ? 'Absent' : 'Present';
      insertAttendance.run(student1Id, subj, classDate, alexStatus);

      // Priya attendance pattern
      const priyaStatus = (i % 4 === 0) ? 'Absent' : 'Present';
      insertAttendance.run(student2Id, subj, classDate, priyaStatus);

      // Rohit attendance pattern: lower attendance
      const rohitStatus = (i % 2 === 0 || sIdx % 3 === 0) ? 'Absent' : 'Present';
      insertAttendance.run(student3Id, subj, classDate, rohitStatus);
    });
  }

  // 5. Insert Sample Results
  const insertResult = db.prepare(`
    INSERT INTO results (student_id, subject, marks_obtained, max_marks, exam_type)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Alex's results
  insertResult.run(student1Id, 'Data Structures & Algorithms', 88, 100, 'Mid-Semester Exam');
  insertResult.run(student1Id, 'Database Management Systems', 92, 100, 'Mid-Semester Exam');
  insertResult.run(student1Id, 'Operating Systems', 78, 100, 'Mid-Semester Exam');
  insertResult.run(student1Id, 'Computer Networks', 85, 100, 'Mid-Semester Exam');
  insertResult.run(student1Id, 'Web Technologies', 95, 100, 'Mid-Semester Exam');

  // Priya's results
  insertResult.run(student2Id, 'Data Structures & Algorithms', 80, 100, 'Mid-Semester Exam');
  insertResult.run(student2Id, 'Database Management Systems', 84, 100, 'Mid-Semester Exam');
  insertResult.run(student2Id, 'Operating Systems', 88, 100, 'Mid-Semester Exam');
  insertResult.run(student2Id, 'Computer Networks', 76, 100, 'Mid-Semester Exam');
  insertResult.run(student2Id, 'Web Technologies', 91, 100, 'Mid-Semester Exam');

  // 6. Insert Quizzes
  const insertQuiz = db.prepare(`
    INSERT INTO quizzes (title, subject)
    VALUES (?, ?)
  `);

  const quiz1 = insertQuiz.run('Full-Stack Web Development Essentials', 'Web Technologies');
  const quiz2 = insertQuiz.run('Data Structures & Algorithms Practice Quiz', 'Computer Science');

  // 7. Insert Quiz Questions
  const insertQuestion = db.prepare(`
    INSERT INTO quiz_questions (quiz_id, question, option_a, option_b, option_c, option_d, correct_option)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Quiz 1 Questions (Web Technologies)
  insertQuestion.run(
    quiz1.lastInsertRowid,
    'Which HTTP status code signifies a successful resource creation on the server?',
    '200 OK',
    '201 Created',
    '204 No Content',
    '301 Moved Permanently',
    'b'
  );

  insertQuestion.run(
    quiz1.lastInsertRowid,
    'What is the purpose of middleware in an Express.js application?',
    'To directly query the database without route handlers',
    'To compile CSS into WebAssembly',
    'To process requests and responses before reaching route handlers or concluding the request',
    'To manage memory paging in the Node.js event loop',
    'c'
  );

  insertQuestion.run(
    quiz1.lastInsertRowid,
    'Which of the following is true about SQLite database engine?',
    'It requires an external standalone daemon service like PostgreSQL',
    'It is an in-process, zero-configuration, serverless SQL database engine',
    'It cannot support ACID transactions',
    'It only supports in-memory key-value lookups without SQL tables',
    'b'
  );

  insertQuestion.run(
    quiz1.lastInsertRowid,
    'What cryptographic technique does bcrypt employ to resist brute-force attacks?',
    'Public-key RSA cryptography',
    'AES-256 block cipher encryption',
    'Salted key derivation with an adjustable work factor (rounds)',
    'Base64 URL-safe encoding',
    'c'
  );

  insertQuestion.run(
    quiz1.lastInsertRowid,
    'In EJS templating, what syntax output escapes HTML characters to protect against XSS?',
    '<%- expression %>',
    '<%= expression %>',
    '<%# expression %>',
    '<%* expression %>',
    'b'
  );

  // Quiz 2 Questions (DSA)
  insertQuestion.run(
    quiz2.lastInsertRowid,
    'What is the worst-case time complexity of QuickSort?',
    'O(N log N)',
    'O(N)',
    'O(N²)',
    'O(log N)',
    'c'
  );

  insertQuestion.run(
    quiz2.lastInsertRowid,
    'Which data structure follows the First-In, First-Out (FIFO) principle?',
    'Stack',
    'Queue',
    'Priority Queue',
    'Binary Search Tree',
    'b'
  );

  insertQuestion.run(
    quiz2.lastInsertRowid,
    'What is the average time complexity for searching an element in a balanced Binary Search Tree (AVL / Red-Black)?',
    'O(1)',
    'O(N)',
    'O(log N)',
    'O(N²)',
    'c'
  );

  insertQuestion.run(
    quiz2.lastInsertRowid,
    'Which graph traversal algorithm uses a Queue as its underlying helper data structure?',
    'Depth First Search (DFS)',
    'Breadth First Search (BFS)',
    'Dijkstra Shortest Path with Fibonacci Heap',
    'Prim Algorithm',
    'b'
  );

  insertQuestion.run(
    quiz2.lastInsertRowid,
    'What is the space complexity of an in-place array reversal algorithm?',
    'O(N)',
    'O(1)',
    'O(N log N)',
    'O(log N)',
    'b'
  );

  // 8. Insert Sample Quiz Attempt for Alex
  const insertAttempt = db.prepare(`
    INSERT INTO quiz_attempts (quiz_id, student_id, score, total)
    VALUES (?, ?, ?, ?)
  `);
  insertAttempt.run(quiz1.lastInsertRowid, student1Id, 4, 5);

  console.log('✅ Database seeded successfully with demo records!');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
