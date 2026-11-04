// Explicit test-only bootstrap. Never run against a development or production database.
const { sequelize, Role, Unit, User, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel } = require('../src/models');
const bcrypt = require('bcryptjs');
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
async function main() {
  const tables = await sequelize.getQueryInterface().showAllTables();
  for (const name of ['roles', 'units', 'users', 'materials', 'stock_ledger_entries'])
    if (!tables.some(table => String(table).toLowerCase() === name)) throw Error(`Migration còn thiếu: ${name}`);
  const [battalion] = await Role.findOrCreate({ where: { code: 'BATTALION_ADMIN' }, defaults: { name: 'Quản trị Tiểu đoàn' } });
  const [company] = await Role.findOrCreate({ where: { code: 'COMPANY_ADMIN' }, defaults: { name: 'Quản trị Đại đội' } });
  const [root] = await Unit.findOrCreate({ where: { code: 'BATTALION_5' }, defaults: { name: 'Tiểu đoàn 5', type: 'BATTALION', is_active: true } });
  for (const number of [11, 12, 13]) await Unit.findOrCreate({ where: { code: `COMPANY_${number}` },
    defaults: { name: `Đại đội ${number}`, type: 'COMPANY', parent_id: root.id, is_active: true } });
  const masters = [
    [MaterialCategory, 'P8_CATEGORY', 'Doanh trại thử Phase 8'],
    [UnitOfMeasure, 'P8_CAI', 'Chiếc'], [UnitOfMeasure, 'P8_BO', 'Bộ'],
    [MaterialSource, 'P8_CAP', 'Nhận cấp thử Phase 8'], [MaterialSource, 'P8_MUON', 'Mượn cấp trên thử Phase 8'],
    [ConditionLevel, 'P8_GOOD', 'Tốt thử Phase 8'], [ConditionLevel, 'P8_BAD', 'Cũ thử Phase 8'],
  ];
  for (const [model, code, name] of masters) await model.findOrCreate({ where: { code }, defaults: { name, is_active: true, ...(model === ConditionLevel ? { scope: 'GENERAL' } : {}) } });
  // Generate credentials only if an authenticated browser test was explicitly requested.
  // Do not log, persist, or include credentials in repository files.
  const password = process.env.PHASE8_TEST_PASSWORD;
  if (password) {
    if (password.length < 12) throw Error('PHASE8_TEST_PASSWORD phải dài tối thiểu 12 ký tự');
    const hash = await bcrypt.hash(password, 10);
    for (const [role, unit, name] of [[battalion, root, 'TĐ'], ...await Promise.all([11, 12, 13].map(async n => [company, await Unit.findOne({ where: { code: `COMPANY_${n}` } }), `ĐĐ${n}`]))]) {
      await User.findOrCreate({ where: { username: `phase8_${role.code}_${unit.code}`.toLowerCase() }, defaults: {
        password_hash: hash, full_name: `Kiểm thử ${name} Phase 8`, role_id: role.id, unit_id: unit.id, is_active: true,
      } });
    }
  }
  console.log('Phase 8 test-only reference data ready; test users:', password ? 'created if absent (no credentials printed)' : 'not created');
}
main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => sequelize.close());
