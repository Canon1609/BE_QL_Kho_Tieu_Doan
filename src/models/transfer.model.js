module.exports = (sequelize, D, { Material, MaterialSource, ConditionLevel, Unit, User, StockLedgerEntry }) => {
  const StockTransfer = sequelize.define('StockTransfer', {
    id: { type: D.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true }, code: { type: D.STRING(64), allowNull: false, unique: true },
    transfer_type: { type: D.STRING(16), allowNull: false }, transfer_date: { type: D.DATEONLY, allowNull: false },
    from_unit_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, to_unit_id: { type: D.BIGINT.UNSIGNED, allowNull: false },
    from_location_id: D.BIGINT.UNSIGNED, to_location_id: D.BIGINT.UNSIGNED,
    status: { type: D.STRING(16), allowNull: false, defaultValue: 'DRAFT' }, document_no: D.STRING(120), note: D.TEXT,
    created_by: { type: D.BIGINT.UNSIGNED, allowNull: false }, posted_by: D.BIGINT.UNSIGNED, posted_at: D.DATE,
  }, { tableName: 'stock_transfers' });
  const StockTransferItem = sequelize.define('StockTransferItem', {
    id: { type: D.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true }, transfer_id: { type: D.BIGINT.UNSIGNED, allowNull: false },
    material_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, source_id: { type: D.BIGINT.UNSIGNED, allowNull: false },
    condition_id: D.BIGINT.UNSIGNED, quantity: { type: D.BIGINT.UNSIGNED, allowNull: false }, note: D.TEXT,
  }, { tableName: 'stock_transfer_items' });
  const restrict = { onDelete: 'RESTRICT' };
  StockTransfer.hasMany(StockTransferItem, { foreignKey: 'transfer_id', as: 'items', ...restrict });
  StockTransferItem.belongsTo(StockTransfer, { foreignKey: 'transfer_id', ...restrict });
  for (const Model of [StockTransferItem]) {
    Model.belongsTo(Material, { foreignKey: 'material_id', as: 'material', ...restrict });
    Model.belongsTo(MaterialSource, { foreignKey: 'source_id', as: 'source', ...restrict });
    Model.belongsTo(ConditionLevel, { foreignKey: 'condition_id', as: 'condition', ...restrict });
  }
  StockTransfer.belongsTo(Unit, { foreignKey: 'from_unit_id', as: 'fromUnit', ...restrict });
  StockTransfer.belongsTo(Unit, { foreignKey: 'to_unit_id', as: 'toUnit', ...restrict });
  StockTransfer.belongsTo(User, { foreignKey: 'created_by', as: 'creator', ...restrict });
  StockTransfer.belongsTo(User, { foreignKey: 'posted_by', as: 'poster', ...restrict });
  StockLedgerEntry.belongsTo(StockTransferItem, { foreignKey: 'transfer_item_id', as: 'transferItem', ...restrict });
  return { StockTransfer, StockTransferItem };
};
