const { QueryTypes } = require('sequelize');
const { sequelize, Unit, Location, Material } = require('../models');
const { canAccessUnit } = require('./unitScope.service');
const { descendantIds, legacyLocation } = require('./location.service');
const { list: visibleLocations } = require('./location-management.service');
const ApiError = require('../utils/ApiError');

const escapeLike = value => value.replace(/[\\%_]/g, '\\$&');
async function permittedUnits(user) {
  if (user.role.code === 'COMPANY_ADMIN') {
    if (user.unit?.type !== 'COMPANY' || !user.unit.is_active) throw new ApiError(403, 'Forbidden');
    return [String(user.unit_id)];
  }
  if (user.role.code !== 'BATTALION_ADMIN' || user.unit?.code !== 'BATTALION_5' || user.unit?.type !== 'BATTALION' || !user.unit.is_active) throw new ApiError(403, 'Forbidden');
  const all = await Unit.findAll({ attributes: ['id', 'parent_id', 'is_active'], raw: true });
  const children = new Map();
  for (const unit of all) {
    const parent = String(unit.parent_id || '');
    children.set(parent, [...(children.get(parent) || []), unit]);
  }
  const visited = new Set(), queue = [String(user.unit_id)];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) throw new ApiError(409, 'Cây đơn vị có vòng lặp');
    visited.add(id);
    for (const child of children.get(id) || []) if (child.is_active) queue.push(String(child.id));
  }
  return [...visited];
}
async function units(user) {
  const ids = await permittedUnits(user);
  const rows = await Unit.findAll({ where: { id: ids }, attributes: ['id', 'code', 'name'], order: [['name', 'ASC']], raw: true });
  return rows.map(row => ({ ...row, id: String(row.id) }));
}
async function selection(q, user, scoped) {
  if (!q.location_id) return null;
  const place = await Location.findByPk(q.location_id);
  if (!place) throw new ApiError(404, 'Không tìm thấy địa điểm');
  if (user.role.code === 'COMPANY_ADMIN' && !(await visibleLocations(user)).some(row => String(row.id) === String(place.id))) {
    // Older ledger rows have no location_id; the representative warehouse must still be filterable.
    const legacy = await legacyLocation(user.unit_id);
    const legacyRows = await sequelize.query('SELECT 1 FROM stock_ledger_entries WHERE unit_id = :unit AND location_id IS NULL LIMIT 1',
      { replacements: { unit: user.unit_id }, type: QueryTypes.SELECT });
    if (!legacyRows.length || ![String(legacy.id), ...(await descendantIds(place.id))].includes(String(legacy.id)))
      throw new ApiError(404, 'Không tìm thấy địa điểm trong phạm vi đơn vị');
  }
  const ids = q.descendants === 'false' ? [String(place.id)] : await descendantIds(place.id);
  const representativeUnits = [];
  for (const unitId of scoped) {
    try {
      const representative = await legacyLocation(unitId);
      if (ids.includes(String(representative.id))) representativeUnits.push(unitId);
    } catch (err) { if (err.statusCode !== 409) throw err; }
  }
  if (user.role.code === 'COMPANY_ADMIN') {
    // Do not disclose a shared room unless the company's ledger actually references it.
    const seen = await sequelize.query(`SELECT 1 FROM stock_ledger_entries
      WHERE unit_id = :unit AND (location_id IN (:ids) OR (location_id IS NULL AND unit_id IN (:legacyUnits))) LIMIT 1`,
    { replacements: { unit: user.unit_id, ids, legacyUnits: representativeUnits.length ? representativeUnits : [0] }, type: QueryTypes.SELECT });
    if (!seen.length) throw new ApiError(404, 'Không tìm thấy địa điểm trong phạm vi đơn vị');
  }
  return { ids, representativeUnits };
}
async function context(q, user) {
  const allowed = await permittedUnits(user);
  if (q.unit_id && (!allowed.includes(String(q.unit_id)) || !await canAccessUnit(user, q.unit_id))) throw new ApiError(403, 'Forbidden');
  const scoped = q.unit_id ? [q.unit_id] : allowed;
  const place = await selection(q, user, scoped);
  return { scoped, place };
}
function ledgerFilter(q, scoped, place) {
  const replacements = { units: scoped, locationIds: place?.ids || [0], legacyUnits: place?.representativeUnits.length ? place.representativeUnits : [0],
    source: q.source_id || null, condition: q.condition_id === 'null' ? null : q.condition_id || null };
  const clauses = ['e.unit_id IN (:units)', '(e.location_id IS NULL OR EXISTS (SELECT 1 FROM locations holding WHERE holding.id = e.location_id AND holding.is_stock_holding = 1))'];
  if (place) clauses.push('(e.location_id IN (:locationIds) OR (e.location_id IS NULL AND e.unit_id IN (:legacyUnits)))');
  if (q.source_id) clauses.push('e.source_id = :source');
  if (q.condition_id) clauses.push(q.condition_id === 'null' ? 'e.condition_id IS NULL' : 'e.condition_id = :condition');
  return { clauses, replacements };
}
async function list(q, user) {
  const { scoped, place } = await context(q, user);
  const base = ledgerFilter(q, scoped, place);
  const replacements = { ...base.replacements, search: `%${escapeLike((q.search || '').trim())}%`,
    limit: 20, offset: (Number(q.page || 1) - 1) * 20 };
  // Aggregate per material over the authorized ledger rows *before* pagination. NULL vs non-NULL
  // borrow_line_id partitions mutually exclusively; no parent-location rows or extra debt added.
  const clauses = [...base.clauses, '(m.code LIKE :search OR m.name LIKE :search)'];
  const from = `FROM stock_ledger_entries e JOIN materials m ON m.id = e.material_id
    JOIN material_categories c ON c.id = m.category_id JOIN units_of_measure u ON u.id = m.unit_id
    WHERE ${clauses.join(' AND ')} GROUP BY m.id, m.code, m.name, c.name, u.name`;
  const aggregate = `SELECT m.id, m.code, m.name, c.name AS category, u.name AS unit,
    SUM(e.quantity_delta) AS physical,
    SUM(CASE WHEN e.borrow_line_id IS NULL THEN e.quantity_delta ELSE 0 END) AS available,
    SUM(CASE WHEN e.borrow_line_id IS NOT NULL THEN e.quantity_delta ELSE 0 END) AS borrowed ${from}`;
  const having = q.include_zero === 'true' ? '' : 'WHERE balances.physical <> 0';
  const sort = { code: 'balances.code', name: 'balances.name', physical: 'balances.physical', available: 'balances.available', borrowed: 'balances.borrowed' }[q.sort || 'code'];
  const direction = q.direction === 'desc' ? 'DESC' : 'ASC';
  const [countRows, rows] = await Promise.all([
    sequelize.query(`SELECT COUNT(*) AS total FROM (${aggregate}) balances ${having}`, { replacements, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT balances.id, balances.code, balances.name, balances.category, balances.unit,
      CAST(balances.physical AS CHAR) AS physical, CAST(balances.available AS CHAR) AS available, CAST(balances.borrowed AS CHAR) AS borrowed
      FROM (${aggregate}) balances ${having} ORDER BY ${sort} ${direction}, balances.code ASC, balances.id ASC LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }),
  ]);
  return { items: rows.map(row => ({ ...row, id: String(row.id) })), total: Number(countRows[0].total), page: Number(q.page || 1), limit: 20 };
}
async function materialInScope(id, scoped) {
  const found = await sequelize.query('SELECT 1 FROM stock_ledger_entries WHERE material_id = :id AND unit_id IN (:units) LIMIT 1',
    { replacements: { id, units: scoped }, type: QueryTypes.SELECT });
  if (!found.length) throw new ApiError(404, 'Không tìm thấy vật chất trong phạm vi quyền');
  const material = await Material.findByPk(id, { attributes: ['id', 'code', 'name'], include: ['category', 'unit'] });
  if (!material) throw new ApiError(404, 'Không tìm thấy vật chất trong phạm vi quyền');
  return { id: String(material.id), code: material.code, name: material.name,
    category: material.category?.name, unit: material.unit?.name };
}
async function detail(id, q, user) {
  const { scoped, place } = await context(q, user);
  const material = await materialInScope(id, scoped);
  const { clauses, replacements } = ledgerFilter(q, scoped, place);
  replacements.material = id;
  clauses.push('e.material_id = :material');
  const rows = await sequelize.query(`SELECT e.unit_id, e.location_id, e.source_id, e.condition_id, e.borrow_line_id,
    unit.code AS unit_code, unit.name AS unit_name, loc.code AS location_code, loc.name AS location_name,
    src.code AS source_code, src.name AS source_name, cond.code AS condition_code, cond.name AS condition_name,
    CAST(SUM(e.quantity_delta) AS CHAR) AS physical
    FROM stock_ledger_entries e JOIN units unit ON unit.id = e.unit_id
    LEFT JOIN locations loc ON loc.id = e.location_id
    JOIN material_sources src ON src.id = e.source_id LEFT JOIN condition_levels cond ON cond.id = e.condition_id
    WHERE ${clauses.join(' AND ')}
    GROUP BY e.unit_id, e.location_id, e.source_id, e.condition_id, e.borrow_line_id,
      unit.code, unit.name, loc.code, loc.name, src.code, src.name, cond.code, cond.name
    ORDER BY unit.code, loc.code, src.code, cond.code, e.borrow_line_id`, { replacements, type: QueryTypes.SELECT });
  const legacy = new Map();
  for (const row of rows.filter(r => r.location_id == null)) {
    const key = String(row.unit_id);
    if (!legacy.has(key)) {
      try { legacy.set(key, await legacyLocation(key)); }
      catch (err) { if (err.statusCode !== 409) throw err; }
    }
  }
  const sum = { physical: 0n, available: 0n, borrowed: 0n };
  const items = rows.map(row => {
    const n = BigInt(row.physical), tagged = row.borrow_line_id != null;
    sum.physical += n;
    sum[tagged ? 'borrowed' : 'available'] += n;
    const mapped = row.location_id == null ? legacy.get(String(row.unit_id)) : null;
    return { unit_id: String(row.unit_id), unit_code: row.unit_code, unit_name: row.unit_name,
      location_id: String(row.location_id ?? mapped?.id ?? ''), location_code: mapped?.code || row.location_code || 'LEGACY_NULL',
      location_name: mapped?.name || row.location_name || 'Địa điểm cũ chưa ánh xạ',
      source_id: String(row.source_id), source_code: row.source_code, source_name: row.source_name,
      condition_id: row.condition_id == null ? null : String(row.condition_id), condition_code: row.condition_code, condition_name: row.condition_name,
      borrow_line_id: row.borrow_line_id == null ? null : String(row.borrow_line_id),
      physical: String(n), available: String(tagged ? 0n : n), borrowed: String(tagged ? n : 0n) };
  });
  return { material, totals: Object.fromEntries(Object.entries(sum).map(([key, value]) => [key, String(value)])), items };
}
async function history(id, q, user) {
  const { scoped, place } = await context(q, user);
  const material = await materialInScope(id, scoped);
  const { clauses, replacements } = ledgerFilter(q, scoped, place);
  clauses.push('e.material_id = :material');
  replacements.material = id;
  if (q.transaction_type) { clauses.push('e.transaction_type = :transactionType'); replacements.transactionType = q.transaction_type; }
  // UI uses Vietnamese local dates; ledger timestamps are stored as UTC (+07 offset).
  if (q.from) { clauses.push('e.occurred_at >= :from'); replacements.from = new Date(`${q.from}T00:00:00+07:00`); }
  if (q.to) { clauses.push('e.occurred_at < :to'); replacements.to = new Date(new Date(`${q.to}T00:00:00+07:00`).getTime() + 86400000); }
  const from = `FROM stock_ledger_entries e JOIN units responsible ON responsible.id = e.unit_id
    LEFT JOIN locations loc ON loc.id = e.location_id JOIN material_sources src ON src.id = e.source_id
    LEFT JOIN condition_levels cond ON cond.id = e.condition_id WHERE ${clauses.join(' AND ')}`;
  const page = Number(q.page || 1), limit = 20;
  replacements.limit = limit; replacements.offset = (page - 1) * limit;
  const [counts, rows] = await Promise.all([
    sequelize.query(`SELECT COUNT(*) AS total ${from}`, { replacements, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT e.id, e.unit_id, e.location_id, e.source_id, e.condition_id, e.borrow_line_id,
      e.transaction_type, CAST(e.quantity_delta AS CHAR) AS quantity_delta, e.reference_type, e.reference_id,
      e.receipt_item_id, e.transfer_item_id, e.transfer_side, e.borrow_delivery_id, e.borrow_return_line_id,
      e.occurred_at, responsible.name AS unit_name, loc.name AS location_name, src.name AS source_name,
      cond.name AS condition_name ${from} ORDER BY e.occurred_at DESC, e.id DESC LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }),
  ]);
  const legacy = new Map();
  for (const row of rows.filter(r => r.location_id == null)) {
    const key = String(row.unit_id);
    if (!legacy.has(key)) {
      try { legacy.set(key, await legacyLocation(key)); }
      catch (err) { if (err.statusCode !== 409) throw err; }
    }
  }
  return { material, items: rows.map(row => {
    const mapped = row.location_id == null ? legacy.get(String(row.unit_id)) : null;
    return { ...row, id: String(row.id), unit_id: String(row.unit_id), location_id: String(row.location_id ?? mapped?.id ?? ''),
      location_name: mapped?.name || row.location_name || 'Địa điểm cũ chưa ánh xạ', source_id: String(row.source_id),
      condition_id: row.condition_id == null ? null : String(row.condition_id),
      borrow_line_id: row.borrow_line_id == null ? null : String(row.borrow_line_id), reference_id: String(row.reference_id),
      receipt_item_id: row.receipt_item_id == null ? null : String(row.receipt_item_id),
      transfer_item_id: row.transfer_item_id == null ? null : String(row.transfer_item_id),
      borrow_delivery_id: row.borrow_delivery_id == null ? null : String(row.borrow_delivery_id),
      borrow_return_line_id: row.borrow_return_line_id == null ? null : String(row.borrow_return_line_id) };
  }), page, limit, total: Number(counts[0].total) };
}
module.exports = { list, detail, history, units };
