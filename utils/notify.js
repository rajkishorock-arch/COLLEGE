const db = require('../config/db');

/**
 * Insert a notification for a user
 * @param {number} userId - Recipient user id
 * @param {string} message - Notification text
 * @param {string} type - 'attendance' | 'library' | 'announcement' | 'assignment' | 'quiz' | 'fee' | 'general'
 */
function createNotification(userId, message, type = 'general') {
  try {
    if (!userId || !message) return;
    db.prepare(`
      INSERT INTO notifications (user_id, message, type, is_read, created_at)
      VALUES (?, ?, ?, 0, datetime('now'))
    `).run(userId, message, type);
  } catch (err) {
    console.error('[Notification:Error]', err.message);
  }
}

/**
 * Broadcast notification to all students
 */
function broadcastToStudents(message, type = 'announcement') {
  try {
    const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all();
    const insert = db.prepare(`
      INSERT INTO notifications (user_id, message, type, is_read, created_at)
      VALUES (?, ?, ?, 0, datetime('now'))
    `);
    const runBatch = db.transaction(() => {
      students.forEach(st => {
        insert.run(st.id, message, type);
      });
    });
    runBatch();
  } catch (err) {
    console.error('[Notification:BroadcastError]', err.message);
  }
}

module.exports = { createNotification, broadcastToStudents };
