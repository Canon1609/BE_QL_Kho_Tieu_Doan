const service = require('../services/dashboard.service');
const ApiError = require('../utils/ApiError');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const id = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function validate(query) {
  if (Object.keys(query).some(key => !['unit_id', 'material_id', 'source_id', 'condition_id', 'location_id', 'from', 'to', 'year'].includes(key)) ||
    ['unit_id', 'material_id', 'source_id', 'location_id'].some(key => query[key] != null && !id(query[key])) ||
    query.condition_id != null && query.condition_id !== 'null' && !id(query.condition_id) || query.from != null && !date(query.from) ||
    query.to != null && !date(query.to) || query.from && query.to && query.from > query.to) {
    throw new ApiError(400, 'Bộ lọc tổng quan không hợp lệ');
  }
  const currentYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date()));
  if (query.year != null && (!/^\d{4}$/.test(query.year) || Number(query.year) < 2024 || Number(query.year) > currentYear + 1)) throw new ApiError(400, 'Năm thống kê không hợp lệ');
  return query;
}
module.exports = {
  summary: handle(async (req, res) => res.json({ success: true, data: await service.getDashboard(validate(req.query), req.user) })),
  filters: handle(async (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'unit_id') || req.query.unit_id != null && !id(req.query.unit_id)) throw new ApiError(400, 'Bộ lọc tổng quan không hợp lệ');
    res.json({ success:true, data: await service.filters(req.user, req.query.unit_id) });
  }),
  units: handle(async (req, res) => {
    if (Object.keys(req.query).some(key => !['unit_id'].includes(key)) || req.query.unit_id != null && !id(req.query.unit_id)) throw new ApiError(400, 'Bộ lọc tổng quan không hợp lệ');
    res.json({ success: true, data: await service.units(req.user, req.query.unit_id) });
  }),
};
