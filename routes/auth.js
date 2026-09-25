const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const tenantService = require('../services/tenantService');
const { logAudit } = require('../utils/audit');

// Root route: Show landing page to visitors, redirect logged-in users to dashboard
router.get('/', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'super_admin') {
      return res.redirect('/super-admin');
    }
    if (req.session.user.role === 'admin' || req.session.user.role === 'college_admin') {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/student/dashboard');
  }
  res.render('landing', {
    title: 'CampusPulse - Next-Gen College Management Platform',
    layout: false
  });
});

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'super_admin') {
      return res.redirect('/super-admin');
    }
    if (req.session.user.role === 'admin' || req.session.user.role === 'college_admin') {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/student/dashboard');
  }
  res.render('login', {
    title: 'Sign In - College Management Platform',
    error: req.query.error || null,
    success: req.query.success || null,
    showDemoCredentials: (process.env.NODE_ENV !== 'production' || process.env.SHOW_DEMO_CREDENTIALS === 'true'),
    layout: false // Standalone auth page
  });
});

// POST /login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', {
      title: 'Sign In - College Management Platform',
      error: 'Please provide both email and password.',
      success: null,
      layout: false
    });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());

    if (!user) {
      return res.render('login', {
        title: 'Sign In - College Management Platform',
        error: 'Invalid email or password.',
        success: null,
        layout: false
      });
    }

    // 1. Account Lockout Check (Brute-force protection: 5 failed attempts in 15 mins = 15 min lock)
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until);
      const now = new Date();
      if (lockExpiry > now) {
        const remainingMinutes = Math.ceil((lockExpiry - now) / 60000);
        return res.render('login', {
          title: 'Sign In - College Management Platform',
          error: `Account temporarily locked due to multiple failed login attempts. Please try again after ${remainingMinutes} minute(s).`,
          success: null,
          layout: false
        });
      } else {
        // Lock expired, reset counters
        db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
        user.failed_attempts = 0;
        user.locked_until = null;
      }
    }

    // 2. Active Status Check
    if (user.is_active === 0) {
      return res.render('login', {
        title: 'Sign In - College Management Platform',
        error: 'Account has been deactivated. Please contact an administrator.',
        success: null,
        layout: false
      });
    }

    // 2b. Tenant Status Check: If user's tenant is suspended, reject login unless super_admin
    const userTenantId = user.tenant_id || 'tenant_default';
    const userTenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(userTenantId);
    if (userTenant && userTenant.status === 'suspended' && user.role !== 'super_admin') {
      return res.render('login', {
        title: 'Sign In - College Management Platform',
        error: 'Access Denied: Your institution account has been temporarily suspended by platform administration.',
        success: null,
        layout: false
      });
    }

    // 3. Password Verification
    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      // Check attempt window (15 minutes)
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      const lastFailed = user.last_failed_at ? new Date(user.last_failed_at) : null;
      let newAttempts = 1;

      if (lastFailed && lastFailed > fifteenMinsAgo) {
        newAttempts = (user.failed_attempts || 0) + 1;
      }

      const nowIso = new Date().toISOString();

      if (newAttempts >= 5) {
        const lockUntilIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        db.prepare(`
          UPDATE users 
          SET failed_attempts = ?, locked_until = ?, last_failed_at = ?
          WHERE id = ?
        `).run(newAttempts, lockUntilIso, nowIso, user.id);

        if (user.role === 'admin' || user.role === 'super_admin') {
          logAudit(user.id, 'Account Locked', `Account ${user.email} locked after 5 failed login attempts.`, user.id, userTenantId);
        }

        return res.render('login', {
          title: 'Sign In - College Management Platform',
          error: 'Account temporarily locked due to multiple failed login attempts. Please try again after 15 minutes.',
          success: null,
          layout: false
        });
      } else {
        db.prepare(`
          UPDATE users 
          SET failed_attempts = ?, last_failed_at = ?
          WHERE id = ?
        `).run(newAttempts, nowIso, user.id);

        const remaining = 5 - newAttempts;
        return res.render('login', {
          title: 'Sign In - College Management Platform',
          error: `Invalid email or password. (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before temporary lockout)`,
          success: null,
          layout: false
        });
      }
    }

    // Login successful: reset failed attempt counters
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_failed_at = NULL WHERE id = ?').run(user.id);

    // Save session with tenantId
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roll_no: user.roll_no,
      course: user.course,
      tenantId: userTenantId
    };

    req.session.save((saveErr) => {
      if (saveErr) console.error('[Auth] Session save error:', saveErr);
      if (user.role === 'super_admin') {
        return res.redirect('/super-admin');
      } else if (user.role === 'admin' || user.role === 'college_admin') {
        return res.redirect('/admin/dashboard');
      } else {
        return res.redirect('/student/dashboard');
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.render('login', {
      title: 'Sign In - College Management Platform',
      error: 'An internal error occurred during authentication.',
      success: null,
      layout: false
    });
  }
});

// GET /register-institution (Direct alias to institution registration)
router.get('/register-institution', (req, res) => {
  return res.redirect('/signup?tab=institution');
});

// GET /signup
router.get('/signup', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'super_admin') {
      return res.redirect('/super-admin');
    }
    if (req.session.user.role === 'admin' || req.session.user.role === 'college_admin') {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/student/dashboard');
  }

  const tenants = db.prepare("SELECT id, name, code, short_name FROM tenants WHERE status = 'active' ORDER BY name ASC").all();
  const activeTab = req.query.tab === 'student' ? 'student' : 'institution';

  res.render('signup', {
    title: activeTab === 'institution' ? 'Register Institution - CampusPulse' : 'Student Enrollment - CampusPulse',
    error: req.query.error || null,
    success: req.query.success || null,
    tenants,
    activeTab,
    selectedTenantId: req.query.tenant || 'tenant_default',
    formData: {},
    layout: false
  });
});

// POST /register-institution (Dedicated SaaS Endpoint)
router.post('/register-institution', (req, res) => {
  const { 
    full_name, name, email, password, confirm_password, 
    institution_name, institution_type, institution_code, 
    short_name, phone, address, default_department 
  } = req.body;

  const adminName = full_name || name;
  const tenants = db.prepare("SELECT id, name, code, short_name FROM tenants WHERE status = 'active' ORDER BY name ASC").all();

  // Basic validation
  if (!adminName || !email || !password || !institution_name) {
    return res.render('signup', {
      title: 'Register Institution - CampusPulse',
      error: 'Please fill in all required fields (Name, Email, Password, Institution Name).',
      success: null,
      tenants,
      activeTab: 'institution',
      selectedTenantId: 'tenant_default',
      formData: req.body,
      layout: false
    });
  }

  if (password.length < 6) {
    return res.render('signup', {
      title: 'Register Institution - CampusPulse',
      error: 'Password must be at least 6 characters long.',
      success: null,
      tenants,
      activeTab: 'institution',
      selectedTenantId: 'tenant_default',
      formData: req.body,
      layout: false
    });
  }

  if (confirm_password && password !== confirm_password) {
    return res.render('signup', {
      title: 'Register Institution - CampusPulse',
      error: 'Passwords do not match.',
      success: null,
      tenants,
      activeTab: 'institution',
      selectedTenantId: 'tenant_default',
      formData: req.body,
      layout: false
    });
  }

  try {
    const result = tenantService.registerInstitution({
      fullName: adminName,
      email: email,
      password: password,
      institutionName: institution_name,
      institutionType: institution_type || 'college',
      institutionCode: institution_code || null,
      shortName: short_name || null,
      phone: phone || null,
      address: address || null,
      defaultDepartment: default_department || 'Computer Science & Engineering'
    });

    // Automatically authenticate the new institution owner
    req.session.user = {
      id: result.adminUserId,
      tenant_id: result.tenantId,
      name: result.user.name,
      email: result.user.email,
      role: 'admin',
      is_owner: true
    };
    req.session.tenant = result.tenant;

    // Direct to onboarding wizard
    return res.redirect('/onboarding/wizard?step=1&success=' + encodeURIComponent('Institution created successfully!'));
  } catch (err) {
    console.error('Institution registration error:', err);
    return res.render('signup', {
      title: 'Register Institution - CampusPulse',
      error: err.message || 'An error occurred while creating your institution. Please try again.',
      success: null,
      tenants,
      activeTab: 'institution',
      selectedTenantId: 'tenant_default',
      formData: req.body,
      layout: false
    });
  }
});

// POST /signup (Dual-mode handler for Institution Creation or Student Enrollment)
router.post('/signup', (req, res) => {
  // If signup_type is institution or institution_name is provided, delegate to register-institution
  if (req.body.signup_type === 'institution' || req.body.institution_name) {
    req.url = '/register-institution';
    return router.handle(req, res);
  }

  // Student Enrollment Flow
  delete req.body.role;
  const { name, email, password, confirm_password, roll_no, course } = req.body;
  const tenantId = req.body.tenant_id || 'tenant_default';

  const tenants = db.prepare("SELECT id, name, code, short_name FROM tenants WHERE status = 'active' ORDER BY name ASC").all();

  // Validation
  if (!name || !email || !password || !roll_no || !course) {
    return res.render('signup', {
      title: 'Student Enrollment - CampusPulse',
      error: 'All fields are required for student enrollment.',
      success: null,
      tenants,
      activeTab: 'student',
      selectedTenantId: tenantId,
      formData: req.body,
      layout: false
    });
  }

  if (password.length < 6) {
    return res.render('signup', {
      title: 'Student Enrollment - CampusPulse',
      error: 'Password must be at least 6 characters long.',
      success: null,
      tenants,
      activeTab: 'student',
      selectedTenantId: tenantId,
      formData: req.body,
      layout: false
    });
  }

  if (confirm_password && password !== confirm_password) {
    return res.render('signup', {
      title: 'Student Enrollment - CampusPulse',
      error: 'Passwords do not match.',
      success: null,
      tenants,
      activeTab: 'student',
      selectedTenantId: tenantId,
      formData: req.body,
      layout: false
    });
  }

  try {
    // Verify target tenant exists and is active
    const tenant = db.prepare("SELECT id FROM tenants WHERE id = ? AND status = 'active'").get(tenantId);
    if (!tenant) {
      return res.render('signup', {
        title: 'Student Enrollment - CampusPulse',
        error: 'Selected institution is not active or invalid.',
        success: null,
        tenants,
        activeTab: 'student',
        selectedTenantId: 'tenant_default',
        formData: req.body,
        layout: false
      });
    }

    // Check if email already in use globally
    const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (existingEmail) {
      return res.render('signup', {
        title: 'Student Enrollment - CampusPulse',
        error: 'An account with this email address already exists.',
        success: null,
        tenants,
        activeTab: 'student',
        selectedTenantId: tenantId,
        formData: req.body,
        layout: false
      });
    }

    // Check if roll number already in use within this institution
    const existingRoll = db.prepare('SELECT id FROM users WHERE LOWER(roll_no) = LOWER(?) AND tenant_id = ?').get(roll_no.trim(), tenantId);
    if (existingRoll) {
      return res.render('signup', {
        title: 'Student Enrollment - CampusPulse',
        error: 'A student with this Roll Number is already registered in this institution.',
        success: null,
        tenants,
        activeTab: 'student',
        selectedTenantId: tenantId,
        formData: req.body,
        layout: false
      });
    }

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    // Hash security answer
    const securityQuestion = req.body.security_question || 'What is your favorite subject?';
    const rawAnswer = (req.body.security_answer || 'computer science').trim().toLowerCase();
    const hashedAnswer = bcrypt.hashSync(rawAnswer, salt);

    // Insert new student user under target tenant
    const insert = db.prepare(`
      INSERT INTO users (tenant_id, name, email, password, role, roll_no, course, security_question, security_answer)
      VALUES (?, ?, ?, ?, 'student', ?, ?, ?, ?)
    `);

    insert.run(
      tenantId,
      name.trim(),
      email.trim().toLowerCase(),
      hashedPassword,
      roll_no.trim().toUpperCase(),
      course.trim(),
      securityQuestion,
      hashedAnswer
    );

    // Redirect to login with success message
    return res.redirect('/login?success=' + encodeURIComponent('Enrollment successful! Please sign in with your credentials.'));
  } catch (err) {
    console.error('Signup error:', err);
    return res.render('signup', {
      title: 'Student Enrollment - CampusPulse',
      error: 'An error occurred while creating your student profile. Please try again.',
      success: null,
      tenants,
      activeTab: 'student',
      selectedTenantId: tenantId,
      formData: req.body,
      layout: false
    });
  }
});

// GET /forgot-password
router.get('/forgot-password', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  let step = 1;
  let question = null;
  let error = req.query.error || null;

  if (email) {
    const user = db.prepare('SELECT id, email, security_question FROM users WHERE LOWER(email) = ?').get(email);
    if (user) {
      step = 2;
      question = user.security_question || 'What is your favorite subject?';
    } else {
      error = 'No user account found with that email address.';
    }
  }

  res.render('forgot-password', {
    title: 'Reset Password - CampusPulse',
    step,
    email,
    question,
    error,
    success: null,
    layout: false
  });
});

// POST /forgot-password/verify
router.post('/forgot-password/verify', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.render('forgot-password', {
      title: 'Reset Password - CampusPulse',
      step: 1,
      email: '',
      question: null,
      error: 'Please enter your registered institutional email address.',
      success: null,
      layout: false
    });
  }

  const user = db.prepare('SELECT id, email, security_question FROM users WHERE LOWER(email) = ?').get(email);
  if (!user) {
    return res.render('forgot-password', {
      title: 'Reset Password - CampusPulse',
      step: 1,
      email,
      question: null,
      error: 'No account found with that email address. Please verify spelling or register.',
      success: null,
      layout: false
    });
  }

  return res.redirect('/forgot-password?email=' + encodeURIComponent(user.email));
});

// POST /forgot-password/reset
router.post('/forgot-password/reset', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const answer = (req.body.security_answer || '').trim();
  const newPassword = req.body.new_password || '';
  const confirmPassword = req.body.confirm_password || '';

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email);
  if (!user) {
    return res.redirect('/forgot-password?error=' + encodeURIComponent('Invalid session. Please start over.'));
  }

  const question = user.security_question || 'What is your favorite subject?';

  if (!answer) {
    return res.render('forgot-password', {
      title: 'Reset Password - CampusPulse',
      step: 2,
      email,
      question,
      error: 'Please provide the answer to your security question.',
      success: null,
      layout: false
    });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.render('forgot-password', {
      title: 'Reset Password - CampusPulse',
      step: 2,
      email,
      question,
      error: 'New password must be at least 6 characters long.',
      success: null,
      layout: false
    });
  }

  if (newPassword !== confirmPassword) {
    return res.render('forgot-password', {
      title: 'Reset Password - CampusPulse',
      step: 2,
      email,
      question,
      error: 'Passwords do not match.',
      success: null,
      layout: false
    });
  }

  // Validate security answer
  const isMatch = user.security_answer && (
    bcrypt.compareSync(answer.toLowerCase(), user.security_answer) ||
    bcrypt.compareSync(answer, user.security_answer)
  );

  if (!isMatch) {
    return res.render('forgot-password', {
      title: 'Reset Password - CampusPulse',
      step: 2,
      email,
      question,
      error: 'Security verification failed: Incorrect answer to the question.',
      success: null,
      layout: false
    });
  }

  // Update password
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(newPassword, salt);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id);

  return res.redirect('/login?success=' + encodeURIComponent('Password reset successfully! Please sign in with your new password.'));
});

// GET & POST /logout - clear session and return to landing page
router.all('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

/**
 * ==========================================
 * TENANT-SCOPED INVITATION ACCEPTANCE
 * ==========================================
 */
const invitationService = require('../services/invitationService');

// GET /invitation/accept - Verify token and render registration form
router.get('/invitation/accept', (req, res) => {
  const token = req.query.token;
  const verification = invitationService.verifyInvitation(token);

  if (!verification.valid) {
    return res.status(400).render('error', {
      statusCode: 400,
      title: 'Invalid Invitation',
      message: verification.reason,
      user: null
    });
  }

  res.render('invitation-accept', {
    title: `Accept Invitation — ${verification.invite.tenant_name}`,
    invite: verification.invite,
    token,
    error: req.query.error || null,
    layout: false
  });
});

// POST /invitation/accept - Provision user under invitation's locked tenant and role
router.post('/invitation/accept', (req, res) => {
  const { token, name, password, rollNo, course, securityQuestion, securityAnswer } = req.body;

  try {
    const userId = invitationService.acceptInvitation(token, {
      name,
      password,
      rollNo,
      course,
      securityQuestion,
      securityAnswer
    });

    logAudit(userId, 'Accepted Institution Invitation', `User registered via invitation token.`);
    res.redirect('/login?success=' + encodeURIComponent('Your account has been activated! Please sign in with your credentials.'));
  } catch (err) {
    res.redirect(`/invitation/accept?token=${encodeURIComponent(token)}&error=` + encodeURIComponent(err.message));
  }
});

module.exports = router;
