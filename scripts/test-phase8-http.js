const assert = require('node:assert/strict');
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, User, Unit, Material, Location } = require('../src/models');
async function main() {
  const [root, company, other, material, zero, unknown, room, foreignRoom] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }),
    Unit.findOne({ where: { code: 'COMPANY_12' } }), Material.findOne({ where: { code: 'P8_QUAT' } }),
    Material.findOne({ where: { code: 'P8_ZERO' } }), Material.findOne({ where: { code: 'P8_NEW' } }),
    Location.findOne({ where: { code: 'P8_SHARED' } }), Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } }),
  ]);
  const [admin, co] = await Promise.all([
    User.findOne({ where: { unit_id: root.id, is_active: true } }), User.findOne({ where: { unit_id: company.id, is_active: true } }),
  ]);
  assert(admin && co, 'Create test-only users with PHASE8_TEST_PASSWORD first');
  const token = user => jwt.sign({ sub: String(user.id), ver: user.auth_version }, jwtConfig().secret, { expiresIn: '5m' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1/search/materials`;
  async function request(user, path = '', method = 'GET', overrideToken) {
    const auth = overrideToken === undefined ? user && token(user) : overrideToken;
    const res = await fetch(base + path, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
    const body = await res.json();
    return { status: res.status, ...body };
  }
  try {
    for (const path of ['', '/units', `/${material.id}`, `/${material.id}/history`]) {
      assert.equal((await request(null, path)).status, 401, `unauth ${path}`);
      assert.equal((await request(null, path, 'GET', jwt.sign({ sub: String(admin.id), ver: admin.auth_version }, jwtConfig().secret, { expiresIn: -1 }))).status, 401, `expired ${path}`);
    }
    // Create an isolated test-only role/user (no valid login password) to verify middleware, no production role changes.
    const { Role } = require('../src/models');
    const [foreignRole] = await Role.findOrCreate({ where: { code: 'P8_DENIED_ROLE' }, defaults: { name: 'Vai trò bị chặn Phase 8' } });
    const [foreignUser] = await User.findOrCreate({ where: { username: 'phase8_denied_role' }, defaults: {
      full_name: 'Thử quyền chặn', password_hash: 'NOT_A_LOGIN', unit_id: company.id, role_id: foreignRole.id, is_active: true,
    } });
    for (const path of ['', '/units', `/${material.id}`, `/${material.id}/history`])
      assert.equal((await request(foreignUser, path)).status, 403, `forbidden role ${path}`);
    assert.equal((await request(co, `?unit_id=${other.id}`)).status, 403);
    assert.equal((await request(co, `/${material.id}?unit_id=${other.id}`)).status, 403);
    assert.equal((await request(co, `/${material.id}/history?unit_id=${other.id}`)).status, 403);
    assert.equal((await request(co, `?location_id=${foreignRoom.id}`)).status, 404);
    assert.equal((await request(co, `/${material.id}?location_id=${foreignRoom.id}`)).status, 404);
    assert.equal((await request(co, `/${material.id}/history?location_id=${foreignRoom.id}`)).status, 404);
    for (const path of ['?page=0', '?sort=unsafe', '?unit_id=0', '?unit_id=18446744073709551616', '?search=' + 'x'.repeat(101),
      '?location_id=18446744073709551616', '?search=%25_',
      `/${material.id}?condition_id=0`, `/${material.id}/history?from=2026-02-30`, `/${material.id}/history?from=2026-10-05&to=2026-10-04`,
      `/${material.id}/history?transaction_type=ISSUE%27`, `/${material.id}/history?page=1000000`])
      if (path === '?search=%25_') assert.equal((await request(admin, path)).data.total, 0);
      else assert.equal((await request(admin, path)).status, 400, path);
    assert.equal((await request(admin, `/${unknown.id}`)).status, 404);
    assert.equal((await request(co, `/${unknown.id}/history`)).status, 404);
    assert.equal((await request(admin, '/0')).status, 400);
    const list = await request(admin, '?search=P8_QUAT');
    assert.equal(list.status, 200, JSON.stringify(list));
    assert.deepEqual([list.data.items[0].physical, list.data.items[0].available, list.data.items[0].borrowed], ['12', '9', '3']);
    const own = await request(co, `?location_id=${room.id}`);
    assert.equal(own.data.items[0].physical, '1');
    assert.equal((await request(admin, `?search=P8_ZERO`)).data.total, 0);
    assert.equal((await request(admin, `?search=P8_ZERO&include_zero=true`)).data.items[0].id, String(zero.id));
    assert.equal((await request(admin, `?search=P8_NEW&include_zero=true`)).data.total, 0);
    assert.equal((await request(co, '/units')).data.length, 1);
    const legacy = await Material.findOne({ where: { code: 'P8_LEGACY' } });
    const store = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
    assert.equal((await request(co, `?location_id=${store.id}&search=P8_LEGACY`)).data.items[0].physical, '5');
    assert.equal((await request(co, `/${legacy.id}?location_id=${store.id}`)).data.totals.physical, '5');
    assert.equal((await request(co, `/${legacy.id}/history?location_id=${store.id}`)).data.total, 1);
    const detail = await request(co, `/${material.id}`);
    assert.deepEqual(detail.data.totals, { physical: '3', available: '0', borrowed: '3' });
    const history = await request(co, `/${material.id}/history?from=2026-10-03&to=2026-10-04`);
    assert.equal(history.data.total, 3);
    assert.equal((await request(co, `/${material.id}/history?transaction_type=RETURN`)).data.total, 1);
    assert.equal((await request(co, '', 'POST')).status, 404);
    console.log('Phase 8 HTTP list/detail/history RBAC/validation/zero/date PASS');
  } finally { server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
