function authorizeRoles(...codes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized', data: null });
    if (!codes.includes(req.user.role?.code)) return res.status(403).json({ success: false, message: 'Forbidden', data: null });
    return next();
  };
}
module.exports = authorizeRoles;
