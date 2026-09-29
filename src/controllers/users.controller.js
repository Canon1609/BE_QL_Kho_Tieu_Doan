const users = require('../services/users.service');
const { validPassword } = require('../services/password.service');
const respond = (res, data) => res.json({ success: true, data });
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const validId = id => /^[1-9]\d*$/.test(String(id));
const allowed = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) &&
  Object.keys(body).every(key => keys.includes(key));
const validProfile = body => typeof body?.username === 'string' && /^[a-zA-Z0-9_]{3,100}$/.test(body.username) &&
  typeof body.full_name === 'string' && !!body.full_name.trim() && body.full_name.trim().length <= 150 && validId(body.unit_id);

const list = handle(async (_req, res) => respond(res, await users.list()));
const units = handle(async (_req, res) => respond(res, await users.companyUnits()));
const detail = handle(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid user id' });
  return respond(res, await users.get(req.params.id));
});
const create = handle(async (req, res) => {
  const { username, full_name, password, unit_id } = req.body || {};
  if (!allowed(req.body, ['username', 'full_name', 'password', 'unit_id']) || !validProfile(req.body) ||
      !validPassword(password))
    return res.status(400).json({ success: false, message: 'Invalid account input' });
  const user = await users.createCompany({ username, full_name: full_name.trim(), password, unit_id });
  return res.status(201).json({ success: true, data: user });
});
const update = handle(async (req, res) => {
  if (!validId(req.params.id) || !allowed(req.body, ['username', 'full_name', 'unit_id']) || !validProfile(req.body))
    return res.status(400).json({ success: false, message: 'Invalid account input' });
  return respond(res, await users.updateCompany(req.params.id, req.body));
});
const active = handle(async (req, res) => {
  if (!validId(req.params.id) || !allowed(req.body, ['is_active']) || typeof req.body?.is_active !== 'boolean') return res.status(400).json({ success: false, message: 'Invalid status input' });
  return respond(res, await users.setActive(req.params.id, req.body.is_active, req.user.id));
});
const remove = handle(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid user id' });
  await users.removeCompany(req.params.id, req.user.id);
  return res.json({ success: true, data: null });
});
const resetPassword = handle(async (req, res) => {
  if (!validId(req.params.id) || !allowed(req.body, ['new_password']) || !validPassword(req.body?.new_password))
    return res.status(400).json({ success: false, message: 'Invalid password input' });
  await users.resetCompanyPassword(req.params.id, req.body.new_password);
  return respond(res, null);
});
module.exports = { list, units, detail, create, update, active, remove, resetPassword };
