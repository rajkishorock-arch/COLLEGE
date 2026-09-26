const db = require('../config/db');

/**
 * Industry & Placement Management 2.0 Service
 * Phase 3.0 Enterprise Engine: Features 26A, 26B, 26C
 * - AI-Powered Job & Student Fit Matching Engine
 * - Recruitment Drive Pipeline Coordination
 * - Alumni Network & Skill-Based Mentorship Matching
 */
class PlacementService {
  /**
   * Get all active and upcoming recruitment job drives
   */
  static getJobOpenings(tenantId = 'tenant_default', studentId = null) {
    const jobs = db.prepare(`
      SELECT * FROM job_openings
      WHERE tenant_id = ?
      ORDER BY deadline_date ASC
    `).all(tenantId);

    return jobs.map(job => {
      let application = null;
      let fitScore = null;

      if (studentId) {
        application = db.prepare(`
          SELECT * FROM job_applications
          WHERE job_id = ? AND student_id = ? AND tenant_id = ?
        `).get(job.id, studentId, tenantId);

        if (application) {
          fitScore = application.fit_probability_pct;
        } else {
          fitScore = this.calculateFitProbability(studentId, job, tenantId);
        }
      }

      return {
        ...job,
        application,
        fit_score: fitScore
      };
    });
  }

  /**
   * AI-powered Fit Matching Algorithm: Computes match probability (0 - 100%) between student and job.
   */
  static calculateFitProbability(studentId, job, tenantId = 'tenant_default') {
    // 1. Check CGPA eligibility
    const results = db.prepare(`
      SELECT marks_obtained, max_marks FROM results WHERE student_id = ? AND tenant_id = ?
    `).all(studentId, tenantId);

    let studentGpa = 7.0;
    if (results.length > 0) {
      const avg = results.reduce((acc, r) => acc + (r.marks_obtained / r.max_marks * 100), 0) / results.length;
      studentGpa = avg / 9.5;
    }

    // 2. Compare against required skills
    const studentComps = db.prepare(`
      SELECT c.name, sc.score_pct, sc.current_level
      FROM student_competencies sc
      JOIN competencies c ON c.id = sc.competency_id
      WHERE sc.student_id = ? AND sc.tenant_id = ?
    `).all(studentId, tenantId);

    let skillMatchCount = 0;
    const requiredSkillsList = job.required_skills ? job.required_skills.toLowerCase().split(',').map(s => s.trim()) : [];

    studentComps.forEach(comp => {
      const compName = comp.name.toLowerCase();
      if (requiredSkillsList.some(req => compName.includes(req) || req.includes(compName))) {
        skillMatchCount++;
      }
    });

    let fit = 60; // baseline
    if (studentGpa >= job.min_cgpa) {
      fit += 20;
    } else {
      fit -= 25;
    }

    fit += Math.min(20, skillMatchCount * 10);
    return Math.min(98, Math.max(25, fit));
  }

  /**
   * Submit job application
   */
  static applyForJob(studentId, jobId, tenantId = 'tenant_default') {
    const job = db.prepare(`SELECT * FROM job_openings WHERE id = ? AND tenant_id = ?`).get(jobId, tenantId);
    if (!job) throw new Error('Job opening not found.');

    const existing = db.prepare(`
      SELECT id FROM job_applications WHERE job_id = ? AND student_id = ? AND tenant_id = ?
    `).get(jobId, studentId, tenantId);

    if (existing) {
      return { alreadyApplied: true, id: existing.id };
    }

    const fitScore = this.calculateFitProbability(studentId, job, tenantId);

    const result = db.prepare(`
      INSERT INTO job_applications (tenant_id, job_id, student_id, fit_probability_pct, application_status, applied_at)
      VALUES (?, ?, ?, ?, 'applied', CURRENT_TIMESTAMP)
    `).run(tenantId, jobId, studentId, fitScore);

    return {
      success: true,
      applicationId: result.lastInsertRowid,
      fitScore
    };
  }

  /**
   * Alumni Directory & Mentorship Matching (Feature 26C)
   */
  static getAlumniMentors(tenantId = 'tenant_default', domain = null) {
    let query = `
      SELECT * FROM alumni_network
      WHERE tenant_id = ? AND is_mentor_available = 1
    `;
    const params = [tenantId];

    if (domain) {
      query += ` AND mentorship_domain LIKE ?`;
      params.push(`%${domain}%`);
    }

    query += ` ORDER BY graduation_year DESC`;
    return db.prepare(query).all(...params);
  }
}

module.exports = PlacementService;
