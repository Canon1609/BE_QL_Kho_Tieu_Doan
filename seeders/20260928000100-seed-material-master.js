"use strict";

// Additive only: re-running never overwrites operator changes or removes records.
module.exports = {
  async up(q) {
    const data = {
      material_categories: [['QUAN_TRANG', 'Quân trang'], ['QUAN_NHU', 'Quân nhu'], ['DOANH_TRAI', 'Doanh trại']],
      units_of_measure: [['CAI', 'Cái'], ['BO', 'Bộ'], ['CAP', 'Cặp']],
      material_sources: [['NHAN_CAP', 'Nhận cấp'], ['MUON_CAP_TREN', 'Mượn cấp trên/Trung tâm'], ['TIEU_DOAN_MUA', 'Tiểu đoàn mua sắm'], ['TU_SAN_XUAT', 'Tự sản xuất'], ['KHAC', 'Khác']],
      condition_levels: [['H1', 'H1'], ['H2', 'H2'], ['H3', 'H3'], ['H4', 'H4'], ['B', 'B'], ['C', 'C'], ['D', 'D']],
    };
    await q.sequelize.transaction(async transaction => {
      for (const [table, entries] of Object.entries(data)) {
        for (const [code, name] of entries) {
          const [rows] = await q.sequelize.query(`SELECT id FROM ${table} WHERE code = :code LIMIT 1`, { replacements: { code }, transaction });
          if (!rows.length) await q.bulkInsert(table, [{ code, name, ...(table === 'condition_levels' ? { scope: code.startsWith('H') ? 'H' : 'BCD' } : {}), is_active: true, created_at: new Date(), updated_at: new Date() }], { transaction });
        }
      }
    });
  },
  // Master records may be referenced; rollback of seed must not delete them.
  async down() {},
};
