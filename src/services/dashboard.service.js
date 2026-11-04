const { QueryTypes } = require('sequelize');
const { sequelize, Unit, Location, Material, MaterialSource, ConditionLevel } = require('../models');
const ApiError = require('../utils/ApiError');
const { vietnamToday } = require('../utils/vietnamDate');
const { descendantIds, legacyLocation } = require('./location.service');

async function permittedUnits(user) {
  if (!user?.is_active || !user.unit?.is_active) throw new ApiError(403, 'Forbidden');
  if (user.role?.code === 'COMPANY_ADMIN') {
    if (user.unit.type !== 'COMPANY') throw new ApiError(403, 'Forbidden');
    return [String(user.unit_id)];
  }
  if (user.role?.code !== 'BATTALION_ADMIN' || user.unit.code !== 'BATTALION_5' || user.unit.type !== 'BATTALION') throw new ApiError(403, 'Forbidden');
  const all = await Unit.findAll({ attributes: ['id', 'parent_id', 'is_active'], raw: true });
  const children = new Map();
  for (const row of all) {
    const parent = String(row.parent_id || '');
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row);
  }
  const result = [], seen = new Set(), queue = [String(user.unit_id)];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) throw new ApiError(409, 'Cây đơn vị có vòng lặp');
    seen.add(id);
    const row = all.find(item => String(item.id) === id);
    if (!row?.is_active) continue;
    result.push(id);
    for (const child of children.get(id) || []) if (child.is_active) queue.push(String(child.id));
  }
  return result;
}

async function units(user, selectedUnitId) {
  const allowed = await permittedUnits(user);
  if (selectedUnitId && !allowed.includes(String(selectedUnitId))) throw new ApiError(403, 'Forbidden');
  const rows = await Unit.findAll({ where: { id: selectedUnitId ? [String(selectedUnitId)] : allowed }, attributes: ['id', 'code', 'name'], order: [['name', 'ASC']], raw: true });
  return rows.map(row => ({ id: String(row.id), code: row.code, name: row.name }));
}

async function filters(user, selectedUnitId) {
  const allowed = await permittedUnits(user);
  if (selectedUnitId && !allowed.includes(String(selectedUnitId))) throw new ApiError(403, 'Forbidden');
  const units = selectedUnitId ? [String(selectedUnitId)] : allowed;
  const rows = await sequelize.query(`SELECT DISTINCT m.id material_id,m.code material_code,m.name material_name,
    src.id source_id,src.code source_code,src.name source_name, c.id condition_id,c.code condition_code,c.name condition_name,
    loc.id location_id,loc.code location_code,loc.name location_name
    FROM stock_ledger_entries e JOIN materials m ON m.id=e.material_id JOIN material_sources src ON src.id=e.source_id
    LEFT JOIN condition_levels c ON c.id=e.condition_id LEFT JOIN locations loc ON loc.id=e.location_id
    WHERE e.unit_id IN (:units) AND (e.location_id IS NULL OR loc.is_stock_holding=1)
    ORDER BY m.code,src.code,c.code,loc.code`, { replacements:{units}, type:QueryTypes.SELECT });
  const unique = key => [...new Map(rows.filter(row => row[key] != null).map(row => [String(row[key]), {id:String(row[key]),code:row[key.replace('_id','_code')],name:row[key.replace('_id','_name')]}])).values()];
  return {materials:unique('material_id'),sources:unique('source_id'),conditions:unique('condition_id'),locations:unique('location_id')};
}

async function activityByMonth(year, unitIds, battalionAdmin) {
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  const receiptRows = battalionAdmin ? await sequelize.query(`
    SELECT MONTH(receipt_date) month, 'RECEIPT' type, COUNT(*) total FROM stock_receipts
    WHERE status='POSTED' AND receipt_type='NORMAL_RECEIPT' AND receipt_date >= :fromDate AND receipt_date < :toDate
    GROUP BY MONTH(receipt_date)`, { replacements: { fromDate: from, toDate: to }, type: QueryTypes.SELECT }) : [];
  const transferRows = await sequelize.query(`
    SELECT MONTH(transfer_date) month, transfer_type type, COUNT(*) total FROM stock_transfers
    WHERE status='POSTED' AND transfer_type IN ('ISSUE','RECALL') AND transfer_date >= :fromDate AND transfer_date < :toDate
      AND ((transfer_type='ISSUE' AND to_unit_id IN (:units)) OR (transfer_type='RECALL' AND from_unit_id IN (:units)))
    GROUP BY MONTH(transfer_date), transfer_type`, { replacements: { fromDate: from, toDate: to, units: unitIds }, type: QueryTypes.SELECT });
  const rows = [...receiptRows, ...transferRows];
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, receipt: 0, issue: 0, recall: 0 }));
  for (const row of rows) { const item = months[Number(row.month) - 1]; item[row.type === 'RECEIPT' ? 'receipt' : row.type === 'ISSUE' ? 'issue' : 'recall'] = Number(row.total); }
  return months;
}

async function getDashboard(query, user) {
  const allowed = await permittedUnits(user);
  if (query.unit_id && !allowed.includes(String(query.unit_id))) throw new ApiError(403, 'Forbidden');
  const unitIds = query.unit_id ? [String(query.unit_id)] : allowed;
  const [material, source, condition, location] = await Promise.all([
    query.material_id ? Material.findByPk(query.material_id, { attributes: ['id'] }) : null,
    query.source_id ? MaterialSource.findByPk(query.source_id, { attributes: ['id'] }) : null,
    query.condition_id && query.condition_id !== 'null' ? ConditionLevel.findByPk(query.condition_id, { attributes: ['id'] }) : null,
    query.location_id ? Location.findByPk(query.location_id, { attributes: ['id'] }) : null,
  ]);
  if (query.material_id && !material || query.source_id && !source || query.condition_id && query.condition_id !== 'null' && !condition || query.location_id && !location)
    throw new ApiError(404, 'Không tìm thấy bộ lọc trong phạm vi dữ liệu');
  const verifyVisible = async (clause, value) => {
    const rows = await sequelize.query(`SELECT 1 FROM stock_ledger_entries e WHERE e.unit_id IN (:units) AND ${clause} LIMIT 1`, { replacements: { units: unitIds, value }, type: QueryTypes.SELECT });
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy bộ lọc trong phạm vi được phép');
  };
  if (query.material_id) await verifyVisible('e.material_id=:value', query.material_id);
  if (query.source_id) await verifyVisible('e.source_id=:value', query.source_id);
  if (query.condition_id) {
    const clause = query.condition_id === 'null' ? 'e.condition_id IS NULL' : 'e.condition_id=:value';
    if (query.condition_id === 'null') {
      const rows = await sequelize.query(`SELECT 1 FROM stock_ledger_entries e WHERE e.unit_id IN (:units) AND ${clause} LIMIT 1`, { replacements: { units: unitIds }, type: QueryTypes.SELECT });
      if (!rows.length) throw new ApiError(404, 'Không tìm thấy bộ lọc trong phạm vi được phép');
    } else await verifyVisible(clause, query.condition_id);
  }
  if (location) {
    query._locationIds = await descendantIds(location.id);
    query._legacyUnits = [];
    for (const unitId of unitIds) {
      try {
        const representative = await legacyLocation(unitId);
        if (query._locationIds.includes(String(representative.id))) query._legacyUnits.push(String(unitId));
      } catch (error) { if (error.statusCode !== 409) throw error; }
    }
    const seen = await sequelize.query(`SELECT 1 FROM stock_ledger_entries WHERE unit_id IN (:units) AND (location_id IN (:locations) OR (location_id IS NULL AND unit_id IN (:legacyUnits))) LIMIT 1`, { replacements: { units: unitIds, locations: query._locationIds.length ? query._locationIds : ['0'], legacyUnits: query._legacyUnits.length ? query._legacyUnits : ['0'] }, type: QueryTypes.SELECT });
    if (!seen.length) throw new ApiError(404, 'Không tìm thấy địa điểm trong phạm vi dữ liệu');
  }
  let borrowScopeUnits = unitIds;
  if (query.unit_id) {
    const selected = await Unit.findByPk(query.unit_id, { attributes: ['id', 'type'] });
    if (selected?.type === 'COMPANY') borrowScopeUnits = [String(selected.id)];
    else {
      const rows = await Unit.findAll({ attributes: ['id', 'parent_id', 'type', 'is_active'], raw: true });
      const descendants = new Set([String(query.unit_id)]);
      let changed = true;
      while (changed) { changed = false; for (const row of rows) if (row.is_active && descendants.has(String(row.parent_id)) && !descendants.has(String(row.id))) { descendants.add(String(row.id)); changed = true; } }
      borrowScopeUnits = rows.filter(row => row.is_active && row.type === 'COMPANY' && descendants.has(String(row.id)) && unitIds.includes(String(row.id))).map(row => String(row.id));
    }
  }
  const companyIds = await Unit.findAll({ where: { id: borrowScopeUnits.length ? borrowScopeUnits : ['0'], type: 'COMPANY' }, attributes: ['id'], raw: true });
  const replacements = { units: unitIds, borrowUnits: companyIds.length ? companyIds.map(row => String(row.id)) : ['0'], today: vietnamToday() };
  const clauses = ['e.unit_id IN (:units)', '(e.location_id IS NULL OR EXISTS (SELECT 1 FROM locations holding WHERE holding.id=e.location_id AND holding.is_stock_holding=1))'];
  if (query.material_id) { clauses.push('e.material_id=:material'); replacements.material = query.material_id; }
  if (query.source_id) { clauses.push('e.source_id=:source'); replacements.source = query.source_id; }
  if (query.condition_id) { clauses.push(query.condition_id === 'null' ? 'e.condition_id IS NULL' : 'e.condition_id=:condition'); if(query.condition_id !== 'null') replacements.condition = query.condition_id; }
  if (query.location_id) { clauses.push('(e.location_id IN (:locationIds) OR (e.location_id IS NULL AND e.unit_id IN (:legacyUnits)))'); replacements.locationIds = query._locationIds; replacements.legacyUnits = query._legacyUnits.length ? query._legacyUnits : ['0']; }
  const scopedFilter = await sequelize.query(`SELECT 1 FROM stock_ledger_entries e WHERE ${clauses.join(' AND ')} LIMIT 1`, { replacements, type: QueryTypes.SELECT });
  if ((query.material_id || query.source_id || query.condition_id || query.location_id) && !scopedFilter.length) throw new ApiError(404, 'Không tìm thấy dữ liệu bộ lọc trong phạm vi được phép');
  const unitFilter = clauses.join(' AND ');
  const stockRows = await sequelize.query(`
    SELECT e.unit_id, un.code AS unit_code, un.name AS unit_name, m.id AS material_id,
      m.code AS material_code, m.name AS material_name, u.name AS measure_name,
      CAST(SUM(e.quantity_delta) AS CHAR) AS physical,
      CAST(SUM(CASE WHEN e.borrow_line_id IS NULL THEN e.quantity_delta ELSE 0 END) AS CHAR) AS unbound,
      CAST(SUM(CASE WHEN e.borrow_line_id IS NOT NULL THEN e.quantity_delta ELSE 0 END) AS CHAR) AS borrowed
    FROM stock_ledger_entries e
    JOIN units un ON un.id = e.unit_id
    JOIN materials m ON m.id = e.material_id
    JOIN units_of_measure u ON u.id = m.unit_id
    WHERE ${unitFilter}
      AND (e.location_id IS NULL OR EXISTS (SELECT 1 FROM locations holding WHERE holding.id=e.location_id AND holding.is_stock_holding=1))
    GROUP BY e.unit_id, un.code, un.name, m.id, m.code, m.name, u.name
    HAVING SUM(e.quantity_delta) <> 0
    ORDER BY un.name, m.name, m.code, u.name`, { replacements, type: QueryTypes.SELECT });
  const requests = await sequelize.query(`
    SELECT
      SUM(CASE WHEN r.status='SUBMITTED' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN r.status IN ('DELIVERED','PARTIAL') AND d.id IS NOT NULL AND r.due_date < :today
        AND EXISTS (SELECT 1 FROM borrow_lines bl WHERE bl.request_id=r.id AND bl.quantity > COALESCE((
          SELECT SUM(brl.quantity) FROM borrow_return_lines brl JOIN borrow_returns ret ON ret.id=brl.return_id
          WHERE ret.request_id=r.id AND ret.status='POSTED' AND brl.borrow_line_id=bl.id),0)) THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN r.status IN ('DELIVERED','PARTIAL') AND d.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM borrow_lines bl WHERE bl.request_id=r.id AND bl.quantity > COALESCE((
          SELECT SUM(brl.quantity) FROM borrow_return_lines brl JOIN borrow_returns ret ON ret.id=brl.return_id
          WHERE ret.request_id=r.id AND ret.status='POSTED' AND brl.borrow_line_id=bl.id),0)) THEN 1 ELSE 0 END) AS outstanding
    FROM borrow_requests r LEFT JOIN borrow_deliveries d ON d.request_id=r.id
    WHERE r.company_unit_id IN (:borrowUnits)`, { replacements, type: QueryTypes.SELECT });

  let period = { documents: 0, ledgerEntries: 0 };
  if (query.from || query.to) {
    const from = query.from || '1000-01-01';
    const until = query.to || vietnamToday();
    const utcBoundary = day => new Date(`${day}T00:00:00+07:00`).toISOString().slice(0, 19).replace('T', ' ');
    const nextDate = day => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
    const periodClauses = ['e.unit_id IN (:units)', 'e.occurred_at >= :fromDate', 'e.occurred_at < :toDate'];
    const periodReplacements = { ...replacements, fromDate: utcBoundary(from), toDate: utcBoundary(nextDate(until)) };
    for (const field of ['material_id', 'source_id']) if (query[field]) { periodClauses.push(`e.${field}=:period_${field}`); periodReplacements[`period_${field}`] = query[field]; }
    if (query.condition_id) { periodClauses.push(query.condition_id === 'null' ? 'e.condition_id IS NULL' : 'e.condition_id=:period_condition'); if(query.condition_id !== 'null') periodReplacements.period_condition=query.condition_id; }
    if (query.location_id) { periodClauses.push('(e.location_id IN (:locationIds) OR (e.location_id IS NULL AND e.unit_id IN (:legacyUnits)))'); periodReplacements.locationIds=query._locationIds; periodReplacements.legacyUnits=query._legacyUnits.length?query._legacyUnits:['0']; }
    const periodRows = await sequelize.query(`
      SELECT COUNT(DISTINCT CONCAT(e.reference_type, ':', e.reference_id)) AS documents,
        COUNT(*) AS ledger_entries
      FROM stock_ledger_entries e
      WHERE ${periodClauses.join(' AND ')}`, { replacements: periodReplacements, type: QueryTypes.SELECT });
    period = { documents: Number(periodRows[0].documents || 0), ledgerEntries: Number(periodRows[0].ledger_entries || 0) };
  }

  const activity = await activityByMonth(Number(query.year || vietnamToday().slice(0, 4)), unitIds, user.role?.code === 'BATTALION_ADMIN');

  // The KPI counts unique codes with a non-zero physical balance in at least one permitted Unit.
  // Do not net separate Units together: equal/opposite balances do not mean no Unit holds stock.
  const materialSet = new Set(stockRows.map(row => String(row.material_id)));
  const byUnitMeasure = new Map();
  for (const row of stockRows) {
    const key = `${row.unit_id}:${row.measure_name}`;
    if (!byUnitMeasure.has(key)) byUnitMeasure.set(key, {
      unitId: String(row.unit_id), unitCode: row.unit_code, unitName: row.unit_name, measure: row.measure_name,
      materialCount: 0, physical: 0n, unbound: 0n, borrowed: 0n,
    });
    const item = byUnitMeasure.get(key);
    item.materialCount += 1;
    item.physical += BigInt(row.physical);
    item.unbound += BigInt(row.unbound);
    item.borrowed += BigInt(row.borrowed);
  }
  const distribution = [...byUnitMeasure.values()].map(item => ({ ...item,
    physical: String(item.physical), unbound: String(item.unbound), borrowed: String(item.borrowed) }));
  const materialBreakdown = stockRows.map(row => ({ unitId: String(row.unit_id), unitCode: row.unit_code, unitName: row.unit_name,
    materialId: String(row.material_id), materialCode: row.material_code, materialName: row.material_name, measure: row.measure_name,
    physical: row.physical, unbound: row.unbound, borrowed: row.borrowed }));
  const borrow = requests[0] || {};
  return {
    scope: { unitIds, selectedUnitId: query.unit_id || null },
    current: {
      materialCodesWithStock: materialSet.size,
      pendingRequests: Number(borrow.pending || 0),
      outstandingBorrowRequests: Number(borrow.outstanding || 0),
      overdueBorrowRequests: Number(borrow.overdue || 0),
    },
    distribution,
    activity: { year: Number(query.year || vietnamToday().slice(0, 4)), months: activity },
    materialBreakdown,
    period: query.from || query.to ? { from: query.from || null, to: query.to || null, documents: period.documents, ledgerEntries: period.ledgerEntries } : null,
  };
}

module.exports = { units, filters, getDashboard };
