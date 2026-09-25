const db = require('../config/db');

/**
 * Log admin action into audit_log with tenant isolation
 * @param {number} adminId - ID of admin user performing the action
 * @param {string} action - Human-readable action title (e.g. 'Student Password Reset')
 * @param {string} details - Additional descriptive details
 * @param {number|null} targetUserId - ID of the affected user account (optional)
 * @param {string|null} tenantId - Tenant ID (optional; automatically resolved from admin if omitted)
 */
function logAudit(adminId, action, details = '', targetUserId = null, tenantId = null) {
  try {
    if (!adminId) return;

    let resolvedTenantId = tenantId;
    if (!resolvedTenantId) {
      const admin = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(adminId);
      resolvedTenantId = admin ? admin.tenant_id : 'tenant_default';
    }

    db.prepare(`
      INSERT INTO audit_log (tenant_id, admin_id, action, details, target_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(resolvedTenantId || 'tenant_default', adminId, action, details, targetUserId || null);
  } catch (err) {
    console.error('[Audit:Error]', err.message);
  }
}

module.exports = { logAudit };

