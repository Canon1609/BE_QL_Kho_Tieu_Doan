'use strict';

// Additive reconciliation only: never creates/drops legacy report tables and never edits SequelizeMeta.
module.exports = {
  async up(q) {
    const qi = q.sequelize.getQueryInterface();
    for (const [table, required] of Object.entries({
      damage_loss_reports: ['id', 'incident_type', 'status', 'unit_id'],
      damage_loss_items: ['id', 'report_id', 'material_id', 'location_id', 'source_id', 'condition_id', 'borrow_line_id', 'quantity'],
    })) {
      const columns = await qi.describeTable(table);
      for (const column of required) if (!columns[column]) throw new Error(`Cannot reconcile damage dimension index: missing ${table}.${column}`);
    }
    const duplicates = await q.sequelize.query(`
      SELECT report_id, material_id, location_id, source_id,
             COALESCE(condition_id, 0) condition_key,
             COALESCE(borrow_line_id, 0) borrow_key,
             COUNT(*) duplicate_count,
             GROUP_CONCAT(id ORDER BY id) item_ids
      FROM damage_loss_items
      GROUP BY report_id, material_id, location_id, source_id,
               COALESCE(condition_id, 0), COALESCE(borrow_line_id, 0)
      HAVING COUNT(*) > 1
      ORDER BY report_id, material_id, location_id, source_id`, { type: q.sequelize.QueryTypes.SELECT });
    if (duplicates.length) {
      const detail = duplicates.map(x => `report=${x.report_id}; items=${x.item_ids}; count=${x.duplicate_count}`).join(' | ');
      throw new Error(`Duplicate damage-loss dimensions found; no data changed and index was not created: ${detail}`);
    }
    const indexes = await qi.showIndex('damage_loss_items');
    const existing = indexes.find(index => index.name === 'damage_loss_dimension_unique');
    if (existing) {
      const fields = existing.fields || [];
      const leading = ['report_id', 'material_id', 'location_id', 'source_id'];
      if (!existing.unique || fields.length !== 6 || leading.some((name, i) => fields[i]?.attribute !== name && fields[i]?.name !== name))
        throw new Error('Index damage_loss_dimension_unique exists but does not match the expected unique expression; manual review required');
      return;
    }
    await q.sequelize.query(`CREATE UNIQUE INDEX damage_loss_dimension_unique ON damage_loss_items
      (report_id, material_id, location_id, source_id,
       (COALESCE(condition_id, 0)), (COALESCE(borrow_line_id, 0)))`);
  },
  async down() {
    throw new Error('Non-destructive reconciliation migration: index rollback requires a separately approved plan');
  },
};
