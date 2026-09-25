const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let dbPath;

if (isVercel) {
  const tmpDir = path.join('/tmp', 'database');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const tmpDb = path.join(tmpDir, 'college.db');
  const sourceDb = path.join(__dirname, '..', 'database', 'college.db');

  if (!fs.existsSync(tmpDb)) {
    if (fs.existsSync(sourceDb)) {
      try {
        fs.copyFileSync(sourceDb, tmpDb);
      } catch (e) {
        console.warn('Could not copy seed DB to /tmp, will initialize fresh DB:', e.message);
      }
    }
  }
  dbPath = tmpDb;
} else {
  const dbDir = path.join(__dirname, '..', 'database');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  dbPath = path.join(dbDir, 'college.db');
}

// Initialize SQLite connection
const db = new Database(dbPath, {
  // verbose: process.env.NODE_ENV === 'development' ? console.log : null
});

// Enforce foreign key constraints
db.pragma('foreign_keys = ON');

module.exports = db;
