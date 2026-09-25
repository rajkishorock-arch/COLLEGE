const db = require('../config/db');

/**
 * Tenant resolution & isolation middleware for CampusPulse Multi-Tenant SaaS
 */
function resolveTenant(req, res, next) {
  try {
    let tenantId = 'tenant_default';

    // 1. If user is logged in, their tenantId is the primary source of truth
    if (req.session && req.session.user) {
      // Platform Super Admins can optionally switch viewing context if activeTenantId is set
      if (req.session.user.role === 'super_admin' && req.session.activeTenantId) {
        tenantId = req.session.activeTenantId;
      } else if (req.session.user.tenantId) {
        tenantId = req.session.user.tenantId;
      } else if (req.session.user.tenant_id) {
        tenantId = req.session.user.tenant_id;
      }
    }

    // 2. Fetch tenant profile from database
    let tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);

    // Fallback if tenant not found
    if (!tenant) {
      tenant = db.prepare("SELECT * FROM tenants WHERE id = 'tenant_default'").get();
      tenantId = 'tenant_default';
    }

    // 3. Status check: Suspended tenants cannot perform user actions unless super_admin
    if (tenant && tenant.status === 'suspended') {
      const isSuperAdmin = req.session && req.session.user && req.session.user.role === 'super_admin';
      if (!isSuperAdmin && req.session && req.session.user) {
        req.session.destroy(() => {
          return res.redirect('/login?error=' + encodeURIComponent('Access Denied: Your institution account has been temporarily suspended by platform administration.'));
        });
        return;
      }
    }

    // 4. Attach to request & response locals for seamless access in routes and EJS views
    req.tenant = tenant;
    req.tenantId = tenant ? tenant.id : 'tenant_default';

    res.locals.tenant = tenant;
    res.locals.currentTenantId = req.tenantId;

    next();
  } catch (err) {
    console.error('[Middleware:resolveTenant] Error:', err.message);
    req.tenantId = 'tenant_default';
    res.locals.tenant = null;
    res.locals.currentTenantId = 'tenant_default';
    next();
  }
}

/**
 * Enforces that a resource being accessed belongs to the authenticated user's tenant
 */
function requireTenantIsolation(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in to continue.'));
  }

  // Super admins have cross-tenant platform management privileges
  if (req.session.user.role === 'super_admin') {
    return next();
  }

  // User's tenant must match current request tenant context
  const userTenantId = req.session.user.tenantId || req.session.user.tenant_id || 'tenant_default';
  if (req.tenantId && req.tenantId !== userTenantId) {
    return res.status(403).render('error', {
      statusCode: 403,
      title: '403 Forbidden - Tenant Isolation Violation',
      message: 'Access Denied: You do not have permission to view or manipulate data belonging to another institution.',
      user: req.session.user
    });
  }

  next();
}

module.exports = {
  resolveTenant,
  requireTenantIsolation
};
