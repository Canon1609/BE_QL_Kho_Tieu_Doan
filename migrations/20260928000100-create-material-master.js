"use strict";

module.exports = {
  async up(q, S) {
    const timestamps = () => ({
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') },
    });
    const base = () => ({
      id: { type: S.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
      code: { type: S.STRING(64), allowNull: false, unique: true },
      name: { type: S.STRING(150), allowNull: false },
      description: { type: S.TEXT, allowNull: true },
      is_active: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
    });
    for (const table of ['material_categories', 'units_of_measure', 'material_sources', 'condition_levels']) {
      await q.createTable(table, { ...base(), ...(table === 'condition_levels' ? { scope: { type: S.STRING(64), allowNull: false, defaultValue: 'GENERAL' } } : {}) });
    }
    await q.createTable('materials', {
      ...base(),
      category_id: { type: S.BIGINT.UNSIGNED, allowNull: false, references: { model: 'material_categories', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
      unit_id: { type: S.BIGINT.UNSIGNED, allowNull: false, references: { model: 'units_of_measure', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
    });
    await q.addIndex('materials', ['category_id']);
    await q.addIndex('materials', ['unit_id']);
    await q.addIndex('materials', ['name']);
  },
  async down(q) {
    await q.dropTable('materials');
    for (const table of ['condition_levels', 'material_sources', 'units_of_measure', 'material_categories']) await q.dropTable(table);
  },
};
