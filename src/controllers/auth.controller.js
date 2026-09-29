const auth = require('../services/auth.service');

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !username.trim() || username.length > 100 ||
        typeof password !== 'string' || !password || password.length > 1024) {
      return res.status(400).json({ success: false, message: 'Invalid login input', data: null });
    }
    const data = await auth.login(username.trim(), password);
    if (!data) return res.status(401).json({ success: false, message: 'Invalid credentials', data: null });
    return res.json({ success: true, message: 'Login successful', data });
  } catch (error) { return next(error); }
}

async function me(req, res) {
  return res.json({ success: true, message: 'Current user', data: auth.publicUser(req.user) });
}

const { validPassword } = require('../services/password.service');
const safe = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => keys.includes(key));
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const invalid = res => res.status(400).json({ success: false, message: 'Invalid input', data: null });
const google = handle(async (req, res) => {
  if (!safe(req.body, ['credential'])) return invalid(res);
  return res.json({ success: true, data: await auth.googleLogin(req.body.credential) });
});
const link = handle(async (req, res) => {
  if (!safe(req.body, ['credential', 'current_password'])) return invalid(res);
  await auth.linkGoogle(req.user, req.body.credential, req.body.current_password);
  return res.json({ success: true, data: null });
});
const change = handle(async (req, res) => {
  if (!safe(req.body, ['current_password', 'new_password']) || !validPassword(req.body.new_password) || typeof req.body.current_password !== 'string') return invalid(res);
  await auth.changePassword(req.user, req.body.current_password, req.body.new_password);
  return res.json({ success: true, data: null });
});
const forgot = handle(async (req, res) => {
  if (!safe(req.body, ['credential', 'new_password']) || !validPassword(req.body.new_password)) return invalid(res);
  await auth.googleReset(req.body.credential, req.body.new_password);
  return res.json({ success: true, data: null });
});
module.exports = { login, me, google, link, change, forgot };
