const db = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * Tenant Service - Platform and Institution Management
 */
const tenantService = {
  /**
   * Fetch tenant by ID
   */
  getTenantById(tenantId) {
    if (!tenantId) return null;
    return db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  },

  /**
   * Fetch tenant by unique institutional code
   */
  getTenantByCode(code) {
    if (!code) return null;
    return db.prepare('SELECT * FROM tenants WHERE UPPER(code) = UPPER(?)').get(code);
  },

  /**
   * Get all institutions with associated aggregate counts
   */
  getAllTenants() {
    const tenants = db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
    return tenants.map(t => {
      const studentCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND role = 'student'").get(t.id).count;
      const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND role IN ('admin', 'college_admin')").get(t.id).count;
      const bookCount = db.prepare("SELECT COUNT(*) as count FROM books WHERE tenant_id = ?").get(t.id).count;
      return {
        ...t,
        studentCount,
        adminCount,
        bookCount
      };
    });
  },

  /**
   * Create a new institution and optionally provision its initial College Administrator atomically
   */
  createTenant({ name, shortName, code, subdomain, email, phone, address, primaryColor, secondaryColor, academicYear, adminName, adminEmail, adminPassword }) {
    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const tenantId = `tenant_${cleanCode.toLowerCase()}`;

    // Verify code uniqueness
    const existing = db.prepare('SELECT id FROM tenants WHERE UPPER(code) = ? OR id = ?').get(cleanCode, tenantId);
    if (existing) {
      throw new Error(`An institution with code "${cleanCode}" already exists.`);
    }

    const insertTenant = db.prepare(`
      INSERT INTO tenants (
        id, name, short_name, code, subdomain, email, phone, address,
        primary_color, secondary_color, academic_year, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);

    const insertUser = db.prepare(`
      INSERT INTO users (
        tenant_id, name, email, password, role, is_active,
        security_question, security_answer
      ) VALUES (?, ?, ?, ?, 'admin', 1, 'What is your favorite subject?', ?)
    `);

    // Use transaction for atomic tenant provisioning
    const transaction = db.transaction(() => {
      insertTenant.run(
        tenantId,
        name.trim(),
        (shortName || cleanCode).trim(),
        cleanCode,
        (subdomain || cleanCode.toLowerCase()).trim(),
        email ? email.trim() : null,
        phone ? phone.trim() : null,
        address ? address.trim() : null,
        primaryColor || '#6C5CE7',
        secondaryColor || '#111318',
        academicYear || '2025-2026'
      );

      let adminUserId = null;
      if (adminEmail && adminPassword) {
        // Check if admin email is already in use
        const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(adminEmail.trim());
        if (existingUser) {
          throw new Error(`User with email "${adminEmail}" is already registered on the platform.`);
        }

        const salt = bcrypt.genSaltSync(10);
        const passHash = bcrypt.hashSync(adminPassword, salt);
        const ansHash = bcrypt.hashSync('computer science', salt);

        const res = insertUser.run(
          tenantId,
          (adminName || `${name} Admin`).trim(),
          adminEmail.trim().toLowerCase(),
          passHash,
          ansHash
        );
        adminUserId = res.lastInsertRowid;
      }

      // Seed initial welcoming announcement for new tenant
      db.prepare(`
        INSERT INTO announcements (tenant_id, title, body, posted_by, priority)
        VALUES (?, ?, ?, ?, 'urgent')
      `).run(
        tenantId,
        `Welcome to ${name}`,
        `Institution management system successfully provisioned for ${name}.`,
        adminUserId || 1
      );

      // Provision initial department foundation
      db.prepare(`
        INSERT INTO departments (tenant_id, name, code, created_at)
        VALUES (?, 'Computer Science & Engineering', 'CSE', datetime('now'))
      `).run(tenantId);

      return { tenantId, adminUserId };
    });

    return transaction();
  },

  /**
   * Update tenant branding and institutional settings
   */
  updateTenant(tenantId, data) {
    const fields = [];
    const values = [];

    const allowed = ['name', 'short_name', 'email', 'phone', 'address', 'primary_color', 'secondary_color', 'academic_year'];
    allowed.forEach(key => {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    });

    if (fields.length === 0) return false;

    fields.push("updated_at = datetime('now')");
    values.push(tenantId);

    const stmt = db.prepare(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
  },

  /**
   * Toggle tenant status ('active', 'suspended', 'inactive')
   */
  setTenantStatus(tenantId, status) {
    if (!['active', 'suspended', 'inactive'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    const stmt = db.prepare("UPDATE tenants SET status = ?, updated_at = datetime('now') WHERE id = ?");
    return stmt.run(status, tenantId).changes > 0;
  },

  /**
   * Retrieve platform-wide metrics for Platform Super Admin
   */
  getPlatformStats() {
    const totalTenants = db.prepare("SELECT COUNT(*) as count FROM tenants").get().count;
    const activeTenants = db.prepare("SELECT COUNT(*) as count FROM tenants WHERE status = 'active'").get().count;
    const suspendedTenants = db.prepare("SELECT COUNT(*) as count FROM tenants WHERE status = 'suspended'").get().count;
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const totalAdmins = db.prepare("SELECT COUNT(*) as count FROM users WHERE role IN ('admin', 'college_admin', 'super_admin')").get().count;
    const totalAuditEvents = db.prepare("SELECT COUNT(*) as count FROM audit_log").get().count;

    return {
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalUsers,
      totalStudents,
      totalAdmins,
      totalAuditEvents
    };
  },

  /**
   * ==========================================
   * DEPARTMENT MANAGEMENT (Tenant Hierarchy)
   * ==========================================
   */
  createDepartment(tenantId, { name, code, headOfDepartment }) {
    if (!tenantId) throw new Error('Tenant ID is required.');
    if (!name || !name.trim()) throw new Error('Department name is required.');
    if (!code || !code.trim()) throw new Error('Department code is required.');

    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

    const existing = db.prepare('SELECT id FROM departments WHERE tenant_id = ? AND UPPER(code) = ?').get(tenantId, cleanCode);
    if (existing) {
      throw new Error(`A department with code "${cleanCode}" already exists in this institution.`);
    }

    const res = db.prepare(`
      INSERT INTO departments (tenant_id, name, code, head_of_department, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(tenantId, name.trim(), cleanCode, headOfDepartment ? headOfDepartment.trim() : null);

    return res.lastInsertRowid;
  },

  getDepartments(tenantId) {
    if (!tenantId) return [];
    return db.prepare(`
      SELECT d.*, COUNT(u.id) AS member_count
      FROM departments d
      LEFT JOIN users u ON d.id = u.department_id AND u.tenant_id = d.tenant_id
      WHERE d.tenant_id = ?
      GROUP BY d.id
      ORDER BY d.name ASC
    `).all(tenantId);
  },

  getDepartmentById(tenantId, departmentId) {
    return db.prepare('SELECT * FROM departments WHERE id = ? AND tenant_id = ?').get(departmentId, tenantId);
  },

  deleteDepartment(tenantId, departmentId) {
    const res = db.prepare('DELETE FROM departments WHERE id = ? AND tenant_id = ?').run(departmentId, tenantId);
    return res.changes > 0;
  }
};

module.exports = tenantService;
