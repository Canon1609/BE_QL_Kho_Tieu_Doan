const { Op } = require('sequelize');
const { StockLedgerEntry: Ledger } = require('../models');
const ApiError = require('../utils/ApiError');
const { legacyLocation } = require('./location.service');
// Call only after locking the material row in the same posting transaction.
async function dimensionBalance({ material_id, source_id, condition_id, unit_id, location_id, borrow_line_id = null }, transaction) {
  // Pre-5.1 NULL locations belong only to the representative store of that Unit.
  // Never add those rows to a different room's balance.
  let representative;
  try { representative = await legacyLocation(unit_id, transaction); }
  catch (err) { if (err.statusCode !== 409) throw err; }
  const locationWhere = representative && String(representative.id) === String(location_id)
    ? { [Op.or]: [{ location_id }, { location_id: null }] } : { location_id };
  const entries = await Ledger.findAll({ where: {
    material_id, unit_id, source_id, condition_id: condition_id || null,
    ...locationWhere,
    borrow_line_id: borrow_line_id == null ? { [Op.is]: null } : borrow_line_id,
  }, attributes: ['quantity_delta'], transaction, lock: transaction.LOCK.UPDATE });
  return entries.reduce((sum, row) => sum + BigInt(row.quantity_delta), 0n);
}
async function requireBalance(dimension, quantity, transaction) {
  const balance = await dimensionBalance(dimension, transaction);
  if (balance < BigInt(quantity)) throw new ApiError(409, `Không đủ tồn khả dụng đúng vật chất/nguồn/tình trạng/vị trí (còn ${balance}).`);
  return balance;
}
module.exports = { dimensionBalance, requireBalance };
