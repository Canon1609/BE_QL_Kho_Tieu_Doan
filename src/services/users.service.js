const bcrypt = require('bcryptjs');
const { UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const { User, Role, Unit } = require('../models');
const { publicUser } = require('./auth.service');
const { replacePassword } = require('./password.service');

const userIncludes = [
  { model: Role, as: 'role', attributes: ['code', 'name'] },
  { model: Unit, as: 'unit', attributes: ['id', 'code', 'name', 'type', 'is_active'] },
];
const error = (status, message) => Object.assign(new Error(message), { status });

async function list() {
  const users = await User.findAll({ attributes: { exclude: ['password_hash'] }, include: userIncludes, order: [['id', 'ASC']] });
  return users.map(user => ({ ...publicUser(user), is_active: user.is_active, google_linked: Boolean(user.google_sub) }));
}

async function get(id) {
  const user = await User.findByPk(id, { attributes: { exclude: ['password_hash'] }, include: userIncludes });
  if (!user) throw error(404, 'User not found');
  return { ...publicUser(user), is_active: user.is_active, google_linked: Boolean(user.google_sub), created_at: user.created_at, updated_at: user.updated_at };
}

async function companyUnits() {
  const root = await Unit.findOne({ where: { code: 'BATTALION_5', type: 'BATTALION', parent_id: null, is_active: true } });
  if (!root) return [];
  const units = await Unit.findAll({ where: { parent_id: root.id, type: 'COMPANY', is_active: true }, attributes: ['id', 'code', 'name'], order: [['name', 'ASC']] });
  return units.map(unit => ({ id: String(unit.id), code: unit.code, name: unit.name }));
}

async function createCompany({ username, full_name, password, unit_id }) {
  const role = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  if (!role) throw error(503, 'Company role unavailable');
  const units = await companyUnits();
  if (!units.some(unit => unit.id === String(unit_id))) throw error(400, 'Invalid company unit');
  if (await User.findOne({ where: { username } })) throw error(409, 'Username already exists');
  try {
    const user = await User.create({ username, full_name, password_hash: await bcrypt.hash(password, 12), role_id: role.id, unit_id });
    return get(user.id);
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw error(409, 'Username already exists');
    throw err;
  }
}

async function managedCompany(id) {
  const user = await User.findByPk(id, { include: userIncludes });
  if (!user) throw error(404, 'User not found');
  if (user.role?.code !== 'COMPANY_ADMIN') throw error(403, 'Cannot manage battalion administrator');
  return user;
}

async function updateCompany(id, { username, full_name, unit_id }) {
  const user = await managedCompany(id);
  const units = await companyUnits();
  if (!units.some(unit => unit.id === String(unit_id))) throw error(400, 'Invalid company unit');
  try {
    await user.update({ username, full_name: full_name.trim(), unit_id });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw error(409, 'Username already exists');
    throw err;
  }
  return get(id);
}

async function resetCompanyPassword(id, password) {
  const user = await managedCompany(id);
  await replacePassword(user, password);
}

async function removeCompany(id, actorId) {
  if (String(id) === String(actorId)) throw error(403, 'Cannot delete your own account');
  const user = await managedCompany(id);
  try {
    await user.destroy();
  } catch (err) {
    if (err instanceof ForeignKeyConstraintError) throw error(409, 'Account has dependent records; deactivate instead');
    throw err;
  }
}

async function setActive(id, active, actorId) {
  if (String(id) === String(actorId)) throw error(400, 'Cannot change your own account');
  const user = await managedCompany(id);
  await user.update({ is_active: active });
  return get(id);
}

module.exports = { list, get, companyUnits, createCompany, updateCompany, setActive, removeCompany, resetCompanyPassword };
