'use strict';
const id = S => ({ type: S.BIGINT.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true });
const fk = (S, table, nullable = false) => ({ type: S.BIGINT.UNSIGNED, allowNull: nullable, references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
const times = S => ({ created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') }, updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') } });
module.exports = {
 async up(q,S) {
  await q.createTable('damage_loss_reports', { id:id(S), code:{type:S.STRING(64),allowNull:false,unique:true}, incident_type:{type:S.STRING(16),allowNull:false}, unit_id:fk(S,'units'), discovered_on:{type:S.DATEONLY,allowNull:false}, description:{type:S.TEXT,allowNull:false}, note:S.TEXT, status:{type:S.STRING(16),allowNull:false,defaultValue:'DRAFT'}, created_by:fk(S,'users'), submitted_at:S.DATE, decided_by:fk(S,'users',true), decided_at:S.DATE, decision_note:S.TEXT, ...times(S) });
  await q.addIndex('damage_loss_reports',['unit_id','status','discovered_on'],{name:'damage_loss_unit_status_date_idx'});
  await q.createTable('damage_loss_items', { id:id(S), report_id:fk(S,'damage_loss_reports'), material_id:fk(S,'materials'), source_id:fk(S,'material_sources'), condition_id:fk(S,'condition_levels',true), location_id:fk(S,'locations'), borrow_line_id:fk(S,'borrow_lines',true), quantity:{type:S.BIGINT.UNSIGNED,allowNull:false}, ...times(S) });
  await q.addIndex('damage_loss_items',['report_id'],{name:'damage_loss_items_report_idx'});
  // MySQL functional unique index normalizes nullable dimensions; NULLs otherwise bypass UNIQUE.
  await q.sequelize.query(`CREATE UNIQUE INDEX damage_loss_dimension_unique ON damage_loss_items
   (report_id, material_id, location_id, source_id, (COALESCE(condition_id, 0)), (COALESCE(borrow_line_id, 0)))`);
 },
 async down(q) { await q.dropTable('damage_loss_items'); await q.dropTable('damage_loss_reports'); }
};
