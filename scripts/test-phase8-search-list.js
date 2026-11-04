const assert = require('node:assert/strict');
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
const { sequelize, Unit, Material, Location, MaterialSource, ConditionLevel } = require('../src/models');
const search = require('../src/services/search.service');
async function main() {
  const refs = async (model, code) => (await model.findOne({ where: { code } })).id;
  const [root, co, other, material, zero, fresh, room, source, good] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }),
    Unit.findOne({ where: { code: 'COMPANY_12' } }), Material.findOne({ where: { code: 'P8_QUAT' } }),
    Material.findOne({ where: { code: 'P8_ZERO' } }), Material.findOne({ where: { code: 'P8_NEW' } }),
    Location.findOne({ where: { code: 'P8_SHARED' } }), MaterialSource.findOne({ where: { code: 'P8_CAP' } }),
    ConditionLevel.findOne({ where: { code: 'P8_GOOD' } }),
  ]);
  assert([root, co, other, material, zero, fresh, room, source, good].every(Boolean), 'Fixture missing');
  const admin = { role: { code: 'BATTALION_ADMIN' }, unit: root, unit_id: root.id };
  const company = { role: { code: 'COMPANY_ADMIN' }, unit: co, unit_id: co.id };
  const [adminUnits, companyUnits] = await Promise.all([search.units(admin), search.units(company)]);
  assert(adminUnits.some(u => String(u.id) === String(other.id)));
  assert.deepEqual(companyUnits.map(u => u.id), [String(co.id)]);
  await assert.rejects(() => search.list({ unit_id: String(other.id) }, company), e => e.statusCode === 403);
  const list = await search.list({ search: 'P8_QUAT' }, admin);
  assert.deepEqual([list.items[0].physical, list.items[0].available, list.items[0].borrowed], ['12', '9', '3']);
  const own = await search.list({ search: 'P8_QUAT' }, company);
  assert.deepEqual([own.items[0].physical, own.items[0].available, own.items[0].borrowed], ['3', '0', '3']);
  const roomOwn = await search.list({ location_id: String(room.id) }, company);
  assert.deepEqual(roomOwn.items.map(item => item.code), ['P8_QUAT']);
  assert.equal(roomOwn.items[0].physical, '1');
  const filtered = await search.list({ source_id: String(source.id), condition_id: String(good.id), search: 'P8_QUAT' }, admin);
  assert.equal(filtered.items[0].physical, '10');
  const nullCondition = await search.list({ condition_id: 'null', search: 'P8_QUAT' }, admin);
  assert.equal(nullCondition.total, 0);
  const zeros = await search.list({ include_zero: 'true', search: 'P8_' }, admin);
  assert(zeros.total > 20);
  const zeroRow = (await search.list({ include_zero: 'true', search: 'P8_ZERO' }, admin)).items[0];
  assert.equal(zeroRow.physical, '0');
  assert.equal((await search.list({ search: 'P8_ZERO' }, admin)).total, 0);
  assert.equal((await search.list({ include_zero: 'true', search: 'P8_NEW' }, admin)).total, 0);
  assert.equal((await search.list({ search: 'P8_%' }, admin)).total, 0, 'LIKE wildcard escaped');
  const page2 = await search.list({ include_zero: 'true', page: '2', sort: 'physical', direction: 'desc' }, admin);
  assert(page2.items.length > 0 && page2.items.length <= 20);
  for (const actor of [admin, company]) {
    const page = await search.list({}, actor);
    for (const item of page.items) assert.equal(BigInt(item.physical), BigInt(item.available) + BigInt(item.borrowed));
    assert(page.items.every(item => BigInt(item.physical) !== 0n));
  }
  console.log('Phase 8 search list fixture/scope/zero/filter/pagination PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
