'use strict';
const id = S => ({ type: S.BIGINT.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true });
const fk = (S, table, nullable = false) => ({ type: S.BIGINT.UNSIGNED, allowNull: nullable, references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
const times = S => ({ created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') }, updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') } });
module.exports = {
  async up(q, S) {
    await q.createTable('stock_receipts', {
      id: id(S), code: { type: S.STRING(64), allowNull: false, unique: true },
      receipt_type: { type: S.STRING(32), allowNull: false }, receipt_date: { type: S.DATEONLY, allowNull: false },
      source_id: fk(S, 'material_sources', true), document_no: { type: S.STRING(120) }, note: { type: S.TEXT },
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'DRAFT' },
      created_by: fk(S, 'users'), posted_by: fk(S, 'users', true), posted_at: { type: S.DATE }, ...times(S),
    });
    await q.addIndex('stock_receipts', ['status', 'receipt_date']);
    await q.addIndex('stock_receipts', ['receipt_type', 'receipt_date']);
    await q.createTable('stock_receipt_items', {
      id: id(S), receipt_id: fk(S, 'stock_receipts'), material_id: fk(S, 'materials'),
      source_id: fk(S, 'material_sources'), condition_id: fk(S, 'condition_levels', true),
      quantity: { type: S.BIGINT.UNSIGNED, allowNull: false }, note: { type: S.TEXT }, ...times(S),
    });
    await q.addIndex('stock_receipt_items', ['receipt_id']);
    await q.addIndex('stock_receipt_items', ['material_id']);
    await q.createTable('stock_ledger_entries', {
      id: id(S), material_id: fk(S, 'materials'), unit_id: fk(S, 'units'),
      source_id: fk(S, 'material_sources'), condition_id: fk(S, 'condition_levels', true),
      transaction_type: { type: S.STRING(64), allowNull: false }, quantity_delta: { type: S.BIGINT, allowNull: false },
      reference_type: { type: S.STRING(64), allowNull: false }, reference_id: { type: S.BIGINT.UNSIGNED, allowNull: false },
      // Generic reference for future movement types; Phase 4 receipts additionally use an FK + unique item guard.
      receipt_item_id: { ...fk(S, 'stock_receipt_items', true), unique: true },
      occurred_at: { type: S.DATE, allowNull: false }, created_by: fk(S, 'users'), ...times(S),
    });
    await q.addIndex('stock_ledger_entries', ['material_id', 'unit_id', 'source_id', 'condition_id']);
    await q.addIndex('stock_ledger_entries', ['unit_id', 'occurred_at']);
    await q.addIndex('stock_ledger_entries', ['reference_type', 'reference_id']);
  },
  async down(q) {
    await q.dropTable('stock_ledger_entries');
    await q.dropTable('stock_receipt_items');
    await q.dropTable('stock_receipts');
  },
};
