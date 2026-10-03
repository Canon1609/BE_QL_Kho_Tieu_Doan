module.exports = (sequelize, D, { Material, MaterialSource, ConditionLevel, Unit, User }) => {
  const StockReceipt = sequelize.define('StockReceipt', {
    id: { type: D.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    code: { type: D.STRING(64), allowNull: false, unique: true },
    receipt_type: { type: D.STRING(32), allowNull: false }, receipt_date: { type: D.DATEONLY, allowNull: false },
    source_id: { type: D.BIGINT.UNSIGNED }, document_no: D.STRING(120), note: D.TEXT,
    status: { type: D.STRING(16), allowNull: false, defaultValue: 'DRAFT' },
    created_by: { type: D.BIGINT.UNSIGNED, allowNull: false }, posted_by: D.BIGINT.UNSIGNED, posted_at: D.DATE,
  }, { tableName: 'stock_receipts' });
  const StockReceiptItem = sequelize.define('StockReceiptItem', {
    id: { type: D.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    receipt_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, material_id: { type: D.BIGINT.UNSIGNED, allowNull: false },
    source_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, condition_id: D.BIGINT.UNSIGNED,
    quantity: { type: D.BIGINT.UNSIGNED, allowNull: false }, note: D.TEXT,
  }, { tableName: 'stock_receipt_items' });
  const StockLedgerEntry = sequelize.define('StockLedgerEntry', {
    id: { type: D.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    material_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, unit_id: { type: D.BIGINT.UNSIGNED, allowNull: false },
    source_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, condition_id: D.BIGINT.UNSIGNED,
    transaction_type: { type: D.STRING(64), allowNull: false }, quantity_delta: { type: D.BIGINT, allowNull: false },
    reference_type: { type: D.STRING(64), allowNull: false }, reference_id: { type: D.BIGINT.UNSIGNED, allowNull: false },
    receipt_item_id: { type: D.BIGINT.UNSIGNED, unique: true },
    occurred_at: { type: D.DATE, allowNull: false }, created_by: { type: D.BIGINT.UNSIGNED, allowNull: false },
  }, { tableName: 'stock_ledger_entries' });
  const restrict = { onDelete: 'RESTRICT' };
  StockReceipt.hasMany(StockReceiptItem, { foreignKey: 'receipt_id', as: 'items', ...restrict });
  StockReceiptItem.belongsTo(StockReceipt, { foreignKey: 'receipt_id', ...restrict });
  for (const Model of [StockReceiptItem, StockLedgerEntry]) {
    Model.belongsTo(Material, { foreignKey: 'material_id', as: 'material', ...restrict });
    Model.belongsTo(MaterialSource, { foreignKey: 'source_id', as: 'source', ...restrict });
    Model.belongsTo(ConditionLevel, { foreignKey: 'condition_id', as: 'condition', ...restrict });
  }
  StockReceipt.belongsTo(MaterialSource, { foreignKey: 'source_id', as: 'source', ...restrict });
  StockLedgerEntry.belongsTo(Unit, { foreignKey: 'unit_id', as: 'location', ...restrict });
  StockReceipt.belongsTo(User, { foreignKey: 'created_by', as: 'creator', ...restrict });
  StockReceipt.belongsTo(User, { foreignKey: 'posted_by', as: 'poster', ...restrict });
  StockLedgerEntry.belongsTo(StockReceiptItem, { foreignKey: 'receipt_item_id', as: 'receiptItem', ...restrict });
  StockLedgerEntry.belongsTo(User, { foreignKey: 'created_by', as: 'creator', ...restrict });
  return { StockReceipt, StockReceiptItem, StockLedgerEntry };
};
