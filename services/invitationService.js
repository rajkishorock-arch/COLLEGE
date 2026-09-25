const crypto = require('crypto');
const db = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * Tenant-Scoped User & Faculty Invitation Service
 */
const invitationService = {
  /**
   * Create cryptographically secure tenant-scoped invitation
   */
  createInvitation(tenantId, { email, role = 'student', createdBy = null, departmentId = null, expiresInHours = 48 }) {
    if (!tenantId) throw new Error('Tenant ID is required.');
    if (!email || !email.trim()) throw new Error('Email is required.');

    const cleanEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
    if (existingUser) {
      throw new Error(`A user with email "${cleanEmail}" already exists.`);
    }

    // Generate high-entropy 256-bit cryptographic token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Calculate expiry
    const expiresAt = new Date(Date.now() + (expiresInHours * 60 * 60 * 1000)).toISOString();

    const stmt = db.prepare(`
      INSERT INTO invitations (tenant_id, department_id, email, role, token_hash, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    stmt.run(tenantId, departmentId, cleanEmail, role, tokenHash, expiresAt, createdBy);

    return {
      rawToken,
      inviteUrl: `/invitation/accept?token=${rawToken}`,
      email: cleanEmail,
      role,
      expiresAt
    };
  },

  /**
   * Validate token without consuming it
   */
  verifyInvitation(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false, reason: 'Invalid or missing invitation token.' };
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const invite = db.prepare(`
      SELECT inv.*, t.name AS tenant_name, t.code AS tenant_code, t.logo AS tenant_logo, t.status AS tenant_status
      FROM invitations inv
      JOIN tenants t ON inv.tenant_id = t.id
      WHERE inv.token_hash = ?
    `).get(tokenHash);

    if (!invite) {
      return { valid: false, reason: 'Invitation not found or invalid token.' };
    }

    if (invite.used_at) {
      return { valid: false, reason: 'This invitation has already been accepted and used.' };
    }

    const isExpired = new Date(invite.expires_at) < new Date();
    if (isExpired) {
      return { valid: false, reason: 'This invitation has expired. Please contact your institution administrator.' };
    }

    if (invite.tenant_status === 'suspended') {
      return { valid: false, reason: 'The inviting institution is currently suspended.' };
    }

    return { valid: true, invite };
  },

  /**
   * Accept invitation and create account atomically
   * Guarantees tenant_id and role cannot be altered by client
   */
  acceptInvitation(rawToken, { name, password, rollNo, course, securityQuestion, securityAnswer }) {
    const verification = this.verifyInvitation(rawToken);
    if (!verification.valid) {
      throw new Error(verification.reason);
    }

    const { invite } = verification;
    const tokenHash = invite.token_hash;
    const tenantId = invite.tenant_id;
    const fixedRole = invite.role; // Strictly enforced from invitation
    const email = invite.email;

    if (!name || !name.trim()) throw new Error('Full name is required.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

    const salt = bcrypt.genSaltSync(10);
    const passHash = bcrypt.hashSync(password, salt);
    const ansHash = bcrypt.hashSync((securityAnswer || 'computer science').trim().toLowerCase(), salt);

    const transaction = db.transaction(() => {
      // 1. Mark invitation as used
      db.prepare("UPDATE invitations SET used_at = datetime('now') WHERE token_hash = ?").run(tokenHash);

      // 2. Insert user with strictly locked tenant_id and role
      const userRes = db.prepare(`
        INSERT INTO users (
          tenant_id, department_id, name, email, password, role,
          roll_no, course, security_question, security_answer, is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        tenantId,
        invite.department_id,
        name.trim(),
        email,
        passHash,
        fixedRole,
        rollNo ? rollNo.trim().toUpperCase() : null,
        course ? course.trim() : null,
        securityQuestion || 'What is your favorite subject?',
        ansHash
      );

      return userRes.lastInsertRowid;
    });

    return transaction();
  },

  /**
   * List active invitations for a tenant
   */
  getInvitationsByTenant(tenantId) {
    return db.prepare(`
      SELECT inv.*, u.name AS creator_name
      FROM invitations inv
      LEFT JOIN users u ON inv.created_by = u.id
      WHERE inv.tenant_id = ?
      ORDER BY inv.created_at DESC
    `).all(tenantId);
  }
};

module.exports = invitationService;
