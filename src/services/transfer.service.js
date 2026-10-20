const { Op, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const { sequelize, StockTransfer: Transfer, StockTransferItem: Item, StockLedgerEntry: Ledger, Material, MaterialSource: Source, ConditionLevel: Condition, Unit, Location, MaterialCategory, UnitOfMeasure } = require('../models');
const { canAccessUnit } = require('./unitScope.service');
const ApiError = require('../utils/ApiError');
const { legacyLocation, holdingWhere } = require('./location.service');
const { requireBalance } = require('./borrow-balance.service');
const fail = (status, message) => { throw new ApiError(status, message); };
const ref = (model, as) => ({ model, as, attributes: ['id', 'code', 'name'] });
const parts = [ref(Material, 'material'), ref(Source, 'source'), ref(Condition, 'condition')];
const includes = [{ model: Item, as: 'items', include: parts }, ref(Unit, 'fromUnit'), ref(Unit, 'toUnit')];
const plain = row => JSON.parse(JSON.stringify(row));
const safe = async fn => {
  try { return await fn(); } catch (e) {
    if (e instanceof UniqueConstraintError) fail(409, 'Mã phiếu hoặc bút toán đã tồn tại');
    if (e instanceof ForeignKeyConstraintError) fail(409, 'Dữ liệu đang được tham chiếu; không thể xóa');
    throw e;
  }
};
async function company(unitId, user, transaction) {
  if (!await canAccessUnit(user, unitId)) fail(403, 'Forbidden');
  const unit = await Unit.findByPk(unitId, { transaction });
  if (!unit?.is_active || unit.type !== 'COMPANY' || String(unit.parent_id) !== String(user.unit_id)) fail(400, 'Đại đội không hợp lệ');
  return unit;
}
async function root(user, transaction) {
  const unit = await Unit.findByPk(user.unit_id, { transaction });
  if (user.role.code !== 'BATTALION_ADMIN' || unit?.code !== 'BATTALION_5' || unit.type !== 'BATTALION' || !unit.is_active) fail(403, 'Forbidden');
  return unit;
}
async function validateItems(items, transaction) {
  const seen = new Set();
  for (const item of items) {
    const key = `${item.material_id}:${item.source_id}:${item.condition_id || ''}:${item.borrow_line_id || ''}`;
    if (seen.has(key)) fail(400, 'Dòng vật chất/nguồn/tình trạng bị trùng');
    seen.add(key);
    const [m, s, c] = await Promise.all([Material.findByPk(item.material_id, { transaction }), Source.findByPk(item.source_id, { transaction }),
      item.condition_id ? Condition.findByPk(item.condition_id, { transaction }) : null]);
    if (!m?.is_active || !s?.is_active || (item.condition_id && !c?.is_active)) fail(400, 'Vật chất, nguồn hoặc tình trạng không hợp lệ/đã tắt');
  }
}
async function get(id) {
  const row = await Transfer.findByPk(id, { include: includes });
  if (!row) fail(404, 'Không tìm thấy phiếu');
  return plain(row);
}
async function holding(id, transaction) {
  const location = await Location.findByPk(id, { transaction });
  if (!location?.is_active || !location.is_stock_holding) fail(400, 'Nơi lưu giữ không hợp lệ');
  let parent = location;
  const seen = new Set();
  while (parent) {
    if (seen.has(String(parent.id)) || !parent.is_active) fail(400, 'Cây địa điểm không hợp lệ');
    seen.add(String(parent.id));
    parent = parent.parent_location_id ? await Location.findByPk(parent.parent_location_id, { transaction }) : null;
  }
  return location;
}
async function save(id, data, user) {
  return safe(async () => {
    const transferId = await sequelize.transaction(async transaction => {
      const warehouse = await root(user, transaction);
      let row;
      if (id) {
        row = await Transfer.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!row) fail(404, 'Không tìm thấy phiếu');
        if (row.status !== 'DRAFT') fail(409, 'Phiếu đã ghi sổ; không thể sửa');
        if (row.transfer_type !== data.transfer_type) fail(400, 'Không thể đổi loại phiếu');
      }
      if (data.transfer_type === 'INTERNAL_TRANSFER') {
        if (!await canAccessUnit(user, data.company_unit_id)) fail(403, 'Forbidden');
        const unit = await Unit.findByPk(data.company_unit_id, { transaction });
        if (!unit?.is_active || !['COMPANY', 'BATTALION'].includes(unit.type)) fail(400, 'Đơn vị không hợp lệ');
        await holding(data.from_location_id, transaction);
        await holding(data.to_location_id, transaction);
        if (String(data.from_location_id) === String(data.to_location_id)) fail(400, 'Nơi chuyển và nơi nhận phải khác nhau');
      } else await company(data.company_unit_id, user, transaction);
      const warehouseLocation = data.transfer_type === 'INTERNAL_TRANSFER' ? null : await legacyLocation(warehouse.id, transaction);
      const companyLocation = data.transfer_type === 'INTERNAL_TRANSFER' ? null : await legacyLocation(data.company_unit_id, transaction);
      const destination = data.transfer_type === 'ISSUE' && data.to_location_id ? await holding(data.to_location_id, transaction) : companyLocation;
      if (data.transfer_type === 'ISSUE' && destination.type !== 'ROOM' && (destination.type !== 'COMPANY_STORE' || String(destination.owner_unit_id) !== String(data.company_unit_id))) fail(400, 'Nơi nhận phải là phòng hoặc Kho Đại đội nhận');
      if (data.items.some(i => i.borrow_line_id) && data.transfer_type !== 'INTERNAL_TRANSFER') fail(400, 'Chỉ điều chuyển nội bộ mới được giữ dấu vết mượn');
      if (data.transfer_type === 'INTERNAL_TRANSFER' && data.items.some(i => i.borrow_line_id) && data.items.some(i => !i.borrow_line_id)) fail(400, 'Tách phiếu điều chuyển vật chất mượn và vật chất không ràng buộc');
      if (data.items.some(i => i.borrow_line_id)) {
        const { BorrowLine, BorrowRequest } = require('../models');
        for (const item of data.items.filter(i => i.borrow_line_id)) {
          const line = await BorrowLine.findByPk(item.borrow_line_id, { transaction });
          const request = line && await BorrowRequest.findByPk(line.request_id, { transaction });
          if (!line || !request || !['DELIVERED', 'PARTIAL'].includes(request.status) || String(request.company_unit_id) !== String(data.company_unit_id) ||
            String(line.material_id) !== String(item.material_id) || String(line.source_id) !== String(item.source_id) ||
            String(line.condition_id || '') !== String(item.condition_id || '')) fail(400, 'Dòng đang mượn không thuộc Đại đội hoặc sai nguồn/tình trạng');
        }
      }
      await validateItems(data.items, transaction);
      const header = { code: data.code, transfer_type: data.transfer_type, transfer_date: data.transfer_date,
        from_unit_id: data.transfer_type === 'ISSUE' ? warehouse.id : data.company_unit_id,
        to_unit_id: data.transfer_type === 'RECALL' ? warehouse.id : data.company_unit_id,
        from_location_id: data.transfer_type === 'INTERNAL_TRANSFER' ? data.from_location_id : data.transfer_type === 'ISSUE' ? warehouseLocation.id : companyLocation.id,
        to_location_id: data.transfer_type === 'INTERNAL_TRANSFER' ? data.to_location_id : data.transfer_type === 'ISSUE' ? destination.id : warehouseLocation.id,
        document_no: data.document_no || null, note: data.note || null };
      if (row) {
        await row.update(header, { transaction });
        await Item.destroy({ where: { transfer_id: id }, transaction });
      } else row = await Transfer.create({ ...header, status: 'DRAFT', created_by: user.id }, { transaction });
      await Item.bulkCreate(data.items.map(i => ({ ...i, condition_id: i.condition_id || null, note: i.note || null, transfer_id: row.id })), { transaction });
      return row.id;
    });
    return get(transferId);
  });
}
async function remove(id, user) {
  return safe(() => sequelize.transaction(async transaction => {
    await root(user, transaction);
    const row = await Transfer.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) fail(404, 'Không tìm thấy phiếu');
    if (row.status !== 'DRAFT') fail(409, 'Phiếu đã ghi sổ; không thể xóa');
    await Item.destroy({ where: { transfer_id: id }, transaction });
    await row.destroy({ transaction });
  }));
}
async function post(id, user) {
  return safe(async () => {
    await sequelize.transaction(async transaction => {
      const warehouse = await root(user, transaction);
      const row = await Transfer.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) fail(404, 'Không tìm thấy phiếu');
      if (row.status !== 'DRAFT') fail(409, 'Phiếu đã ghi sổ; không thể xác nhận lại');
      const internal = row.transfer_type === 'INTERNAL_TRANSFER';
      const companyId = row.transfer_type === 'ISSUE' ? row.to_unit_id : row.from_unit_id;
      if (internal) {
        if (String(row.from_unit_id) !== String(row.to_unit_id) || !await canAccessUnit(user, row.from_unit_id)) fail(403, 'Forbidden');
        const unit = await Unit.findByPk(row.from_unit_id, { transaction });
        if (!unit?.is_active) fail(409, 'Đơn vị đã ngừng hoạt động');
      } else {
        if (!['ISSUE', 'RECALL'].includes(row.transfer_type) || String(row.transfer_type === 'ISSUE' ? row.from_unit_id : row.to_unit_id) !== String(warehouse.id)) fail(400, 'Vị trí phiếu không hợp lệ');
        await company(companyId, user, transaction);
      }
      const fromLocation = internal ? await holding(row.from_location_id, transaction) : await legacyLocation(row.from_unit_id, transaction);
      const toLocation = internal || row.transfer_type === 'ISSUE' ? await holding(row.to_location_id || (await legacyLocation(row.to_unit_id, transaction)).id, transaction) : await legacyLocation(row.to_unit_id, transaction);
      if (row.transfer_type === 'ISSUE' && toLocation.type !== 'ROOM' && (toLocation.type !== 'COMPANY_STORE' || String(toLocation.owner_unit_id) !== String(companyId))) fail(409, 'Nơi nhận không còn hợp lệ');
      if (String(fromLocation.id) === String(toLocation.id)) fail(409, 'Nơi chuyển và nơi nhận phải khác nhau');
      if (!internal && (row.from_location_id && String(row.from_location_id) !== String(fromLocation.id) ||
          row.transfer_type === 'RECALL' && row.to_location_id && String(row.to_location_id) !== String(toLocation.id))) fail(409, 'Vị trí phiếu không khớp đơn vị');
      const items = await Item.findAll({ where: { transfer_id: id }, transaction, order: [['id', 'ASC']] });
      if (!items.length) fail(400, 'Phiếu phải có ít nhất một dòng');
      await validateItems(items, transaction);
      if (items.some(i => i.borrow_line_id)) {
        if (items.some(i => !i.borrow_line_id)) fail(409, 'Không trộn vật chất mượn với tồn khác trên cùng phiếu');
        if (!internal) fail(409, 'Phiếu không được dùng vật chất đang mượn');
        const { BorrowLine, BorrowRequest } = require('../models');
        for (const item of items.filter(i => i.borrow_line_id)) {
          const line = await BorrowLine.findByPk(item.borrow_line_id, { transaction });
          const request = line && await BorrowRequest.findByPk(line.request_id, { transaction });
          if (!line || !request || !['DELIVERED', 'PARTIAL'].includes(request.status) || String(request.company_unit_id) !== String(row.from_unit_id) || String(line.material_id) !== String(item.material_id) || String(line.source_id) !== String(item.source_id) || String(line.condition_id || '') !== String(item.condition_id || '')) fail(409, 'Dòng mượn không còn hợp lệ');
        }
      }
      // Same material lock protocol as receipt posting. All writers lock material IDs in ascending order.
      const ids = [...new Set(items.map(i => String(i.material_id)))].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
      for (const materialId of ids) await Material.findByPk(materialId, { transaction, lock: transaction.LOCK.UPDATE });
      // Current locking read after acquiring the material lock: avoids stale RR snapshot and overselling.
      for (const item of items) {
        await requireBalance({ material_id: item.material_id, source_id: item.source_id, condition_id: item.condition_id,
          unit_id: row.from_unit_id, location_id: fromLocation.id, borrow_line_id: item.borrow_line_id || null }, item.quantity, transaction);
      }
      const now = new Date();
      for (const item of items) {
        const common = { material_id: item.material_id, source_id: item.source_id, condition_id: item.condition_id || null,
          transaction_type: row.transfer_type, reference_type: 'STOCK_TRANSFER', reference_id: row.id,
          transfer_item_id: item.id, borrow_line_id: item.borrow_line_id || null, occurred_at: now, created_by: user.id };
        await Ledger.create({ ...common, unit_id: row.from_unit_id, location_id: fromLocation.id, transfer_side: 'OUT', quantity_delta: -Number(item.quantity) }, { transaction });
        await Ledger.create({ ...common, unit_id: row.to_unit_id, location_id: toLocation.id, transfer_side: 'IN', quantity_delta: Number(item.quantity) }, { transaction });
      }
      await row.update({ from_location_id: fromLocation.id, to_location_id: toLocation.id, status: 'POSTED', posted_by: user.id, posted_at: now }, { transaction });
    });
    return get(id);
  });
}
async function list(q) {
  const where = {};
  for (const key of ['transfer_type', 'status']) if (q[key]) where[key] = q[key];
  if (q.unit_id) where[Op.or] = [{ from_unit_id: q.unit_id }, { to_unit_id: q.unit_id }];
  if (q.from || q.to) where.transfer_date = { ...(q.from ? { [Op.gte]: q.from } : {}), ...(q.to ? { [Op.lte]: q.to } : {}) };
  if (q.search) where[Op.and] = [{ [Op.or]: [{ code: { [Op.like]: `%${q.search}%` } }, { document_no: { [Op.like]: `%${q.search}%` } }] }];
  if (q.material_id) { const items = await Item.findAll({ where: { material_id: q.material_id }, attributes: ['transfer_id'], raw: true }); where.id = { [Op.in]: [...new Set(items.map(i => i.transfer_id))] }; }
  const page = Number(q.page || 1), limit = 20;
  const { rows, count } = await Transfer.findAndCountAll({ where, include: [ref(Unit, 'fromUnit'), ref(Unit, 'toUnit')], order: [['id', 'DESC']], limit, offset: (page - 1) * limit });
  return { items: rows.map(plain), total: count, page, limit };
}
async function units(user) {
  await root(user);
  const rows = await Unit.findAll({ where: { parent_id: user.unit_id, type: 'COMPANY', is_active: true }, attributes: ['id', 'code', 'name'], order: [['name', 'ASC']] });
  return rows.map(plain);
}
async function assets(unitId, user, q) {
  if (!await canAccessUnit(user, unitId) || user.role.code === 'BATTALION_ADMIN' && String(user.unit_id) === String(unitId)) fail(403, 'Forbidden');
  const unit = await Unit.findByPk(unitId);
  if (!unit || unit.type !== 'COMPANY' || !unit.is_active) fail(403, 'Forbidden');
  const rows = await Ledger.findAll({ where: { unit_id: unitId, ...(q.material_id ? { material_id: q.material_id } : {}) },
    attributes: ['material_id', 'source_id', 'condition_id', [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']],
    group: ['material_id', 'source_id', 'condition_id'], raw: true });
  const ids = [...new Set(rows.map(r => String(r.material_id)))];
  const materials = await Material.findAll({ where: { id: ids.length ? ids : [0], ...(q.search ? { [Op.or]: [{ code: { [Op.like]: `%${q.search}%` } }, { name: { [Op.like]: `%${q.search}%` } }] } : {}) },
    include: [ref(MaterialCategory, 'category'), ref(UnitOfMeasure, 'unit')], order: [['code', 'ASC']] });
  const locationRows = await Ledger.findAll({ where: { unit_id: unitId, ...(q.material_id ? { material_id: q.material_id } : {}) }, attributes: ['material_id', 'location_id', 'source_id', 'condition_id', [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']], group: ['material_id', 'location_id', 'source_id', 'condition_id'], raw: true });
  const locations = await Location.findAll({ where: { id: [...new Set(locationRows.map(r => r.location_id).filter(Boolean))] }, attributes: ['id', 'code', 'name', 'parent_location_id'] });
  const [sources, conditions] = await Promise.all([Source.findAll({ where: { id: [...new Set(rows.map(r => r.source_id))] } }), Condition.findAll({ where: { id: [...new Set(rows.map(r => r.condition_id).filter(Boolean))] } })]);
  return materials.map(m => {
    const breakdown = rows.filter(r => String(r.material_id) === String(m.id) && BigInt(r.quantity) !== 0n).map(r => ({
      source_id: String(r.source_id), source: sources.find(s => String(s.id) === String(r.source_id))?.name,
      condition_id: r.condition_id ? String(r.condition_id) : null, condition: conditions.find(c => String(c.id) === String(r.condition_id))?.name || null,
      quantity: String(r.quantity),
    }));
    return { ...plain(m), quantity: breakdown.reduce((n, b) => n + BigInt(b.quantity), 0n).toString(), breakdown,
      locations: locationRows.filter(r => String(r.material_id) === String(m.id) && BigInt(r.quantity) > 0n).map(r => ({ location: locations.find(l => String(l.id) === String(r.location_id)) || null, quantity: String(r.quantity), source: sources.find(s => String(s.id) === String(r.source_id))?.name, condition: conditions.find(c => String(c.id) === String(r.condition_id))?.name || null })) };
  }).filter(m => m.breakdown.length > 0);
}
async function history(unitId, user, q) {
  if (!await canAccessUnit(user, unitId) || user.role.code === 'BATTALION_ADMIN' && String(user.unit_id) === String(unitId)) fail(403, 'Forbidden');
  const unit = await Unit.findByPk(unitId);
  if (!unit || unit.type !== 'COMPANY' || !unit.is_active) fail(403, 'Forbidden');
  const where = { unit_id: unitId, reference_type: { [Op.in]: ['STOCK_TRANSFER', 'BORROW_DELIVERY', 'BORROW_RETURN'] } };
  if (q.material_id) where.material_id = q.material_id;
  const page = Number(q.page || 1), limit = 20;
  const { rows, count } = await Ledger.findAndCountAll({ where, include: parts, order: [['id', 'DESC']], limit, offset: (page - 1) * limit });
  const places = await Location.findAll({ where: { id: [...new Set(rows.map(r => r.location_id).filter(Boolean))] }, attributes: ['id', 'code', 'name', 'parent_location_id'] });
  return { items: rows.map(r => ({ ...plain(r), location: places.find(p => String(p.id) === String(r.location_id)) || null })), total: count, page, limit };
}
module.exports = { get, save, remove, post, list, units, assets, history };
