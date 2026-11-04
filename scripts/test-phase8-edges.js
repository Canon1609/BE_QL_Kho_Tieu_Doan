// Additive tests ONLY on the isolated Phase 8 database. Never run on development.
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Only isolated Phase 8 test DB');
const assert = require('node:assert/strict');
const { sequelize, Unit, User, Material, MaterialCategory, UnitOfMeasure, MaterialSource, Location, StockLedgerEntry: Ledger } = require('../src/models');
const search = require('../src/services/search.service');
async function main() {
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const co = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const actor = { role: { code: 'BATTALION_ADMIN' }, unit: root, unit_id: root.id };
  const company = { role: { code: 'COMPANY_ADMIN' }, unit: co, unit_id: co.id };
  const [author, category, measure, source, warehouse] = await Promise.all([
    User.findOne({ where: { username: 'phase8_fixture_author' } }), MaterialCategory.findOne({ where: { code: 'P8_CATEGORY' } }),
    UnitOfMeasure.findOne({ where: { code: 'P8_CAI' } }), MaterialSource.findOne({ where: { code: 'P8_CAP' } }),
    Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } }),
  ]);
  assert([root, co, author, category, measure, source, warehouse].every(Boolean));
  async function fixture(code, delta, ref, unit, place) {
    const [m] = await Material.findOrCreate({ where: { code }, defaults: { name: `Kiểm thử biên ${code}`, category_id: category.id, unit_id: measure.id } });
    await Ledger.findOrCreate({ where: { reference_type: 'P8_EDGE_FIXTURE', reference_id: ref, material_id: m.id }, defaults: {
      unit_id: unit.id, location_id: place?.id ?? null, material_id: m.id, source_id: source.id, condition_id: null,
      borrow_line_id: null, quantity_delta: delta, transaction_type: 'OPENING_BALANCE', reference_type: 'P8_EDGE_FIXTURE',
      reference_id: ref, occurred_at: new Date('2026-10-07T01:00:00Z'), created_by: author.id,
    } });
    return m;
  }
  const negative = await fixture('P8_NEGATIVE', '-3', 9001, root, warehouse);
  const huge = await fixture('P8_BIGINT', '9007199254740993', 9002, root, warehouse);
  // Two NULL dimension combinations for different Units; NULL location must never leak to the other Unit.
  const legacyRoot = await fixture('P8_NULL_ROOT', '7', 9003, root, null);
  const legacyCompany = await fixture('P8_NULL_COMPANY', '9', 9004, co, null);
  for (const [m, user, expected] of [[negative, actor, '-3'], [huge, actor, '9007199254740993'],
    [legacyRoot, actor, '7'], [legacyCompany, company, '9']]) {
    const id = String(m.id), list = await search.list({ search: m.code }, user);
    assert.equal(list.total, 1); assert.equal(list.items[0].physical, expected);
    assert.equal((await search.detail(id, {}, user)).totals.physical, expected);
    assert.equal((await search.history(id, {}, user)).items[0].quantity_delta, expected);
  }
  assert.equal((await search.list({ search: 'P8_NULL_ROOT' }, company)).total, 0);
  const rootWarehouseDetail = await search.detail(String(legacyRoot.id), { location_id: String(warehouse.id) }, actor);
  assert.equal(rootWarehouseDetail.totals.physical, '7');
  const companyStore = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
  assert.equal((await search.detail(String(legacyCompany.id), { location_id: String(companyStore.id), condition_id: 'null' }, company)).totals.physical, '9');
  console.log('Phase 8 negative/BIGINT/NULL dimensions service PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
