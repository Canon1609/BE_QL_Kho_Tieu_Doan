const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Role, Unit } = require('../models');
const { OAuth2Client } = require('google-auth-library');
const { replacePassword, failure } = require('./password.service');

const publicUser = (user) => ({
  id: String(user.id), username: user.username, full_name: user.full_name,
  role: { code: user.role.code, name: user.role.name },
  unit: { id: String(user.unit.id), code: user.unit.code, name: user.unit.name },
});

const findUser = (where) => User.findOne({ where, include: [
  { model: Role, as: 'role', attributes: ['code', 'name'] },
  { model: Unit, as: 'unit', attributes: ['id', 'code', 'name', 'type', 'is_active'] },
] });

const eligible = user => user && user.is_active && user.role && user.unit?.is_active;
function issueToken(user) {
  const { secret, expiresIn } = jwtConfig();
  return jwt.sign({ sub: String(user.id), ver: user.auth_version }, secret, { algorithm: 'HS256', expiresIn });
}
async function googleIdentity(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw failure(400, 'Google Sign-In is not configured');
  if (typeof credential !== 'string' || credential.length > 8192 || !credential) throw failure(400, 'Invalid Google credential');
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email_verified) throw Error('Unverified identity');
    return payload.sub;
  } catch { throw failure(401, 'Google verification failed'); }
}
async function googleLogin(credential) {
  const sub = await googleIdentity(credential);
  const user = await findUser({ google_sub: sub });
  if (!eligible(user)) throw failure(401, 'Google account is not linked to an active internal account');
  await user.update({ last_login_at: new Date() });
  return { token: issueToken(user), user: publicUser(user) };
}
async function linkGoogle(user, credential, currentPassword) {
  if (typeof currentPassword !== 'string' || !await bcrypt.compare(currentPassword, user.password_hash)) throw failure(401, 'Current password is incorrect');
  const sub = await googleIdentity(credential);
  if (user.google_sub && user.google_sub !== sub) throw failure(409, 'Google identity already linked');
  const existing = await User.findOne({ where: { google_sub: sub } });
  if (existing && String(existing.id) !== String(user.id)) throw failure(409, 'Google identity already linked');
  try { await user.update({ google_sub: sub }); }
  catch (err) { if (err.name === 'SequelizeUniqueConstraintError') throw failure(409, 'Google identity already linked'); throw err; }
}
async function googleReset(credential, password) {
  const sub = await googleIdentity(credential);
  const user = await findUser({ google_sub: sub });
  if (!eligible(user)) throw failure(401, 'Google account is not linked to an active internal account');
  await replacePassword(user, password);
}
async function changePassword(user, current, next) {
  if (typeof current !== 'string' || !await bcrypt.compare(current, user.password_hash)) throw failure(401, 'Current password is incorrect');
  await replacePassword(user, next);
}

function jwtConfig() {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '1h';
  if (!secret || secret.length < 32) throw new Error('JWT configuration unavailable');
  return { secret, expiresIn };
}

async function login(username, password) {
  const user = await findUser({ username });
  // Avoid revealing whether a username exists; always perform a bcrypt comparison.
  const valid = await bcrypt.compare(password, user?.password_hash || '$2b$12$QY7LPQUwjiy/tvhyMwJFQujPg3EjTxzeYR9Zx2hL0wRIZk2laGjbW');
  if (!valid || !eligible(user)) return null;
  const token = issueToken(user);
  await user.update({ last_login_at: new Date() });
  return { token, user: publicUser(user) };
}

module.exports = { login, findUser, publicUser, jwtConfig, googleLogin, linkGoogle, googleReset, changePassword };
