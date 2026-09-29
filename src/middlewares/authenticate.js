const jwt = require('jsonwebtoken');
const { findUser, jwtConfig } = require('../services/auth.service');

async function authenticate(req, res, next) {
  try {
    const header = req.get('Authorization');
    if (!header || !/^Bearer [^\s]+$/.test(header)) return res.status(401).json({ success: false, message: 'Unauthorized', data: null });
    const { secret } = jwtConfig();
    const payload = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] });
    if (!payload.sub || !/^[1-9]\d*$/.test(payload.sub)) throw new Error('Invalid subject');
    const user = await findUser({ id: payload.sub });
    if (!user || !user.is_active || !user.role || !user.unit?.is_active ||
        !Number.isInteger(payload.ver) || payload.ver !== user.auth_version)
      return res.status(401).json({ success: false, message: 'Unauthorized', data: null });
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.message === 'Invalid subject') {
      return res.status(401).json({ success: false, message: 'Unauthorized', data: null });
    }
    return next(error);
  }
}
module.exports = authenticate;
