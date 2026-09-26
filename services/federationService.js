const db = require('../config/db');
const crypto = require('crypto');

/**
 * Multi-Institutional Insights & Federation Service
 * Phase 3.0 Enterprise Engine: Features 25A, 25B, 25C
 * - Anonymized Inter-Institutional Benchmarking & Peer Comparison
 * - Federated Course Credit Transfers & Cryptographic Transcript Verification
 */
class FederationService {
  /**
   * Get Consortium Benchmarks for an institution category
   */
  static getConsortiumBenchmarks(tenantId = 'tenant_default', category = null) {
    let query = `SELECT * FROM consortium_benchmarks WHERE tenant_id = ?`;
    const params = [tenantId];

    if (category) {
      query += ` AND institution_category = ?`;
      params.push(category);
    }

    query += ` ORDER BY benchmark_metric ASC`;
    return db.prepare(query).all(...params);
  }

  /**
   * Generate SHA-256 cryptographic transcript verification hash for federated student transfers
   */
  static generateTranscriptHash(studentId, tenantId = 'tenant_default') {
    const student = db.prepare(`SELECT * FROM users WHERE id = ? AND tenant_id = ?`).get(studentId, tenantId);
    const results = db.prepare(`SELECT * FROM results WHERE student_id = ? AND tenant_id = ?`).all(studentId, tenantId);

    const payload = JSON.stringify({
      studentId,
      name: student ? student.name : '',
      rollNo: student ? student.roll_no : '',
      course: student ? student.course : '',
      results,
      timestamp: new Date().toISOString()
    });

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Initiate Inter-Institutional Student Credit Transfer
   */
  static initiateCreditTransfer(tenantId, studentName, studentRollNo, sourceInst, targetInst, credits) {
    const hash = crypto.createHash('sha256').update(`${studentRollNo}:${sourceInst}:${targetInst}:${Date.now()}`).digest('hex');

    const result = db.prepare(`
      INSERT INTO inter_institutional_transfers (tenant_id, student_name, student_roll_no, source_institution, target_institution, credits_transferred, status, cryptographic_transcript_hash)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(tenantId, studentName, studentRollNo, sourceInst, targetInst, credits, hash);

    return {
      transferId: result.lastInsertRowid,
      transcriptHash: hash,
      status: 'pending'
    };
  }

  /**
   * List pending and approved federated transfers
   */
  static getTransfers(tenantId = 'tenant_default') {
    return db.prepare(`
      SELECT * FROM inter_institutional_transfers
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(tenantId);
  }
}

module.exports = FederationService;
