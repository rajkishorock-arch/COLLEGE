const db = require('../config/db');
const { logAudit } = require('../utils/audit');

/**
 * Centralized Audit Service supporting Tenant & Platform scopes
 */
const auditService = {
  /**
   * Log action with explicit tenant scoping
   */
  log(tenantId, adminId, action, details = '', targetUserId = null) {
    logAudit(adminId, action, details, targetUserId, tenantId);
  },

  /**
   * Retrieve audit logs strictly scoped to a tenant
   */
  getTenantLogs(tenantId, limit = 50, offset = 0) {
    if (!tenantId) return [];
    return db.prepare(`
      SELECT 
        a.id, a.tenant_id, a.action, a.details, a.created_at,
        u.name AS admin_name, u.email AS admin_email, u.role AS admin_role,
        t.name AS target_name, t.email AS target_email
      FROM audit_log a
      LEFT JOIN users u ON a.admin_id = u.id
      LEFT JOIN users t ON a.target_user_id = t.id
      WHERE a.tenant_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).all(tenantId, limit, offset);
  },

  /**
   * Retrieve platform-wide audit logs across all institutions (Super Admin exclusive)
   */
  getPlatformLogs(limit = 100, offset = 0) {
    return db.prepare(`
      SELECT 
        a.id, a.tenant_id, a.action, a.details, a.created_at,
        u.name AS admin_name, u.email AS admin_email, u.role AS admin_role,
        t.name AS target_name, t.email AS target_email,
        ten.name AS tenant_name, ten.code AS tenant_code
      FROM audit_log a
      LEFT JOIN users u ON a.admin_id = u.id
      LEFT JOIN users t ON a.target_user_id = t.id
      LEFT JOIN tenants ten ON a.tenant_id = ten.id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }
};

module.exports = auditService;
