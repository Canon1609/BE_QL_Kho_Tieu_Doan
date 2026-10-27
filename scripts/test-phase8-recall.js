// Real POSTED receipt -> ISSUE -> RECALL, isolated Phase 8 database only.
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Only Phase 8 test DB');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, Unit, User, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, StockTransfer, StockLedgerEntry: Ledger } = require('../src/models');
const search = require('../src/services/search.service');
async function main() {
  const [root, co, cat, measure, source, condition] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }),
    MaterialCategory.findOne({ where: { code: 'P8_CATEGORY' } }), UnitOfMeasure.findOne({ where: { code: 'P8_CAI' } }),
    MaterialSource.findOne({ where: { code: 'P8_CAP' } }), ConditionLevel.findOne({ where: { code: 'P8_GOOD' } }),
  ]);
  const author = await User.findOne({ where: { unit_id: root.id, is_active: true } });
  assert([root, co, cat, measure, source, condition, author].every(Boolean));
  const code = `P8_RECALL_${Date.now()}`;
  const m = await Material.create({ code, name: 'Thu hồi thật Phase 8', category_id: cat.id, unit_id: measure.id });
  const token = jwt.sign({ sub: String(author.id), ver: author.auth_version }, jwtConfig().secret, { expiresIn: '10m' });
  const server = app.listen(0), base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (path, method, body, status) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    const json = await response.json(); assert.equal(response.status, status, `${method} ${path}: ${response.status} ${json.message}`);
    return json.data;
  };
  const item = qty => ({ material_id: String(m.id), source_id: String(source.id), condition_id: String(condition.id), quantity: qty });
  try {
    const receipt = await call('/stock/receipts', 'POST', { code: `${code}_OPEN`, receipt_type: 'OPENING_BALANCE', receipt_date: '2026-10-01', items: [item(10)] }, 201);
    await call(`/stock/receipts/${receipt.id}/post`, 'POST', {}, 200);
    for (const [type, qty] of [['ISSUE', 4], ['RECALL', 2]]) {
      const draft = await call('/transfers', 'POST', { code: `${code}_${type}`, transfer_type: type, transfer_date: '2026-10-02', company_unit_id: String(co.id), items: [item(qty)] }, 201);
      await call(`/transfers/${draft.id}/post`, 'POST', {}, 200);
      const posted = await StockTransfer.findByPk(draft.id);
      assert.equal(posted.status, 'POSTED');
      const pairs = await Ledger.findAll({ where: { reference_type: 'STOCK_TRANSFER', reference_id: draft.id, material_id: m.id }, order: [['id', 'ASC']] });
      assert.equal(pairs.length, 2); assert.deepEqual(pairs.map(e => e.transfer_side).sort(), ['IN', 'OUT']);
      assert.equal(new Set(pairs.map(e => String(e.transfer_item_id))).size, 1);
      assert.equal(pairs.reduce((sum, e) => sum + BigInt(e.quantity_delta), 0n), 0n);
      const h = await search.history(String(m.id), { transaction_type: type }, { role: { code: 'BATTALION_ADMIN' }, unit: root, unit_id: root.id });
      assert.equal(h.total, 2);
      assert(h.items.every(e => e.reference_type === 'STOCK_TRANSFER' && e.reference_id === String(draft.id) && e.transfer_item_id));
    }
    const detail = await search.detail(String(m.id), {}, { role: { code: 'BATTALION_ADMIN' }, unit: root, unit_id: root.id });
    assert.equal(detail.totals.physical, '10');
    assert.equal((await search.detail(String(m.id), {}, { role: { code: 'COMPANY_ADMIN' }, unit: co, unit_id: co.id })).totals.physical, '2');
    console.log('Phase 8 real POSTED receipt/ISSUE/RECALL trace PASS', code, '10=8+2');
  } finally { server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
