'use strict';
const id = S => ({ type: S.BIGINT.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true });
const fk = (S, table) => ({ type: S.BIGINT.UNSIGNED, allowNull: true, references: { model: table, key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
const mapping = [
  ['BATTALION_5', 'LOC_BATTALION_5_WAREHOUSE', 'Kho Tiểu đoàn 5', 'WAREHOUSE'],
  ...[11, 12, 13].map(n => [`COMPANY_${n}`, `LOC_COMPANY_${n}_STORE`, `Kho Đại đội ${n}`, 'COMPANY_STORE']),
];
module.exports = {
  async up(q, S) {
    const hasLocations = (await q.showAllTables()).some(t => String(t).toLowerCase() === 'locations');
    if (!hasLocations) await q.createTable('locations', {
      id: id(S), code: { type: S.STRING(64), allowNull: false, unique: true },
      name: { type: S.STRING(150), allowNull: false }, type: { type: S.STRING(64), allowNull: false },
      parent_location_id: fk(S, 'locations'), owner_unit_id: fk(S, 'units'),
      is_stock_holding: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      is_active: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') },
    });
    const addIndex = async (table, fields, name) => {
      if (!(await q.showIndex(table)).some(i => i.name === name)) await q.addIndex(table, fields, { name });
    };
    await addIndex('locations', ['parent_location_id'], 'locations_parent_location_id');
    await addIndex('locations', ['owner_unit_id'], 'locations_owner_unit_id');
    if (!(await q.describeTable('stock_ledger_entries')).location_id) await q.addColumn('stock_ledger_entries', 'location_id', fk(S, 'locations'));
    await addIndex('stock_ledger_entries', ['material_id', 'location_id', 'source_id', 'condition_id'], 'ledger_location_dimensions');
    if (!(await q.describeTable('stock_transfers')).from_location_id) await q.addColumn('stock_transfers', 'from_location_id', fk(S, 'locations'));
    if (!(await q.describeTable('stock_transfers')).to_location_id) await q.addColumn('stock_transfers', 'to_location_id', fk(S, 'locations'));
    const db = q.sequelize;
    const [units] = await db.query('SELECT id, code, parent_id, type FROM units WHERE code IN (:codes)', { replacements: { codes: mapping.map(m => m[0]) } });
    const root = units.find(u => u.code === 'BATTALION_5');
    if (!root || root.type !== 'BATTALION') throw new Error('Root unit missing; manual review required');
    const [existingRoot] = await db.query("SELECT * FROM locations WHERE code = 'LOC_BATTALION_5_ROOT'");
    if (!existingRoot.length) await db.query("INSERT INTO locations (code, name, type, owner_unit_id, is_stock_holding, is_active, created_at, updated_at) VALUES ('LOC_BATTALION_5_ROOT', 'Tiểu đoàn 5', 'GROUP', :owner, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", { replacements: { owner: root.id } });
    else if (String(existingRoot[0].owner_unit_id) !== String(root.id) || existingRoot[0].type !== 'GROUP' || existingRoot[0].is_stock_holding || existingRoot[0].parent_location_id != null) throw new Error('Root location conflict');
    const [group] = await db.query("SELECT id FROM locations WHERE code = 'LOC_BATTALION_5_ROOT'");
    for (const [unitCode, code, name, type] of mapping) {
      const unit = units.find(u => u.code === unitCode);
      if (!unit || unit.type !== (unitCode === 'BATTALION_5' ? 'BATTALION' : 'COMPANY') ||
          (unit !== root && String(unit.parent_id) !== String(root.id))) throw new Error(`Invalid unit ${unitCode}`);
      const [existing] = await db.query('SELECT * FROM locations WHERE code = :code', { replacements: { code } });
      if (existing.length) {
        const l = existing[0];
        if (String(l.owner_unit_id) !== String(unit.id) || l.type !== type || !l.is_stock_holding ||
            String(l.parent_location_id) !== String(group[0].id)) throw new Error(`Location conflict: ${code}`);
      } else await db.query('INSERT INTO locations (code, name, type, parent_location_id, owner_unit_id, is_stock_holding, is_active, created_at, updated_at) VALUES (:code, :name, :type, :parent, :owner, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', {
        replacements: { code, name, type, parent: group[0].id, owner: unit.id },
      });
      const [wrong] = await db.query('SELECT COUNT(*) AS n FROM stock_ledger_entries WHERE unit_id = :unit AND location_id IS NOT NULL AND location_id <> (SELECT id FROM locations WHERE code = :code)', { replacements: { code, unit: unit.id } });
      if (Number(wrong[0].n)) throw new Error(`Conflicting ledger locations for ${unitCode}`);
      await db.query('UPDATE stock_ledger_entries SET location_id = (SELECT id FROM locations WHERE code = :code) WHERE unit_id = :unit AND location_id IS NULL', { replacements: { code, unit: unit.id } });
    }
    const [unmapped] = await db.query('SELECT COUNT(*) AS n FROM stock_ledger_entries WHERE location_id IS NULL');
    if (Number(unmapped[0].n)) throw new Error('Unmapped ledger units; manual review required');
    for (const side of ['from', 'to']) await db.query(`UPDATE stock_transfers t JOIN locations l ON l.owner_unit_id = t.${side}_unit_id AND l.code IN (:codes) SET t.${side}_location_id = l.id WHERE t.${side}_location_id IS NULL`, { replacements: { codes: mapping.map(m => m[1]) } });
    const [unmappedTransfers] = await db.query('SELECT COUNT(*) AS n FROM stock_transfers t LEFT JOIN locations f ON f.id = t.from_location_id LEFT JOIN locations dest ON dest.id = t.to_location_id WHERE f.id IS NULL OR dest.id IS NULL OR f.owner_unit_id <> t.from_unit_id OR dest.owner_unit_id <> t.to_unit_id');
    if (Number(unmappedTransfers[0].n)) throw new Error('Unmapped/conflicting transfers; manual review required');
  },
  async down(q) {
    const db = q.sequelize;
    const [other] = await db.query("SELECT COUNT(*) AS n FROM locations WHERE code NOT IN ('LOC_BATTALION_5_ROOT','LOC_BATTALION_5_WAREHOUSE','LOC_COMPANY_11_STORE','LOC_COMPANY_12_STORE','LOC_COMPANY_13_STORE')");
    const [mismatch] = await db.query('SELECT COUNT(*) AS n FROM stock_ledger_entries e JOIN locations l ON l.id = e.location_id WHERE e.unit_id <> l.owner_unit_id');
    if (Number(other[0].n) || Number(mismatch[0].n)) throw new Error('Cannot safely rollback location-specific data');
    await q.removeColumn('stock_transfers', 'to_location_id');
    await q.removeColumn('stock_transfers', 'from_location_id');
    await q.removeIndex('stock_ledger_entries', 'ledger_location_dimensions');
    await q.removeColumn('stock_ledger_entries', 'location_id');
    await q.dropTable('locations');
  },
};
