const assert = require('node:assert/strict');
const { sequelize, User, Unit, Location, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, StockLedgerEntry: Ledger, StockTransfer: Transfer } = require('../src/models');
const transfers = require('../src/services/transfer.service');
const code = `P6R_${Date.now()}`;
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify');
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } }), company = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const admin = { ...(await User.findOne({ where: { unit_id: root.id } })).get({ plain: true }), unit: root, role: { code: 'BATTALION_ADMIN' } };
  const rootStore = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } });
  const store = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
  const room = await Location.findOne({ where: { type: 'ROOM', is_active: true }, order: [['id', 'DESC']] });
  const source = await MaterialSource.findOne(), cond = await ConditionLevel.findOne();
  const m1 = await Material.create({ code: code+'A', name: 'Quạt race', category_id: (await MaterialCategory.findOne()).id, unit_id: (await UnitOfMeasure.findOne()).id });
  const m2 = await Material.create({ code: code+'B', name: 'Đèn rollback', category_id: m1.category_id, unit_id: m1.unit_id });
  const item = (material, quantity, source_id = source.id) => ({ material_id: material.id, source_id, condition_id: cond.id, quantity });
  const make = (suffix, type, from, to, items) => transfers.save(null, { code: code+suffix, transfer_type: type, transfer_date: new Date().toISOString().slice(0,10), company_unit_id: company.id, ...(from ? { from_location_id: from } : {}), ...(to ? { to_location_id: to } : {}), items }, admin);
  const quantities = async () => (await Ledger.findAll({ where: { material_id: m1.id, unit_id: company.id, location_id: store.id }, attributes: ['quantity_delta'] })).reduce((n,e) => n + Number(e.quantity_delta),0);
  await Ledger.create({ material_id: m1.id, unit_id: root.id, location_id: rootStore.id, source_id: source.id, condition_id: cond.id, quantity_delta: 10, transaction_type: 'OPENING_BALANCE', reference_type: 'PHASE6_TEST_FIXTURE', reference_id: m1.id, occurred_at: new Date(), created_by: admin.id });
  const issue = await make('ISS','ISSUE',null,store.id,[item(m1,10)]);
  assert.equal(await quantities(),0);
  const both = await Promise.allSettled([transfers.post(issue.id,admin),transfers.post(issue.id,admin)]);
  assert.deepEqual(both.map(r => r.status).sort(),['fulfilled','rejected']);
  assert.equal((await Ledger.count({ where: { reference_type: 'STOCK_TRANSFER', reference_id: issue.id } })),2);
  const first = await make('MOVE1','INTERNAL_TRANSFER',store.id,room.id,[item(m1,8)]);
  const second = await make('MOVE2','INTERNAL_TRANSFER',store.id,room.id,[item(m1,8)]);
  const races = await Promise.allSettled([transfers.post(first.id,admin),transfers.post(second.id,admin)]);
  assert.deepEqual(races.map(r => r.status).sort(),['fulfilled','rejected']);
  assert.equal(await quantities(),2);
  assert.equal(await Ledger.count({ where: { reference_type: 'STOCK_TRANSFER', reference_id: races[0].status === 'rejected' ? first.id : second.id } }),0);
  await Ledger.create({ material_id: m2.id, unit_id: company.id, location_id: store.id, source_id: source.id, condition_id: cond.id, quantity_delta: 1, transaction_type: 'PHASE6_TEST_FIXTURE', reference_type: 'PHASE6_TEST_FIXTURE', reference_id: m2.id, occurred_at: new Date(), created_by: admin.id });
  const failed = await make('ROLLBACK','INTERNAL_TRANSFER',store.id,room.id,[item(m1,1),item(m2,1)]);
  // A failure after the first ledger INSERT must roll back the whole document.
  let inserts = 0;
  Ledger.addHook('beforeCreate','phase6Failure',() => { if (++inserts === 2) throw Error('Injected second ledger failure') });
  try { await assert.rejects(() => transfers.post(failed.id,admin), /Injected second ledger failure/); }
  finally { Ledger.removeHook('beforeCreate','phase6Failure'); }
  assert.equal((await Transfer.findByPk(failed.id)).status,'DRAFT');
  assert.equal(await Ledger.count({ where: { reference_type: 'STOCK_TRANSFER', reference_id: failed.id } }),0);
  assert.equal(await quantities(),2);
  const over = await make('OVER','INTERNAL_TRANSFER',store.id,room.id,[item(m1,3)]);
  await assert.rejects(() => transfers.post(over.id,admin), e => e.statusCode === 409);
  assert.equal(await quantities(),2);
  const immutable = races[0].status === 'fulfilled' ? first.id : second.id;
  await assert.rejects(() => transfers.save(immutable, { code: code+'CHANGE', transfer_type: 'INTERNAL_TRANSFER', company_unit_id: company.id, from_location_id: store.id, to_location_id: room.id, items: [item(m1,1)] },admin), e => e.statusCode === 409);
  await assert.rejects(() => transfers.remove(immutable,admin), e => e.statusCode === 409);
  const before = await Ledger.count();
  await assert.rejects(() => transfers.post(immutable,admin), e => e.statusCode === 409);
  assert.equal(await Ledger.count(),before);
  const posted = await Transfer.findByPk(races[0].status === 'fulfilled' ? first.id : second.id);
  const entries = await Ledger.findAll({ where: { reference_type: 'STOCK_TRANSFER', reference_id: posted.id } });
  assert(entries.every(e => String(e.unit_id) === String(company.id) && String(e.source_id) === String(source.id) && String(e.condition_id) === String(cond.id)));
  console.log('Phase 6 race/rollback/double-submit/posted immutable PASS', { issue: issue.id, winner: posted.id, quantityAtStore: await quantities() });
}
main().catch(e => { console.error(e); process.exitCode=1 }).finally(() => sequelize.close());
