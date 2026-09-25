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
 * Ensures user is authenticated and has 'admin' role
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in with administrator credentials.'));
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      statusCode: 403,
      title: '403 Forbidden',
      message: 'Access Denied: Administrative privileges are required for this section.',
      user: req.session.user
    });
  }
  next();
}

const db = require('../config/db');

/**
 * Middleware to pass session user and path info to all views, including live notifications and profile avatar
 */
function setUserLocals(req, res, next) {
  if (req.session && req.session.user) {
    try {
      const freshUser = db.prepare("SELECT id, name, email, role, roll_no, course, profile_photo FROM users WHERE id = ?").get(req.session.user.id);
      res.locals.user = freshUser || req.session.user;
      req.session.user = res.locals.user;

      // Unread notifications count
      const unreadCount = db.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0").get(req.session.user.id);
      res.locals.unreadNotifCount = unreadCount ? unreadCount.count : 0;

      // Top 5 recent notifications for topbar dropdown
      const recentNotifs = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 6").all(req.session.user.id);
      res.locals.recentNotifications = recentNotifs || [];
    } catch (err) {
      console.error('[Middleware:setUserLocals]', err.message);
      res.locals.user = req.session.user;
      res.locals.unreadNotifCount = 0;
      res.locals.recentNotifications = [];
    }
  } else {
    res.locals.user = null;
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
  setUserLocals
};
