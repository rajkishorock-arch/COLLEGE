const multer = require('multer');
const path = require('path');
const fs = require('fs');

const avatarsDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
const assignmentsDir = path.join(__dirname, '..', 'public', 'uploads', 'assignments');

[avatarsDir, assignmentsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Storage for avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + ext);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype;
    if (allowed.test(ext) || allowed.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WEBP, GIF) are allowed for profile photos.'));
    }
  }
});

// Storage for assignment submissions
const assignmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, assignmentsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'sub-' + uniqueSuffix + ext);
  }
});

const assignmentUpload = multer({
  storage: assignmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf', '.doc', '.docx', '.zip', '.txt', '.tar', '.gz'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, Word documents (DOC/DOCX), or ZIP/archive files are allowed (max 10MB).'));
    }
  }
});

module.exports = { avatarUpload, assignmentUpload };
