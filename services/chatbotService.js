const db = require('../config/db');

/**
 * CampusPulse Real-Time Academic Assistant Service
 * Combines:
 * 1. Live Student Database Context (Real Attendance %, Due Fees, Overdue Books, Classes)
 * 2. Google Gemini Generative AI (if GEMINI_API_KEY is configured)
 * 3. Smart Contextual Fallback Engine that provides real data even without API keys
 */
class ChatbotService {
  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || null;
  }

  /**
   * Fetch complete, live academic state for the logged-in student
   */
  getStudentContext(studentId, tenantId) {
    try {
      const student = db.prepare("SELECT name, email, roll_no, course FROM users WHERE id = ?").get(studentId);
      const tenant = db.prepare("SELECT name, short_name FROM tenants WHERE id = ?").get(tenantId);

      // 1. Real Attendance Stats
      const attStats = db.prepare(`
        SELECT 
          COUNT(*) as total_classes,
          SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as attended_classes
        FROM attendance 
        WHERE student_id = ? AND tenant_id = ?
      `).get(studentId, tenantId) || { total_classes: 0, attended_classes: 0 };

      const totalClasses = attStats.total_classes || 0;
      const attendedClasses = attStats.attended_classes || 0;
      const attendancePct = totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 100;

      // 2. Real Pending Fees
      const feeStats = db.prepare(`
        SELECT 
          COUNT(*) as pending_count,
          COALESCE(SUM(amount_due - amount_paid), 0) as total_due
        FROM fees 
        WHERE student_id = ? AND tenant_id = ? AND status != 'Paid'
      `).get(studentId, tenantId) || { pending_count: 0, total_due: 0 };

      // 3. Real Library Loans & Overdue Books
      const libraryStats = db.prepare(`
        SELECT 
          COUNT(*) as total_loans,
          SUM(CASE WHEN status = 'Issued' AND date(due_date) < date('now') THEN 1 ELSE 0 END) as overdue_count
        FROM book_issues 
        WHERE student_id = ? AND tenant_id = ? AND status = 'Issued'
      `).get(studentId, tenantId) || { total_loans: 0, overdue_count: 0 };

      // 4. Real Exam Performance Average
      const resultStats = db.prepare(`
        SELECT 
          COUNT(*) as exam_count,
          COALESCE(AVG(marks_obtained), 0) as avg_marks
        FROM results 
        WHERE student_id = ? AND tenant_id = ?
      `).get(studentId, tenantId) || { exam_count: 0, avg_marks: 0 };

      // 5. Today's Timetable
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const todayDay = days[new Date().getDay()];
      const todaySchedule = db.prepare(`
        SELECT subject, start_time, end_time, room 
        FROM timetable 
        WHERE tenant_id = ? AND day_of_week = ?
        ORDER BY start_time ASC
      `).all(tenantId, todayDay) || [];

      return {
        name: student?.name || 'Student',
        rollNo: student?.roll_no || 'N/A',
        course: student?.course || 'General Program',
        institution: tenant?.name || 'CampusPulse Institute',
        attendance: {
          total: totalClasses,
          attended: attendedClasses,
          percentage: attendancePct,
          isShortage: attendancePct < 75
        },
        fees: {
          pendingInvoices: feeStats.pending_count,
          totalDueAmount: feeStats.total_due
        },
        library: {
          activeLoans: libraryStats.total_loans,
          overdueBooks: libraryStats.overdue_count
        },
        academics: {
          examCount: resultStats.exam_count,
          averageMarks: Math.round(resultStats.avg_marks)
        },
        todaySchedule
      };
    } catch (err) {
      console.error('[ChatbotService:ContextError]', err.message);
      return null;
    }
  }

  /**
   * Process Student Query with Live Context & AI
   */
  async processQuery(userMessage, studentId, tenantId) {
    const context = this.getStudentContext(studentId, tenantId);
    const query = (userMessage || '').trim();

    // 1. If Gemini API key is configured, use Google Generative AI
    if (this.geminiApiKey) {
      try {
        const aiResponse = await this.callGeminiAI(query, context);
        if (aiResponse) return aiResponse;
      } catch (err) {
        console.warn('⚠️ [ChatbotService:Gemini] Fallback to contextual generator:', err.message);
      }
    }

    // 2. Intelligent Contextual Engine (Answers with actual database numbers)
    return this.generateContextualResponse(query, context);
  }

  /**
   * Call Google Gemini API with system prompt & live academic state
   */
  async callGeminiAI(query, context) {
    const systemPrompt = `You are CampusPulse Assistant, an empathetic, helpful, and concise AI academic advisor for higher education students.
Here is the LIVE real-time database record for the currently logged-in student:
- Name: ${context.name} (Roll: ${context.rollNo})
- Enrolled Course: ${context.course}
- Institution: ${context.institution}
- Attendance: ${context.attendance.percentage}% (${context.attendance.attended} of ${context.attendance.total} classes attended). Minimum required: 75%.
- Pending Fees: ₹${context.fees.totalDueAmount} across ${context.fees.pendingInvoices} unpaid invoice(s).
- Library Status: ${context.library.activeLoans} book(s) borrowed, ${context.library.overdueBooks} overdue.
- Academic Standing: Average marks ${context.academics.averageMarks}/100 across ${context.academics.examCount} exam records.

Answer the student's questions concisely, accurately, and politely in 2-3 sentences. If they ask about attendance, fees, books, or exams, always cite their EXACT numbers from the record above. You can respond in English or Hinglish if the user asks in Hinglish.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nStudent asks: "${query}"` }] }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 250
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) return reply.trim();
    }
    return null;
  }

  /**
   * Smart Contextual Generator with Real Database Metrics
   */
  generateContextualResponse(query, context) {
    const q = query.toLowerCase();
    const firstName = context?.name ? context.name.split(' ')[0] : 'there';

    // 1. Attendance Queries
    if (q.includes('attendance') || q.includes('absent') || q.includes('present') || q.includes('shortage') || q.includes('percentage') || q.includes('attend')) {
      const { percentage, attended, total, isShortage } = context.attendance;
      if (total === 0) {
        return `Hello ${firstName}! You don't have any logged attendance sessions yet for this semester. Once classes start, you can verify your check-ins under the Self Check-In portal.`;
      }
      if (isShortage) {
        return `⚠️ Hello ${firstName}, your current attendance is ${percentage}% (${attended} out of ${total} classes attended). This is below the required 75% semester threshold! Please attend upcoming lectures and check in with your dynamic session code.`;
      }
      return `🌟 Hello ${firstName}! Your overall attendance is currently ${percentage}% (${attended} out of ${total} sessions attended). You are comfortably above the mandatory 75% exam requirement!`;
    }

    // 2. Fee & Invoice Queries
    if (q.includes('fee') || q.includes('due') || q.includes('pay') || q.includes('tuition') || q.includes('invoice') || q.includes('receipt') || q.includes('fine')) {
      const { totalDueAmount, pendingInvoices } = context.fees;
      if (pendingInvoices === 0 || totalDueAmount === 0) {
        return `✅ Great news, ${firstName}! You have no outstanding fees due. All your semester invoices are fully paid and verified.`;
      }
      return `💳 Hello ${firstName}, you have ${pendingInvoices} pending fee invoice(s) totaling ₹${totalDueAmount.toLocaleString('en-IN')}. You can pay directly with instant verification under 'Fee Status' (/student/fees).`;
    }

    // 3. Library & Book Queries
    if (q.includes('library') || q.includes('book') || q.includes('borrow') || q.includes('return') || q.includes('overdue')) {
      const { activeLoans, overdueBooks } = context.library;
      if (activeLoans === 0) {
        return `📚 You currently have no books borrowed from the central library. You can browse the catalog and loan titles in the 'Library' section (/student/library).`;
      }
      if (overdueBooks > 0) {
        return `⚠️ You have ${activeLoans} active book loan(s), of which ${overdueBooks} is overdue. Please return overdue titles to the librarian to prevent loan penalties.`;
      }
      return `📖 You currently have ${activeLoans} active book loan(s) in good standing. Track your return due dates under 'Library' (/student/library).`;
    }

    // 4. Result & GPA Queries
    if (q.includes('result') || q.includes('mark') || q.includes('grade') || q.includes('score') || q.includes('gpa') || q.includes('cgpa') || q.includes('exam')) {
      const { examCount, averageMarks } = context.academics;
      if (examCount === 0) {
        return `📊 No examination results have been published for your profile yet. Once instructors publish scorecards, you can view them under 'My Results' (/student/results).`;
      }
      return `📈 Hello ${firstName}! Across your ${examCount} published examination subjects, your average score is ${averageMarks}%. You can review subject-wise marks breakdown under 'My Results'.`;
    }

    // 5. Timetable / Schedule Queries
    if (q.includes('timetable') || q.includes('schedule') || q.includes('class') || q.includes('today') || q.includes('lecture')) {
      if (context.todaySchedule && context.todaySchedule.length > 0) {
        const classes = context.todaySchedule.map(c => `${c.subject} (${c.start_time} - ${c.end_time} in ${c.room || 'Classroom'})`).join(', ');
        return `📅 Your schedule for today: ${classes}.`;
      }
      return `📅 You have no scheduled lectures on today's calendar. Check your full weekly routine under 'Timetable' (/student/timetable).`;
    }

    // 6. Quizzes
    if (q.includes('quiz') || q.includes('test') || q.includes('mcq')) {
      return `✍️ You can test your knowledge with self-assessment quizzes under 'Quizzes & Tests' (/student/quiz). Responses are graded automatically upon submission!`;
    }

    // 7. General Greetings
    if (q.includes('hi') || q.includes('hello') || q.includes('hey') || q.includes('who are you')) {
      return `Hello ${firstName}! 👋 I am your CampusPulse AI academic assistant. You can ask me about your real attendance percentage, pending fees, borrowed library books, or exam marks anytime!`;
    }

    // 8. Admin Contact
    if (q.includes('admin') || q.includes('office') || q.includes('help') || q.includes('support')) {
      return `The administrative helpdesk at ${context.institution} is available Monday to Friday. You can reach administration at admin@college.edu with your Roll Number: ${context.rollNo}.`;
    }

    // Fallback default
    return `Hello ${firstName}! I can provide your real-time academic records. Try asking: "What is my attendance percentage?", "Do I have any pending fees?", or "What books do I have on loan?"`;
  }
}

module.exports = new ChatbotService();
