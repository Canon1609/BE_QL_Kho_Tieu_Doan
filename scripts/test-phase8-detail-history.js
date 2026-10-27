const assert = require('node:assert/strict');
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
const { sequelize, Unit, Material, Location, StockLedgerEntry } = require('../src/models');
const search = require('../src/services/search.service');
async function main() {
  const [root, company, other, material, unseen, room, building] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }),
    Unit.findOne({ where: { code: 'COMPANY_12' } }), Material.findOne({ where: { code: 'P8_QUAT' } }),
    Material.findOne({ where: { code: 'P8_NEW' } }), Location.findOne({ where: { code: 'P8_SHARED' } }),
    Location.findOne({ where: { code: 'P8_BUILDING' } }),
  ]);
  const admin = { role: { code: 'BATTALION_ADMIN' }, unit: root, unit_id: root.id };
  const co = { role: { code: 'COMPANY_ADMIN' }, unit: company, unit_id: company.id };
  const detail = await search.detail(String(material.id), {}, admin);
  assert.deepEqual(detail.totals, { physical: '12', available: '9', borrowed: '3' });
  assert.equal(detail.items.reduce((n, item) => n + BigInt(item.physical), 0n), 12n);
  assert(detail.items.some(item => item.unit_id === String(other.id) && item.location_id === String(room.id)));
  const own = await search.detail(String(material.id), {}, co);
  assert.deepEqual(own.totals, { physical: '3', available: '0', borrowed: '3' });
  assert(own.items.every(item => item.unit_id === String(company.id)));
  const roomDetail = await search.detail(String(material.id), { location_id: String(room.id) }, co);
  assert.equal(roomDetail.totals.physical, '1');
  assert.equal((await search.detail(String(material.id), { location_id: String(building.id) }, co)).totals.physical, '3');
  await assert.rejects(() => search.detail(String(unseen.id), {}, co), e => e.statusCode === 404);
  await assert.rejects(() => search.detail(String(material.id), { unit_id: String(other.id) }, co), e => e.statusCode === 403);
  const history = await search.history(String(material.id), {}, admin);
  assert.equal(history.total, 46);
  const pages = await Promise.all([1, 2, 3].map(page => search.history(String(material.id), { page: String(page) }, admin)));
  assert.deepEqual(pages.map(p => p.items.length), [20, 20, 6]);
  const all = pages.flatMap(p => p.items);
  assert.equal(new Set(all.map(row => row.id)).size, history.total);
  assert.equal(all.reduce((n, row) => n + BigInt(row.quantity_delta), 0n), 12n);
  assert(all.every((row, i) => !i || new Date(all[i - 1].occurred_at) > new Date(row.occurred_at) ||
    new Date(all[i - 1].occurred_at).getTime() === new Date(row.occurred_at).getTime() && BigInt(all[i - 1].id) > BigInt(row.id)));
  assert.deepEqual((await search.history(String(material.id), { page: '2' }, admin)).items.map(row => row.id), pages[1].items.map(row => row.id));
  const borrow = await search.history(String(material.id), { transaction_type: 'BORROW' }, co);
  assert.equal(borrow.total, 1);
  assert.equal(borrow.items[0].quantity_delta, '4');
  const filtered = await Promise.all([1, 2, 3].map(page => search.history(String(material.id), {
    transaction_type: 'NORMAL_RECEIPT', from: '2026-10-06', to: '2026-10-06', page: String(page),
  }, admin)));
  assert.deepEqual(filtered.map(p => p.items.length), [18, 0, 0]);
  assert(filtered[0].items.every(row => row.transaction_type === 'NORMAL_RECEIPT' && row.quantity_delta === '1'));
  const narrow = await search.history(String(material.id), { from: '2026-10-04', to: '2026-10-04' }, admin);
  assert.equal(narrow.total, 2);
  assert.equal((await search.detail(String(material.id), {}, admin)).totals.physical, '12');
  const ownHistory = await search.history(String(material.id), { location_id: String(room.id) }, co);
  assert.equal(ownHistory.total, 3);
  assert(ownHistory.items.every(row => row.unit_id === String(company.id)));
  assert(ownHistory.items.some(row => row.borrow_return_line_id && row.transfer_side === 'OUT'));
  await assert.rejects(() => search.history(String(material.id), { unit_id: String(other.id) }, co), e => e.statusCode === 403);
  const legacy = await Material.findOne({ where: { code: 'P8_LEGACY' } });
  const legacyDetail = await search.detail(String(legacy.id), {}, co);
  assert.equal(legacyDetail.totals.physical, '5');
  assert.equal(legacyDetail.items[0].location_code, 'LOC_COMPANY_11_STORE');
  const legacyHistory = await search.history(String(legacy.id), {}, co);
  assert.equal(legacyHistory.total, 1);
  assert.equal(legacyHistory.items[0].location_id, legacyDetail.items[0].location_id);
  assert.equal((await search.detail(String(legacy.id), { location_id: legacyDetail.items[0].location_id }, co)).totals.physical, '5');
  assert.equal((await search.detail(String(legacy.id), { condition_id: 'null' }, co)).totals.physical, '5');
  assert.equal((await search.detail(String(legacy.id), { location_id: legacyDetail.items[0].location_id }, admin)).totals.physical, '5');
  assert.equal((await search.history(String(legacy.id), { condition_id: 'null' }, co)).total, 1);
  const direct = await StockLedgerEntry.findAll({ where: { material_id: material.id }, attributes: ['unit_id', 'borrow_line_id', 'quantity_delta'], raw: true });
  assert.equal(direct.reduce((n, e) => n + BigInt(e.quantity_delta), 0n), BigInt(detail.totals.physical));
  assert.equal(direct.filter(e => e.borrow_line_id).reduce((n, e) => n + BigInt(e.quantity_delta), 0n), BigInt(detail.totals.borrowed));
  console.log('Phase 8 detail/history fixture/scope/date/ledger reconciliation PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
