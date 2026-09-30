const { Op, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const { MaterialCategory, UnitOfMeasure, Material } = require('../models');

const types = { categories: MaterialCategory, units: UnitOfMeasure, materials: Material };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const includes = [{ model: MaterialCategory, as: 'category', attributes: ['id', 'code', 'name'] }, { model: UnitOfMeasure, as: 'unit', attributes: ['id', 'code', 'name'] }];
const modelFor = kind => types[kind];
const publicRow = row => {
  const value = row.toJSON();
  for (const key of ['id', 'category_id', 'unit_id']) if (value[key] != null) value[key] = String(value[key]);
  if (value.category) value.category.id = String(value.category.id);
  if (value.unit) value.unit.id = String(value.unit.id);
  return value;
};
async function list(kind, query) {
  const where = {};
  if (query.search) where[Op.or] = [{ code: { [Op.like]: `%${query.search}%` } }, { name: { [Op.like]: `%${query.search}%` } }];
  if (query.is_active !== undefined) where.is_active = query.is_active === 'true';
  if (kind === 'materials' && query.category_id) where.category_id = query.category_id;
  const page = Number(query.page || 1), limit = Number(query.limit || 20);
  const { rows, count } = await modelFor(kind).findAndCountAll({ where, include: kind === 'materials' ? includes : [], order: [['id', 'DESC']], offset: (page - 1) * limit, limit });
  return { items: rows.map(publicRow), total: count, page, limit };
}
async function get(kind, id) {
  const row = await modelFor(kind).findByPk(id, { include: kind === 'materials' ? includes : [] });
  if (!row) fail(404, 'Không tìm thấy danh mục');
  return publicRow(row);
}
async function validateReferences(data) {
  if (!data.category_id || !data.unit_id) fail(400, 'Loại vật chất và đơn vị tính bắt buộc');
  const [category, unit] = await Promise.all([MaterialCategory.findByPk(data.category_id), UnitOfMeasure.findByPk(data.unit_id)]);
  if (!category?.is_active || !unit?.is_active) fail(400, 'Loại vật chất hoặc đơn vị tính không hợp lệ/đã tắt');
}
async function safeWrite(operation) {
  try { return await operation(); }
  catch (err) {
    if (err instanceof UniqueConstraintError) fail(409, 'Mã danh mục đã tồn tại');
    if (err instanceof ForeignKeyConstraintError) fail(409, 'Dữ liệu đang được tham chiếu; hãy tắt thay vì xóa');
    throw err;
  }
}
async function create(kind, data) {
  if (kind === 'materials') await validateReferences(data);
  return safeWrite(async () => {
    const row = await modelFor(kind).create(data);
    return get(kind, row.id);
  });
}
async function update(kind, id, data) {
  const row = await modelFor(kind).findByPk(id);
  if (!row) fail(404, 'Không tìm thấy danh mục');
  if (kind === 'materials') {
    if (data.category_id !== undefined && String(data.category_id) !== String(row.category_id)) {
      const category = await MaterialCategory.findByPk(data.category_id);
      if (!category?.is_active) fail(400, 'Loại vật chất không hợp lệ/đã tắt');
    }
    if (data.unit_id !== undefined && String(data.unit_id) !== String(row.unit_id)) {
      const unit = await UnitOfMeasure.findByPk(data.unit_id);
      if (!unit?.is_active) fail(400, 'Đơn vị tính không hợp lệ/đã tắt');
    }
  }
  return safeWrite(async () => { await row.update(data); return get(kind, id); });
}
async function remove(kind, id) {
  const row = await modelFor(kind).findByPk(id);
  if (!row) fail(404, 'Không tìm thấy danh mục');
  // FK RESTRICT is the final safeguard even when concurrent writes occur.
  await safeWrite(() => row.destroy());
}
module.exports = { list, get, create, update, remove };
