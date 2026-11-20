'use strict';

// Additive master-data seed. Run only against the explicitly approved test DB.
// Never rewrites existing conditions or maps H1-H4/B/C/D to DAMAGED.
module.exports = {
  async up(q) {
    await q.sequelize.transaction(async transaction => {
      const [byCode] = await q.sequelize.query(
        'SELECT id, name, scope FROM condition_levels WHERE code = :code LIMIT 1',
        { replacements: { code: 'DAMAGED' }, transaction },
      );
      const [byName] = await q.sequelize.query(
        'SELECT id, code, scope FROM condition_levels WHERE name = :name LIMIT 1',
        { replacements: { name: 'Hỏng' }, transaction },
      );
      if (byCode.length) {
        if (byCode[0].name !== 'Hỏng' || byCode[0].scope !== 'GENERAL') {
          throw new Error('Existing DAMAGED condition conflicts with approved definition; refusing to overwrite');
        }
        if (byName.some(row => String(row.id) !== String(byCode[0].id))) {
          throw new Error('Another condition already uses the approved display name Hỏng');
        }
        return;
      }
      if (byName.length) throw new Error('Condition name Hỏng already exists under another code; refusing to create duplicate');
      await q.bulkInsert('condition_levels', [{
        code: 'DAMAGED', name: 'Hỏng', scope: 'GENERAL', is_active: true,
        created_at: new Date(), updated_at: new Date(),
      }], { transaction });
    });
  },
  // Intentionally non-destructive; condition rows may already be referenced.
  async down() {},
};
