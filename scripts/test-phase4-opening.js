// Isolated DB only; retain POSTED fixtures. Never run against development.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { sequelize, Role, Unit, User, MaterialCategory, UnitOfMeasure, MaterialSource, Material, StockLedgerEntry } = require('../src/models');
const { jwtConfig } = require('../src/services/auth.service');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase4_verify');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1/stock`;
  const code = `P4_OPEN_${Date.now()}`;
  try {
    const [role, unit, category, uom, source] = await Promise.all([
      Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), Unit.findOne({ where: { code: 'BATTALION_5' } }),
      MaterialCategory.findOne({ where: { code: 'QUAN_TRANG' } }), UnitOfMeasure.findOne({ where: { code: 'BO' } }),
      MaterialSource.findOne({ where: { code: 'NHAN_CAP' } }),
    ]);
    const user = await User.create({ username: code, full_name: 'Thử opening', password_hash: 'fixture', role_id: role.id, unit_id: unit.id });
    const materials = [];
    for (const suffix of ['A', 'B', 'C', 'D']) materials.push(await Material.create({ code: code + suffix, name: `Vật chất thử ${suffix}`, category_id: category.id, unit_id: uom.id }));
    const [A, B, C, D] = materials;
    const token = jwt.sign({ sub: String(user.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
    const call = async (path, method = 'GET', body) => {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
      const json = await response.json();
      assert(!/Sequelize|SELECT .+ FROM|"stack"|password_hash/i.test(JSON.stringify(json)));
      return { status: response.status, data: json.data, message: json.message };
    };
    const expect = async (path, method, body, status) => { const result = await call(path, method, body); assert.equal(result.status, status, `${path}: ${result.message}`); return result; };
    const item = (material, quantity) => ({ material_id: String(material.id), source_id: String(source.id), quantity });
    let seq = 0;
    const draft = async (type, items, date = '2026-09-29') => (await expect('/receipts', 'POST', { code: `${code}_${++seq}`, receipt_type: type, receipt_date: date, items }, 201)).data;
    const post = (receipt, status = 200) => expect(`/receipts/${receipt.id}/post`, 'POST', {}, status);
    const balance = async material => { const r = await expect(`/balance?material_id=${material.id}`, 'GET', null, 200); return Number(r.data[0]?.quantity || 0); };
    const a0 = await draft('OPENING_BALANCE', [item(A, 500)]);
    assert.equal(await balance(A), 0); // case 7
    await post(a0); assert.equal(await balance(A), 500); // case 1
    for (const [amount, total] of [[100, 600], [50, 650]]) { await post(await draft('NORMAL_RECEIPT', [item(A, amount)])); assert.equal(await balance(A), total); } // case 2
    const aAgain = await draft('OPENING_BALANCE', [item(A, 200)]);
    const deniedA = await post(aAgain, 409); assert.match(deniedA.message, /Vật chất thử A.*đã có phát sinh kho/);
    assert.equal(await balance(A), 650); // case 3
    const bOpening = await draft('OPENING_BALANCE', [item(B, 500)]); // prepared before receipt
    assert.equal(await balance(B), 0);
    await post(await draft('NORMAL_RECEIPT', [item(B, 100)]));
    await post(bOpening, 409); assert.equal(await balance(B), 100); // case 4 + draft revalidation
    await post(await draft('OPENING_BALANCE', [item(B, 500)], '2020-01-01'), 409);
    assert.equal(await balance(B), 100); // case 5
    const mixed = await draft('OPENING_BALANCE', [item(C, 300), item(A, 200)]);
    await post(mixed, 409); assert.equal(await balance(C), 0); assert.equal(await balance(A), 650);
    assert.equal(await StockLedgerEntry.count({ where: { reference_id: mixed.id } }), 0); // case 6
    const concurrent = await draft('OPENING_BALANCE', [item(D, 80)]);
    const statuses = (await Promise.all([call(`/receipts/${concurrent.id}/post`, 'POST', {}), call(`/receipts/${concurrent.id}/post`, 'POST', {})])).map(r => r.status).sort();
    assert.deepEqual(statuses, [200, 409]); assert.equal(await balance(D), 80);
    assert.equal(await StockLedgerEntry.count({ where: { material_id: D.id, unit_id: unit.id } }), 1); // case 8
    // Different receipt headers, same material: only one opening can win.
    const [first, second] = await Promise.all([draft('OPENING_BALANCE', [item(C, 30)]), draft('OPENING_BALANCE', [item(C, 40)])]);
    const raced = (await Promise.all([call(`/receipts/${first.id}/post`, 'POST', {}), call(`/receipts/${second.id}/post`, 'POST', {})])).map(r => r.status).sort();
    assert.deepEqual(raced, [200, 409]); assert([30, 40].includes(await balance(C)));
    assert.equal(await StockLedgerEntry.count({ where: { material_id: C.id, unit_id: unit.id } }), 1);
    console.log('AUTOMATED PASS: opening first-only, draft revalidated after normal receipt, backdate, atomic multi-item, normal 500+100+50=650, concurrent same/different receipts');
  } finally { server.close(); await sequelize.close(); }
}
main().catch(error => { console.error('Opening test failed:', error.message); process.exitCode = 1; });
