// Run only against the isolated Phase 5 verification database after its location migration.
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { sequelize, Location, Unit, StockLedgerEntry: Ledger } = require('../src/models');
const { legacyLocation, locationBalance, unitHoldingIds, holdingWhere } = require('../src/services/location.service');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase5_verify');
  const [before] = await sequelize.query('SELECT COUNT(*) n, COALESCE(SUM(quantity_delta),0) delta, SUM(location_id IS NULL) missing FROM stock_ledger_entries');
  assert.equal(Number(before[0].missing), 0);
  const units = await Unit.findAll({ where: { code: { [Op.in]: ['BATTALION_5','COMPANY_11','COMPANY_12','COMPANY_13'] } } });
  for (const unit of units) {
    const loc = await legacyLocation(unit.id);
    const [mismatches] = await sequelize.query('SELECT COUNT(*) n FROM stock_ledger_entries WHERE unit_id = :unit AND location_id <> :location', { replacements: { unit: unit.id, location: loc.id } });
    assert.equal(Number(mismatches[0].n), 0);
  }
  const [transfers] = await sequelize.query('SELECT COUNT(*) n FROM stock_transfers WHERE from_location_id IS NULL OR to_location_id IS NULL');
  assert.equal(Number(transfers[0].n), 0);
  const root = units.find(u => u.code === 'BATTALION_5'), co11 = units.find(u => u.code === 'COMPANY_11'), co12 = units.find(u => u.code === 'COMPANY_12');
  const warehouse = await legacyLocation(root.id), company = await legacyLocation(co11.id);
  const grouping = await Location.findOne({ where: { code: 'LOC_BATTALION_5_ROOT' } });
  assert.equal(grouping.is_stock_holding, false);
  assert.equal(String(warehouse.parent_location_id), String(grouping.id));
  // Rollback test fixture only; validate parent sum is children sum, without writing to ledger.
  try { await sequelize.transaction(async transaction => {
    const building = await Location.create({ code: 'TEST_P51_BUILDING', name: 'Dãy thử', type: 'BUILDING', parent_location_id: grouping.id, owner_unit_id: co11.id, is_stock_holding: false }, { transaction });
    const room = await Location.create({ code: 'TEST_P51_ROOM', name: 'Phòng thử', type: 'ROOM', parent_location_id: building.id, owner_unit_id: co11.id, is_stock_holding: true }, { transaction });
    assert.equal(String(room.owner_unit_id), String(co11.id));
    throw new Error('ROLLBACK_TEST_FIXTURE');
  }); } catch (error) { if (error.message !== 'ROLLBACK_TEST_FIXTURE') throw error; }
  const all = await Ledger.findAll({ attributes: ['material_id', 'quantity_delta', 'location_id'] });
  const materials = [...new Set(all.map(e => String(e.material_id)))];
  for (const material of materials) {
    const aggregate = await locationBalance(material, grouping.id, { descendants: true });
    const expected = all.filter(e => String(e.material_id) === material).reduce((n,e) => n + BigInt(e.quantity_delta),0n);
    assert.equal(aggregate.reduce((n,r) => n + BigInt(r.quantity), 0n), expected);
  }
  const scoped11 = await Ledger.sum('quantity_delta', { where: holdingWhere(await unitHoldingIds(co11.id), co11.id) });
  const legacy11 = await Ledger.sum('quantity_delta', { where: { unit_id: co11.id } });
  assert.equal(BigInt(scoped11 || 0), BigInt(legacy11 || 0));
  const forbidden = await Ledger.count({ where: { ...holdingWhere(await unitHoldingIds(co11.id), co11.id), location_id: (await legacyLocation(co12.id)).id } });
  assert.equal(forbidden, 0);
  const [after] = await sequelize.query('SELECT COUNT(*) n, COALESCE(SUM(quantity_delta),0) delta FROM stock_ledger_entries');
  assert.equal(String(after[0].n), String(before[0].n)); assert.equal(String(after[0].delta), String(before[0].delta));
  console.log('PASS: mapped ledger, transfer headers, tree aggregate, unit scope, unchanged count/SUM', after[0]);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => sequelize.close());
