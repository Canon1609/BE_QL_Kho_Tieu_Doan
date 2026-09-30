// Run only with DB_NAME=ql_kho_tieu_doan_5_phase3_test; never changes development data.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { sequelize, Role, Unit, User } = require('../src/models');
const { jwtConfig } = require('../src/services/auth.service');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase3_test');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  let battalion, company;
  const request = async (path, token, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, json: await response.json() };
  };
  const token = user => jwt.sign({ sub: String(user.id), ver: user.auth_version }, jwtConfig().secret, { expiresIn: '10m' });
  const code = `P3_${Date.now()}`;
  let categoryId, unitId, materialId;
  try {
    const [root, co, br, cr] = await Promise.all([Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), Role.findOne({ where: { code: 'COMPANY_ADMIN' } })]);
    battalion = await User.create({ username: code + '_b', full_name: 'Thử danh mục', password_hash: 'fixture', role_id: br.id, unit_id: root.id });
    company = await User.create({ username: code + '_c', full_name: 'Thử Đại đội', password_hash: 'fixture', role_id: cr.id, unit_id: co.id });
    const a = token(battalion), c = token(company);
    const expect = async (path, t, method, body, status) => { const r = await request(path, t, method, body); assert.equal(r.status, status, `${method} ${path}: ${r.status} ${JSON.stringify(r.json)}`); assert.equal(JSON.stringify(r.json).includes('Sequelize'), false); return r.json.data; };
    await expect('/catalog/materials', null, 'GET', null, 401);
    for (const kind of ['categories', 'units', 'materials']) {
      await expect(`/catalog/${kind}`, c, 'GET', null, 200);
      await expect(`/catalog/${kind}`, c, 'POST', { code: code, name: 'Không được sửa' }, 403);
      await expect(`/catalog/${kind}/1`, c, 'PATCH', { name: 'Không được sửa' }, 403);
      await expect(`/catalog/${kind}/1/status`, c, 'PATCH', { is_active: false }, 403);
      await expect(`/catalog/${kind}/1`, c, 'DELETE', null, 403);
    }
    const cat = await expect('/catalog/categories', a, 'POST', { code: code + '_CAT', name: 'Loại thử' }, 201); categoryId = cat.id;
    const unit = await expect('/catalog/units', a, 'POST', { code: code + '_UNIT', name: 'Bộ thử' }, 201); unitId = unit.id;
    for (const [kind, id] of [['categories', categoryId], ['units', unitId]]) {
      await expect(`/catalog/${kind}/${id}`, c, 'GET', null, 200);
      await expect(`/catalog/${kind}/${id}`, a, 'PATCH', { name: 'Đã sửa' }, 200);
      await expect(`/catalog/${kind}/${id}/status`, a, 'PATCH', { is_active: false }, 200);
      await expect(`/catalog/${kind}/${id}/status`, a, 'PATCH', { is_active: true }, 200);
    }
    await expect('/catalog/categories', a, 'POST', { code: code + '_CAT', name: 'Trùng' }, 409);
    await expect('/catalog/categories', a, 'POST', { code: code + '_EMPTY' }, 400);
    await expect('/catalog/units', a, 'POST', { code: 'mã sai', name: 'Sai' }, 400);
    await expect('/catalog/materials?page=0', a, 'GET', null, 400);
    await expect('/catalog/materials?limit=101', a, 'GET', null, 400);
    await expect('/catalog/materials', a, 'POST', { code, name: 'Không hợp lệ', category_id: '999999999', unit_id: unitId }, 400);
    await expect('/catalog/materials', a, 'POST', { code, name: 'Không hợp lệ', category_id: categoryId, unit_id: unitId, quantity: 999 }, 400);
    const material = await expect('/catalog/materials', a, 'POST', { code, name: 'Quân phục nam thử', category_id: categoryId, unit_id: unitId }, 201); materialId = material.id;
    assert.equal(Object.hasOwn(material, 'quantity'), false);
    await expect('/catalog/materials', a, 'POST', { code, name: 'Trùng', category_id: categoryId, unit_id: unitId }, 409);
    await expect('/catalog/categories/' + categoryId, a, 'DELETE', null, 409);
    await expect('/catalog/units/' + unitId, a, 'DELETE', null, 409);
    await expect('/catalog/materials/' + materialId, c, 'GET', null, 200);
    const found = await expect('/catalog/materials?search=Qu%C3%A2n%20ph%E1%BB%A5c&category_id=' + categoryId + '&is_active=true&page=1&limit=20', c, 'GET', null, 200);
    assert.equal(found.items.some(m => m.id === materialId), true);
    await expect('/catalog/materials/' + materialId, a, 'PATCH', { name: 'Quân phục nam sửa', stock: 123 }, 400);
    await expect('/catalog/categories/' + categoryId + '/status', a, 'PATCH', { is_active: false }, 200);
    await expect('/catalog/materials/' + materialId, a, 'PATCH', { category_id: categoryId }, 200);
    await expect('/catalog/materials', a, 'POST', { code: code + '_OFF', name: 'Sai', category_id: categoryId, unit_id: unitId }, 400);
    await expect('/catalog/categories/' + categoryId + '/status', a, 'PATCH', { is_active: true }, 200);
    await expect('/catalog/materials/' + materialId, a, 'PATCH', { name: 'Quân phục nam sửa' }, 200);
    await expect('/catalog/materials/' + materialId + '/status', a, 'PATCH', { is_active: false }, 200);
    await expect('/catalog/materials/' + materialId + '/status', a, 'PATCH', { is_active: true }, 200);
    await expect('/catalog/materials/' + materialId, a, 'DELETE', null, 200); materialId = null;
    await expect('/catalog/categories/' + categoryId, a, 'DELETE', null, 200); categoryId = null;
    await expect('/catalog/units/' + unitId, a, 'DELETE', null, 200); unitId = null;
    const qi = sequelize.getQueryInterface();
    for (const table of ['material_categories', 'units_of_measure', 'material_sources', 'condition_levels', 'materials']) {
      const description = await qi.describeTable(table);
      assert.equal('quantity' in description, false);
      const options = await sequelize.query(`SHOW TABLE STATUS LIKE '${table}'`);
      assert.match(options[0][0].Collation, /^utf8mb4/);
    }
    const [indexes, fks] = await Promise.all([qi.showIndex('materials'), qi.getForeignKeyReferencesForTable('materials')]);
    for (const field of ['code', 'name', 'category_id', 'unit_id']) assert(indexes.some(i => i.fields.some(f => f.attribute === field)));
    assert.equal(fks.filter(f => ['category_id', 'unit_id'].includes(f.columnName)).length, 2);
    const [rules] = await sequelize.query("SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'");
    assert.equal(rules.filter(rule => rule.DELETE_RULE === 'RESTRICT').length, 2);
    for (const [table, count] of [['material_categories', 3], ['units_of_measure', 3], ['material_sources', 5], ['condition_levels', 7]]) {
      const [rows] = await sequelize.query(`SELECT COUNT(*) AS n, COUNT(DISTINCT code) AS distinct_codes FROM ${table}`);
      assert.equal(Number(rows[0].n), count); assert.equal(Number(rows[0].distinct_codes), count);
    }
    console.log('PASS: migrate/seed schema metadata, HTTP CRUD, read-only RBAC, rejection of stock payload, FK RESTRICT and safe 409');
  } finally {
    // Clean up only records created in this test DB by this script.
    if (materialId) await sequelize.query('DELETE FROM materials WHERE id = :id', { replacements: { id: materialId } });
    if (categoryId) await sequelize.query('DELETE FROM material_categories WHERE id = :id', { replacements: { id: categoryId } });
    if (unitId) await sequelize.query('DELETE FROM units_of_measure WHERE id = :id', { replacements: { id: unitId } });
    if (company) await company.destroy();
    if (battalion) await battalion.destroy();
    server.close(); await sequelize.close();
  }
}
main().catch(err => { console.error('Phase 3 test failed:', err.message); process.exitCode = 1; });
