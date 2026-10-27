const assert = require('node:assert/strict');
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
const { sequelize, Unit, Material, Location, BorrowRequest, BorrowReturn, BorrowReturnLine, StockLedgerEntry } = require('../src/models');
const search = require('../src/services/search.service');
const stock = require('../src/services/stock.service');
const locations = require('../src/services/location-management.service');
const borrow = require('../src/services/borrow.service');
async function main() {
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } }), co = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const material = await Material.findOne({ where: { code: 'P8_QUAT' } }), room = await Location.findOne({ where: { code: 'P8_SHARED' } });
  const admin = { role: { code: 'BATTALION_ADMIN' }, unit: root, unit_id: root.id, is_active: true };
  const company = { role: { code: 'COMPANY_ADMIN' }, unit: co, unit_id: co.id, is_active: true };
  assert.equal((await stock.balance({ unitId: root.id, material_id: material.id })).find(x => x.code === 'P8_QUAT').quantity, '7');
  assert.equal((await search.list({ unit_id: String(root.id), search: 'P8_QUAT' }, admin)).items[0].physical, '7');
  const oldLedger = await stock.ledger({ unitId: root.id, material_id: material.id });
  assert(oldLedger.total >= 4);
  const inRoom = await locations.balances(company, { material_id: material.id, location_id: room.id, descendants: 'true' });
  assert.equal(inRoom.reduce((n, row) => n + BigInt(row.quantity), 0n), 1n);
  const doc = await BorrowRequest.findOne({ where: { code: 'P8_REQ' } });
  const posted = await BorrowReturn.findAll({ where: { request_id: doc.id, status: 'POSTED' } });
  const returned = (await BorrowReturnLine.findAll({ where: { return_id: posted.map(x => x.id) } })).reduce((n, row) => n + BigInt(row.quantity), 0n);
  assert.equal(returned, 1n);
  const debt = await borrow.list({ search: 'P8_REQ' }, company);
  assert.equal(debt.items[0].outstanding_quantity, '3');
  const actualBorrowed = (await search.detail(String(material.id), {}, company)).totals.borrowed;
  assert.equal(actualBorrowed, '3');
  // Debt agrees here only by fixture design; it is never added to stock or substituted for location stock.
  const rows = await StockLedgerEntry.findAll({ where: { material_id: material.id }, raw: true });
  assert.equal(rows.reduce((n, row) => n + BigInt(row.quantity_delta), 0n), 12n);
  assert.equal(rows.filter(row => row.unit_id === co.id && row.location_id === room.id).reduce((n, row) => n + BigInt(row.quantity_delta), 0n), 1n);
  console.log('Phase 4 balance/history, Phase 5.1 room, Phase 7 posted-return debt and Phase 8 reconciliation PASS (fixture scope)');
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
