const db = require('../config/db');

/**
 * Attendance Service - Scoped by Tenant
 */
const attendanceService = {
  /**
   * Get attendance statistics for an institution
   */
  getTenantStats(tenantId) {
    if (!tenantId) return { total: 0, present: 0, averageAttendance: 0 };
    const stats = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present
      FROM attendance
      WHERE tenant_id = ?
    `).get(tenantId);

    const averageAttendance = stats && stats.total > 0
      ? Math.round((stats.present / stats.total) * 100)
      : 0;

    return {
      total: stats ? stats.total : 0,
      present: stats ? (stats.present || 0) : 0,
      averageAttendance
    };
  },

  /**
   * Get attendance for a specific student scoped to their tenant
   */
  getStudentAttendance(studentId, tenantId) {
    return db.prepare(`
      SELECT * FROM attendance
      WHERE student_id = ? AND tenant_id = ?
      ORDER BY date DESC, id DESC
    `).all(studentId, tenantId);
  },

  /**
   * Mark attendance
   */
  markAttendance(tenantId, studentId, subject, date, status) {
    // Check if record already exists for this student, subject, and date in this tenant
    const existing = db.prepare(`
      SELECT id FROM attendance 
      WHERE tenant_id = ? AND student_id = ? AND subject = ? AND date = ?
    `).get(tenantId, studentId, subject, date);

    if (existing) {
      return db.prepare(`
        UPDATE attendance SET status = ? WHERE id = ? AND tenant_id = ?
      `).run(status, existing.id, tenantId).changes > 0;
    }

    return db.prepare(`
      INSERT INTO attendance (tenant_id, student_id, subject, date, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(tenantId, studentId, subject, date, status).lastInsertRowid;
  }
};

module.exports = attendanceService;
