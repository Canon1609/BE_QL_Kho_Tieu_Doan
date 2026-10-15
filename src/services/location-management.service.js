const { Op, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const { sequelize, Location, StockLedgerEntry: Ledger, StockTransfer: Transfer, Unit, Material, MaterialSource: Source, ConditionLevel: Condition } = require('../models');
const { descendantIds } = require('./location.service');
const ApiError = require('../utils/ApiError');
const { children, invalid } = require('../validators/location.validation');
const fail = (status, message) => { throw new ApiError(status, message); };
const plain = row => row.get({ plain: true });
const types = ['GROUP', 'BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE', 'COMPANY_STORE'];
const groups = ['GROUP', 'BUILDING', 'FLOOR'];
function admin(user) { if (user.role.code !== 'BATTALION_ADMIN' || user.unit?.code !== 'BATTALION_5') fail(403, 'Forbidden'); }
async function check(data, self, transaction) {
  if (!types.includes(data.type) || groups.includes(data.type) === Boolean(data.is_stock_holding)) invalid({ type: 'Loại địa điểm và chức năng lưu giữ không phù hợp.' });
  if (data.owner_unit_id) {
    const unit = await Unit.findByPk(data.owner_unit_id, { transaction });
    if (!unit?.is_active || !['BATTALION', 'COMPANY'].includes(unit.type)) invalid({ owner_unit_id: 'Đơn vị quản trị không hợp lệ.' });
  }
  if (data.parent_location_id) {
    const parent = await Location.findByPk(data.parent_location_id, { transaction });
    if (!parent || !parent.is_active || String(parent.id) === String(self)) invalid({ parent_location_id: 'Vui lòng chọn địa điểm cha hợp lệ.' });
    if (!children[parent.type]?.includes(data.type)) invalid({ parent_location_id: `${data.type === 'BUILDING' ? 'Dãy nhà' : 'Địa điểm này'} không thể nằm trong ${parent.name}. Vui lòng chọn địa điểm cha hợp lệ.` });
    const seen = new Set(); let node = parent;
    while (node) {
      if (seen.has(String(node.id)) || String(node.id) === String(self)) invalid({ parent_location_id: 'Cây địa điểm không được tạo vòng lặp.' });
      seen.add(String(node.id));
      node = node.parent_location_id ? await Location.findByPk(node.parent_location_id, { transaction }) : null;
    }
  } else invalid({ parent_location_id: 'Vui lòng chọn địa điểm cha hợp lệ.' });
}
async function dependencies(id, transaction) {
  const [children, entries, from, to] = await Promise.all([
    Location.count({ where: { parent_location_id: id }, transaction }), Ledger.count({ where: { location_id: id }, transaction }),
    Transfer.count({ where: { from_location_id: id }, transaction }), Transfer.count({ where: { to_location_id: id }, transaction }),
  ]);
  return children + entries + from + to;
}
async function save(id, data, user) {
  admin(user);
  try {
    return await sequelize.transaction(async transaction => {
      // Serialize tree changes, including sibling changes and dependency checks.
      await Location.findAll({ attributes: ['id'], order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      const row = id ? await Location.findByPk(id, { transaction }) : null;
      if (id && !row) fail(404, 'Không tìm thấy địa điểm');
      if (row?.code === 'LOC_BATTALION_5_ROOT' || row?.code === 'LOC_BATTALION_5_WAREHOUSE' || /^LOC_COMPANY_(11|12|13)_STORE$/.test(row?.code || '')) fail(409, 'Không sửa vị trí đại diện của dữ liệu cũ');
      if (!id && ['LOC_BATTALION_5_ROOT', 'LOC_BATTALION_5_WAREHOUSE', 'LOC_COMPANY_11_STORE', 'LOC_COMPANY_12_STORE', 'LOC_COMPANY_13_STORE'].includes(data.code)) fail(409, 'Mã vị trí đại diện được bảo vệ');
      await check(data, id, transaction);
      if (row && (row.type !== data.type || row.is_stock_holding !== data.is_stock_holding || String(row.parent_location_id || '') !== String(data.parent_location_id || '') || String(row.owner_unit_id || '') !== String(data.owner_unit_id || '')) && await dependencies(id, transaction)) fail(409, 'Địa điểm đã có dữ liệu phụ thuộc');
      if (row && !data.is_active && await dependencies(id, transaction)) fail(409, 'Địa điểm còn con, lịch sử hoặc chứng từ');
      return plain(row ? await row.update(data, { transaction }) : await Location.create(data, { transaction }));
    });
  } catch (e) { if (e instanceof UniqueConstraintError) throw new ApiError(409, 'Mã địa điểm đã tồn tại.', { code: 'Mã địa điểm đã tồn tại.' }); throw e; }
}
async function remove(id, user) {
  admin(user);
  try { await sequelize.transaction(async transaction => {
    await Location.findAll({ attributes: ['id'], order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    const row = await Location.findByPk(id, { transaction });
    if (!row) fail(404, 'Không tìm thấy địa điểm');
    if (['LOC_BATTALION_5_ROOT', 'LOC_BATTALION_5_WAREHOUSE', 'LOC_COMPANY_11_STORE', 'LOC_COMPANY_12_STORE', 'LOC_COMPANY_13_STORE'].includes(row.code) || await dependencies(id, transaction)) fail(409, 'Địa điểm có dữ liệu phụ thuộc; không thể xóa');
    await row.destroy({ transaction });
  }); } catch (e) { if (e instanceof ForeignKeyConstraintError) fail(409, 'Địa điểm đang được sử dụng'); throw e; }
}
async function list(user, q = {}) {
  if (user.role.code === 'BATTALION_ADMIN') admin(user);
  else if (user.role.code !== 'COMPANY_ADMIN' || user.unit?.type !== 'COMPANY' || !user.unit.is_active) fail(403, 'Forbidden');
  const rows = await Location.findAll({ order: [['id', 'ASC']] });
  if (user.role.code === 'BATTALION_ADMIN') return rows.map(plain);
  // A company's location name is visible only if its own ledger references that location.
  const entries = await Ledger.findAll({ where: { unit_id: user.unit_id }, attributes: ['location_id'], group: ['location_id'], raw: true });
  const ids = new Set(entries.filter(e => e.location_id).map(e => String(e.location_id)));
  const byId = new Map(rows.map(r => [String(r.id), r]));
  for (const id of [...ids]) { let parent = byId.get(id); while (parent?.parent_location_id) { ids.add(String(parent.parent_location_id)); parent = byId.get(String(parent.parent_location_id)); } }
  return rows.filter(r => ids.has(String(r.id))).map(r => ({ ...plain(r), owner_unit_id: undefined, note: undefined }));
}
async function detail(id, user) {
  const rows = await list(user);
  const row = rows.find(r => String(r.id) === String(id));
  if (!row) fail(404, 'Không tìm thấy địa điểm');
  return row;
}
async function balances(user, q) {
  if (user.role.code === 'BATTALION_ADMIN') admin(user);
  else if (user.role.code !== 'COMPANY_ADMIN' || user.unit?.type !== 'COMPANY' || !user.unit.is_active) fail(403, 'Forbidden');
  if (user.role.code === 'COMPANY_ADMIN' && q.unit_id && String(q.unit_id) !== String(user.unit_id)) fail(403, 'Forbidden');
  let ids;
  if (q.location_id) { await detail(q.location_id, user); ids = q.descendants === 'true' ? await descendantIds(q.location_id) : [String(q.location_id)]; }
  if (q.unit_id && user.role.code === 'BATTALION_ADMIN') {
    const unit = await Unit.findByPk(q.unit_id);
    if (!unit?.is_active || !['BATTALION', 'COMPANY'].includes(unit.type) || unit.type === 'COMPANY' && String(unit.parent_id) !== String(user.unit_id)) fail(400, 'Đơn vị không hợp lệ');
  }
  const where = { ...(user.role.code === 'COMPANY_ADMIN' ? { unit_id: user.unit_id } : q.unit_id ? { unit_id: q.unit_id } : {}),
    ...(ids ? { location_id: { [Op.in]: ids } } : {}), ...(q.material_id ? { material_id: q.material_id } : {}) };
  const entries = await Ledger.findAll({ where, attributes: ['unit_id', 'location_id', 'material_id', 'source_id', 'condition_id', [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']],
    group: ['unit_id', 'location_id', 'material_id', 'source_id', 'condition_id'], raw: true });
  const positive = entries.filter(e => BigInt(e.quantity) > 0n && e.location_id);
  const [locations, units, materials, sources, conditions] = await Promise.all([
    Location.findAll({ where: { id: [...new Set(positive.map(e => e.location_id))] }, attributes: ['id', 'code', 'name', 'parent_location_id'] }),
    Unit.findAll({ where: { id: [...new Set(positive.map(e => e.unit_id))] }, attributes: ['id', 'code', 'name'] }),
    Material.findAll({ where: { id: [...new Set(positive.map(e => e.material_id))] }, attributes: ['id', 'code', 'name'] }),
    Source.findAll({ where: { id: [...new Set(positive.map(e => e.source_id))] }, attributes: ['id', 'name'] }),
    Condition.findAll({ where: { id: [...new Set(positive.map(e => e.condition_id).filter(Boolean))] }, attributes: ['id', 'name'] }),
  ]);
  const name = (rows, id) => rows.find(r => String(r.id) === String(id));
  return positive.map(e => ({ ...e, quantity: String(e.quantity), location: name(locations, e.location_id), unit: name(units, e.unit_id), material: name(materials, e.material_id), source: name(sources, e.source_id), condition: name(conditions, e.condition_id) || null }));
}
module.exports = { list, detail, save, remove, balances };
