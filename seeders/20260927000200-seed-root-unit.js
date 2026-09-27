"use strict";

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query("SELECT code FROM units WHERE code = 'BATTALION_5'");
    if (existing.length) return;
    const now = new Date();
    await queryInterface.bulkInsert("units", [{ code: "BATTALION_5", name: "Tiểu đoàn 5", type: "BATTALION", parent_id: null, is_active: true, created_at: now, updated_at: now }]);
  },
  async down(queryInterface) { await queryInterface.bulkDelete("units", { code: "BATTALION_5" }); },
};
