const db = require('../config/db');

/**
 * Log admin action into audit_log
 * @param {number} adminId - ID of admin user performing the action
 * @param {string} action - Human-readable action title (e.g. 'Student Password Reset')
 * @param {string} details - Additional descriptive details (e.g. 'Reset password for student Priya Sharma')
 * @param {number|null} targetUserId - ID of the affected user account (optional)
 */
function logAudit(adminId, action, details = '', targetUserId = null) {
  try {
    if (!adminId) return;
    db.prepare(`
      INSERT INTO audit_log (admin_id, action, details, target_user_id, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(adminId, action, details, targetUserId || null);
  } catch (err) {
    console.error('[Audit:Error]', err.message);
  }
}

module.exports = { logAudit };
