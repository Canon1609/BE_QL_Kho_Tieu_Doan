// HTTP security checks against the isolated Phase 6 database only.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, Unit, Role, User, Location, StockTransfer, StockLedgerEntry } = require('../src/models');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify');
  const [root, c11, c13, role] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Unit.findOne({ where: { code: 'COMPANY_13' } }), Role.findOne({ where: { code: 'COMPANY_ADMIN' } }),
  ]);
  const admin = await User.findOne({ where: { unit_id: root.id } });
  const code = `P6HTTP_${Date.now()}`;
  const company = await User.create({ username: code, full_name: 'Kiểm thử Phase 6', role_id: role.id, unit_id: c11.id, password_hash: 'test-only' });
  const token = user => jwt.sign({ sub: String(user.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (path, user, method = 'GET', data) => {
    const res = await fetch(base + path, { method, headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), 'Content-Type': 'application/json' }, body: data && JSON.stringify(data) });
    const text = await res.text();
    assert(!/Sequelize|sqlMessage|password_hash|stack|DB_PASSWORD|ER_NO_SUCH_TABLE/i.test(text));
    return { status: res.status, body: JSON.parse(text) };
  };
  const expect = async (path, user, method, data, status) => { const r = await call(path, user, method, data); assert.equal(r.status, status, `${method} ${path}: ${r.status} ${r.body.message}`); return r.body.data; };
  try {
    const room = await Location.findOne({ where: { type: 'ROOM' } });
    assert(room);
    await expect('/locations', null, 'GET', null, 401);
    await expect('/locations', company, 'GET', null, 200);
    await expect('/locations/balance?unit_id=' + c13.id, company, 'GET', null, 403);
    await expect('/transfers/company-assets/' + c13.id, company, 'GET', null, 403);
    await expect('/transfers/company-assets/' + c11.id, company, 'GET', null, 200);
    await expect('/transfers/company-assets/' + c13.id + '/history', company, 'GET', null, 403);
    const data = { code, name: 'Phòng kiểm thử', type: 'ROOM', parent_location_id: room.parent_location_id, owner_unit_id: null, is_stock_holding: true, is_active: true };
    await expect('/locations', company, 'POST', data, 403);
    await expect('/locations/' + room.id, company, 'PUT', data, 403);
    await expect('/locations/' + room.id, company, 'DELETE', null, 403);
    await expect('/transfers', company, 'POST', { transfer_type: 'INTERNAL_TRANSFER' }, 403);
    const created = await expect('/locations', admin, 'POST', data, 201);
    await expect('/locations', admin, 'POST', data, 409);
    await expect('/locations/' + created.id, admin, 'PUT', { ...data, name: 'Phòng kiểm thử sửa' }, 200);
    await expect('/locations/' + created.id, admin, 'GET', null, 200);
    await expect('/locations/' + created.id, admin, 'DELETE', null, 200);
    // Shared room: scope cannot be inferred from its owner or its name.
    const shared = await Location.findOne({ where: { code: { [require('sequelize').Op.like]: 'P6F_%_PHONG_101' } }, order: [['id','DESC']] });
    assert(shared);
    const own = await expect('/locations/balance?location_id=' + shared.id, company, 'GET', null, 200);
    assert(own.length && own.every(r => String(r.unit_id) === String(c11.id)));
    const all = await expect('/locations/balance?location_id=' + shared.id, admin, 'GET', null, 200);
    assert(all.some(r => String(r.unit_id) === String(c13.id)));
    const scopeMaterial = all.find(r => String(r.unit_id) === String(c13.id)).material_id;
    const assets11 = await expect('/transfers/company-assets/' + c11.id + '?material_id=' + scopeMaterial, company, 'GET', null, 200);
    const assets13 = await expect('/transfers/company-assets/' + c13.id + '?material_id=' + scopeMaterial, admin, 'GET', null, 200);
    assert.equal(assets11[0]?.quantity, '4'); assert.equal(assets13[0]?.quantity, '2');
    const nameSearch = await expect('/transfers/company-assets/' + c11.id + '?search=' + encodeURIComponent(assets11[0].name), company, 'GET', null, 200);
    assert(nameSearch.some(r => String(r.id) === String(scopeMaterial)));
    const history11 = await expect('/transfers/company-assets/' + c11.id + '/history?material_id=' + scopeMaterial, company, 'GET', null, 200);
    const history13 = await expect('/transfers/company-assets/' + c13.id + '/history?material_id=' + scopeMaterial, admin, 'GET', null, 200);
    assert(history11.items.length && history13.items.length);
    assert(history11.items.every(e => String(e.unit_id) === String(c11.id) && e.location));
    assert(history13.items.every(e => String(e.unit_id) === String(c13.id) && e.location));
    assert(history13.items.some(e => String(e.location_id) === String(shared.id)));
    const otherOnly = await Location.findOne({ where: { code: { [require('sequelize').Op.like]: 'P6F_%_PHONG_103' } }, order: [['id','DESC']] });
    assert(otherOnly);
    // Latest fixture's room 103 contains only Unit 13; older rooms may have Unit 11 test assets.
    await expect('/locations/' + otherOnly.id, company, 'GET', null, 404);
    await expect('/locations/balance?location_id=' + otherOnly.id, company, 'GET', null, 404);
    await expect('/locations/balance?location_id=' + otherOnly.id + '&unit_id=' + c13.id, company, 'GET', null, 403);
    const used = { code: shared.code, name: shared.name, type: shared.type, parent_location_id: shared.parent_location_id, owner_unit_id: shared.owner_unit_id, is_stock_holding: true, is_active: false, note: shared.note };
    await expect('/locations/' + shared.id, admin, 'PUT', used, 409);
    await expect('/locations/' + shared.id, admin, 'PUT', { ...used, is_active: true, parent_location_id: room.parent_location_id }, 409);
    const preserved = await expect('/locations/' + shared.id, admin, 'GET', null, 200);
    assert.equal(preserved.is_active, true);
    assert.equal(String(preserved.parent_location_id), String(shared.parent_location_id));
    const building = await Location.findByPk(shared.parent_location_id);
    const parentBody = { code: building.code, name: building.name, type: building.type, parent_location_id: building.parent_location_id, owner_unit_id: building.owner_unit_id, is_stock_holding: false, is_active: false, note: building.note };
    await expect('/locations/' + building.id, admin, 'PUT', parentBody, 409);
    assert.equal((await Location.findByPk(building.id)).is_active, true);
    const from = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } });
    const target = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
    const material = await require('../src/models').Material.findOne({ where: { code: { [require('sequelize').Op.like]: 'P6F_%_A_0' } }, order: [['id','DESC']] });
    const source = await require('../src/models').MaterialSource.findOne();
    const condition = await require('../src/models').ConditionLevel.findOne();
    const date = new Date().toISOString().slice(0,10);
    const legacy = { code: code+'_LEGACY', transfer_type: 'ISSUE', transfer_date: date, company_unit_id: c11.id, items: [{ material_id: material.id, source_id: source.id, condition_id: condition.id, quantity: 1 }] };
    const before = await StockLedgerEntry.count();
    await expect('/transfers', admin, 'POST', { ...legacy, code: code+'_FROM', from_location_id: from.id }, 400);
    await expect('/transfers', admin, 'POST', { ...legacy, code: code+'_ITEM', items: [{ ...legacy.items[0], location_id: shared.id }] }, 400);
    await expect('/transfers', admin, 'POST', { ...legacy, code: code+'_ZERO', items: [{ ...legacy.items[0], quantity: 0 }] }, 400);
    await expect('/transfers', admin, 'POST', { ...legacy, code: code+'_NEG', items: [{ ...legacy.items[0], quantity: -1 }] }, 400);
    const draftLegacy = await expect('/transfers', admin, 'POST', legacy, 201);
    assert.equal(String(draftLegacy.to_location_id), String(target.id));
    assert.equal(await StockLedgerEntry.count(), before, 'Legacy DRAFT cannot change ledger');
    await expect('/transfers/' + draftLegacy.id, admin, 'DELETE', null, 200);
    await expect('/transfers', admin, 'POST', { code: code + '_SPOOF', transfer_type: 'INTERNAL_TRANSFER', transfer_date: '2026-10-01', company_unit_id: c11.id, from_location_id: room.id, to_location_id: room.id, items: [{ material_id: 1, source_id: 1, quantity: 1, unit_id: c13.id }] }, 400);
    assert.equal(await StockTransfer.count({ where: { code: code + '_SPOOF' } }), 0);
    assert.equal(await StockLedgerEntry.count(), before);
    // HTTP race against one balance; then force failure after the first ledger insert.
    const { Material, StockTransferItem } = require('../src/models');
    const raceMaterial = await Material.create({ code: code+'_RACE', name: 'Quạt cạnh tranh HTTP', category_id: material.category_id, unit_id: material.unit_id });
    await StockLedgerEntry.create({ unit_id: root.id, location_id: from.id, material_id: raceMaterial.id, source_id: source.id, condition_id: condition.id, quantity_delta: 10, transaction_type: 'OPENING_BALANCE', reference_type: 'PHASE6_HTTP_FIXTURE', reference_id: raceMaterial.id, occurred_at: new Date(), created_by: admin.id });
    const doc = (suffix, type, origin, destination, quantity) => ({ code: code+suffix, transfer_type: type, transfer_date: date, company_unit_id: c11.id, ...(origin ? { from_location_id: origin } : {}), to_location_id: destination, items: [{ material_id: raceMaterial.id, source_id: source.id, condition_id: condition.id, quantity }] });
    const issued = await expect('/transfers', admin, 'POST', doc('_RISS','ISSUE',null,target.id,10), 201);
    const racePost = path => call('/transfers/'+path+'/post', admin, 'POST', {});
    const double = await Promise.all([racePost(issued.id),racePost(issued.id)]);
    assert.deepEqual(double.map(r => r.status).sort(),[200,409]);
    const first = await expect('/transfers', admin, 'POST', doc('_R1','INTERNAL_TRANSFER',target.id,shared.id,8), 201);
    const second = await expect('/transfers', admin, 'POST', doc('_R2','INTERNAL_TRANSFER',target.id,shared.id,8), 201);
    const competing = await Promise.all([racePost(first.id),racePost(second.id)]);
    assert.deepEqual(competing.map(r => r.status).sort(),[200,409]);
    const winner = competing[0].status === 200 ? first : second;
    const loser = competing[0].status === 409 ? first : second;
    assert.equal(await StockLedgerEntry.count({ where: { reference_type: 'STOCK_TRANSFER', reference_id: loser.id } }),0);
    assert.equal((await StockTransfer.findByPk(loser.id)).status,'DRAFT');
    const failDoc = await expect('/transfers', admin, 'POST', doc('_ROLL','INTERNAL_TRANSFER',target.id,shared.id,1), 201);
    let inserts = 0;
    StockLedgerEntry.addHook('beforeCreate','phase6HttpRollback', () => { if (++inserts === 2) throw Error('Injected HTTP ledger failure') });
    try { await expect('/transfers/'+failDoc.id+'/post',admin,'POST',{},500); }
    finally { StockLedgerEntry.removeHook('beforeCreate','phase6HttpRollback') }
    assert.equal(await StockLedgerEntry.count({ where: { reference_type: 'STOCK_TRANSFER', reference_id: failDoc.id } }),0);
    assert.equal((await StockTransfer.findByPk(failDoc.id)).status,'DRAFT');
    await expect('/transfers/'+winner.id,admin,'DELETE',null,409);
    await expect('/transfers/'+winner.id,admin,'PATCH',doc('_CHANGED','INTERNAL_TRANSFER',target.id,shared.id,1),409);
    await expect('/transfers/'+winner.id+'/post',admin,'POST',{},409);
    const transactions = await StockLedgerEntry.findAll({ where: { reference_type: 'STOCK_TRANSFER', reference_id: winner.id } });
    assert.equal(transactions.length,2);
    assert(transactions.every(e => String(e.unit_id) === String(c11.id) && String(e.source_id) === String(source.id) && String(e.condition_id) === String(condition.id)));
    assert.equal((await StockLedgerEntry.findAll({ where: { unit_id: c11.id, location_id: target.id, material_id: raceMaterial.id } })).reduce((n,e)=>n+Number(e.quantity_delta),0),2);
    console.log('Phase 6 HTTP RBAC/CRUD/scope/race/rollback PASS');
  } finally { server.close(); await sequelize.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 });
