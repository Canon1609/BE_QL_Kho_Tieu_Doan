'use strict';
const id = S => ({ type: S.BIGINT.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true });
const fk = (S, table, nullable = false) => ({ type: S.BIGINT.UNSIGNED, allowNull: nullable, references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
const times = S => ({ created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') }, updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') } });
module.exports = {
  async up(q, S) {
    await q.createTable('stock_transfers', {
      id: id(S), code: { type: S.STRING(64), allowNull: false, unique: true }, transfer_type: { type: S.STRING(16), allowNull: false },
      transfer_date: { type: S.DATEONLY, allowNull: false }, from_unit_id: fk(S, 'units'), to_unit_id: fk(S, 'units'),
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'DRAFT' }, document_no: { type: S.STRING(120) }, note: { type: S.TEXT },
      created_by: fk(S, 'users'), posted_by: fk(S, 'users', true), posted_at: { type: S.DATE }, ...times(S),
    });
    await q.addIndex('stock_transfers', ['transfer_type', 'status', 'transfer_date']);
    await q.addIndex('stock_transfers', ['from_unit_id']);
    await q.addIndex('stock_transfers', ['to_unit_id']);
    await q.createTable('stock_transfer_items', {
      id: id(S), transfer_id: fk(S, 'stock_transfers'), material_id: fk(S, 'materials'), source_id: fk(S, 'material_sources'),
      condition_id: fk(S, 'condition_levels', true), quantity: { type: S.BIGINT.UNSIGNED, allowNull: false }, note: { type: S.TEXT }, ...times(S),
    });
    await q.addIndex('stock_transfer_items', ['transfer_id']);
    await q.addIndex('stock_transfer_items', ['material_id']);
    await q.addColumn('stock_ledger_entries', 'transfer_item_id', { ...fk(S, 'stock_transfer_items', true) });
    await q.addColumn('stock_ledger_entries', 'transfer_side', { type: S.STRING(8), allowNull: true });
    await q.addIndex('stock_ledger_entries', ['transfer_item_id', 'transfer_side'], { unique: true, name: 'stock_ledger_transfer_item_side_unique' });
  },
  async down(q) {
    await q.removeIndex('stock_ledger_entries', 'stock_ledger_transfer_item_side_unique');
    await q.removeColumn('stock_ledger_entries', 'transfer_side');
    await q.removeColumn('stock_ledger_entries', 'transfer_item_id');
    await q.dropTable('stock_transfer_items');
    await q.dropTable('stock_transfers');
  },
};
