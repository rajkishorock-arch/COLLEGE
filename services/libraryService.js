const db = require('../config/db');

/**
 * Library Service - Tenant Scoped Catalog & Circulation
 */
const libraryService = {
  /**
   * Get library statistics for a specific institution
   */
  getStats(tenantId) {
    const todayStr = new Date().toISOString().split('T')[0];

    const bookStats = db.prepare(`
      SELECT 
        COUNT(*) AS totalTitles, 
        COALESCE(SUM(total_copies), 0) AS totalCopies,
        COALESCE(SUM(available_copies), 0) AS availableCopies
      FROM books
      WHERE tenant_id = ?
    `).get(tenantId);

    const issuedStats = db.prepare(`
      SELECT 
        COUNT(*) AS totalIssued,
        SUM(CASE WHEN due_date < ? AND status = 'Issued' THEN 1 ELSE 0 END) AS overdueCount
      FROM book_issues
      WHERE tenant_id = ? AND status = 'Issued'
    `).get(todayStr, tenantId);

    return {
      totalTitles: bookStats ? bookStats.totalTitles : 0,
      totalCopies: bookStats ? bookStats.totalCopies : 0,
      availableCopies: bookStats ? bookStats.availableCopies : 0,
      totalIssued: issuedStats ? (issuedStats.totalIssued || 0) : 0,
      overdueCount: issuedStats ? (issuedStats.overdueCount || 0) : 0
    };
  },

  /**
   * Get books catalog for an institution
   */
  getBooks(tenantId, search = '', category = '') {
    let sql = 'SELECT * FROM books WHERE tenant_id = ?';
    const params = [tenantId];

    if (search && search.trim()) {
      sql += ' AND (LOWER(title) LIKE ? OR LOWER(author) LIKE ?)';
      params.push(`%${search.trim().toLowerCase()}%`, `%${search.trim().toLowerCase()}%`);
    }

    if (category && category !== 'All') {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY title ASC';
    return db.prepare(sql).all(...params);
  },

  /**
   * Add a new book to the institution catalog
   */
  addBook(tenantId, { title, author, category, total_copies }) {
    const copies = parseInt(total_copies, 10) || 1;
    const stmt = db.prepare(`
      INSERT INTO books (tenant_id, title, author, category, total_copies, available_copies)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(tenantId, title.trim(), author.trim(), category.trim(), copies, copies).lastInsertRowid;
  },

  /**
   * Get issued books scoped to tenant
   */
  getIssuedBooks(tenantId) {
    const todayStr = new Date().toISOString().split('T')[0];
    return db.prepare(`
      SELECT 
        bi.id, bi.tenant_id, bi.issue_date, bi.due_date, bi.return_date, bi.status,
        b.title, b.author, b.category,
        u.name AS student_name, u.roll_no, u.email AS student_email
      FROM book_issues bi
      JOIN books b ON bi.book_id = b.id
      JOIN users u ON bi.student_id = u.id
      WHERE bi.tenant_id = ? AND bi.status = 'Issued'
      ORDER BY bi.due_date ASC
    `).all(tenantId).map(item => ({
      ...item,
      isOverdue: item.due_date < todayStr
    }));
  }
};

module.exports = libraryService;
