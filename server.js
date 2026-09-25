const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Auto initialize and seed database if necessary
const seedDatabase = require('./database/seed');
const runMigrations = require('./database/migrations');
try {
  seedDatabase();
  runMigrations();
} catch (err) {
  console.error('[DB:Init] Database initialization warning:', err.message);
}

// Route handlers & middleware
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const superAdminRoutes = require('./routes/superAdmin');
const onboardingRoutes = require('./routes/onboarding');
const { setUserLocals } = require('./middleware/auth');
const { resolveTenant } = require('./middleware/tenant');

const app = express();
const PORT = process.env.PORT || 3000;

// Security hardening: hide server tech stack
app.disable('x-powered-by');

// Security headers (clickjacking protection, MIME sniffing prevention, referrer policy)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Trust reverse proxy (essential for Vercel, Render, Heroku HTTPS)
app.set('trust proxy', 1);

// Body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Observability & Request Logging (RequestId, Duration, Scoped Tenant, Redacted Secrets)
const observabilityMiddleware = require('./middleware/observability');
app.use(observabilityMiddleware);

// Session management with configurable inactivity timeout (.env SESSION_TIMEOUT_MINUTES)
const sessionSecret = process.env.SESSION_SECRET || 'fallback-college-secret-key-39824';
const sessionTimeoutMinutes = parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) || 60;
const sessionTimeoutMs = sessionTimeoutMinutes * 60 * 1000;

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Automatically resets cookie expiry timer on every active user interaction
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_COOKIES !== 'true',
      maxAge: sessionTimeoutMs
    }
  })
);

// Inactivity session expiration middleware (double-checks server-side timestamp)
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const now = Date.now();
    if (req.session.lastActivity && (now - req.session.lastActivity > sessionTimeoutMs)) {
      req.session.destroy(() => {
        res.redirect('/login?error=' + encodeURIComponent('Your session has expired due to inactivity. Please sign in again.'));
      });
      return;
    }
    req.session.lastActivity = now;
  }
  next();
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));
if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.use('/uploads', express.static('/tmp/uploads'));
}

// View Engine & Layout Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');

// Global view locals & tenant resolution
app.use(setUserLocals);
app.use(resolveTenant);

// ==========================================
// 1. HEALTH CHECKS (Liveness & Readiness)
// ==========================================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/health/ready', (req, res) => {
  try {
    const db = require('./config/db');
    if (db.dialect === 'postgres') {
      db.pool.query('SELECT 1', (err) => {
        if (err) {
          return res.status(503).json({ status: 'unready', error: 'Database unreachable', timestamp: new Date().toISOString() });
        }
        res.status(200).json({ status: 'ready', dialect: 'postgres', database: 'connected', timestamp: new Date().toISOString() });
      });
    } else {
      db.prepare('SELECT 1').get();
      res.status(200).json({ status: 'ready', dialect: 'sqlite', database: 'connected', timestamp: new Date().toISOString() });
    }
  } catch (err) {
    res.status(503).json({ status: 'unready', error: err.message, timestamp: new Date().toISOString() });
  }
});

// ==========================================
// 2. PRIVATE STORAGE DOWNLOAD CONTROLLER
// ==========================================
const storageProvider = require('./services/storage/storageProvider');
const fs = require('fs');

app.get('/storage/download', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login?error=' + encodeURIComponent('Please sign in to access this document.'));
  }

  const storageKey = req.query.key;
  if (!storageKey || typeof storageKey !== 'string') {
    return res.status(400).send('Invalid or missing storage key.');
  }

  // Format: tenants/{tenantId}/...
  const parts = storageKey.replace(/\\/g, '/').split('/');
  if (parts.length < 3 || parts[0] !== 'tenants') {
    return res.status(400).send('Invalid storage key format.');
  }

  const fileTenantId = parts[1];
  const user = req.session.user;

  // Strict tenant boundary check: super_admin can access all; ordinary users only their own tenant's files
  if (user.role !== 'super_admin' && user.tenantId !== fileTenantId) {
    return res.status(403).render('error', {
      statusCode: 403,
      title: 'Access Denied',
      message: 'You do not have authorization to view files belonging to another institution.',
      user
    });
  }

  const physicalPath = storageProvider.driver.getPhysicalPath ? storageProvider.driver.getPhysicalPath(storageKey) : null;
  if (!physicalPath || !fs.existsSync(physicalPath)) {
    return res.status(404).render('error', {
      statusCode: 404,
      title: 'Document Not Found',
      message: 'The requested document does not exist or has been removed.',
      user
    });
  }

  res.download(physicalPath);
});

// ==========================================
// 3. RATE LIMITING ON SENSITIVE ENDPOINTS
// ==========================================
const { authLimiter, sensitiveActionLimiter } = require('./middleware/rateLimiter');
app.use('/login', authLimiter);
app.use('/signup', authLimiter);
app.use('/register-institution', authLimiter);
app.use('/forgot-password', sensitiveActionLimiter);
app.use('/invitation/accept', sensitiveActionLimiter);

// Mount Application Routes
app.use('/', authRoutes);
app.use('/onboarding', onboardingRoutes);
app.use('/student', studentRoutes);
app.use('/admin', adminRoutes);
app.use('/super-admin', superAdminRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 - Page Not Found',
    statusCode: 404,
    message: `The requested endpoint "${req.originalUrl}" was not found on this server.`,
    user: req.session ? req.session.user : null
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(`[Server:Error] [${req.method} ${req.originalUrl}]`, err);
  const statusCode = err.status || 500;
  res.status(statusCode).render('error', {
    title: `${statusCode} - Server Error`,
    statusCode,
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred. Please contact the administrator.' 
      : (err.message || 'An unexpected error occurred.'),
    user: req.session ? req.session.user : null
  });
});

// Start server when run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🎓 College Management Platform is running live!`);
    console.log(`🚀 URL: http://localhost:${PORT}`);
    console.log(`🔑 Default Admin: admin@college.edu | admin123`);
    console.log(`🎓 Demo Student: alex@college.edu   | student123`);
    console.log(`====================================================`);
  });
}

module.exports = app;
