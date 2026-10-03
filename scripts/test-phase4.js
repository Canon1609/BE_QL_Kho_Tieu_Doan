// Only against isolated DB; posted fixtures intentionally retained as immutable audit data.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { sequelize, Role, Unit, User, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, Material, StockReceipt, StockLedgerEntry } = require('../src/models');
const { jwtConfig } = require('../src/services/auth.service');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase4_verify');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1/stock`;
  const call = async (path, token, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    const json = await r.json(); assert(!JSON.stringify(json).includes('Sequelize')); return { status: r.status, data: json.data, message: json.message };
  };
  const check = async (path, token, method, body, status) => { const r = await call(path, token, method, body); assert.equal(r.status, status, `${method} ${path}: expected ${status} got ${r.status} ${r.message}`); return r.data; };
  const code = `P4_${Date.now()}`;
  try {
    const [root, co, br, cr, category, unit, sourceA, sourceB, condition] = await Promise.all([
      Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), Role.findOne({ where: { code: 'COMPANY_ADMIN' } }),
      MaterialCategory.findOne({ where: { code: 'QUAN_TRANG' } }), UnitOfMeasure.findOne({ where: { code: 'BO' } }), MaterialSource.findOne({ where: { code: 'NHAN_CAP' } }), MaterialSource.findOne({ where: { code: 'TIEU_DOAN_MUA' } }), ConditionLevel.findOne({ where: { code: 'H1' } }),
    ]);
    const battalion = await User.create({ username: code + '_b', full_name: 'Admin thử', password_hash: 'fixture', role_id: br.id, unit_id: root.id });
    const company = await User.create({ username: code + '_c', full_name: 'Đại đội thử', password_hash: 'fixture', role_id: cr.id, unit_id: co.id });
    const material = await Material.create({ code: code, name: 'Quân phục nam thử', category_id: category.id, unit_id: unit.id });
    const other = await Material.create({ code: code + '_2', name: 'Vật chất thử 2', category_id: category.id, unit_id: unit.id });
    const a = jwt.sign({ sub: String(battalion.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
    const c = jwt.sign({ sub: String(company.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
    const item = (m, qty, src = sourceA, cond = condition) => ({ material_id: String(m.id), source_id: String(src.id), condition_id: cond ? String(cond.id) : null, quantity: qty });
    const draft = (suffix, type, items) => ({ code: code + suffix, receipt_type: type, receipt_date: '2026-09-29', items });
    const balance = async m => { const rows = await check('/balance?material_id=' + m.id, a, 'GET', null, 200); return rows[0]?.quantity || '0'; };
    await check('/receipts', null, 'GET', null, 401);
    for (const [path, method, body] of [['/receipts', 'POST', draft('_X', 'NORMAL_RECEIPT', [item(material, 1)])], ['/receipts/1', 'PATCH', draft('_X', 'NORMAL_RECEIPT', [item(material, 1)])], ['/receipts/1', 'DELETE'], ['/receipts/1/post', 'POST', {}], ['/balance', 'GET'], ['/ledger', 'GET']]) await check(path, c, method, body, 403);
    await check('/references', a, 'GET', null, 200);
    const opening = await check('/receipts', a, 'POST', draft('_O', 'OPENING_BALANCE', [item(material, 100)]), 201);
    assert.equal(await balance(material), '0');
    await check(`/receipts/${opening.id}`, a, 'PATCH', draft('_O', 'OPENING_BALANCE', [item(material, 120)]), 200);
    assert.equal(await balance(material), '0');
    await check(`/receipts/${opening.id}/post`, a, 'POST', {}, 200);
    assert.equal(await balance(material), '120');
    await check(`/receipts/${opening.id}/post`, a, 'POST', {}, 409);
    await check(`/receipts/${opening.id}`, a, 'PATCH', draft('_O', 'OPENING_BALANCE', [item(material, 1)]), 409);
    await check(`/receipts/${opening.id}`, a, 'DELETE', null, 409);
    const receipt = await check('/receipts', a, 'POST', draft('_N', 'NORMAL_RECEIPT', [item(material, 20, sourceA, condition), item(material, 10, sourceB, null), item(other, 7)]), 201);
    await check(`/receipts/${receipt.id}/post`, a, 'POST', {}, 200);
    assert.equal(await balance(material), '150'); assert.equal(await balance(other), '7');
    const lines = await StockLedgerEntry.findAll({ where: { reference_id: receipt.id } }); assert.equal(lines.length, 3);
    assert.equal((await check('/balance?material_id=' + material.id, a, 'GET', null, 200))[0].breakdown.length, 2);
    assert.equal((await check('/ledger?material_id=' + material.id, a, 'GET', null, 200)).total, 3);
    await check('/receipts', a, 'POST', draft('_INVALID', 'NORMAL_RECEIPT', [item(material, 0)]), 400);
    await check('/receipts', a, 'POST', draft('_DUP', 'NORMAL_RECEIPT', [item(material, 1), item(material, 2)]), 400);
    await check('/receipts', a, 'POST', draft('_DUP', 'NORMAL_RECEIPT', [item(material, 1, { id: '99999999' })]), 400);
    await check('/receipts', a, 'POST', draft('_O', 'NORMAL_RECEIPT', [item(material, 1)]), 409);
    const removable = await check('/receipts', a, 'POST', draft('_D', 'NORMAL_RECEIPT', [item(material, 1)]), 201);
    await check('/receipts/' + removable.id, a, 'DELETE', null, 200);
    // Inject failure in second ledger insert; first insert must be rolled back, no ledger deleted by cleanup.
    const failure = await check('/receipts', a, 'POST', draft('_F', 'NORMAL_RECEIPT', [item(material, 3), item(other, 4)]), 201);
    let inserts = 0;
    const hook = () => { if (++inserts === 2) throw new Error('Injected test failure'); };
    StockLedgerEntry.addHook('beforeCreate', 'phase4Rollback', hook);
    try { await check(`/receipts/${failure.id}/post`, a, 'POST', {}, 500); }
    finally { StockLedgerEntry.removeHook('beforeCreate', 'phase4Rollback'); }
    assert.equal((await StockReceipt.findByPk(failure.id)).status, 'DRAFT');
    assert.equal(await StockLedgerEntry.count({ where: { reference_id: failure.id } }), 0);
    assert.equal(await balance(material), '150'); assert.equal(await balance(other), '7');
    await check(`/receipts/${failure.id}`, a, 'DELETE', null, 200);
    // Concurrent POST: header row lock; exactly one winner.
    const simultaneous = await check('/receipts', a, 'POST', draft('_C', 'NORMAL_RECEIPT', [item(material, 5)]), 201);
    const both = await Promise.all([call(`/receipts/${simultaneous.id}/post`, a, 'POST', {}), call(`/receipts/${simultaneous.id}/post`, a, 'POST', {})]);
    assert.deepEqual(both.map(r => r.status).sort(), [200, 409]); assert.equal(await balance(material), '155');
    assert.equal(await StockLedgerEntry.count({ where: { reference_id: simultaneous.id } }), 1);
    const [meta] = await sequelize.query("SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('stock_receipt_items','stock_ledger_entries')");
    assert(meta.length > 0 && meta.every(r => r.DELETE_RULE === 'RESTRICT'));
    console.log('PASS: isolated HTTP opening/draft/post/rollback/concurrency/multi-line/balance/ledger/RBAC/FK; immutable posted fixtures retained in test DB');
  } finally { server.close(); await sequelize.close(); }
}
main().catch(e => { console.error('Phase 4 test failed:', e.message); process.exitCode = 1; });
