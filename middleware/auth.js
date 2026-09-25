// Authentication & Authorization Middleware

/**
 * Ensures a user is logged in
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in to access this page.'));
  }
  next();
}

/**
 * Ensures user is authenticated and has 'student' role
 */
function requireStudent(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in to access student portal.'));
  }
  if (req.session.user.role !== 'student') {
    return res.status(403).render('error', {
      statusCode: 403,
      title: '403 Forbidden',
      message: 'Access Denied: Only students can access this portal.',
      user: req.session.user
    });
  }
  next();
}

/**
 * Ensures user is authenticated and has 'admin' or 'super_admin' role
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in with administrator credentials.'));
  }
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin') {
    return res.status(403).render('error', {
      statusCode: 403,
      title: '403 Forbidden',
      message: 'Access Denied: Administrative privileges are required for this section.',
      user: req.session.user
    });
  }
  next();
}

/**
 * Ensures user is authenticated and has 'super_admin' role
 */
function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in with administrator credentials.'));
  }
  if (req.session.user.role !== 'super_admin') {
    return res.status(403).render('error', {
      statusCode: 403,
      title: '403 Forbidden',
      message: 'Access Denied: Super Administrator privileges are required to access this section.',
      user: req.session.user
    });
  }
  next();
}

/**
 * Centralized Permission Matrix
 */
const ROLE_PERMISSIONS = {
  super_admin: [
    'platform.manage', 'tenants.read', 'tenants.create', 'tenants.update', 'tenants.suspend',
    'audit.platform', 'users.manage_admins', 'college.all',
    'students.read', 'students.write', 'attendance.read', 'attendance.write',
    'results.read', 'results.write', 'library.read', 'library.manage',
    'quizzes.read', 'quizzes.manage', 'timetable.manage', 'announcements.manage',
    'assignments.manage', 'fees.manage', 'audit.tenant', 'tenant.settings'
  ],
  college_admin: [
    'students.read', 'students.write', 'faculty.read', 'faculty.write',
    'attendance.read', 'attendance.write', 'results.read', 'results.write',
    'library.read', 'library.manage', 'quizzes.read', 'quizzes.manage',
    'timetable.manage', 'announcements.manage', 'assignments.manage',
    'fees.manage', 'audit.tenant', 'tenant.settings'
  ],
  admin: [
    'students.read', 'students.write', 'faculty.read', 'faculty.write',
    'attendance.read', 'attendance.write', 'results.read', 'results.write',
    'library.read', 'library.manage', 'quizzes.read', 'quizzes.manage',
    'timetable.manage', 'announcements.manage', 'assignments.manage',
    'fees.manage', 'audit.tenant', 'tenant.settings'
  ],
  faculty: [
    'students.read', 'attendance.read', 'attendance.write', 'results.read', 'results.write',
    'library.read', 'quizzes.manage', 'timetable.read', 'announcements.read', 'assignments.manage'
  ],
  staff: [
    'students.read', 'library.read', 'library.manage', 'timetable.read', 'announcements.read'
  ],
  student: [
    'student.portal', 'attendance.read_own', 'results.read_own',
    'library.read', 'quizzes.take', 'timetable.read_own', 'announcements.read',
    'assignments.submit_own', 'fees.read_own'
  ]
};

function hasPermission(role, permission) {
  if (!role || !permission) return false;
  if (role === 'super_admin') return true;
  const list = ROLE_PERMISSIONS[role] || [];
  return list.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login?error=' + encodeURIComponent('Please sign in to access this page.'));
    }
    const role = req.session.user.role;
    if (!hasPermission(role, permission)) {
      return res.status(403).render('error', {
        statusCode: 403,
        title: '403 Forbidden - Permission Denied',
        message: `Access Denied: You do not possess the required permission [${permission}].`,
        user: req.session.user
      });
    }
    next();
  };
}

const db = require('../config/db');

/**
 * Middleware to pass session user, tenant context, and permissions to all views
 */
function setUserLocals(req, res, next) {
  if (req.session && req.session.user) {
    try {
      const freshUser = db.prepare("SELECT id, tenant_id, name, email, role, roll_no, course, profile_photo, is_active FROM users WHERE id = ?").get(req.session.user.id);
      
      // If user account was deactivated, terminate session immediately
      if (freshUser && freshUser.is_active === 0) {
        req.session.destroy(() => {
          res.redirect('/login?error=' + encodeURIComponent('Your account has been deactivated. Please contact an administrator.'));
        });
        return;
      }

      const tenantId = (freshUser && freshUser.tenant_id) || req.session.user.tenantId || req.session.user.tenant_id || 'tenant_default';
      let tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
      if (!tenant) {
        tenant = db.prepare("SELECT * FROM tenants WHERE id = 'tenant_default'").get();
      }

      // Check tenant suspension for non-super_admin
      if (tenant && tenant.status === 'suspended' && freshUser && freshUser.role !== 'super_admin') {
        req.session.destroy(() => {
          res.redirect('/login?error=' + encodeURIComponent('Access Denied: Your institution account has been temporarily suspended by platform administration.'));
        });
        return;
      }

      const user = freshUser || req.session.user;
      user.tenantId = tenant ? tenant.id : tenantId;
      req.session.user = user;
      req.tenant = tenant;
      req.tenantId = tenant ? tenant.id : tenantId;

      res.locals.user = user;
      res.locals.tenant = tenant;
      res.locals.currentTenantId = req.tenantId;

      res.locals.isSuperAdmin = Boolean(user && user.role === 'super_admin');
      res.locals.isAdmin = Boolean(user && (user.role === 'admin' || user.role === 'college_admin' || user.role === 'super_admin'));
      res.locals.isCollegeAdmin = Boolean(user && (user.role === 'admin' || user.role === 'college_admin'));
      res.locals.isStudent = Boolean(user && user.role === 'student');

      // Permissions helper attached to res.locals
      const userPermissions = ROLE_PERMISSIONS[user.role] || [];
      res.locals.permissions = userPermissions;
      res.locals.hasPermission = (perm) => hasPermission(user.role, perm);

      // Unread notifications count scoped to user
      const unreadCount = db.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0").get(user.id);
      res.locals.unreadNotifCount = unreadCount ? unreadCount.count : 0;

      // Top 5 recent notifications
      const recentNotifs = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 6").all(user.id);
      res.locals.recentNotifications = recentNotifs || [];
    } catch (err) {
      console.error('[Middleware:setUserLocals]', err.message);
      res.locals.user = req.session.user;
      res.locals.tenant = null;
      res.locals.currentTenantId = 'tenant_default';
      res.locals.isSuperAdmin = Boolean(req.session.user && req.session.user.role === 'super_admin');
      res.locals.isAdmin = Boolean(req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'super_admin'));
      res.locals.isCollegeAdmin = false;
      res.locals.isStudent = Boolean(req.session.user && req.session.user.role === 'student');
      res.locals.permissions = [];
      res.locals.hasPermission = () => false;
      res.locals.unreadNotifCount = 0;
      res.locals.recentNotifications = [];
    }
  } else {
    // Unauthenticated: provide default tenant for public styling/branding
    let defaultTenant = null;
    try {
      defaultTenant = db.prepare("SELECT * FROM tenants WHERE id = 'tenant_default'").get();
    } catch (e) {}

    res.locals.user = null;
    res.locals.tenant = defaultTenant;
    res.locals.currentTenantId = 'tenant_default';
    res.locals.isSuperAdmin = false;
    res.locals.isAdmin = false;
    res.locals.isCollegeAdmin = false;
    res.locals.isStudent = false;
    res.locals.permissions = [];
    res.locals.hasPermission = () => false;
    res.locals.unreadNotifCount = 0;
    res.locals.recentNotifications = [];
  }
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  next();
}

module.exports = {
  requireAuth,
  requireStudent,
  requireAdmin,
  requireSuperAdmin,
  requirePermission,
  hasPermission,
  ROLE_PERMISSIONS,
  setUserLocals
};

