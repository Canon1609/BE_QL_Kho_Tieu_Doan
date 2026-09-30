module.exports = (sequelize, DataTypes) => {
  const fields = {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.TEXT },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  };
  const MaterialCategory = sequelize.define('MaterialCategory', fields, { tableName: 'material_categories' });
  const UnitOfMeasure = sequelize.define('UnitOfMeasure', fields, { tableName: 'units_of_measure' });
  const MaterialSource = sequelize.define('MaterialSource', fields, { tableName: 'material_sources' });
  const ConditionLevel = sequelize.define('ConditionLevel', {
    ...fields, scope: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'GENERAL' },
  }, { tableName: 'condition_levels' });
  const Material = sequelize.define('Material', {
    ...fields,
    category_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    unit_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  }, { tableName: 'materials', indexes: [{ fields: ['category_id'] }, { fields: ['unit_id'] }, { fields: ['name'] }] });
  MaterialCategory.hasMany(Material, { foreignKey: 'category_id', as: 'materials', onDelete: 'RESTRICT' });
  Material.belongsTo(MaterialCategory, { foreignKey: 'category_id', as: 'category', onDelete: 'RESTRICT' });
  UnitOfMeasure.hasMany(Material, { foreignKey: 'unit_id', as: 'materials', onDelete: 'RESTRICT' });
  Material.belongsTo(UnitOfMeasure, { foreignKey: 'unit_id', as: 'unit', onDelete: 'RESTRICT' });
  return { MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, Material };
};
