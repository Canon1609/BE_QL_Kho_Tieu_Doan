"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("units", {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      code: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(150), allowNull: false },
      type: { type: Sequelize.STRING(64), allowNull: false },
      parent_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true, references: { model: "units", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("units", ["parent_id"]);
  },
  async down(queryInterface) { await queryInterface.dropTable("units"); },
};
