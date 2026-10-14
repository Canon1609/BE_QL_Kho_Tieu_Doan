// Isolated material identities per fixture: no reset and no interference with historical tests.
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { sequelize, User, Unit, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, Location, StockLedgerEntry: Ledger, StockTransfer: Transfer, StockTransferItem: Item } = require('../src/models');
const locations = require('../src/services/location-management.service');
const transfers = require('../src/services/transfer.service');
const code = `P6F_${Date.now()}`;
const same = (a,b) => String(a) === String(b);
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify', 'Refuse development database');
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const c11 = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const c13 = await Unit.findOne({ where: { code: 'COMPANY_13' } });
  const admin = { ...(await User.findOne({ where: { unit_id: root.id } })).get({ plain: true }), unit: root, role: { code: 'BATTALION_ADMIN' } };
  const user11 = { ...admin, unit_id: c11.id, unit: c11, role: { code: 'COMPANY_ADMIN' } };
  const user13 = { ...admin, unit_id: c13.id, unit: c13, role: { code: 'COMPANY_ADMIN' } };
  const category = await MaterialCategory.findOne(), uom = await UnitOfMeasure.findOne(), source = await MaterialSource.findOne(), condition = await ConditionLevel.findOne();
  const rootNode = await Location.findOne({ where: { code: 'LOC_BATTALION_5_ROOT' } });
  const rootStore = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } });
  const store11 = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
  const make = (name, type, parent_location_id, is_stock_holding) => locations.save(null, { code: `${code}_${name.toUpperCase()}`, name, type, parent_location_id, owner_unit_id: null, is_stock_holding, is_active: true, note: null }, admin);
  const building = await make('Day_nha_D11', 'BUILDING', rootNode.id, false);
  const floor = await make('Tang_1', 'FLOOR', building.id, false);
  const p101 = await make('Phong_101', 'ROOM', floor.id, true);
  const p102 = await make('Phong_102', 'ROOM', floor.id, true);
  const p103 = await make('Phong_103', 'ROOM', floor.id, true);
  const items = ['Quat', 'Bong_den', 'Giuong'];
  const target = [[2, 4, 20], [2, 4, 25]];
  const dimensions = { source_id: source.id, condition_id: condition.id };
  const getBalances = async (unitId, materialId) => Ledger.findAll({ where: { unit_id: unitId, material_id: materialId, ...dimensions }, attributes: ['location_id', [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']], group: ['location_id'], raw: true });
  const qty = (rows, loc) => Number(rows.find(r => same(r.location_id, loc))?.quantity || 0);
  const total = rows => rows.reduce((n,r) => n + Number(r.quantity), 0);
  const doc = (suffix, type, unit, from, to, lines) => ({ code: `${code}_${suffix}`, transfer_date: new Date().toISOString().slice(0,10), transfer_type: type, company_unit_id: unit, ...(from ? { from_location_id: from } : {}), ...(to ? { to_location_id: to } : {}), items: lines });
  const write = async data => { const draft = await transfers.save(null, data, admin); assert.equal(draft.status, 'DRAFT'); const posted = await transfers.post(draft.id, admin); assert.equal(posted.status, 'POSTED'); return posted; };
  for (const variant of ['A', 'B']) {
    const materials = await Promise.all(items.map((name,i) => Material.create({ code: `${code}_${variant}_${i}`, name, category_id: category.id, unit_id: uom.id })));
    // Exactly 4 fans, 8 bulbs, 45 beds available; only this variant's materials contribute.
    for (const [i, material] of materials.entries()) await Ledger.create({ material_id: material.id, unit_id: root.id, location_id: rootStore.id, ...dimensions, quantity_delta: [4,8,45][i], transaction_type: 'OPENING_BALANCE', reference_type: 'PHASE6_TEST_FIXTURE', reference_id: material.id, occurred_at: new Date(), created_by: admin.id });
    const lines = (room) => materials.map((m,i) => ({ material_id: m.id, ...dimensions, quantity: target[room][i] }));
    const before = await Ledger.count({ where: { material_id: { [Op.in]: materials.map(m => m.id) } } });
    if (variant === 'A') {
      await write(doc('A101', 'ISSUE', c11.id, null, p101.id, lines(0)));
      await write(doc('A102', 'ISSUE', c11.id, null, p102.id, lines(1)));
    } else {
      const issued = await write(doc('B_STORE', 'ISSUE', c11.id, null, store11.id, materials.map((m,i) => ({ material_id: m.id, ...dimensions, quantity: [4,8,45][i] }))));
      assert.equal(same(issued.to_location_id, store11.id), true);
      for (let r=0; r<2; r++) await write(doc(`B_MOVE_${r}`, 'INTERNAL_TRANSFER', c11.id, store11.id, [p101,p102][r].id, lines(r)));
      assert.equal(await Transfer.count({ where: { code: { [Op.like]: `${code}_B%` }, transfer_type: 'ISSUE' } }), 1, 'No second ISSUE');
    }
    const expectedEntries = variant === 'A' ? 12 : 18;
    const count = await Ledger.count({ where: { material_id: { [Op.in]: materials.map(m => m.id) } } });
    assert.equal(count - before, expectedEntries, 'one debit and one credit per posted item');
    for (const [i,m] of materials.entries()) {
      const rows = await getBalances(c11.id,m.id);
      assert.equal(qty(rows,p101.id), target[0][i]); assert.equal(qty(rows,p102.id), target[1][i]);
      assert.equal(qty(rows,store11.id),0); assert.equal(total(rows),[4,8,45][i]);
      const all = await Ledger.findAll({ where: { material_id: m.id }, attributes: ['quantity_delta'] });
      assert.equal(all.reduce((n,e) => n + Number(e.quantity_delta),0), [4,8,45][i]);
      const asset = (await transfers.assets(c11.id,user11,{ material_id: String(m.id) }))[0];
      assert.equal(Number(asset.quantity), [4,8,45][i]); assert.equal(asset.locations.reduce((n,l) => n + Number(l.quantity),0), [4,8,45][i]);
    }
    console.log(`FIXTURE ${variant} PASS: Phòng 101 (2/4/20), Phòng 102 (2/4/25); Đại đội 11 (4/8/45), ledger ${count}`);
    if (variant === 'A') {
      // Same physical room, two different responsible units, including transfer for Unit 13.
      const m = materials[0];
      await Ledger.create({ material_id: m.id, unit_id: root.id, location_id: rootStore.id, ...dimensions, quantity_delta: 2, transaction_type: 'NORMAL_RECEIPT', reference_type: 'PHASE6_TEST_FIXTURE', reference_id: m.id, occurred_at: new Date(), created_by: admin.id });
      await write(doc('C13_ISS', 'ISSUE', c13.id, null, p101.id, [{ material_id: m.id, ...dimensions, quantity: 2 }]));
      const c13move = await write(doc('C13_MOVE','INTERNAL_TRANSFER',c13.id,p101.id,p103.id,[{ material_id: m.id, ...dimensions, quantity: 1 }]));
      const written = await Ledger.findAll({ where: { transfer_item_id: c13move.items[0].id } });
      assert.equal(written.length,2); assert(written.every(e => same(e.unit_id,c13.id) && same(e.source_id,source.id) && same(e.condition_id,condition.id)));
      const all = await locations.balances(admin,{ location_id: String(p101.id) });
      assert(all.some(e => same(e.unit_id,c11.id)) && all.some(e => same(e.unit_id,c13.id)));
      const own11 = await locations.balances(user11,{ location_id: String(p101.id) });
      const own13 = await locations.balances(user13,{ location_id: String(p101.id) });
      assert(own11.every(e => same(e.unit_id,c11.id))); assert(own13.every(e => same(e.unit_id,c13.id)));
      assert.equal(qty(await getBalances(c13.id,m.id),p101.id),1); assert.equal(qty(await getBalances(c13.id,m.id),p103.id),1);
      assert.equal((await transfers.assets(c11.id,user11,{ material_id: String(m.id) }))[0].quantity,'4');
      assert.equal((await transfers.assets(c13.id,user13,{ material_id: String(m.id) }))[0].quantity,'2');
      console.log('FIXTURE C PASS: shared Phòng 101, Unit 13 transfer 101 → 103 retains ownership, separate scoped assets');
    }
  }
  console.log('Fixture prefix', code);
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
