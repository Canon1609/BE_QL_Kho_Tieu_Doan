const service = require('../services/location-management.service');
const ApiError = require('../utils/ApiError');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const { validate, id } = require('../validators/location.validation');
const bad = () => { throw new ApiError(400, 'Dữ liệu địa điểm không hợp lệ'); };
function query(q) {
  if (Object.keys(q).some(k => !['unit_id', 'material_id', 'location_id', 'descendants'].includes(k)) || ['unit_id', 'material_id', 'location_id'].some(k => q[k] != null && !id(q[k])) || q.descendants != null && !['true', 'false'].includes(q.descendants)) bad();
  return q;
}
const send = (res, data, status = 200) => res.status(status).json({ success: true, data });
module.exports = {
  list: handle(async (req, res) => { if (Object.keys(req.query).length) bad(); send(res, await service.list(req.user)); }),
  units: handle(async (req, res) => { if (Object.keys(req.query).length) bad(); send(res, await service.managedUnits(req.user)); }),
  detail: handle(async (req, res) => { if (!id(req.params.id)) bad(); send(res, await service.detail(req.params.id, req.user)); }),
  balance: handle(async (req, res) => send(res, await service.balances(req.user, query(req.query)))),
  create: handle(async (req, res) => send(res, await service.save(null, validate(req.body), req.user), 201)),
  update: handle(async (req, res) => { if (!id(req.params.id)) bad(); send(res, await service.save(req.params.id, validate(req.body), req.user)); }),
  remove: handle(async (req, res) => { if (!id(req.params.id)) bad(); await service.remove(req.params.id, req.user); send(res, null); }),
};
