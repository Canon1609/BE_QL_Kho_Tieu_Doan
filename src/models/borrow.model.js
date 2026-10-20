module.exports = (sequelize, D, { Material, MaterialSource, ConditionLevel, Unit, User, Location, StockLedgerEntry, StockTransferItem }) => {
  const opts = name => ({ tableName: name });
  const pk = { type: D.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true };
  const BorrowRequest = sequelize.define('BorrowRequest', { id: pk, code: { type: D.STRING(64), allowNull: false, unique: true }, company_unit_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, due_date: { type: D.DATEONLY, allowNull: false }, status: { type: D.STRING(24), allowNull: false, defaultValue: 'DRAFT' }, note: D.TEXT, created_by: { type: D.BIGINT.UNSIGNED, allowNull: false }, decided_by: D.BIGINT.UNSIGNED, decided_at: D.DATE, decision_note: D.TEXT }, opts('borrow_requests'));
  const BorrowLine = sequelize.define('BorrowLine', { id: pk, request_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, material_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, source_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, condition_id: D.BIGINT.UNSIGNED, quantity: { type: D.BIGINT.UNSIGNED, allowNull: false } }, opts('borrow_lines'));
  const BorrowDelivery = sequelize.define('BorrowDelivery', { id: pk, request_id: { type: D.BIGINT.UNSIGNED, allowNull: false, unique: true }, from_location_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, to_location_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, confirmed_by: { type: D.BIGINT.UNSIGNED, allowNull: false }, confirmed_at: { type: D.DATE, allowNull: false } }, opts('borrow_deliveries'));
  const BorrowReturn = sequelize.define('BorrowReturn', { id: pk, request_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, to_location_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, status: { type: D.STRING(16), allowNull: false, defaultValue: 'DRAFT' }, created_by: { type: D.BIGINT.UNSIGNED, allowNull: false }, confirmed_by: D.BIGINT.UNSIGNED, confirmed_at: D.DATE }, opts('borrow_returns'));
  const BorrowReturnLine = sequelize.define('BorrowReturnLine', { id: pk, return_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, borrow_line_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, from_location_id: { type: D.BIGINT.UNSIGNED, allowNull: false }, quantity: { type: D.BIGINT.UNSIGNED, allowNull: false } }, opts('borrow_return_lines'));
  const restrict = { onDelete: 'RESTRICT' };
  BorrowRequest.hasMany(BorrowLine, { foreignKey: 'request_id', as: 'items', ...restrict });
  BorrowLine.belongsTo(BorrowRequest, { foreignKey: 'request_id', ...restrict });
  BorrowRequest.hasOne(BorrowDelivery, { foreignKey: 'request_id', as: 'delivery', ...restrict });
  BorrowRequest.hasMany(BorrowReturn, { foreignKey: 'request_id', as: 'returns', ...restrict });
  BorrowReturn.hasMany(BorrowReturnLine, { foreignKey: 'return_id', as: 'items', ...restrict });
  BorrowReturnLine.belongsTo(BorrowLine, { foreignKey: 'borrow_line_id', as: 'borrowLine', ...restrict });
  BorrowRequest.belongsTo(Unit, { foreignKey: 'company_unit_id', as: 'company', ...restrict });
  for (const [key, model] of [['created_by', User], ['decided_by', User]]) BorrowRequest.belongsTo(model, { foreignKey: key, ...restrict });
  for (const [key, model] of [['material_id', Material], ['source_id', MaterialSource], ['condition_id', ConditionLevel]]) BorrowLine.belongsTo(model, { foreignKey: key, as: key.replace('_id', ''), ...restrict });
  for (const model of [BorrowDelivery, BorrowReturn, BorrowReturnLine]) {
    for (const key of ['from_location_id', 'to_location_id']) if (model.rawAttributes[key]) model.belongsTo(Location, { foreignKey: key, ...restrict });
  }
  StockLedgerEntry.belongsTo(BorrowLine, { foreignKey: 'borrow_line_id', ...restrict });
  StockLedgerEntry.belongsTo(BorrowDelivery, { foreignKey: 'borrow_delivery_id', ...restrict });
  StockLedgerEntry.belongsTo(BorrowReturnLine, { foreignKey: 'borrow_return_line_id', ...restrict });
  StockTransferItem.belongsTo(BorrowLine, { foreignKey: 'borrow_line_id', ...restrict });
  return { BorrowRequest, BorrowLine, BorrowDelivery, BorrowReturn, BorrowReturnLine };
};
