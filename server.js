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
const { setUserLocals } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Request logger for transparent debugging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

// Session management with SameSite=Lax and env secret
const sessionSecret = process.env.SESSION_SECRET || 'fallback-college-secret-key-39824';
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // CSRF defense
      secure: process.env.NODE_ENV === 'production', // true if HTTPS
      maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
  })
);

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// View Engine & Layout Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');

// Global view locals
app.use(setUserLocals);

// Mount Routes
app.use('/', authRoutes);
app.use('/student', studentRoutes);
app.use('/admin', adminRoutes);

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

// Start server
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🎓 College Management Platform is running live!`);
  console.log(`🚀 URL: http://localhost:${PORT}`);
  console.log(`🔑 Default Admin: admin@college.edu | admin123`);
  console.log(`🎓 Demo Student: alex@college.edu   | student123`);
  console.log(`====================================================`);
});

module.exports = { app, server };
