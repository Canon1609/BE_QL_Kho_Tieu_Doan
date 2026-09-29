const { Unit } = require('../models');

// Require authentication first. Controllers must use this result to constrain DB queries,
// never trust a unit id provided by the browser as proof of access.
async function canAccessUnit(user, targetUnitId) {
  if (!user?.is_active || !user.role || !user.unit?.is_active || !/^[1-9]\d*$/.test(String(targetUnitId))) return false;
  if (user.role.code === 'COMPANY_ADMIN') {
    return user.unit.type === 'COMPANY' && String(user.unit_id) === String(targetUnitId);
  }
  if (user.role.code !== 'BATTALION_ADMIN' || user.unit.code !== 'BATTALION_5' || user.unit.type !== 'BATTALION') return false;
  // Walk upward: allow only descendants of the assigned battalion, not unrelated units.
  const visited = new Set();
  let id = String(targetUnitId);
  while (id && !visited.has(id)) {
    visited.add(id);
    const unit = await Unit.findByPk(id, { attributes: ['id', 'parent_id', 'is_active'] });
    if (!unit || !unit.is_active) return false;
    if (String(unit.id) === String(user.unit_id)) return true;
    id = unit.parent_id ? String(unit.parent_id) : null;
  }
  return false;
}

function requireUnitScope(getUnitId = (req) => req.params.unitId) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized', data: null });
      if (!await canAccessUnit(req.user, getUnitId(req))) return res.status(403).json({ success: false, message: 'Forbidden', data: null });
      return next();
    } catch (error) { return next(error); }
  };
}
module.exports = { canAccessUnit, requireUnitScope };
