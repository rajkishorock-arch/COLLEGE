const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Root redirect
router.get('/', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/student/dashboard');
  }
  res.redirect('/login');
});

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/student/dashboard');
  }
  res.render('login', {
    title: 'Sign In - College Management Platform',
    error: req.query.error || null,
    success: req.query.success || null,
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

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.render('login', {
        title: 'Sign In - College Management Platform',
        error: 'Invalid email or password.',
        success: null,
        layout: false
      });
    }

    // Save session
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roll_no: user.roll_no,
      course: user.course
    };

    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    } else {
      return res.redirect('/student/dashboard');
    }
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

// GET /signup
router.get('/signup', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
  }
  res.render('signup', {
    title: 'Student Registration - College Management Platform',
    error: req.query.error || null,
    success: null,
    layout: false
  });
});

// POST /signup
router.post('/signup', (req, res) => {
  const { name, email, password, confirm_password, roll_no, course } = req.body;

  // Validation
  if (!name || !email || !password || !roll_no || !course) {
    return res.render('signup', {
      title: 'Student Registration - College Management Platform',
      error: 'All fields are required.',
      success: null,
      formData: req.body,
      layout: false
    });
  }

  if (password.length < 6) {
    return res.render('signup', {
      title: 'Student Registration - College Management Platform',
      error: 'Password must be at least 6 characters long.',
      success: null,
      formData: req.body,
      layout: false
    });
  }

  if (confirm_password && password !== confirm_password) {
    return res.render('signup', {
      title: 'Student Registration - College Management Platform',
      error: 'Passwords do not match.',
      success: null,
      formData: req.body,
      layout: false
    });
  }

  try {
    // Check if email already in use
    const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (existingEmail) {
      return res.render('signup', {
        title: 'Student Registration - College Management Platform',
        error: 'An account with this email address already exists.',
        success: null,
        formData: req.body,
        layout: false
      });
    }

    // Check if roll number already in use
    const existingRoll = db.prepare('SELECT id FROM users WHERE LOWER(roll_no) = LOWER(?)').get(roll_no.trim());
    if (existingRoll) {
      return res.render('signup', {
        title: 'Student Registration - College Management Platform',
        error: 'A student with this Roll Number is already registered.',
        success: null,
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

    // Insert new student user
    const insert = db.prepare(`
      INSERT INTO users (name, email, password, role, roll_no, course, security_question, security_answer)
      VALUES (?, ?, ?, 'student', ?, ?, ?, ?)
    `);

    insert.run(
      name.trim(),
      email.trim().toLowerCase(),
      hashedPassword,
      roll_no.trim().toUpperCase(),
      course.trim(),
      securityQuestion,
      hashedAnswer
    );

    // Redirect to login with success message
    return res.redirect('/login?success=' + encodeURIComponent('Registration successful! Please sign in with your credentials.'));
  } catch (err) {
    console.error('Signup error:', err);
    return res.render('signup', {
      title: 'Student Registration - College Management Platform',
      error: 'An error occurred while creating your account. Please try again.',
      success: null,
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

// GET & POST /logout
router.all('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    res.clearCookie('connect.sid');
    res.redirect('/login?success=' + encodeURIComponent('You have been logged out securely.'));
  });
});

module.exports = router;
