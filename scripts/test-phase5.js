// Isolated database only; immutable posted fixtures retained for audit.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, Role, Unit, User, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, Material, StockLedgerEntry, StockTransfer } = require('../src/models');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase5_verify');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (path, token, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    const json = await r.json(); assert(!/Sequelize|password_hash|SELECT /i.test(JSON.stringify(json))); return { status: r.status, data: json.data, message: json.message };
  };
  const check = async (path, token, method, body, status) => { const r = await call(path, token, method, body); assert.equal(r.status, status, `${method} ${path}: expected ${status}, got ${r.status}: ${r.message}`); return r.data; };
  const code = `P5_${Date.now()}`;
  try {
    const [root, co11, co12, br, cr, category, unit, sourceA, sourceB, condition] = await Promise.all([
      Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Unit.findOne({ where: { code: 'COMPANY_12' } }),
      Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), Role.findOne({ where: { code: 'COMPANY_ADMIN' } }),
      MaterialCategory.findOne({ where: { code: 'QUAN_TRANG' } }), UnitOfMeasure.findOne({ where: { code: 'BO' } }),
      MaterialSource.findOne({ where: { code: 'NHAN_CAP' } }), MaterialSource.findOne({ where: { code: 'TIEU_DOAN_MUA' } }), ConditionLevel.findOne({ where: { code: 'H1' } }),
    ]);
    const battalion = await User.create({ username: code + '_b', full_name: 'Admin thử', password_hash: 'fixture', role_id: br.id, unit_id: root.id });
    const company = await User.create({ username: code + '_c', full_name: 'Đại đội thử', password_hash: 'fixture', role_id: cr.id, unit_id: co11.id });
    const material = await Material.create({ code: code, name: 'Vật chất P5 thử', category_id: category.id, unit_id: unit.id });
    const other = await Material.create({ code: code + '_2', name: 'Vật chất P5 thứ hai', category_id: category.id, unit_id: unit.id });
    const a = jwt.sign({ sub: String(battalion.id), ver: 0 }, jwtConfig().secret, { expiresIn: '30m' });
    const c = jwt.sign({ sub: String(company.id), ver: 0 }, jwtConfig().secret, { expiresIn: '30m' });
    const item = (m, qty, src = sourceA, cond = condition) => ({ material_id: String(m.id), source_id: String(src.id), condition_id: cond ? String(cond.id) : null, quantity: qty });
    const receipt = (suffix, qty) => ({ code: code + suffix, receipt_type: 'OPENING_BALANCE', receipt_date: '2026-09-30', items: [item(material, qty), item(other, 20)] });
    const draft = (suffix, type, items = [item(material, 200)]) => ({ code: code + suffix, transfer_type: type, transfer_date: '2026-09-30', company_unit_id: String(co11.id), items });
    const warehouse = async m => (await check('/stock/balance?material_id=' + m.id, a, 'GET', null, 200))[0]?.quantity || '0';
    const assets = async (m, token = a, id = co11.id) => (await check('/transfers/company-assets/' + id + '?material_id=' + m.id, token, 'GET', null, 200))[0]?.quantity || '0';
    const totals = async () => [await warehouse(material), await assets(material), (BigInt(await warehouse(material)) + BigInt(await assets(material))).toString()];
    await check('/transfers', null, 'GET', null, 401);
    for (const [path, method] of [['/transfers','GET'], ['/transfers','POST'], ['/transfers/1','PATCH'], ['/transfers/1','DELETE'], ['/transfers/1/post','POST'], ['/transfers/company-units','GET']]) await check(path, c, method, method === 'POST' ? {} : null, 403);
    await check('/transfers/company-assets/' + co12.id, c, 'GET', null, 403);
    await check('/transfers/company-assets/' + root.id, c, 'GET', null, 403);
    await check('/transfers/company-assets/' + co12.id + '/history', c, 'GET', null, 403);
    const opening = await check('/stock/receipts', a, 'POST', receipt('_O', 650), 201);
    await check('/stock/receipts/' + opening.id + '/post', a, 'POST', {}, 200);
    assert.deepEqual(await totals(), ['650','0','650']);
    const removable = await check('/transfers', a, 'POST', draft('_D', 'ISSUE'), 201);
    assert.equal((await check('/transfers/' + removable.id, a, 'GET', null, 200)).items.length, 1);
    await check('/transfers/' + removable.id, a, 'PATCH', draft('_D', 'ISSUE', [item(material, 10), item(other, 2)]), 200);
    assert.deepEqual(await totals(), ['650','0','650']);
    await check('/transfers/' + removable.id, a, 'DELETE', null, 200);
    await check('/transfers/' + removable.id, a, 'GET', null, 404);
    const issue = await check('/transfers', a, 'POST', draft('_I', 'ISSUE'), 201);
    assert.deepEqual(await totals(), ['650','0','650']);
    await check('/transfers/' + issue.id + '/post', a, 'POST', {}, 200);
    assert.deepEqual(await totals(), ['450','200','650']);
    assert.equal(await assets(material, c), '200');
    assert.equal((await check('/transfers/company-assets/' + co11.id + '/history?material_id=' + material.id, c, 'GET', null, 200)).total, 1);
    await check('/transfers/' + issue.id + '/post', a, 'POST', {}, 409);
    await check('/transfers/' + issue.id, a, 'PATCH', draft('_I','ISSUE'), 409);
    await check('/transfers/' + issue.id, a, 'DELETE', null, 409);
    const large = await check('/transfers', a, 'POST', draft('_L', 'ISSUE', [item(material, 500)]), 201);
    await check('/transfers/' + large.id + '/post', a, 'POST', {}, 409);
    const badSource = await check('/transfers', a, 'POST', draft('_S', 'ISSUE', [item(material, 1, sourceB)]), 201);
    await check('/transfers/' + badSource.id + '/post', a, 'POST', {}, 409);
    const badCondition = await check('/transfers', a, 'POST', draft('_C', 'ISSUE', [item(material, 1, sourceA, null)]), 201);
    await check('/transfers/' + badCondition.id + '/post', a, 'POST', {}, 409);
    assert.deepEqual(await totals(), ['450','200','650']);
    const recall = await check('/transfers', a, 'POST', draft('_R', 'RECALL', [item(material, 50)]), 201);
    assert.deepEqual(await totals(), ['450','200','650']);
    await check('/transfers/' + recall.id + '/post', a, 'POST', {}, 200);
    assert.deepEqual(await totals(), ['500','150','650']);
    const tooMuch = await check('/transfers', a, 'POST', draft('_RM', 'RECALL', [item(material, 200)]), 201);
    await check('/transfers/' + tooMuch.id + '/post', a, 'POST', {}, 409);
    assert.deepEqual(await totals(), ['500','150','650']);
    const failure = await check('/transfers', a, 'POST', draft('_F', 'ISSUE', [item(material, 1), item(other, 1)]), 201);
    let inserts = 0; const hook = () => { if (++inserts === 2) throw new Error('injected test failure'); };
    StockLedgerEntry.addHook('beforeCreate','phase5Rollback', hook);
    try { await check('/transfers/' + failure.id + '/post', a, 'POST', {}, 500); }
    finally { StockLedgerEntry.removeHook('beforeCreate','phase5Rollback'); }
    assert.equal((await StockTransfer.findByPk(failure.id)).status,'DRAFT');
    assert.equal(await StockLedgerEntry.count({ where: { reference_type: 'STOCK_TRANSFER', reference_id: failure.id } }),0);
    assert.deepEqual(await totals(), ['500','150','650']);
    const simultaneous = await Promise.all([
      check('/transfers', a, 'POST', draft('_Q1', 'ISSUE', [item(material, 300)]), 201),
      check('/transfers', a, 'POST', draft('_Q2', 'ISSUE', [item(material, 300)]), 201),
    ]);
    const results = await Promise.all(simultaneous.map(r => call('/transfers/' + r.id + '/post', a, 'POST', {})));
    assert.deepEqual(results.map(r => r.status).sort(), [200,409]);
    assert.deepEqual(await totals(), ['200','450','650']);
    const paired = await StockLedgerEntry.findAll({ where: { reference_type: 'STOCK_TRANSFER', reference_id: issue.id } });
    assert.equal(paired.length, 2);
    assert.equal(paired.reduce((n, e) => n + BigInt(e.quantity_delta), 0n), 0n);
    assert.equal(new Set(paired.map(e => e.transfer_side)).size, 2);
    assert.equal(paired[0].transfer_item_id, paired[1].transfer_item_id);
    console.log('PASS: isolated HTTP CRUD/POST/rollback/race/source-condition/scope/total invariant');
  } finally { server.close(); await sequelize.close(); }
}
main().catch(e => { console.error('Phase 5 test failed:', e); process.exitCode = 1; });
