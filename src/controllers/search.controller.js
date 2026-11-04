const service = require('../services/search.service');
const ApiError = require('../utils/ApiError');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const bad = () => { throw new ApiError(400, 'Bộ lọc tra cứu không hợp lệ'); };
const id = v => typeof v === 'string' && /^[1-9]\d{0,19}$/.test(v) && BigInt(v) <= 18446744073709551615n;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
function dimensions(q) {
  const allowed = ['unit_id', 'location_id', 'descendants', 'source_id', 'condition_id'];
  if (Object.keys(q).some(k => !allowed.includes(k)) || ['unit_id', 'location_id', 'source_id'].some(k => q[k] != null && !id(q[k])) ||
      q.condition_id != null && q.condition_id !== 'null' && !id(q.condition_id) ||
      q.descendants != null && !['true', 'false'].includes(q.descendants) || q.descendants != null && !q.location_id) bad();
  return q;
}
function historyQuery(q) {
  const allowed = [...['unit_id', 'location_id', 'descendants', 'source_id', 'condition_id'], 'transaction_type', 'from', 'to', 'page'];
  if (Object.keys(q).some(k => !allowed.includes(k)) || ['unit_id', 'location_id', 'source_id'].some(k => q[k] != null && !id(q[k])) ||
    q.condition_id != null && q.condition_id !== 'null' && !id(q.condition_id) ||
    q.descendants != null && !['true', 'false'].includes(q.descendants) || q.descendants != null && !q.location_id ||
    q.transaction_type != null && (typeof q.transaction_type !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(q.transaction_type)) ||
    q.from != null && !date(q.from) || q.to != null && !date(q.to) || q.from && q.to && q.from > q.to ||
    q.page != null && !/^[1-9]\d{0,5}$/.test(q.page)) bad();
  return q;
}
function query(q) {
  const allowed = ['search', 'unit_id', 'location_id', 'descendants', 'source_id', 'condition_id', 'include_zero', 'sort', 'direction', 'page'];
  if (Object.keys(q).some(k => !allowed.includes(k)) || ['unit_id', 'location_id', 'source_id'].some(k => q[k] != null && !id(q[k])) ||
      q.condition_id != null && q.condition_id !== 'null' && !id(q.condition_id) ||
      ['include_zero', 'descendants'].some(k => q[k] != null && !['true', 'false'].includes(q[k])) ||
      q.descendants != null && !q.location_id ||
      q.search != null && (typeof q.search !== 'string' || q.search.length > 100) ||
      q.page != null && !/^[1-9]\d{0,5}$/.test(q.page) ||
      q.sort != null && !['code', 'name', 'physical', 'available', 'borrowed'].includes(q.sort) ||
      q.direction != null && !['asc', 'desc'].includes(q.direction)) bad();
  return q;
}
module.exports = {
  list: handle(async (req, res) => res.json({ success: true, data: await service.list(query(req.query), req.user) })),
  units: handle(async (req, res) => { if (Object.keys(req.query).length) bad(); res.json({ success: true, data: await service.units(req.user) }); }),
  detail: handle(async (req, res) => { if (!id(req.params.id)) bad(); res.json({ success: true, data: await service.detail(req.params.id, dimensions(req.query), req.user) }); }),
  history: handle(async (req, res) => { if (!id(req.params.id)) bad(); res.json({ success: true, data: await service.history(req.params.id, historyQuery(req.query), req.user) }); }),
};
