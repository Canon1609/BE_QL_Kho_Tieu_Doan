// Isolated HTTP security regression: legacy routes must reject client-selected locations.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, Role, Unit, User, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, StockReceipt, StockTransfer, StockLedgerEntry: Ledger, Location } = require('../src/models');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase5_verify', 'Only isolated Phase 5 DB');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (path, token, method, body) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const text = await response.text();
    assert(!/Sequelize|"stack"\s*:|sqlMessage|password_hash|DB_PASSWORD|ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR/i.test(text), `Sensitive response for ${path}: ${response.status}`);
    return { status: response.status, body: JSON.parse(text) };
  };
  const expect = async (path, token, method, body, status) => {
    const r = await call(path, token, method, body);
    assert.equal(r.status, status, `${method} ${path}: ${r.status} ${r.body.message || ''}`);
    if (status >= 400) { assert.equal(r.body.success, false); assert.equal(r.body.data, null); }
    return r.body.data;
  };
  const code = `P51SEC_${Date.now()}`;
  try {
    const [root, co11, co12, br, cr, category, uom, source, condition, outside] = await Promise.all([
      Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Unit.findOne({ where: { code: 'COMPANY_12' } }),
      Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), Role.findOne({ where: { code: 'COMPANY_ADMIN' } }),
      MaterialCategory.findOne(), UnitOfMeasure.findOne(), MaterialSource.findOne(), ConditionLevel.findOne(),
      Location.findOne({ where: { code: 'LOC_COMPANY_12_STORE' } }),
    ]);
    assert(root && co11 && co12 && br && cr && category && uom && source && condition && outside);
    const battalion = await User.create({ username: code + '_b', full_name: 'Security fixture', password_hash: 'no-login', role_id: br.id, unit_id: root.id });
    const company = await User.create({ username: code + '_c', full_name: 'Security fixture', password_hash: 'no-login', role_id: cr.id, unit_id: co11.id });
    const material = await Material.create({ code, name: 'Fixture security', category_id: category.id, unit_id: uom.id });
    const adminToken = jwt.sign({ sub: String(battalion.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
    const companyToken = jwt.sign({ sub: String(company.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
    const item = { material_id: String(material.id), source_id: String(source.id), condition_id: String(condition.id), quantity: 1 };
    const receipt = { code: code + '_R', receipt_type: 'NORMAL_RECEIPT', receipt_date: '2026-09-30', items: [item] };
    const transfer = type => ({ code: code + '_' + type, transfer_type: type, transfer_date: '2026-09-30', company_unit_id: String(co11.id), items: [item] });
    // Genuine DRAFT documents: PATCH/POST spoof checks must not mutate them.
    const r = await expect('/stock/receipts', adminToken, 'POST', receipt, 201);
    const i = await expect('/transfers', adminToken, 'POST', transfer('ISSUE'), 201);
    const b = await expect('/transfers', adminToken, 'POST', transfer('RECALL'), 201);
    const cases = [
      ['/stock/receipts', `/stock/receipts/${r.id}`, `/stock/receipts/${r.id}/post`, receipt, r.id, StockReceipt],
      ['/transfers', `/transfers/${i.id}`, `/transfers/${i.id}/post`, transfer('ISSUE'), i.id, StockTransfer],
      ['/transfers', `/transfers/${b.id}`, `/transfers/${b.id}/post`, transfer('RECALL'), b.id, StockTransfer],
    ];
    const baseline = await Ledger.count();
    // Authorization precedes payload validation; unauthorized clients cannot use these routes.
    const unauth = await fetch(base + '/stock/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...receipt, location_id: String(outside.id) }) });
    assert.equal(unauth.status, 401);
    assert.equal((await unauth.json()).data, null);
    let probes = 0;
    for (const [createPath, updatePath, postPath, body, id, Model] of cases) {
      for (const field of ['location_id', 'from_location_id', 'to_location_id']) {
        for (const value of ['not-an-id', String(outside.id)]) {
          const spoof = { ...body, [field]: value };
          await expect(createPath, adminToken, 'POST', { ...spoof, code: body.code + '_' + field.slice(0, 1) + probes }, 400);
          await expect(updatePath, adminToken, 'PATCH', spoof, 400);
          await expect(postPath, adminToken, 'POST', { [field]: value }, 400);
          await expect(createPath, companyToken, 'POST', spoof, 403);
          await expect(updatePath, companyToken, 'PATCH', spoof, 403);
          await expect(postPath, companyToken, 'POST', { [field]: value }, 403);
          probes++;
        }
      }
      // Also reject attempts to smuggle location on item (and keep source/condition intact).
      await expect(createPath, adminToken, 'POST', { ...body, code: body.code + '_N', items: [{ ...item, location_id: String(outside.id) }] }, 400);
      await expect(updatePath, adminToken, 'PATCH', { ...body, items: [{ ...item, to_location_id: String(outside.id) }] }, 400);
      const persisted = await Model.findByPk(id);
      assert.equal(persisted.status, 'DRAFT'); assert.equal(persisted.code, body.code);
      if (Model === StockTransfer) {
        const [from, to] = await Promise.all([Location.findByPk(persisted.from_location_id), Location.findByPk(persisted.to_location_id)]);
        assert.equal(String(from.owner_unit_id), String(persisted.from_unit_id));
        assert.equal(String(to.owner_unit_id), String(persisted.to_unit_id));
        assert.notEqual(String(from.id), String(outside.id)); assert.notEqual(String(to.id), String(outside.id));
      }
      assert.equal(await Ledger.count(), baseline, 'No ledger from spoofed requests');
    }
    assert.equal(await StockReceipt.count({ where: { code: { [require('sequelize').Op.like]: `${code}_R_%` } } }), 0);
    assert.equal(await StockTransfer.count({ where: { code: { [require('sequelize').Op.like]: `${code}_ISSUE_%` } } }), 0);
    assert.equal(await StockTransfer.count({ where: { code: { [require('sequelize').Op.like]: `${code}_RECALL_%` } } }), 0);
    assert.equal(await Ledger.count({ where: { material_id: material.id } }), 0);
    for (const Model of [StockReceipt, StockTransfer]) {
      const draftItems = Model === StockReceipt ? require('../src/models').StockReceiptItem : require('../src/models').StockTransferItem;
      const fk = Model === StockReceipt ? 'receipt_id' : 'transfer_id';
      for (const doc of await Model.findAll({ where: { code: { [require('sequelize').Op.in]: Model === StockReceipt ? [receipt.code] : [transfer('ISSUE').code, transfer('RECALL').code] } } })) {
        const lines = await draftItems.findAll({ where: { [fk]: doc.id } });
        assert.equal(lines.length, 1);
        assert.equal(String(lines[0].source_id), String(source.id)); assert.equal(String(lines[0].condition_id), String(condition.id));
      }
    }
    console.log(`PASS: ${probes} combinations per document type, 3 legacy routes × create/update/post × 2 roles; 400 admin / 403 company; no new document, no ledger, no sensitive response`);
  } finally { server.close(); await sequelize.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
