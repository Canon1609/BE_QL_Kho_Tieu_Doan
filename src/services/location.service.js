const { Op } = require('sequelize');
const { Location, Unit, StockLedgerEntry: Ledger, sequelize } = require('../models');
const ApiError = require('../utils/ApiError');
const codes = { BATTALION_5: 'LOC_BATTALION_5_WAREHOUSE', COMPANY_11: 'LOC_COMPANY_11_STORE', COMPANY_12: 'LOC_COMPANY_12_STORE', COMPANY_13: 'LOC_COMPANY_13_STORE' };
async function legacyLocation(unitId, transaction) {
  const unit = await Unit.findByPk(unitId, { transaction });
  const code = codes[unit?.code];
  if (!code) throw new ApiError(409, 'Chưa có vị trí đại diện cho đơn vị');
  const location = await Location.findOne({ where: { code, owner_unit_id: unitId, is_active: true, is_stock_holding: true }, transaction });
  if (!location) throw new ApiError(409, 'Vị trí đại diện không hợp lệ');
  return location;
}
// Read the tree once, reject cycles; only the ledger's holding location contributes to totals.
async function descendantIds(parentId) {
  const locations = await Location.findAll({ attributes: ['id', 'parent_location_id'], raw: true });
  const visited = new Set();
  const queue = [String(parentId)];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) throw new ApiError(409, 'Cây vị trí có vòng lặp');
    visited.add(id);
    queue.push(...locations.filter(l => String(l.parent_location_id) === id).map(l => String(l.id)));
  }
  return [...visited];
}
async function unitHoldingIds(unitId) {
  const rows = await Location.findAll({ where: { owner_unit_id: unitId, is_stock_holding: true }, attributes: ['id'], raw: true });
  return rows.map(l => String(l.id));
}
// A null location is a pre-migration legacy entry. Never include it alongside its backfilled equivalent.
function holdingWhere(ids, unitId) {
  return { [Op.or]: [{ location_id: { [Op.in]: ids.length ? ids : [0] } }, { location_id: null, unit_id: unitId }] };
}
async function locationBalance(materialId, locationId, { descendants = false } = {}) {
  const location = await Location.findByPk(locationId);
  if (!location) throw new ApiError(404, 'Không tìm thấy vị trí');
  const ids = descendants ? await descendantIds(locationId) : [String(locationId)];
  const rows = await Ledger.findAll({ where: { material_id: materialId, location_id: { [Op.in]: ids } },
    attributes: ['source_id', 'condition_id', [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']],
    group: ['source_id', 'condition_id'], raw: true });
  return rows;
}
module.exports = { legacyLocation, descendantIds, unitHoldingIds, holdingWhere, locationBalance };
