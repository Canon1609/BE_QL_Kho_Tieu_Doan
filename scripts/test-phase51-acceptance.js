// Isolated acceptance DB only. Run `pre`, migrate UP, then run `post`.
const assert = require('node:assert/strict');
const { sequelize, Unit, User, Role, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, Location, StockLedgerEntry: Ledger } = require('../src/models');
const { legacyLocation, locationBalance, unitHoldingIds, holdingWhere } = require('../src/services/location.service');
const { canAccessUnit } = require('../src/services/unitScope.service');
const { Op } = require('sequelize');
const dbName = 'ql_kho_tieu_doan_5_phase51_accept_v2';
const ref = 'P51_ACCEPT_FIXTURE';
const sum = rows => rows.reduce((n, r) => n + BigInt(r.quantity), 0n);
async function main() {
  assert.equal(process.env.DB_NAME, dbName, 'Refuse non-test DB');
  const stage = process.argv[2]; assert(['pre', 'post'].includes(stage));
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const c11 = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const c12 = await Unit.findOne({ where: { code: 'COMPANY_12' } });
  assert(root && c11 && c12);
  const entries = () => Ledger.findAll({ where: { reference_type: ref }, order: [['reference_id', 'ASC']] });
  if (stage === 'pre') {
    assert.equal((await sequelize.getQueryInterface().describeTable('stock_ledger_entries')).location_id, undefined);
    assert.equal(await Ledger.count({ where: { reference_type: ref } }), 0, 'Use fresh isolated DB');
    const role = await Role.findOne({ where: { code: 'BATTALION_ADMIN' } });
    const cat = await MaterialCategory.findOne(); const uom = await UnitOfMeasure.findOne();
    const source = await MaterialSource.findOne(); const condition = await ConditionLevel.findOne();
    assert(role && cat && uom && source && condition);
    const user = await User.create({ username: 'p51_accept_user', full_name: 'Fixture acceptance', password_hash: 'not-a-login', role_id: role.id, unit_id: root.id });
    const material = await Material.create({ code: 'P51_ACCEPT_FAN', name: 'Quạt fixture', category_id: cat.id, unit_id: uom.id });
    for (const [unit, qty, idx] of [[root, 500, 1], [c11, 150, 2]]) {
      await Ledger.create({ material_id: material.id, unit_id: unit.id, source_id: source.id, condition_id: condition.id,
        transaction_type: 'OPENING_BALANCE', quantity_delta: qty, reference_type: ref, reference_id: idx,
        occurred_at: new Date('2026-09-29T00:00:00Z'), created_by: user.id });
    }
    const [rows] = await sequelize.query('SELECT unit_id, source_id, condition_id, quantity_delta FROM stock_ledger_entries WHERE reference_type = :ref ORDER BY reference_id', { replacements: { ref } });
    assert.equal(rows.length, 2); assert.equal(sum(rows.map(r => ({ quantity: r.quantity_delta }))), 650n);
    assert.equal(String(rows[0].unit_id), String(root.id)); assert.equal(String(rows[1].unit_id), String(c11.id));
    assert.equal(String(rows[0].source_id), String(source.id)); assert.equal(String(rows[1].source_id), String(source.id));
    assert.equal(String(rows[0].condition_id), String(condition.id)); assert.equal(String(rows[1].condition_id), String(condition.id));
    console.log('PRE MIGRATION PASS: 500 + 150 = 650; ledger count 2; source/condition IDs', String(source.id), String(condition.id));
    return;
  }
  const rows = await entries(); assert.equal(rows.length, 2);
  const warehouse = await legacyLocation(root.id), store = await legacyLocation(c11.id);
  assert.equal(String(rows[0].unit_id), String(root.id)); assert.equal(String(rows[1].unit_id), String(c11.id));
  assert.equal(String(rows[0].location_id), String(warehouse.id)); assert.equal(String(rows[1].location_id), String(store.id));
  assert.equal(BigInt(rows[0].quantity_delta), 500n); assert.equal(BigInt(rows[1].quantity_delta), 150n);
  assert.equal(rows[0].source_id, rows[1].source_id); assert.equal(rows[0].condition_id, rows[1].condition_id);
  const source = await MaterialSource.findOne(); const condition = await ConditionLevel.findOne();
  assert.equal(String(rows[0].source_id), String(source.id)); assert.equal(String(rows[0].condition_id), String(condition.id));
  assert.equal(await Ledger.count(), 2, 'No compensating ledger');
  assert.equal(rows[0].transaction_type, 'OPENING_BALANCE'); assert.equal(rows[1].transaction_type, 'OPENING_BALANCE');
  assert.equal(rows[0].reference_type, ref); assert.equal(rows[1].reference_type, ref);
  assert.equal(sum(await locationBalance(rows[0].material_id, warehouse.id)), 500n);
  assert.equal(sum(await locationBalance(rows[0].material_id, store.id)), 150n);
  const group = await Location.findOne({ where: { code: 'LOC_BATTALION_5_ROOT' } });
  assert.equal(sum(await locationBalance(rows[0].material_id, group.id, { descendants: true })), 650n);
  console.log('MIGRATION FIXTURE PASS: warehouse 500, company 150, total 650, ledger 2, source/condition unchanged');

  // A second material ensures the room-only total is 10 even while the 650 fixture exists.
  const originalMaterial = await Material.findByPk(rows[0].material_id);
  const fan = await Material.create({ code: 'P51_ACCEPT_ROOM_FAN', name: 'Quạt phòng fixture', category_id: originalMaterial.category_id, unit_id: originalMaterial.unit_id });
  const building = await Location.create({ code: 'P51_ACCEPT_BUILDING', name: 'Khu nhà học viên 1', type: 'BUILDING', parent_location_id: group.id, owner_unit_id: c11.id, is_stock_holding: false });
  const p101 = await Location.create({ code: 'P51_ACCEPT_101', name: 'Phòng 101', type: 'ROOM', parent_location_id: building.id, owner_unit_id: c11.id, is_stock_holding: true });
  const p102 = await Location.create({ code: 'P51_ACCEPT_102', name: 'Phòng 102', type: 'ROOM', parent_location_id: building.id, owner_unit_id: c11.id, is_stock_holding: true });
  const user = await User.findOne({ where: { username: 'p51_accept_user' } });
  for (const [room, qty, idx] of [[p101, 4, 101], [p102, 6, 102]]) await Ledger.create({ material_id: fan.id, unit_id: c11.id, location_id: room.id,
    source_id: rows[0].source_id, condition_id: rows[0].condition_id, transaction_type: 'ROOM_FIXTURE', quantity_delta: qty,
    reference_type: ref, reference_id: idx, occurred_at: new Date('2026-09-29T00:00:00Z'), created_by: user.id });
  assert.equal(sum(await locationBalance(fan.id, p101.id)), 4n);
  assert.equal(sum(await locationBalance(fan.id, p102.id)), 6n);
  assert.equal(sum(await locationBalance(fan.id, building.id)), 0n);
  assert.equal(sum(await locationBalance(fan.id, building.id, { descendants: true })), 10n);
  assert.equal(sum(await locationBalance(fan.id, group.id, { descendants: true })), 10n);
  assert.equal(await Ledger.count({ where: { material_id: fan.id, location_id: building.id } }), 0);
  assert.equal(await Ledger.count({ where: { material_id: fan.id } }), 2);
  assert.equal(String(p101.owner_unit_id), String(c11.id)); assert.equal(String(p102.owner_unit_id), String(c11.id));
  const companyRole = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  const companyUser = { is_active: true, role: companyRole, unit: c11, unit_id: c11.id };
  const battalionUser = { is_active: true, role: await Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), unit: root, unit_id: root.id };
  assert(await canAccessUnit(companyUser, c11.id));
  assert.equal(await canAccessUnit(companyUser, c12.id), false); assert.equal(await canAccessUnit(companyUser, root.id), false);
  assert(await canAccessUnit(battalionUser, c11.id)); assert(await canAccessUnit(battalionUser, c12.id)); assert(await canAccessUnit(battalionUser, root.id));
  const ids = await unitHoldingIds(c11.id);
  assert(ids.includes(String(p101.id)) && ids.includes(String(p102.id)));
  assert.equal(await Ledger.count({ where: { material_id: fan.id, ...holdingWhere(ids, c11.id), location_id: { [Op.in]: [warehouse.id, (await legacyLocation(c12.id)).id] } } }), 0);
  console.log('LOCATION TREE / NO DOUBLE COUNT / UNIT SCOPE PASS: 4 + 6 = 10; group direct 0; battalion 10; company outside scope denied');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => sequelize.close());
