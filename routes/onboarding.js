const express = require('express');
const router = express.Router();
const db = require('../config/db');
const tenantService = require('../services/tenantService');
const invitationService = require('../services/invitationService');
const { logAudit } = require('../utils/audit');

// Middleware to guard onboarding wizard routes
function requireTenantAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in to access institution setup.'));
  }
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin' && req.session.user.role !== 'college_admin') {
    return res.status(403).render('error', {
      title: 'Access Denied',
      statusCode: 403,
      message: 'Onboarding setup wizard is restricted to institution administrators.'
    });
  }
  next();
}

/**
 * GET /onboarding/wizard
 * Renders the 4-step interactive setup wizard
 */
router.get('/wizard', requireTenantAdmin, (req, res) => {
  const tenantId = req.session.user.tenant_id;
  const tenant = tenantService.getTenantById(tenantId);
  if (!tenant) {
    return res.redirect('/admin/dashboard');
  }

  const departments = tenantService.getDepartments(tenantId);
  const step = parseInt(req.query.step || '1', 10);

  res.render('onboarding-wizard', {
    title: 'Setup Wizard - CampusPulse',
    user: req.session.user,
    tenant,
    departments,
    step: Math.min(Math.max(step, 1), 4),
    success: req.query.success || null,
    error: req.query.error || null,
    layout: false
  });
});

/**
 * POST /onboarding/wizard/step1
 * Profile & Branding Configuration
 */
router.post('/wizard/step1', requireTenantAdmin, (req, res) => {
  const tenantId = req.session.user.tenant_id;
  const { name, short_name, institution_type, address, phone, primary_color, secondary_color } = req.body;

  try {
    db.prepare(`
      UPDATE tenants 
      SET name = COALESCE(?, name),
          short_name = COALESCE(?, short_name),
          institution_type = COALESCE(?, institution_type),
          address = ?,
          phone = ?,
          primary_color = COALESCE(?, primary_color),
          secondary_color = COALESCE(?, secondary_color),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      short_name ? short_name.trim() : null,
      institution_type || null,
      address ? address.trim() : null,
      phone ? phone.trim() : null,
      primary_color || null,
      secondary_color || null,
      tenantId
    );

    logAudit(
      req.session.user.id,
      'Onboarding Profile Updated',
      `Administrator configured profile details during setup wizard.`,
      null,
      tenantId
    );

    res.redirect('/onboarding/wizard?step=2');
  } catch (err) {
    console.error('Wizard Step 1 Error:', err);
    res.redirect('/onboarding/wizard?step=1&error=' + encodeURIComponent('Failed to save profile: ' + err.message));
  }
});

/**
 * POST /onboarding/wizard/step2
 * Academic Structure & Departments
 */
router.post('/wizard/step2', requireTenantAdmin, (req, res) => {
  const tenantId = req.session.user.tenant_id;
  const { academic_year, new_department_name, new_department_code } = req.body;

  try {
    if (academic_year && academic_year.trim()) {
      db.prepare("UPDATE tenants SET academic_year = ?, updated_at = datetime('now') WHERE id = ?")
        .run(academic_year.trim(), tenantId);
    }

    if (new_department_name && new_department_name.trim()) {
      const code = (new_department_code && new_department_code.trim()) 
        ? new_department_code.trim().toUpperCase() 
        : new_department_name.split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase();

      const existingDept = db.prepare('SELECT id FROM departments WHERE tenant_id = ? AND UPPER(code) = ?').get(tenantId, code);
      if (!existingDept) {
        tenantService.createDepartment(tenantId, {
          name: new_department_name.trim(),
          code: code,
          headOfDepartment: 'Department Chair'
        });
      }
    }

    res.redirect('/onboarding/wizard?step=3');
  } catch (err) {
    console.error('Wizard Step 2 Error:', err);
    res.redirect('/onboarding/wizard?step=2&error=' + encodeURIComponent('Failed to update academic structure: ' + err.message));
  }
});

/**
 * POST /onboarding/wizard/step3
 * Initial Team Invitations (Optional)
 */
router.post('/wizard/step3', requireTenantAdmin, (req, res) => {
  const tenantId = req.session.user.tenant_id;
  const { faculty_email, staff_email, action } = req.body;

  if (action === 'skip') {
    return res.redirect('/onboarding/wizard?step=4');
  }

  try {
    if (faculty_email && faculty_email.trim()) {
      invitationService.createInvitation(tenantId, {
        email: faculty_email.trim(),
        role: 'admin',
        createdBy: req.session.user.id
      });
    }

    if (staff_email && staff_email.trim()) {
      invitationService.createInvitation(tenantId, {
        email: staff_email.trim(),
        role: 'admin',
        createdBy: req.session.user.id
      });
    }

    res.redirect('/onboarding/wizard?step=4');
  } catch (err) {
    console.error('Wizard Step 3 Error:', err);
    // Non-fatal, allow proceeding to finish step
    res.redirect('/onboarding/wizard?step=4');
  }
});

/**
 * POST /onboarding/wizard/finish
 * Complete Onboarding & Launch Dashboard
 */
router.post('/wizard/finish', requireTenantAdmin, (req, res) => {
  const tenantId = req.session.user.tenant_id;
  logAudit(
    req.session.user.id,
    'Institution Onboarding Completed',
    `Administrator ${req.session.user.email} completed initial institution onboarding.`,
    null,
    tenantId
  );
  res.redirect('/admin/dashboard?success=' + encodeURIComponent('🎉 Welcome to CampusPulse! Your institution is fully initialized and ready.'));
});

module.exports = router;
