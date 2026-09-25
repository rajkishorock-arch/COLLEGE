const db = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * User Service - Tenant-Scoped User Operations
 */
const userService = {
  /**
   * Get user by ID scoped strictly to a tenant (unless tenantId is null for super_admin)
   */
  getUserById(userId, tenantId = null) {
    if (!userId) return null;
    if (tenantId) {
      return db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId);
    }
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  },

  /**
   * Get students for a specific tenant
   */
  getStudentsByTenant(tenantId, search = '') {
    if (!tenantId) return [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      return db.prepare(`
        SELECT id, tenant_id, name, email, roll_no, course, profile_photo, is_active, created_at
        FROM users
        WHERE tenant_id = ? AND role = 'student'
          AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(roll_no) LIKE ? OR LOWER(course) LIKE ?)
        ORDER BY name ASC
      `).all(tenantId, q, q, q, q);
    }

    return db.prepare(`
      SELECT id, tenant_id, name, email, roll_no, course, profile_photo, is_active, created_at
      FROM users
      WHERE tenant_id = ? AND role = 'student'
      ORDER BY name ASC
    `).all(tenantId);
  },

  /**
   * Get administrators for a tenant
   */
  getAdminsByTenant(tenantId) {
    if (!tenantId) return [];
    return db.prepare(`
      SELECT id, tenant_id, name, email, role, is_active, created_at
      FROM users
      WHERE tenant_id = ? AND role IN ('admin', 'college_admin')
      ORDER BY created_at ASC
    `).all(tenantId);
  },

  /**
   * Create a new student under a specific tenant
   */
  createStudent(tenantId, { name, email, password, roll_no, course, securityQuestion, securityAnswer }) {
    if (!tenantId) throw new Error('Tenant ID is required.');

    // Check email uniqueness globally
    const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (existingEmail) {
      throw new Error(`An account with email "${email}" already exists.`);
    }

    // Check roll number uniqueness within this tenant
    const existingRoll = db.prepare('SELECT id FROM users WHERE LOWER(roll_no) = LOWER(?) AND tenant_id = ?').get(roll_no.trim(), tenantId);
    if (existingRoll) {
      throw new Error(`A student with Roll Number "${roll_no}" already exists in this institution.`);
    }

    const salt = bcrypt.genSaltSync(10);
    const passHash = bcrypt.hashSync(password, salt);
    const ansHash = bcrypt.hashSync((securityAnswer || 'computer science').trim().toLowerCase(), salt);

    const stmt = db.prepare(`
      INSERT INTO users (
        tenant_id, name, email, password, role, roll_no, course,
        security_question, security_answer, is_active
      ) VALUES (?, ?, ?, ?, 'student', ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(
      tenantId,
      name.trim(),
      email.trim().toLowerCase(),
      passHash,
      roll_no.trim().toUpperCase(),
      course.trim(),
      securityQuestion || 'What is your favorite subject?',
      ansHash
    );

    return result.lastInsertRowid;
  },

  /**
   * Update student details scoped to tenant
   */
  updateStudent(studentId, tenantId, { name, email, roll_no, course }) {
    // Verify student exists and belongs to this tenant
    const student = this.getUserById(studentId, tenantId);
    if (!student) {
      throw new Error('Student not found or does not belong to this institution.');
    }

    // Verify email uniqueness if changed
    if (email && email.toLowerCase() !== student.email.toLowerCase()) {
      const emailClash = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?').get(email.trim(), studentId);
      if (emailClash) {
        throw new Error(`Email "${email}" is already in use by another user.`);
      }
    }

    // Verify roll number uniqueness within tenant if changed
    if (roll_no && roll_no.toUpperCase() !== (student.roll_no || '').toUpperCase()) {
      const rollClash = db.prepare('SELECT id FROM users WHERE LOWER(roll_no) = LOWER(?) AND tenant_id = ? AND id != ?').get(roll_no.trim(), tenantId, studentId);
      if (rollClash) {
        throw new Error(`Roll number "${roll_no}" is already assigned to another student in this institution.`);
      }
    }

    const stmt = db.prepare(`
      UPDATE users 
      SET name = ?, email = ?, roll_no = ?, course = ?
      WHERE id = ? AND tenant_id = ?
    `);

    return stmt.run(
      name.trim(),
      email.trim().toLowerCase(),
      roll_no.trim().toUpperCase(),
      course.trim(),
      studentId,
      tenantId
    ).changes > 0;
  }
};

module.exports = userService;
