"use strict";

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [existing] = await queryInterface.sequelize.query("SELECT code FROM roles WHERE code IN ('BATTALION_ADMIN', 'COMPANY_ADMIN')");
    const existingCodes = new Set(existing.map((row) => row.code));
    const rows = [
      { code: "BATTALION_ADMIN", name: "Quản trị Tiểu đoàn", description: null, created_at: now, updated_at: now },
      { code: "COMPANY_ADMIN", name: "Quản trị Đại đội", description: null, created_at: now, updated_at: now },
    ].filter((role) => !existingCodes.has(role.code));
    if (rows.length) await queryInterface.bulkInsert("roles", rows);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete("roles", { code: ["BATTALION_ADMIN", "COMPANY_ADMIN"] });
  },
};
