const db = require('../config/db');

/**
 * Results Service - Tenant-Scoped Academic Performance & CGPA
 */
const resultsService = {
  /**
   * Get student results scoped to tenant
   */
  getStudentResults(studentId, tenantId) {
    return db.prepare(`
      SELECT * FROM results
      WHERE student_id = ? AND tenant_id = ?
      ORDER BY id DESC
    `).all(studentId, tenantId);
  },

  /**
   * Get all results for an institution
   */
  getTenantResults(tenantId) {
    return db.prepare(`
      SELECT r.*, u.name AS student_name, u.roll_no, u.course
      FROM results r
      JOIN users u ON r.student_id = u.id
      WHERE r.tenant_id = ?
      ORDER BY r.id DESC
    `).all(tenantId);
  },

  /**
   * Record or update marks
   */
  saveResult(tenantId, studentId, subject, marksObtained, maxMarks, examType, semester = 'Semester 1') {
    return db.prepare(`
      INSERT INTO results (tenant_id, student_id, subject, marks_obtained, max_marks, exam_type, semester)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, studentId, subject, marksObtained, maxMarks, examType, semester).lastInsertRowid;
  }
};

module.exports = resultsService;
