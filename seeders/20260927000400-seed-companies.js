"use strict";

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      const options = { transaction };
      const [roots] = await sequelize.query('SELECT id FROM units WHERE code = :code AND type = :type AND parent_id IS NULL AND is_active = 1 LIMIT 1', { ...options, replacements: { code: 'BATTALION_5', type: 'BATTALION' } });
      if (!roots.length) throw new Error('Seed the active battalion root before companies');
      const rootId = String(roots[0].id);
      const legacy = [1, 2, 3];
      const [oldUnits] = await sequelize.query('SELECT id, code, name, type, parent_id, is_active FROM units WHERE code IN (:codes) FOR UPDATE', { ...options, replacements: { codes: legacy.map(n => `COMPANY_${n}`) } });
      for (const row of oldUnits) {
        const number = legacy.find(n => row.code === `COMPANY_${n}`);
        if (!number || row.name !== `Đại đội ${number}` || row.type !== 'COMPANY' || String(row.parent_id) !== rootId || !row.is_active) {
          throw new Error('Old company data differs from Phase 2 fixtures; manual review required');
        }
        const [users] = await sequelize.query('SELECT id FROM users WHERE unit_id = :id LIMIT 1', { ...options, replacements: { id: row.id } });
        const [children] = await sequelize.query('SELECT id FROM units WHERE parent_id = :id LIMIT 1', { ...options, replacements: { id: row.id } });
        if (users.length || children.length) throw new Error('Old company has dependencies; manual review required');
      }
      // Only exact, unreferenced Phase 2 fixtures can be removed.
      if (oldUnits.length) await queryInterface.bulkDelete('units', { id: oldUnits.map(row => row.id) }, options);
      const companies = [11, 12, 13].map(n => ({ code: `COMPANY_${n}`, name: `Đại đội ${n}` }));
      const [existing] = await sequelize.query('SELECT code, name, type, parent_id, is_active FROM units WHERE code IN (:codes) FOR UPDATE', { ...options, replacements: { codes: companies.map(c => c.code) } });
      for (const row of existing) {
        const expected = companies.find(c => c.code === row.code);
        if (row.name !== expected.name || row.type !== 'COMPANY' || String(row.parent_id) !== rootId || !row.is_active) {
          throw new Error('Existing company data differs from Phase 2 master data; manual review required');
        }
      }
      const codes = new Set(existing.map(row => row.code));
      const now = new Date();
      const rows = companies.filter(c => !codes.has(c.code)).map(c => ({ ...c, type: 'COMPANY', parent_id: roots[0].id, is_active: true, created_at: now, updated_at: now }));
      if (rows.length) await queryInterface.bulkInsert('units', rows, options);
    });
  },
  // Do not delete master data when rolling back seeders.
  async down() {},
};
