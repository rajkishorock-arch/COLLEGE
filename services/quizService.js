const db = require('../config/db');

/**
 * Quiz Service - Tenant-Scoped Quizzes & Attempts
 */
const quizService = {
  /**
   * Get all quizzes for a tenant
   */
  getQuizzesByTenant(tenantId) {
    return db.prepare(`
      SELECT q.*, 
        (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id AND qq.tenant_id = q.tenant_id) AS question_count,
        (SELECT COUNT(*) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.tenant_id = q.tenant_id) AS attempt_count
      FROM quizzes q
      WHERE q.tenant_id = ?
      ORDER BY q.id DESC
    `).all(tenantId);
  },

  /**
   * Get a quiz by ID scoped to tenant
   */
  getQuizById(quizId, tenantId) {
    const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ? AND tenant_id = ?').get(quizId, tenantId);
    if (!quiz) return null;

    const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? AND tenant_id = ?').all(quizId, tenantId);
    return { ...quiz, questions };
  },

  /**
   * Record a student's quiz attempt
   */
  recordAttempt(tenantId, quizId, studentId, score, total) {
    return db.prepare(`
      INSERT INTO quiz_attempts (tenant_id, quiz_id, student_id, score, total, attempted_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(tenantId, quizId, studentId, score, total).lastInsertRowid;
  }
};

module.exports = quizService;
