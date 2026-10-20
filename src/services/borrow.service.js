const { Op, UniqueConstraintError, literal } = require('sequelize');
const { sequelize, BorrowRequest: Request, BorrowLine: Line, BorrowDelivery: Delivery, BorrowReturn: Return, BorrowReturnLine: ReturnLine, StockLedgerEntry: Ledger, Material, MaterialSource: Source, ConditionLevel: Condition, Unit, Location } = require('../models');
const ApiError = require('../utils/ApiError');
const { canAccessUnit } = require('./unitScope.service');
const { legacyLocation } = require('./location.service');
const { requireBalance } = require('./borrow-balance.service');
const { vietnamToday } = require('../utils/vietnamDate');
const fail = (status, message) => { throw new ApiError(status, message); };
const plain = row => row && JSON.parse(JSON.stringify(row));
// Only posted returns reduce debt; pending returns do not. Keep this predicate in SQL before pagination.
const hasDebt = `EXISTS (SELECT 1 FROM borrow_lines bl WHERE bl.request_id = BorrowRequest.id AND bl.quantity > COALESCE((SELECT SUM(brl.quantity) FROM borrow_return_lines brl JOIN borrow_returns br ON br.id = brl.return_id WHERE br.request_id = BorrowRequest.id AND br.status = 'POSTED' AND brl.borrow_line_id = bl.id), 0))`;
const include = [{ model: Line, as: 'items', include: [{ model: Material, as: 'material', attributes: ['id', 'code', 'name'] }, { model: Source, as: 'source', attributes: ['id', 'code', 'name'] }, { model: Condition, as: 'condition', attributes: ['id', 'code', 'name'] }] }, { model: Delivery, as: 'delivery' }, { model: Return, as: 'returns', include: [{ model: ReturnLine, as: 'items' }] }, { model: Unit, as: 'company', attributes: ['id', 'code', 'name'] }];
async function scope(user, unitId, transaction) {
  if (user.role.code === 'COMPANY_ADMIN' && String(unitId) !== String(user.unit_id) || !await canAccessUnit(user, unitId)) fail(403, 'Forbidden');
  const unit = await Unit.findByPk(unitId, { transaction });
  if (!unit?.is_active || !['COMPANY_11', 'COMPANY_12', 'COMPANY_13'].includes(unit.code) || unit.type !== 'COMPANY' || (user.role.code === 'BATTALION_ADMIN' && String(unit.parent_id) !== String(user.unit_id))) fail(403, 'Đơn vị không thuộc phạm vi mượn');
}
function admin(user) { if (user.role.code !== 'BATTALION_ADMIN' || user.unit?.code !== 'BATTALION_5') fail(403, 'Forbidden'); }
async function request(id, user, options = {}) {
  const row = await Request.findByPk(id, { ...options, include });
  if (!row) fail(404, 'Không tìm thấy yêu cầu');
  await scope(user, row.company_unit_id, options.transaction);
  return plain(row);
}
async function list(q, user) {
  if (user.role.code === 'BATTALION_ADMIN') admin(user);
  else await scope(user, user.unit_id);
  const where = { ...(user.role.code === 'COMPANY_ADMIN' ? { company_unit_id: user.unit_id } : {}) };
  if (q.company_unit_id) { await scope(user, q.company_unit_id); where.company_unit_id = q.company_unit_id; }
  if (q.status) where.status = q.status;
  if (q.search) where.code = { [Op.like]: `%${q.search.replace(/[\\%_]/g, '\\$&')}%` };
  if (q.from || q.to) where.due_date = { ...(q.from ? { [Op.gte]: q.from } : {}), ...(q.to ? { [Op.lte]: q.to } : {}) };
  if (q.overdue) {
    where.status = { [Op.in]: ['DELIVERED', 'PARTIAL'] };
    where.due_date = { ...(where.due_date || {}), [Op.lt]: vietnamToday() };
    where[Op.and] = literal(`EXISTS (SELECT 1 FROM borrow_deliveries bd WHERE bd.request_id = BorrowRequest.id) AND ${hasDebt}`);
  }
  const page = Number(q.page || 1), limit = 20;
  const { rows, count } = await Request.findAndCountAll({ where, limit, offset: (page - 1) * limit, order: [['id', 'DESC']], include: [{ model: Unit, as: 'company', attributes: ['id', 'name'] }, { model: Delivery, as: 'delivery', attributes: ['id'] }] });
  const ids = rows.map(r => r.id);
  const [lines, returns] = ids.length ? await Promise.all([
    Line.findAll({ where: { request_id: ids }, attributes: ['id', 'request_id', 'quantity'], raw: true }),
    Return.findAll({ where: { request_id: ids, status: 'POSTED' }, attributes: ['id', 'request_id'], include: [{ model: ReturnLine, as: 'items', attributes: ['borrow_line_id', 'quantity'] }] }),
  ]) : [[], []];
  const returned = new Map();
  for (const ret of returns) for (const item of ret.items) returned.set(String(item.borrow_line_id), (returned.get(String(item.borrow_line_id)) || 0n) + BigInt(item.quantity));
  const debt = new Map();
  for (const line of lines) debt.set(String(line.request_id), (debt.get(String(line.request_id)) || 0n) + BigInt(line.quantity) - (returned.get(String(line.id)) || 0n));
  return { items: rows.map(r => ({ ...plain(r), outstanding_quantity: ['DELIVERED', 'PARTIAL'].includes(r.status) ? String(debt.get(String(r.id)) || 0n) : '0' })), total: count, page, limit };
}
async function validateLines(items, transaction) {
  const seen = new Set();
  for (const item of items) {
    const key = `${item.material_id}:${item.source_id}:${item.condition_id || ''}`;
    if (seen.has(key)) fail(400, 'Dòng vật chất/nguồn/tình trạng bị trùng');
    seen.add(key);
    const [m, s, c] = await Promise.all([Material.findByPk(item.material_id, { transaction }), Source.findByPk(item.source_id, { transaction }), item.condition_id ? Condition.findByPk(item.condition_id, { transaction }) : null]);
    if (!m?.is_active || !s?.is_active || item.condition_id && !c?.is_active) fail(400, 'Vật chất/nguồn/tình trạng không hợp lệ');
  }
}
async function save(id, data, user) {
  if (user.role.code !== 'COMPANY_ADMIN') fail(403, 'Chỉ Đại đội được tạo và sửa yêu cầu mượn');
  try {
    const key = await sequelize.transaction(async transaction => {
      await scope(user, data.company_unit_id, transaction);
      let row;
      if (id) {
        row = await Request.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!row) fail(404, 'Không tìm thấy yêu cầu');
        await scope(user, row.company_unit_id, transaction);
        if (row.status !== 'DRAFT' || String(row.company_unit_id) !== String(data.company_unit_id)) fail(409, 'Chỉ được sửa yêu cầu nháp cùng Đại đội');
      }
      await validateLines(data.items, transaction);
      const header = { code: data.code, company_unit_id: data.company_unit_id, due_date: data.due_date, note: data.note || null };
      if (row) { await row.update(header, { transaction }); await Line.destroy({ where: { request_id: id }, transaction }); }
      else row = await Request.create({ ...header, created_by: user.id, status: 'DRAFT' }, { transaction });
      await Line.bulkCreate(data.items.map(i => ({ ...i, condition_id: i.condition_id || null, request_id: row.id })), { transaction });
      return row.id;
    });
    return request(key, user);
  } catch (e) { if (e instanceof UniqueConstraintError) fail(409, 'Mã yêu cầu đã tồn tại'); throw e; }
}
async function transition(id, action, user, note) {
  await sequelize.transaction(async transaction => {
    const row = await Request.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) fail(404, 'Không tìm thấy yêu cầu');
    await scope(user, row.company_unit_id, transaction);
    if (['CANCEL', 'SUBMITTED'].includes(action) && user.role.code !== 'COMPANY_ADMIN') fail(403, 'Chỉ Đại đội được gửi hoặc hủy yêu cầu');
    if (action === 'CANCEL') { if (row.status !== 'DRAFT' && row.status !== 'SUBMITTED') fail(409, 'Không thể hủy yêu cầu này'); }
    else if (action === 'SUBMITTED') { if (row.status !== 'DRAFT') fail(409, 'Yêu cầu không còn là nháp'); }
    else { admin(user); if (row.status !== 'SUBMITTED' || !['APPROVED', 'REJECTED'].includes(action)) fail(409, 'Trạng thái không cho phép duyệt/từ chối'); }
    await row.update({ status: action === 'CANCEL' ? 'CANCELLED' : action, ...(action === 'APPROVED' || action === 'REJECTED' ? { decided_by: user.id, decided_at: new Date(), decision_note: note || null } : {}) }, { transaction });
  });
  return request(id, user);
}
async function references(user) {
  if (user.role.code === 'BATTALION_ADMIN') admin(user);
  else await scope(user, user.unit_id);
  const [sources, conditions] = await Promise.all([Source.findAll({ order: [['code', 'ASC']] }), Condition.findAll({ order: [['code', 'ASC']] })]);
  return { sources: sources.map(plain), conditions: conditions.map(plain) };
}
async function borrowedAt(user, q) {
  admin(user);
  const location = await Location.findByPk(q.location_id);
  if (!location?.is_active || !location.is_stock_holding) fail(400, 'Địa điểm không hợp lệ');
  const where = { borrow_line_id: { [Op.ne]: null }, unit_id: q.unit_id, location_id: q.location_id,
    ...(q.material_id ? { material_id: q.material_id } : {}) };
  await scope(user, q.unit_id);
  const rows = await Ledger.findAll({ where, attributes: ['borrow_line_id', 'material_id', 'source_id', 'condition_id',
    [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']],
  group: ['borrow_line_id', 'material_id', 'source_id', 'condition_id'], raw: true });
  const positive = rows.filter(r => BigInt(r.quantity) > 0n);
  const lines = await Line.findAll({ where: { id: positive.map(r => r.borrow_line_id) }, attributes: ['id', 'request_id'] });
  const requests = await Request.findAll({ where: { id: lines.map(l => l.request_id) }, attributes: ['id', 'code'] });
  return positive.map(r => ({ ...r, quantity: String(r.quantity), request_code: requests.find(req => String(req.id) === String(lines.find(l => String(l.id) === String(r.borrow_line_id))?.request_id))?.code }));
}
async function place(id, transaction, battalion = false) {
  const row = await Location.findByPk(id, { transaction });
  if (!row?.is_active || !row.is_stock_holding || battalion && !(row.type === 'WAREHOUSE' && String(row.owner_unit_id) === String(battalion))) fail(400, 'Địa điểm không hợp lệ');
  const seen = new Set(); let parent = row;
  while (parent) { if (seen.has(String(parent.id)) || !parent.is_active) fail(409, 'Cây địa điểm không hợp lệ'); seen.add(String(parent.id)); parent = parent.parent_location_id ? await Location.findByPk(parent.parent_location_id, { transaction }) : null; }
  return row;
}
async function delivery(id, data, user) {
  admin(user);
  await sequelize.transaction(async transaction => {
    const row = await Request.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) fail(404, 'Không tìm thấy yêu cầu');
    await scope(user, row.company_unit_id, transaction);
    if (row.status !== 'APPROVED') fail(409, 'Yêu cầu chưa duyệt hoặc đã giao');
    const from = await (data.from_location_id ? place(data.from_location_id, transaction, user.unit_id) : legacyLocation(user.unit_id, transaction));
    const to = await place(data.to_location_id, transaction);
    if (to.type !== 'ROOM' && !(to.type === 'COMPANY_STORE' && String(to.owner_unit_id) === String(row.company_unit_id))) fail(400, 'Nơi nhận phải là phòng hoặc Kho Đại đội nhận');
    const lines = await Line.findAll({ where: { request_id: id }, transaction, order: [['id', 'ASC']] });
    if (!lines.length) fail(409, 'Yêu cầu không có dòng vật chất');
    await validateLines(lines, transaction);
    for (const mid of [...new Set(lines.map(l => String(l.material_id)))].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1)) await Material.findByPk(mid, { transaction, lock: transaction.LOCK.UPDATE });
    for (const line of lines) await requireBalance({ ...line.get(), unit_id: user.unit_id, location_id: from.id }, line.quantity, transaction);
    const now = new Date();
    const doc = await Delivery.create({ request_id: id, from_location_id: from.id, to_location_id: to.id, confirmed_by: user.id, confirmed_at: now }, { transaction });
    for (const line of lines) {
      const common = { borrow_line_id: line.id, borrow_delivery_id: doc.id, material_id: line.material_id, source_id: line.source_id, condition_id: line.condition_id, transaction_type: 'BORROW', reference_type: 'BORROW_DELIVERY', reference_id: doc.id, occurred_at: now, created_by: user.id };
      await Ledger.create({ ...common, borrow_line_id: null, unit_id: user.unit_id, location_id: from.id, quantity_delta: -Number(line.quantity), transfer_side: 'OUT' }, { transaction });
      await Ledger.create({ ...common, unit_id: row.company_unit_id, location_id: to.id, quantity_delta: line.quantity, transfer_side: 'IN' }, { transaction });
    }
    await row.update({ status: 'DELIVERED' }, { transaction });
  });
  return request(id, user);
}
async function returnSave(requestId, returnId, data, user) {
  if (user.role.code === 'BATTALION_ADMIN') admin(user);
  else if (user.role.code !== 'COMPANY_ADMIN') fail(403, 'Forbidden');
  const key = await sequelize.transaction(async transaction => {
    const row = await Request.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) fail(404, 'Không tìm thấy yêu cầu');
    await scope(user, row.company_unit_id, transaction);
    if (!['DELIVERED', 'PARTIAL'].includes(row.status)) fail(409, 'Chưa giao hoặc đã trả hết');
    const delivery = await Delivery.findOne({ where: { request_id: requestId }, transaction });
    if (!delivery) fail(409, 'Chưa có phiếu giao');
    // The company may request a return to a battalion warehouse, never choose a company/room destination.
    const battalionId = user.role.code === 'COMPANY_ADMIN' ? (await Unit.findByPk(row.company_unit_id, { transaction })).parent_id : user.unit_id;
    const to = await place(data.to_location_id || delivery.from_location_id, transaction, battalionId);
    const ids = new Set();
    for (const item of data.items) {
      if (ids.has(String(item.borrow_line_id))) fail(400, 'Dòng trả bị trùng'); ids.add(String(item.borrow_line_id));
      const line = await Line.findByPk(item.borrow_line_id, { transaction });
      if (!line || String(line.request_id) !== String(requestId)) fail(400, 'Dòng mượn không thuộc yêu cầu');
      await place(item.from_location_id, transaction);
      // A shared room is allowed only when this company's tagged stock is actually present.
      if (user.role.code === 'COMPANY_ADMIN') await requireBalance({ ...line.get(), unit_id: row.company_unit_id, location_id: item.from_location_id, borrow_line_id: line.id }, item.quantity, transaction);
      const confirmed = await Return.findAll({ where: { request_id: requestId, status: 'POSTED' }, include: [{ model: ReturnLine, as: 'items', where: { borrow_line_id: item.borrow_line_id }, required: true }], transaction });
      const already = confirmed.flatMap(r => r.items).reduce((sum, i) => sum + BigInt(i.quantity), 0n);
      if (already + BigInt(item.quantity) > BigInt(line.quantity)) fail(409, 'Số trả vượt số còn phải trả');
    }
    let ret;
    if (returnId) {
      ret = await Return.findByPk(returnId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!ret || String(ret.request_id) !== String(requestId)) fail(404, 'Không tìm thấy phiếu trả');
      if (user.role.code === 'COMPANY_ADMIN' && String(ret.created_by) !== String(user.id)) fail(403, 'Forbidden');
      if (ret.status !== 'DRAFT') fail(409, 'Phiếu trả không còn là nháp');
      await ret.update({ to_location_id: to.id }, { transaction });
      await ReturnLine.destroy({ where: { return_id: returnId }, transaction });
    } else ret = await Return.create({ request_id: requestId, to_location_id: to.id, created_by: user.id }, { transaction });
    await ReturnLine.bulkCreate(data.items.map(i => ({ ...i, return_id: ret.id })), { transaction });
    return ret.id;
  });
  return { id: String(key) };
}
async function returnRemove(requestId, returnId, user) {
  if (user.role.code === 'BATTALION_ADMIN') admin(user);
  else if (user.role.code !== 'COMPANY_ADMIN') fail(403, 'Forbidden');
  await sequelize.transaction(async transaction => {
    const row = await Request.findByPk(requestId, { transaction });
    if (!row) fail(404, 'Không tìm thấy yêu cầu');
    await scope(user, row.company_unit_id, transaction);
    const ret = await Return.findByPk(returnId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!ret || String(ret.request_id) !== String(requestId)) fail(404, 'Không tìm thấy phiếu trả');
    if (user.role.code === 'COMPANY_ADMIN' && String(ret.created_by) !== String(user.id)) fail(403, 'Forbidden');
    if (ret.status !== 'DRAFT') fail(409, 'Không thể xóa phiếu đã xác nhận');
    await ReturnLine.destroy({ where: { return_id: returnId }, transaction }); await ret.destroy({ transaction });
  });
}
async function returnPost(requestId, returnId, user) {
  admin(user);
  await sequelize.transaction(async transaction => {
    const row = await Request.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) fail(404, 'Không tìm thấy yêu cầu');
    await scope(user, row.company_unit_id, transaction);
    if (!['DELIVERED', 'PARTIAL'].includes(row.status)) fail(409, 'Yêu cầu không còn khoản phải trả');
    const ret = await Return.findByPk(returnId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!ret || String(ret.request_id) !== String(requestId) || ret.status !== 'DRAFT') fail(409, 'Phiếu trả đã xác nhận hoặc không hợp lệ');
    const items = await ReturnLine.findAll({ where: { return_id: returnId }, transaction, order: [['id', 'ASC']] });
    if (!items.length) fail(400, 'Phiếu trả cần ít nhất một dòng');
    const to = await place(ret.to_location_id, transaction, user.unit_id);
    const lines = await Line.findAll({ where: { request_id: requestId }, transaction });
    const map = new Map(lines.map(l => [String(l.id), l]));
    for (const mid of [...new Set(lines.map(l => String(l.material_id)))].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1)) await Material.findByPk(mid, { transaction, lock: transaction.LOCK.UPDATE });
    const seen = new Set();
    for (const item of items) {
      const line = map.get(String(item.borrow_line_id));
      if (!line || seen.has(String(item.borrow_line_id))) fail(400, 'Dòng trả không hợp lệ hoặc bị trùng');
      seen.add(String(item.borrow_line_id));
      await place(item.from_location_id, transaction);
      await requireBalance({ ...line.get(), unit_id: row.company_unit_id, location_id: item.from_location_id, borrow_line_id: line.id }, item.quantity, transaction);
    }
    const now = new Date();
    for (const item of items) {
      const line = map.get(String(item.borrow_line_id));
      const common = { material_id: line.material_id, source_id: line.source_id, condition_id: line.condition_id, borrow_line_id: line.id, borrow_return_line_id: item.id, transaction_type: 'RETURN', reference_type: 'BORROW_RETURN', reference_id: ret.id, occurred_at: now, created_by: user.id };
      await Ledger.create({ ...common, unit_id: row.company_unit_id, location_id: item.from_location_id, quantity_delta: -Number(item.quantity), transfer_side: 'OUT' }, { transaction });
      await Ledger.create({ ...common, borrow_line_id: null, unit_id: user.unit_id, location_id: to.id, quantity_delta: item.quantity, transfer_side: 'IN' }, { transaction });
    }
    await ret.update({ status: 'POSTED', confirmed_by: user.id, confirmed_at: now }, { transaction });
    const all = await Return.findAll({ where: { request_id: requestId, status: 'POSTED' }, include: [{ model: ReturnLine, as: 'items' }], transaction });
    const done = new Map();
    for (const r of all) for (const i of r.items) done.set(String(i.borrow_line_id), (done.get(String(i.borrow_line_id)) || 0n) + BigInt(i.quantity));
    if (lines.some(l => (done.get(String(l.id)) || 0n) > BigInt(l.quantity))) fail(409, 'Trả vượt lượng đã mượn');
    await row.update({ status: lines.every(l => (done.get(String(l.id)) || 0n) === BigInt(l.quantity)) ? 'RETURNED' : 'PARTIAL' }, { transaction });
  });
  return request(requestId, user);
}
module.exports = { request, list, save, transition, delivery, returnSave, returnRemove, returnPost, borrowedAt, references };
