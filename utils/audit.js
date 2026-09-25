const db = require('../config/db');

/**
 * Log admin action into audit_log
 * @param {number} adminId - ID of admin user performing the action
 * @param {string} action - Human-readable action title (e.g. 'Marked attendance')
 * @param {string} details - Additional descriptive details (e.g. 'Subject: DSA, Date: 2026-09-25')
 */
function logAudit(adminId, action, details = '') {
  try {
    if (!adminId) return;
    db.prepare(`
      INSERT INTO audit_log (admin_id, action, details, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(adminId, action, details);
  } catch (err) {
    console.error('[Audit:Error]', err.message);
  }
}

module.exports = { logAudit };
