const service = require('../services/stock.service');
const ApiError = require('../utils/ApiError');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const id = v => typeof v === 'string' && /^[1-9]\d{0,19}$/.test(v) && BigInt(v) <= 18446744073709551615n;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const text = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
const bad = () => { throw new ApiError(400, 'Dữ liệu phiếu không hợp lệ'); };
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(k => !['code', 'receipt_type', 'receipt_date', 'source_id', 'document_no', 'note', 'items'].includes(k))) bad();
  if (typeof body.code !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(body.code) || !['OPENING_BALANCE', 'NORMAL_RECEIPT'].includes(body.receipt_type) || !date(body.receipt_date) ||
    (body.source_id != null && !id(body.source_id)) || !text(body.document_no, 120) || !text(body.note, 5000) || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) bad();
  for (const item of body.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !['material_id', 'source_id', 'condition_id', 'quantity', 'note'].includes(k)) ||
      !id(item.material_id) || !id(item.source_id) || (item.condition_id != null && !id(item.condition_id)) ||
      !(typeof item.quantity === 'number' && Number.isSafeInteger(item.quantity) && item.quantity > 0) || !text(item.note, 5000)) bad();
  }
  return body;
}
const query = (q, keys) => {
  if (Object.keys(q).some(k => !keys.includes(k)) || (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 100)) ||
    (q.page !== undefined && !/^[1-9]\d{0,5}$/.test(q.page)) || (q.material_id !== undefined && !id(q.material_id)) ||
    (q.category_id !== undefined && !id(q.category_id)) || (q.status !== undefined && !['DRAFT', 'POSTED'].includes(q.status)) ||
    (q.receipt_type !== undefined && !['OPENING_BALANCE', 'NORMAL_RECEIPT'].includes(q.receipt_type)) ||
    (q.from !== undefined && !date(q.from)) || (q.to !== undefined && !date(q.to)) || (q.from && q.to && q.from > q.to)) bad();
  return q;
};
module.exports = {
  references: handle(async (req, res) => res.json({ success: true, data: await service.references() })),
  list: handle(async (req, res) => res.json({ success: true, data: await service.list(query(req.query, ['search', 'status', 'receipt_type', 'from', 'to', 'page'])) })),
  detail: handle(async (req, res) => { if (!id(req.params.id)) bad(); res.json({ success: true, data: await service.get(req.params.id) }); }),
  create: handle(async (req, res) => res.status(201).json({ success: true, data: await service.save(null, validate(req.body), req.user) })),
  update: handle(async (req, res) => { if (!id(req.params.id)) bad(); res.json({ success: true, data: await service.save(req.params.id, validate(req.body), req.user) }); }),
  remove: handle(async (req, res) => { if (!id(req.params.id)) bad(); await service.remove(req.params.id); res.json({ success: true, data: null }); }),
  post: handle(async (req, res) => { if (!id(req.params.id) || Object.keys(req.body || {}).length) bad(); res.json({ success: true, data: await service.post(req.params.id, req.user) }); }),
  ledger: handle(async (req, res) => res.json({ success: true, data: await service.ledger({ ...query(req.query, ['material_id', 'page']), unitId: req.user.unit_id }) })),
  balance: handle(async (req, res) => res.json({ success: true, data: await service.balance({ ...query(req.query, ['search', 'category_id', 'material_id']), unitId: req.user.unit_id }) })),
};
