const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const DIALECT = (process.env.DB_DIALECT || 'sqlite').toLowerCase();

let adapter = null;

if (DIALECT === 'postgres') {
  const { Pool } = require('pg');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('[DatabaseAdapter] DB_DIALECT is set to postgres but DATABASE_URL environment variable is missing.');
  }
  const poolMin = parseInt(process.env.DB_POOL_MIN, 10) || 2;
  const poolMax = parseInt(process.env.DB_POOL_MAX, 10) || 20;
  const idleTimeoutMillis = parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000;
  const connectionTimeoutMillis = parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 5000;

  const pool = new Pool({
    connectionString,
    min: poolMin,
    max: poolMax,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ssl: (process.env.NODE_ENV === 'production' || connectionString.includes('sslmode=require')) && !process.env.ALLOW_INSECURE_DB ? { rejectUnauthorized: false } : false
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL:PoolError] Unexpected client error:', err.message);
  });

  // Convert SQLite ? placeholders into PostgreSQL $1, $2... placeholders
  function convertPlaceholders(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }

  adapter = {
    dialect: 'postgres',
    pool,

    /**
     * Execute a query against connection pool with optional tenant RLS context
     */
    async query(sql, params = [], tenantContext = null) {
      const client = await pool.connect();
      try {
        if (tenantContext) {
          if (tenantContext === 'super_admin') {
            await client.query("SET LOCAL app.is_super_admin = 'true'");
          } else {
            await client.query("SET LOCAL app.current_tenant_id = $1", [tenantContext]);
          }
        }
        const pgSql = convertPlaceholders(sql);
        const result = await client.query(pgSql, params);
        return result;
      } finally {
        client.release();
      }
    },

    /**
     * Execute atomic transaction with automatic rollback
     */
    async transaction(callback, tenantContext = null) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (tenantContext) {
          if (tenantContext === 'super_admin') {
            await client.query("SET LOCAL app.is_super_admin = 'true'");
          } else {
            await client.query("SET LOCAL app.current_tenant_id = $1", [tenantContext]);
          }
        }

        const txHelper = {
          query: (sql, params) => client.query(convertPlaceholders(sql), params),
          prepare: (sql) => ({
            run: async (...params) => {
              const res = await client.query(convertPlaceholders(sql), params);
              return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id };
            },
            get: async (...params) => {
              const res = await client.query(convertPlaceholders(sql), params);
              return res.rows[0];
            },
            all: async (...params) => {
              const res = await client.query(convertPlaceholders(sql), params);
              return res.rows;
            }
          })
        };

        const result = await callback(txHelper, client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * SQLite-compatible prepare method for synchronous/transitional queries
     */
    prepare(sql) {
      const pgSql = convertPlaceholders(sql);
      return {
        all: async (...params) => {
          const res = await pool.query(pgSql, params);
          return res.rows;
        },
        get: async (...params) => {
          const res = await pool.query(pgSql, params);
          return res.rows[0];
        },
        run: async (...params) => {
          const res = await pool.query(pgSql, params);
          return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id };
        }
      };
    },

    async exec(sql) {
      return pool.query(sql);
    },

    async close() {
      await pool.end();
    }
  };

  console.log('🔌 Database Adapter initialized in PostgreSQL mode.');
} else {
  // ==========================================
  // SQLite Mode (Development / Testing)
  // ==========================================
  const Database = require('better-sqlite3');

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

  const sqliteDb = new Database(dbPath);
  sqliteDb.pragma('foreign_keys = ON');
  try {
    sqliteDb.pragma('journal_mode = WAL');
  } catch (e) {
    sqliteDb.pragma('journal_mode = DELETE');
  }
  sqliteDb.pragma('synchronous = NORMAL');

  adapter = sqliteDb;
  adapter.dialect = 'sqlite';
  adapter.getDbPath = () => dbPath;

  adapter.transactionAsync = async (callback) => {
    sqliteDb.exec('BEGIN TRANSACTION;');
    try {
      const result = await callback(sqliteDb);
      sqliteDb.exec('COMMIT;');
      return result;
    } catch (err) {
      sqliteDb.exec('ROLLBACK;');
      throw err;
    }
  };
}

module.exports = adapter;
