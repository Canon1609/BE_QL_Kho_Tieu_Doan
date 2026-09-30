const service = require('../services/material-master.service');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const bad = (res, message = 'Dữ liệu danh mục không hợp lệ') => res.status(400).json({ success: false, message, data: null });
const validId = id => /^[1-9]\d{0,19}$/.test(String(id)) && BigInt(id) <= 18446744073709551615n;
const text = (value, max) => typeof value === 'string' && !!value.trim() && value.trim().length <= max;
const code = value => text(value, 64) && /^[A-Z0-9][A-Z0-9_-]*$/.test(value);
const kinds = ['categories', 'units', 'materials'];
const kindOf = req => kinds.includes(req.params.kind) ? req.params.kind : null;
function validate(req, statusOnly = false) {
  const kind = kindOf(req), body = req.body;
  if (!kind || !body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = statusOnly ? ['is_active'] : ['code', 'name', 'description', 'is_active', ...(kind === 'materials' ? ['category_id', 'unit_id'] : [])];
  if (!Object.keys(body).length || Object.keys(body).some(key => !keys.includes(key))) return null;
  if (statusOnly) return typeof body.is_active === 'boolean' ? body : null;
  if ('code' in body && !code(body.code)) return null;
  if ('name' in body && !text(body.name, 150)) return null;
  if ('description' in body && body.description !== null && (typeof body.description !== 'string' || body.description.length > 5000)) return null;
  if ('is_active' in body && typeof body.is_active !== 'boolean') return null;
  if (kind === 'materials' && ['category_id', 'unit_id'].some(key => key in body && !validId(body[key]))) return null;
  if (req.method === 'POST' && (!('code' in body) || !('name' in body) || (kind === 'materials' && (!('category_id' in body) || !('unit_id' in body))))) return null;
  return { ...body, ...(body.name ? { name: body.name.trim() } : {}) };
}
const queryValid = q => Object.keys(q).every(key => ['search', 'is_active', 'category_id', 'page', 'limit'].includes(key)) &&
  (q.search === undefined || (typeof q.search === 'string' && q.search.length <= 100)) &&
  (q.is_active === undefined || ['true', 'false'].includes(q.is_active)) &&
  (q.category_id === undefined || validId(q.category_id)) &&
  (q.page === undefined || (/^[1-9]\d{0,5}$/.test(q.page))) &&
  (q.limit === undefined || (/^[1-9]\d?$|^100$/.test(q.limit)));
const list = handle(async (req, res) => {
  if (!kindOf(req) || !queryValid(req.query) || (req.params.kind !== 'materials' && req.query.category_id !== undefined)) return bad(res);
  return res.json({ success: true, data: await service.list(req.params.kind, req.query) });
});
const detail = handle(async (req, res) => {
  if (!kindOf(req) || !validId(req.params.id)) return bad(res);
  return res.json({ success: true, data: await service.get(req.params.kind, req.params.id) });
});
const create = handle(async (req, res) => {
  const data = validate(req);
  if (!data) return bad(res);
  return res.status(201).json({ success: true, data: await service.create(req.params.kind, data) });
});
const update = handle(async (req, res) => {
  const data = validate(req);
  if (!data || !validId(req.params.id)) return bad(res);
  return res.json({ success: true, data: await service.update(req.params.kind, req.params.id, data) });
});
const active = handle(async (req, res) => {
  const data = validate(req, true);
  if (!data || !validId(req.params.id)) return bad(res);
  return res.json({ success: true, data: await service.update(req.params.kind, req.params.id, data) });
});
const remove = handle(async (req, res) => {
  if (!kindOf(req) || !validId(req.params.id)) return bad(res);
  await service.remove(req.params.kind, req.params.id);
  return res.json({ success: true, data: null });
});
module.exports = { list, detail, create, update, active, remove };
