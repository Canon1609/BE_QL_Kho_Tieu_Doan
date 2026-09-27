module.exports = (sequelize, DataTypes) => sequelize.define("User", {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  full_name: { type: DataTypes.STRING(150), allowNull: false },
  role_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  unit_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  last_login_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: "users", indexes: [{ fields: ["role_id"] }, { fields: ["unit_id"] }] });
