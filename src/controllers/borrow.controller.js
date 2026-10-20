const service = require('../services/borrow.service');
const ApiError = require('../utils/ApiError');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const bad = () => { throw new ApiError(400, 'Dữ liệu mượn/trả không hợp lệ'); };
const id = v => /^[1-9]\d{0,19}$/.test(String(v)) && BigInt(v) <= 18446744073709551615n;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
const qty = v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
function request(body) {
  if (!keys(body, ['code', 'company_unit_id', 'due_date', 'note', 'items']) || typeof body.code !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(body.code) || !id(body.company_unit_id) || !date(body.due_date) || body.note != null && (typeof body.note !== 'string' || body.note.length > 5000) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) bad();
  for (const i of body.items) if (!keys(i, ['material_id', 'source_id', 'condition_id', 'quantity']) || !id(i.material_id) || !id(i.source_id) || i.condition_id != null && !id(i.condition_id) || !qty(i.quantity)) bad();
  return body;
}
function returns(body) {
  if (!keys(body, ['to_location_id', 'items']) || body.to_location_id != null && !id(body.to_location_id) || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) bad();
  for (const i of body.items) if (!keys(i, ['borrow_line_id', 'from_location_id', 'quantity']) || !id(i.borrow_line_id) || !id(i.from_location_id) || !qty(i.quantity)) bad();
  return body;
}
function query(q) {
  if (!keys(q, ['search', 'status', 'company_unit_id', 'from', 'to', 'overdue', 'page']) || q.search != null && (typeof q.search !== 'string' || q.search.length > 100) || q.status != null && !['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIAL', 'RETURNED'].includes(q.status) || q.company_unit_id != null && !id(q.company_unit_id) || q.page != null && !/^[1-9]\d{0,5}$/.test(q.page) || q.from != null && !date(q.from) || q.to != null && !date(q.to) || q.from && q.to && q.from > q.to || q.overdue != null && q.overdue !== 'true') bad();
  return q;
}
const send = (res, data, status = 200) => res.status(status).json({ success: true, data });
const check = req => { if (!id(req.params.id) || req.params.returnId && !id(req.params.returnId)) bad(); };
module.exports = {
  list: handle(async (req, res) => send(res, await service.list(query(req.query), req.user))),
  references: handle(async (req, res) => send(res, await service.references(req.user))),
  borrowedAt: handle(async (req, res) => { if (!keys(req.query, ['unit_id', 'location_id', 'material_id']) || !id(req.query.unit_id) || !id(req.query.location_id) || req.query.material_id != null && !id(req.query.material_id)) bad(); send(res, await service.borrowedAt(req.user, req.query)); }),
  detail: handle(async (req, res) => { check(req); send(res, await service.request(req.params.id, req.user)); }),
  create: handle(async (req, res) => send(res, await service.save(null, request(req.body), req.user), 201)),
  update: handle(async (req, res) => { check(req); send(res, await service.save(req.params.id, request(req.body), req.user)); }),
  action: action => handle(async (req, res) => { check(req); if (!keys(req.body, action === 'REJECTED' || action === 'APPROVED' ? ['note'] : []) || req.body.note != null && (typeof req.body.note !== 'string' || req.body.note.length > 5000)) bad(); send(res, await service.transition(req.params.id, action, req.user, req.body.note)); }),
  deliver: handle(async (req, res) => { check(req); if (!keys(req.body, ['from_location_id', 'to_location_id']) || !id(req.body.to_location_id) || req.body.from_location_id != null && !id(req.body.from_location_id)) bad(); send(res, await service.delivery(req.params.id, req.body, req.user)); }),
  returnCreate: handle(async (req, res) => { check(req); send(res, await service.returnSave(req.params.id, null, returns(req.body), req.user), 201); }),
  returnUpdate: handle(async (req, res) => { check(req); send(res, await service.returnSave(req.params.id, req.params.returnId, returns(req.body), req.user)); }),
  returnRemove: handle(async (req, res) => { check(req); if (Object.keys(req.body || {}).length) bad(); await service.returnRemove(req.params.id, req.params.returnId, req.user); send(res, null); }),
  returnPost: handle(async (req, res) => { check(req); if (Object.keys(req.body || {}).length) bad(); send(res, await service.returnPost(req.params.id, req.params.returnId, req.user)); }),
};
