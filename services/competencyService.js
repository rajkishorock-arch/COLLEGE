const db = require('../config/db');

/**
 * Competency-Based Learning Pathways Service
 * Phase 3.0 Enterprise Engine: Features 28A, 28B
 * - Technical & Soft Skill Competency Framework & Badges
 * - Skill-Based Career Learning Pathway Milestones
 */
class CompetencyService {
  /**
   * Get all registered competencies in the institution framework
   */
  static getCompetencyFramework(tenantId = 'tenant_default', category = null) {
    let query = `SELECT * FROM competencies WHERE tenant_id = ?`;
    const params = [tenantId];

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    query += ` ORDER BY category ASC, name ASC`;
    return db.prepare(query).all(...params);
  }

  /**
   * Get student competency mastery profile
   */
  static getStudentCompetencies(studentId, tenantId = 'tenant_default') {
    return db.prepare(`
      SELECT 
        sc.*,
        c.name as competency_name,
        c.category as competency_category,
        c.description as competency_description,
        c.max_level
      FROM student_competencies sc
      JOIN competencies c ON c.id = sc.competency_id
      WHERE sc.student_id = ? AND sc.tenant_id = ?
      ORDER BY sc.score_pct DESC
    `).all(studentId, tenantId);
  }

  /**
   * Get student's career pathways and progress
   */
  static getStudentPathwayProgress(studentId, tenantId = 'tenant_default') {
    const pathways = db.prepare(`
      SELECT 
        spp.*,
        lp.title as pathway_title,
        lp.role_target,
        lp.description as pathway_description,
        lp.total_milestones,
        lp.required_skills
      FROM student_pathway_progress spp
      JOIN learning_pathways lp ON lp.id = spp.pathway_id
      WHERE spp.student_id = ? AND spp.tenant_id = ?
    `).all(studentId, tenantId);

    return pathways.map(p => ({
      ...p,
      required_skills: p.required_skills ? JSON.parse(p.required_skills) : []
    }));
  }

  /**
   * Advance student milestone on a career pathway
   */
  static advanceMilestone(studentId, pathwayId, tenantId = 'tenant_default') {
    const progress = db.prepare(`
      SELECT * FROM student_pathway_progress
      WHERE student_id = ? AND pathway_id = ? AND tenant_id = ?
    `).get(studentId, pathwayId, tenantId);

    const pathway = db.prepare(`SELECT total_milestones FROM learning_pathways WHERE id = ?`).get(pathwayId);
    if (!progress || !pathway) return null;

    const nextMilestone = Math.min(pathway.total_milestones, progress.current_milestone + 1);
    const completionPct = parseFloat(((nextMilestone / pathway.total_milestones) * 100).toFixed(1));
    const status = completionPct >= 100 ? 'completed' : 'active';

    db.prepare(`
      UPDATE student_pathway_progress
      SET current_milestone = ?, completion_pct = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextMilestone, completionPct, status, progress.id);

    return {
      pathwayId,
      currentMilestone: nextMilestone,
      completionPct,
      status
    };
  }
}

module.exports = CompetencyService;
