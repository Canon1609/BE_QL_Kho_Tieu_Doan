const { Op, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const { sequelize, StockReceipt: Receipt, StockReceiptItem: Item, StockLedgerEntry: Ledger, Material, MaterialSource: Source, ConditionLevel: Condition, Unit } = require('../models');
const ApiError = require('../utils/ApiError');
const { legacyLocation, holdingWhere } = require('./location.service');
const fail = (status, message) => { throw new ApiError(status, message); };
const simple = (model, as) => ({ model, as, attributes: ['id', 'code', 'name'] });
const itemIncludes = [simple(Material, 'material'), simple(Source, 'source'), simple(Condition, 'condition')];
const includes = [{ model: Item, as: 'items', include: itemIncludes }, simple(Source, 'source')];
const safe = async fn => {
  try { return await fn(); }
  catch (e) {
    if (e instanceof UniqueConstraintError) fail(409, 'Mã phiếu hoặc dòng ghi sổ đã tồn tại');
    if (e instanceof ForeignKeyConstraintError) fail(409, 'Dữ liệu đang được tham chiếu; không thể xóa');
    throw e;
  }
};
const present = row => {
  const value = row.toJSON();
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') { if (Array.isArray(v)) v.forEach(walk); else walk(v); }
      else if ((k === 'id' || k.endsWith('_id')) && v != null) obj[k] = String(v);
    }
  };
  walk(value);
  return value;
};
async function get(id, options = {}) {
  const row = await Receipt.findByPk(id, { include: includes, ...options });
  if (!row) fail(404, 'Không tìm thấy phiếu');
  return present(row);
}
async function validateItems(items, transaction) {
  const seen = new Set();
  for (const item of items) {
    const key = [item.material_id, item.source_id, item.condition_id || ''].join(':');
    if (seen.has(key)) fail(400, 'Dòng vật chất/nguồn/tình trạng bị trùng');
    seen.add(key);
    const [material, source, condition] = await Promise.all([
      Material.findByPk(item.material_id, { transaction }), Source.findByPk(item.source_id, { transaction }),
      item.condition_id ? Condition.findByPk(item.condition_id, { transaction }) : null,
    ]);
    if (!material?.is_active || !source?.is_active || (item.condition_id && !condition?.is_active)) fail(400, 'Vật chất, nguồn hoặc tình trạng không hợp lệ/đã tắt');
  }
}
async function save(id, data, user) {
  return safe(async () => {
    const receiptId = await sequelize.transaction(async transaction => {
      let row;
      if (id) {
        row = await Receipt.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!row) fail(404, 'Không tìm thấy phiếu');
        if (row.status !== 'DRAFT') fail(409, 'Phiếu đã ghi sổ; không thể sửa');
      }
      await validateItems(data.items, transaction);
      if (data.source_id) {
        const source = await Source.findByPk(data.source_id, { transaction });
        if (!source?.is_active) fail(400, 'Nguồn phiếu không hợp lệ');
      }
      const header = { code: data.code, receipt_type: data.receipt_type, receipt_date: data.receipt_date,
        source_id: data.source_id || null, document_no: data.document_no || null, note: data.note || null };
      if (row) {
        await row.update(header, { transaction });
        await Item.destroy({ where: { receipt_id: row.id }, transaction });
      } else row = await Receipt.create({ ...header, created_by: user.id, status: 'DRAFT' }, { transaction });
      await Item.bulkCreate(data.items.map(item => ({ ...item, condition_id: item.condition_id || null, note: item.note || null, receipt_id: row.id })), { transaction });
      return row.id;
    });
    return get(receiptId);
  });
}
async function remove(id) {
  return safe(() => sequelize.transaction(async transaction => {
    const row = await Receipt.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) fail(404, 'Không tìm thấy phiếu');
    if (row.status !== 'DRAFT') fail(409, 'Phiếu đã ghi sổ; không thể xóa');
    await Item.destroy({ where: { receipt_id: id }, transaction });
    await row.destroy({ transaction });
  }));
}
async function post(id, user) {
  return safe(async () => {
    await sequelize.transaction(async transaction => {
      // Lock the header first. Concurrent POST and draft edits/deletes serialize on this row.
      const row = await Receipt.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) fail(404, 'Không tìm thấy phiếu');
      if (row.status !== 'DRAFT') fail(409, 'Phiếu đã ghi sổ; không thể xác nhận lại');
      const items = await Item.findAll({ where: { receipt_id: id }, transaction, order: [['id', 'ASC']] });
      if (!items.length) fail(400, 'Phiếu phải có ít nhất một dòng');
      await validateItems(items, transaction);
      const unit = await Unit.findOne({ where: { code: 'BATTALION_5', type: 'BATTALION', is_active: true }, transaction });
      if (!unit || String(unit.id) !== String(user.unit_id)) fail(403, 'Forbidden');
      const location = await legacyLocation(unit.id, transaction);
      // Serialize EVERY posting for a material/location on the material row, not just
      // the receipt header. Sorted order avoids cycles for multi-material receipts.
      // A locking ledger read is a current read under MySQL REPEATABLE READ (a
      // plain SELECT could reuse a snapshot created before waiting for the lock).
      const materialIds = [...new Set(items.map(item => String(item.material_id)))].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
      for (const materialId of materialIds) {
        const material = await Material.findByPk(materialId, { transaction, lock: transaction.LOCK.UPDATE });
        if (row.receipt_type === 'OPENING_BALANCE') {
          const existing = await Ledger.findOne({ where: { material_id: materialId, ...holdingWhere([String(location.id)], unit.id) },
            transaction, lock: transaction.LOCK.UPDATE });
          if (existing) fail(409, `Không thể ghi sổ tồn đầu kỳ vì vật chất ${material.name} đã có phát sinh kho.`);
        }
      }
      // All opening items were checked before any ledger insert. No receipt date
      // comparison: a backdated opening cannot precede already-posted movements.
      const now = new Date();
      for (const item of items) {
        await Ledger.create({ material_id: item.material_id, unit_id: unit.id, location_id: location.id, source_id: item.source_id,
          condition_id: item.condition_id, transaction_type: row.receipt_type, quantity_delta: item.quantity,
          reference_type: 'STOCK_RECEIPT', reference_id: row.id, receipt_item_id: item.id,
          occurred_at: now, created_by: user.id }, { transaction });
      }
      await row.update({ status: 'POSTED', posted_by: user.id, posted_at: now }, { transaction });
    });
    return get(id);
  });
}
async function list(q) {
  const where = {};
  if (q.status) where.status = q.status;
  if (q.receipt_type) where.receipt_type = q.receipt_type;
  if (q.from || q.to) where.receipt_date = { ...(q.from ? { [Op.gte]: q.from } : {}), ...(q.to ? { [Op.lte]: q.to } : {}) };
  if (q.search) where[Op.or] = [{ code: { [Op.like]: `%${q.search}%` } }, { document_no: { [Op.like]: `%${q.search}%` } }];
  const page = Number(q.page || 1), limit = 20;
  const { rows, count } = await Receipt.findAndCountAll({ where, order: [['id', 'DESC']], limit, offset: (page - 1) * limit });
  return { items: rows.map(present), total: count, page, limit };
}
async function ledger(q) {
  const location = await legacyLocation(q.unitId);
  const where = holdingWhere([String(location.id)], q.unitId);
  if (q.material_id) where.material_id = q.material_id;
  const page = Number(q.page || 1), limit = 20;
  const { rows, count } = await Ledger.findAndCountAll({ where, include: [simple(Material, 'material'), simple(Source, 'source'), simple(Condition, 'condition')], order: [['id', 'DESC']], limit, offset: (page - 1) * limit });
  return { items: rows.map(present), total: count, page, limit };
}
async function balance(q) {
  // No material.quantity or cache. Each ledger entry contributes once at its holding location.
  const location = await legacyLocation(q.unitId);
  const where = holdingWhere([String(location.id)], q.unitId);
  if (q.material_id) where.material_id = q.material_id;
  const rows = await Ledger.findAll({ where, attributes: ['material_id', 'source_id', 'condition_id', [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']],
    group: ['material_id', 'source_id', 'condition_id'], raw: true });
  const ids = [...new Set(rows.map(r => String(r.material_id)))];
  const materials = await Material.findAll({ where: { id: ids.length ? ids : [0], ...(q.category_id ? { category_id: q.category_id } : {}),
    ...(q.search ? { [Op.or]: [{ code: { [Op.like]: `%${q.search}%` } }, { name: { [Op.like]: `%${q.search}%` } }] } : {}) },
    include: [simple(require('../models').MaterialCategory, 'category'), simple(require('../models').UnitOfMeasure, 'unit')], order: [['code', 'ASC']] });
  const sources = await Source.findAll({ where: { id: [...new Set(rows.map(r => r.source_id))] } });
  const conditions = await Condition.findAll({ where: { id: [...new Set(rows.map(r => r.condition_id).filter(Boolean))] } });
  return materials.map(material => {
    const breakdown = rows.filter(r => String(r.material_id) === String(material.id)).map(r => ({ source_id: String(r.source_id), source: sources.find(s => String(s.id) === String(r.source_id))?.name,
      condition_id: r.condition_id ? String(r.condition_id) : null, condition: conditions.find(c => String(c.id) === String(r.condition_id))?.name || null, quantity: String(r.quantity) }));
    const value = present(material);
    return { ...value, quantity: breakdown.reduce((n, b) => n + BigInt(b.quantity), 0n).toString(), breakdown };
  });
}
async function references() {
  const [sources, conditions] = await Promise.all([Source.findAll({ order: [['code', 'ASC']] }), Condition.findAll({ order: [['code', 'ASC']] })]);
  return { sources: sources.map(present), conditions: conditions.map(present) };
}
module.exports = { save, get, list, remove, post, ledger, balance, references };
