'use strict';
// The schema migration creates these rows to permit atomic historical backfill before
// the independently run seeder. Seeder re-checks the canonical mapping and is safe to rerun.
const mapping = [
  ['BATTALION_5', 'LOC_BATTALION_5_WAREHOUSE', 'WAREHOUSE'],
  ...[11, 12, 13].map(n => [`COMPANY_${n}`, `LOC_COMPANY_${n}_STORE`, 'COMPANY_STORE']),
];
module.exports = {
  async up(q) {
    const db = q.sequelize;
    await db.transaction(async transaction => {
      const opts = { transaction };
      const [units] = await db.query('SELECT id, code, type, parent_id FROM units WHERE code IN (:codes)', { ...opts, replacements: { codes: mapping.map(row => row[0]) } });
      const root = units.find(row => row.code === 'BATTALION_5');
      if (!root || root.type !== 'BATTALION') throw new Error('Root unit missing');
      const [groups] = await db.query("SELECT * FROM locations WHERE code = 'LOC_BATTALION_5_ROOT' FOR UPDATE", opts);
      if (groups.length !== 1 || String(groups[0].owner_unit_id) !== String(root.id) || groups[0].parent_location_id != null || groups[0].is_stock_holding || !groups[0].is_active) throw new Error('Location root conflict');
      for (const [unitCode, code, type] of mapping) {
        const unit = units.find(row => row.code === unitCode);
        if (!unit || unit.type !== (unitCode === 'BATTALION_5' ? 'BATTALION' : 'COMPANY') ||
          (unit !== root && String(unit.parent_id) !== String(root.id))) throw new Error(`Unit conflict: ${unitCode}`);
        const [rows] = await db.query('SELECT * FROM locations WHERE code = :code FOR UPDATE', { ...opts, replacements: { code } });
        if (rows.length > 1) throw new Error(`Duplicate location ${code}`);
        if (!rows.length) await db.query('INSERT INTO locations (code, name, type, parent_location_id, owner_unit_id, is_stock_holding, is_active, created_at, updated_at) VALUES (:code, :name, :type, :parent, :owner, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', {
          ...opts, replacements: { code, name: unitCode === 'BATTALION_5' ? 'Kho Tiểu đoàn 5' : `Kho Đại đội ${unitCode.split('_')[1]}`, type, parent: groups[0].id, owner: unit.id },
        });
        else if (rows[0].type !== type || String(rows[0].owner_unit_id) !== String(unit.id) || String(rows[0].parent_location_id) !== String(groups[0].id) || !rows[0].is_stock_holding || !rows[0].is_active) throw new Error(`Location conflict: ${code}`);
      }
    });
  },
  // Master locations are referenced by immutable ledger; rollback must not delete them.
  async down() {},
};
