"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("users", {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      username: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      full_name: { type: Sequelize.STRING(150), allowNull: false },
      role_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, references: { model: "roles", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      unit_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, references: { model: "units", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("users", ["role_id"]);
    await queryInterface.addIndex("users", ["unit_id"]);
  },
  async down(queryInterface) { await queryInterface.dropTable("users"); },
};
