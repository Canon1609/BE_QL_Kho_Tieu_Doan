module.exports = (sequelize, DataTypes) => sequelize.define("Unit", {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(150), allowNull: false },
  type: { type: DataTypes.STRING(64), allowNull: false },
  parent_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: "units", indexes: [{ fields: ["parent_id"] }] });
