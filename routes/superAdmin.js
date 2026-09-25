const express = require('express');
const router = express.Router();
const { requireSuperAdmin } = require('../middleware/auth');
const tenantService = require('../services/tenantService');
const auditService = require('../services/auditService');
const db = require('../config/db');

// Require Super Admin privileges for all platform management routes
router.use(requireSuperAdmin);

/**
 * GET /super-admin - Platform Dashboard Overview
 */
router.get(['/', '/dashboard'], (req, res) => {
  try {
    const stats = tenantService.getPlatformStats();
    const tenants = tenantService.getAllTenants();
    const recentAudit = auditService.getPlatformLogs(8);

    res.render('super-admin/dashboard', {
      title: 'Platform Management - CampusPulse SaaS',
      pageName: 'super-admin-overview',
      stats,
      tenants: tenants.slice(0, 5),
      totalTenantsCount: tenants.length,
      recentAudit,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error('[SuperAdmin:Dashboard] Error:', err);
    res.status(500).render('error', {
      statusCode: 500,
      title: 'Platform Dashboard Error',
      message: err.message,
      user: req.session.user
    });
  }
});

/**
 * GET /super-admin/tenants - All Institutions List
 */
router.get('/tenants', (req, res) => {
  try {
    const tenants = tenantService.getAllTenants();
    const filter = req.query.filter || 'all';

    const filteredTenants = tenants.filter(t => {
      if (filter === 'active') return t.status === 'active';
      if (filter === 'suspended') return t.status === 'suspended';
      return true;
    });

    res.render('super-admin/tenants', {
      title: 'Institutions & Tenants - CampusPulse SaaS',
      pageName: 'super-admin-tenants',
      tenants: filteredTenants,
      totalCount: tenants.length,
      activeCount: tenants.filter(t => t.status === 'active').length,
      suspendedCount: tenants.filter(t => t.status === 'suspended').length,
      currentFilter: filter,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error('[SuperAdmin:Tenants] Error:', err);
    res.status(500).render('error', {
      statusCode: 500,
      title: 'Institutions Error',
      message: err.message,
      user: req.session.user
    });
  }
});

/**
 * GET /super-admin/tenants/new - Provision New Institution
 */
router.get('/tenants/new', (req, res) => {
  res.render('super-admin/new-tenant', {
    title: 'Onboard Institution - CampusPulse SaaS',
    pageName: 'super-admin-new-tenant',
    error: req.query.error || null,
    success: req.query.success || null,
    formData: {}
  });
});

/**
 * POST /super-admin/tenants/new - Create Institution + College Admin
 */
router.post('/tenants/new', (req, res) => {
  const {
    name, shortName, code, subdomain, email, phone, address,
    primaryColor, secondaryColor, academicYear,
    adminName, adminEmail, adminPassword, confirmPassword
  } = req.body;

  if (!name || !code) {
    return res.render('super-admin/new-tenant', {
      title: 'Onboard Institution - CampusPulse SaaS',
      pageName: 'super-admin-new-tenant',
      error: 'Institution Name and Unique Institutional Code are required.',
      success: null,
      formData: req.body
    });
  }

  if (adminPassword && adminPassword !== confirmPassword) {
    return res.render('super-admin/new-tenant', {
      title: 'Onboard Institution - CampusPulse SaaS',
      pageName: 'super-admin-new-tenant',
      error: 'Admin passwords do not match.',
      success: null,
      formData: req.body
    });
  }

  if (adminPassword && adminPassword.length < 6) {
    return res.render('super-admin/new-tenant', {
      title: 'Onboard Institution - CampusPulse SaaS',
      pageName: 'super-admin-new-tenant',
      error: 'Admin password must be at least 6 characters long.',
      success: null,
      formData: req.body
    });
  }

  try {
    const result = tenantService.createTenant({
      name,
      shortName,
      code,
      subdomain,
      email,
      phone,
      address,
      primaryColor,
      secondaryColor,
      academicYear,
      adminName,
      adminEmail,
      adminPassword
    });

    auditService.log(
      result.tenantId,
      req.session.user.id,
      'Tenant Onboarded',
      `Super admin provisioned new institution "${name}" (ID: ${result.tenantId}, Code: ${code.toUpperCase()}). Initial administrator: ${adminEmail || 'None'}.`
    );

    res.redirect('/super-admin/tenants?success=' + encodeURIComponent(`Institution "${name}" has been successfully provisioned!`));
  } catch (err) {
    console.error('[SuperAdmin:CreateTenant] Error:', err);
    res.render('super-admin/new-tenant', {
      title: 'Onboard Institution - CampusPulse SaaS',
      pageName: 'super-admin-new-tenant',
      error: err.message,
      success: null,
      formData: req.body
    });
  }
});

/**
 * GET /super-admin/tenants/:id - View Institution Details
 */
router.get('/tenants/:id', (req, res) => {
  const tenantId = req.params.id;
  const tenant = tenantService.getTenantById(tenantId);

  if (!tenant) {
    return res.status(404).render('error', {
      statusCode: 404,
      title: 'Tenant Not Found',
      message: `No institution found with ID "${tenantId}".`,
      user: req.session.user
    });
  }

  // Get tenant stats & users
  const studentsCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND role = 'student'").get(tenant.id).count;
  const admins = db.prepare("SELECT id, name, email, role, is_active, created_at FROM users WHERE tenant_id = ? AND role IN ('admin', 'college_admin')").all(tenant.id);
  const auditLogs = auditService.getTenantLogs(tenant.id, 10);

  res.render('super-admin/tenant-detail', {
    title: `${tenant.name} - Platform Management`,
    pageName: 'super-admin-tenants',
    tenant,
    studentsCount,
    admins,
    auditLogs,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

/**
 * POST /super-admin/tenants/:id/status - Toggle Status ('active' / 'suspended')
 */
router.post('/tenants/:id/status', (req, res) => {
  const tenantId = req.params.id;
  const { status } = req.body;

  if (tenantId === 'tenant_default' && status === 'suspended') {
    return res.redirect(`/super-admin/tenants/${tenantId}?error=` + encodeURIComponent('Cannot suspend the default root platform institution.'));
  }

  try {
    tenantService.setTenantStatus(tenantId, status);
    auditService.log(
      tenantId,
      req.session.user.id,
      'Tenant Status Changed',
      `Super admin modified tenant "${tenantId}" status to "${status}".`
    );

    res.redirect(`/super-admin/tenants/${tenantId}?success=` + encodeURIComponent(`Institution status successfully updated to ${status}.`));
  } catch (err) {
    console.error('[SuperAdmin:SetStatus] Error:', err);
    res.redirect(`/super-admin/tenants/${tenantId}?error=` + encodeURIComponent(err.message));
  }
});

/**
 * POST /super-admin/tenants/:id/update - Update Metadata
 */
router.post('/super-admin/tenants/:id/update', (req, res) => {
  const tenantId = req.params.id;
  try {
    tenantService.updateTenant(tenantId, req.body);
    auditService.log(
      tenantId,
      req.session.user.id,
      'Tenant Metadata Updated',
      `Super admin updated institutional profile for "${tenantId}".`
    );

    res.redirect(`/super-admin/tenants/${tenantId}?success=` + encodeURIComponent('Institutional profile updated successfully.'));
  } catch (err) {
    console.error('[SuperAdmin:UpdateTenant] Error:', err);
    res.redirect(`/super-admin/tenants/${tenantId}?error=` + encodeURIComponent(err.message));
  }
});

/**
 * GET /super-admin/audit - Platform-wide Global Audit Log
 */
router.get('/audit', (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    const totalLogs = db.prepare('SELECT COUNT(*) as count FROM audit_log').get().count;
    const auditLogs = auditService.getPlatformLogs(limit, offset);
    const totalPages = Math.ceil(totalLogs / limit) || 1;

    res.render('super-admin/audit', {
      title: 'Platform Audit History - CampusPulse SaaS',
      pageName: 'super-admin-audit',
      auditLogs,
      currentPage: page,
      totalPages,
      totalLogs
    });
  } catch (err) {
    console.error('[SuperAdmin:Audit] Error:', err);
    res.status(500).render('error', {
      statusCode: 500,
      title: 'Platform Audit Error',
      message: err.message,
      user: req.session.user
    });
  }
});

module.exports = router;
