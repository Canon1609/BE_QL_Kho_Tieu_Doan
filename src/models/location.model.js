module.exports = (sequelize, D, Unit) => {
  const Location = sequelize.define('Location', {
    id: { type: D.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    code: { type: D.STRING(64), allowNull: false, unique: true },
    name: { type: D.STRING(150), allowNull: false }, type: { type: D.STRING(64), allowNull: false },
    parent_location_id: D.BIGINT.UNSIGNED, owner_unit_id: D.BIGINT.UNSIGNED,
    is_stock_holding: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
    is_active: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
  }, { tableName: 'locations' });
  Location.belongsTo(Location, { foreignKey: 'parent_location_id', as: 'parent', onDelete: 'RESTRICT' });
  Location.hasMany(Location, { foreignKey: 'parent_location_id', as: 'children', onDelete: 'RESTRICT' });
  Location.belongsTo(Unit, { foreignKey: 'owner_unit_id', as: 'ownerUnit', onDelete: 'RESTRICT' });
  return Location;
};
