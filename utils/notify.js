const db = require('../config/db');

/**
 * Insert a notification for a user with tenant scoping
 * @param {number} userId - Recipient user id
 * @param {string} message - Notification text
 * @param {string} type - 'attendance' | 'library' | 'announcement' | 'assignment' | 'quiz' | 'fee' | 'general'
 * @param {string|null} tenantId - Tenant ID (optional, auto-resolved if omitted)
 */
function createNotification(userId, message, type = 'general', tenantId = null) {
  try {
    if (!userId || !message) return;
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId) {
      const u = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId);
      resolvedTenantId = u ? u.tenant_id : 'tenant_default';
    }

    db.prepare(`
      INSERT INTO notifications (tenant_id, user_id, message, type, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `).run(resolvedTenantId || 'tenant_default', userId, message, type);
  } catch (err) {
    console.error('[Notification:Error]', err.message);
  }
}

/**
 * Broadcast notification to all students of a specific tenant
 * @param {string} message - Notification text
 * @param {string} type - Notification type
 * @param {string} tenantId - Target tenant ID (defaults to 'tenant_default')
 */
function broadcastToStudents(message, type = 'announcement', tenantId = 'tenant_default') {
  try {
    const students = db.prepare("SELECT id FROM users WHERE role = 'student' AND tenant_id = ?").all(tenantId);
    const insert = db.prepare(`
      INSERT INTO notifications (tenant_id, user_id, message, type, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `);
    const runBatch = db.transaction(() => {
      students.forEach(st => {
        insert.run(tenantId, st.id, message, type);
      });
    });
    runBatch();
  } catch (err) {
    console.error('[Notification:BroadcastError]', err.message);
  }
}

module.exports = { createNotification, broadcastToStudents };

