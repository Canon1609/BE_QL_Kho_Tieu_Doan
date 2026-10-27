'use strict';

// Register unit master data only. Never changes existing units or creates users/locations.
// Execute only against an explicitly approved database after verifying its identity.
const expected = [
  { code: 'BATTALION_HQ', name: 'Nhà BCH', type: 'BATTALION_HQ' },
  { code: 'KITCHEN', name: 'Nhà bếp', type: 'KITCHEN' },
];
module.exports = {
  async up(queryInterface) {
    const db = queryInterface.sequelize;
    await db.transaction(async transaction => {
      const options = { transaction };
      const [roots] = await db.query("SELECT id FROM units WHERE code = 'BATTALION_5' AND type = 'BATTALION' AND parent_id IS NULL AND is_active = 1 FOR UPDATE", options);
      if (roots.length !== 1) throw new Error('Không xác định duy nhất Tiểu đoàn 5 đang hoạt động; dừng đăng ký đơn vị.');
      const rootId = String(roots[0].id);
      for (const unit of expected) {
        const [rows] = await db.query('SELECT id, code, name, type, parent_id, is_active FROM units WHERE code = :code FOR UPDATE', { ...options, replacements: { code: unit.code } });
        if (rows.length > 1) throw new Error(`Mã đơn vị bị trùng: ${unit.code}`);
        if (rows.length) {
          const row = rows[0];
          if (row.name !== unit.name || row.type !== unit.type || String(row.parent_id) !== rootId || !row.is_active) {
            throw new Error(`Đơn vị ${unit.code} đã tồn tại nhưng thông tin không khớp; không tự sửa.`);
          }
          continue;
        }
        const now = new Date();
        await queryInterface.bulkInsert('units', [{ ...unit, parent_id: roots[0].id, is_active: true, created_at: now, updated_at: now }], options);
      }
    });
  },
  async down() {},
};
