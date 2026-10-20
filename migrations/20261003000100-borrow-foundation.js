'use strict';
const id = S => ({ type: S.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false });
const fk = (S, table, nullable = false) => ({ type: S.BIGINT.UNSIGNED, allowNull: nullable, references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
const times = S => ({ created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') }, updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') } });
module.exports = {
  async up(q, S) {
    await q.createTable('borrow_requests', {
      id: id(S), code: { type: S.STRING(64), allowNull: false, unique: true }, company_unit_id: fk(S, 'units'), due_date: { type: S.DATEONLY, allowNull: false },
      status: { type: S.STRING(24), allowNull: false, defaultValue: 'DRAFT' }, note: { type: S.TEXT },
      created_by: fk(S, 'users'), decided_by: fk(S, 'users', true), decided_at: { type: S.DATE }, decision_note: { type: S.TEXT }, ...times(S),
    });
    await q.addIndex('borrow_requests', ['company_unit_id', 'status', 'due_date']);
    await q.createTable('borrow_lines', {
      id: id(S), request_id: fk(S, 'borrow_requests'), material_id: fk(S, 'materials'), source_id: fk(S, 'material_sources'), condition_id: fk(S, 'condition_levels', true),
      quantity: { type: S.BIGINT.UNSIGNED, allowNull: false }, ...times(S),
    });
    await q.addIndex('borrow_lines', ['request_id']);
    await q.createTable('borrow_deliveries', {
      id: id(S), request_id: { ...fk(S, 'borrow_requests'), unique: true }, from_location_id: fk(S, 'locations'), to_location_id: fk(S, 'locations'),
      confirmed_by: fk(S, 'users'), confirmed_at: { type: S.DATE, allowNull: false }, ...times(S),
    });
    await q.createTable('borrow_returns', {
      id: id(S), request_id: fk(S, 'borrow_requests'), to_location_id: fk(S, 'locations'), status: { type: S.STRING(16), allowNull: false, defaultValue: 'DRAFT' },
      created_by: fk(S, 'users'), confirmed_by: fk(S, 'users', true), confirmed_at: { type: S.DATE }, ...times(S),
    });
    await q.addIndex('borrow_returns', ['request_id', 'status']);
    await q.createTable('borrow_return_lines', {
      id: id(S), return_id: fk(S, 'borrow_returns'), borrow_line_id: fk(S, 'borrow_lines'), from_location_id: fk(S, 'locations'),
      quantity: { type: S.BIGINT.UNSIGNED, allowNull: false }, ...times(S),
    });
    await q.addIndex('borrow_return_lines', ['return_id']);
    await q.addColumn('stock_ledger_entries', 'borrow_line_id', fk(S, 'borrow_lines', true));
    await q.addIndex('stock_ledger_entries', ['borrow_line_id', 'unit_id', 'location_id']);
    await q.addColumn('stock_ledger_entries', 'borrow_delivery_id', fk(S, 'borrow_deliveries', true));
    await q.addColumn('stock_ledger_entries', 'borrow_return_line_id', fk(S, 'borrow_return_lines', true));
    await q.addIndex('stock_ledger_entries', ['borrow_delivery_id', 'borrow_line_id', 'transfer_side'], { unique: true, name: 'borrow_delivery_ledger_unique' });
    await q.addIndex('stock_ledger_entries', ['borrow_return_line_id', 'transfer_side'], { unique: true, name: 'borrow_return_ledger_unique' });
    await q.addColumn('stock_transfer_items', 'borrow_line_id', fk(S, 'borrow_lines', true));
  },
  async down(q) {
    await q.removeColumn('stock_transfer_items', 'borrow_line_id');
    await q.removeIndex('stock_ledger_entries', 'borrow_return_ledger_unique');
    await q.removeIndex('stock_ledger_entries', 'borrow_delivery_ledger_unique');
    await q.removeIndex('stock_ledger_entries', ['borrow_line_id', 'unit_id', 'location_id']);
    for (const col of ['borrow_return_line_id', 'borrow_delivery_id', 'borrow_line_id']) await q.removeColumn('stock_ledger_entries', col);
    for (const table of ['borrow_return_lines', 'borrow_returns', 'borrow_deliveries', 'borrow_lines', 'borrow_requests']) await q.dropTable(table);
  },
};
