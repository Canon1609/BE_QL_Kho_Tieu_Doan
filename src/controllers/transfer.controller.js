const service = require('../services/transfer.service');
const ApiError = require('../utils/ApiError');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const bad = () => { throw new ApiError(400, 'Dữ liệu phiếu không hợp lệ'); };
const id = v => typeof v === 'string' && /^[1-9]\d{0,19}$/.test(v) && BigInt(v) <= 18446744073709551615n;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const text = (v, max) => v == null || typeof v === 'string' && v.length <= max;
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['code', 'transfer_type', 'transfer_date', 'company_unit_id', 'document_no', 'note', 'items'].includes(k)) ||
    typeof body.code !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(body.code) || !['ISSUE', 'RECALL'].includes(body.transfer_type) || !date(body.transfer_date) ||
    !id(String(body.company_unit_id)) || !text(body.document_no, 120) || !text(body.note, 5000) || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) bad();
  for (const item of body.items) if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !['material_id', 'source_id', 'condition_id', 'quantity', 'note'].includes(k)) ||
    !id(String(item.material_id)) || !id(String(item.source_id)) || item.condition_id != null && !id(String(item.condition_id)) ||
    typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !text(item.note, 5000)) bad();
  return body;
}
function query(q, keys) {
  if (Object.keys(q).some(k => !keys.includes(k)) || q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 100) ||
    q.page !== undefined && !/^[1-9]\d{0,5}$/.test(q.page) || ['unit_id', 'material_id'].some(k => q[k] !== undefined && !id(q[k])) ||
    q.status !== undefined && !['DRAFT', 'POSTED'].includes(q.status) || q.transfer_type !== undefined && !['ISSUE', 'RECALL'].includes(q.transfer_type) ||
    ['from', 'to'].some(k => q[k] !== undefined && !date(q[k])) || q.from && q.to && q.from > q.to) bad();
  return q;
}
const send = (res, data, status = 200) => res.status(status).json({ success: true, data });
module.exports = {
  units: handle(async (req, res) => send(res, await service.units(req.user))),
  list: handle(async (req, res) => send(res, await service.list(query(req.query, ['search', 'status', 'transfer_type', 'from', 'to', 'unit_id', 'material_id', 'page'])))),
  detail: handle(async (req, res) => { if (!id(req.params.id)) bad(); send(res, await service.get(req.params.id)); }),
  create: handle(async (req, res) => send(res, await service.save(null, validate(req.body), req.user), 201)),
  update: handle(async (req, res) => { if (!id(req.params.id)) bad(); send(res, await service.save(req.params.id, validate(req.body), req.user)); }),
  remove: handle(async (req, res) => { if (!id(req.params.id)) bad(); await service.remove(req.params.id, req.user); send(res, null); }),
  post: handle(async (req, res) => { if (!id(req.params.id) || Object.keys(req.body || {}).length) bad(); send(res, await service.post(req.params.id, req.user)); }),
  assets: handle(async (req, res) => { if (!id(req.params.unitId)) bad(); send(res, await service.assets(req.params.unitId, req.user, query(req.query, ['search', 'material_id']))); }),
  history: handle(async (req, res) => { if (!id(req.params.unitId)) bad(); send(res, await service.history(req.params.unitId, req.user, query(req.query, ['material_id', 'page']))); }),
};
