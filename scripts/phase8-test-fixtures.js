// Additive fixture builder. Guard at module load to prevent development writes.
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
const assert = require('node:assert/strict');
const { sequelize, Unit, User, Location, Material, MaterialCategory, UnitOfMeasure, MaterialSource,
  ConditionLevel, StockLedgerEntry: Ledger, BorrowRequest, BorrowLine, BorrowDelivery, BorrowReturn, BorrowReturnLine } = require('../src/models');
async function main() {
  const [root, co11, co12, cat, cai, bo, cap, muon, good, bad] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Unit.findOne({ where: { code: 'COMPANY_12' } }),
    MaterialCategory.findOne({ where: { code: 'P8_CATEGORY' } }), UnitOfMeasure.findOne({ where: { code: 'P8_CAI' } }), UnitOfMeasure.findOne({ where: { code: 'P8_BO' } }),
    MaterialSource.findOne({ where: { code: 'P8_CAP' } }), MaterialSource.findOne({ where: { code: 'P8_MUON' } }),
    ConditionLevel.findOne({ where: { code: 'P8_GOOD' } }), ConditionLevel.findOne({ where: { code: 'P8_BAD' } }),
  ]);
  assert([root, co11, co12, cat, cai, bo, cap, muon, good, bad].every(Boolean), 'Bootstrap references first');
  await sequelize.transaction(async transaction => {
    const opts = { transaction };
    const [admin] = await User.findOrCreate({ where: { username: 'phase8_fixture_author' }, defaults: {
      password_hash: 'NOT_A_LOGIN', full_name: 'Tác giả fixture Phase 8', role_id: (await require('../src/models').Role.findOne({ where: { code: 'BATTALION_ADMIN' }, transaction })).id,
      unit_id: root.id, is_active: false,
    }, ...opts });
    const at = async (code, name, type, parent, owner, holding) => (await Location.findOrCreate({ where: { code }, defaults: {
      name, type, parent_location_id: parent, owner_unit_id: owner, is_stock_holding: holding, is_active: true,
    }, ...opts }))[0];
    const group = await Location.findOne({ where: { code: 'LOC_BATTALION_5_ROOT' }, transaction });
    const warehouse = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' }, transaction });
    assert(group && warehouse);
    const building = await at('P8_BUILDING', 'Dãy nhà thử Phase 8', 'BUILDING', group.id, null, false);
    const room = await at('P8_SHARED', 'Phòng chung thử Phase 8', 'ROOM', building.id, null, true);
    const room2 = await at('P8_OTHER', 'Phòng khác thử Phase 8', 'ROOM', building.id, null, true);
    const makeMaterial = async (code, name, measure = cai) => (await Material.findOrCreate({ where: { code }, defaults: {
      name, category_id: cat.id, unit_id: measure.id, is_active: true,
    }, ...opts }))[0];
    const material = await makeMaterial('P8_QUAT', 'Quạt thử Phase 8');
    const zero = await makeMaterial('P8_ZERO', 'Đèn tồn không thử Phase 8');
    const legacy = await makeMaterial('P8_LEGACY', 'Vật chất NULL địa điểm thử Phase 8');
    await makeMaterial('P8_NEW', 'Vật chất chưa ghi sổ thử Phase 8');
    const otherMeasure = await makeMaterial('P8_BO', 'Bộ dụng cụ thử Phase 8', bo);
    const filler = [];
    for (let n = 1; n <= 22; n++) filler.push(await makeMaterial(`P8_ITEM_${String(n).padStart(2, '0')}`, `Vật chất phân trang ${n}`));
    const [request] = await BorrowRequest.findOrCreate({ where: { code: 'P8_REQ' }, defaults: {
      company_unit_id: co11.id, due_date: '2026-12-31', status: 'PARTIAL', created_by: admin.id,
    }, ...opts });
    const [line] = await BorrowLine.findOrCreate({ where: { request_id: request.id, material_id: material.id }, defaults: {
      source_id: cap.id, condition_id: good.id, quantity: 4,
    }, ...opts });
    const [delivery] = await BorrowDelivery.findOrCreate({ where: { request_id: request.id }, defaults: {
      from_location_id: warehouse.id, to_location_id: room.id, confirmed_by: admin.id, confirmed_at: new Date('2026-10-02T01:00:00Z'),
    }, ...opts });
    const [returned] = await BorrowReturn.findOrCreate({ where: { request_id: request.id, status: 'POSTED' }, defaults: {
      to_location_id: warehouse.id, created_by: admin.id, confirmed_by: admin.id, confirmed_at: new Date('2026-10-04T01:00:00Z'),
    }, ...opts });
    const [returnLine] = await BorrowReturnLine.findOrCreate({ where: { return_id: returned.id, borrow_line_id: line.id }, defaults: {
      from_location_id: room.id, quantity: 1,
    }, ...opts });
    // Unique fixture reference ID per entry prevents duplicate writes without deleting existing rows.
    const ledger = async (referenceId, m, unit, place, source, condition, borrowLine, delta, type, reference, day, extra = {}) => {
      await Ledger.findOrCreate({ where: { reference_type: reference, reference_id: referenceId, material_id: m.id }, defaults: {
        material_id: m.id, unit_id: unit.id, location_id: place?.id ?? null, source_id: source.id, condition_id: condition?.id ?? null,
        borrow_line_id: borrowLine?.id ?? null, quantity_delta: delta, transaction_type: type, reference_type: reference,
        reference_id: referenceId, occurred_at: new Date(`2026-10-${String(day).padStart(2, '0')}T01:00:00Z`), created_by: admin.id,
        ...extra,
      }, ...opts });
    };
    const entries = [
      [1, material, root, warehouse, cap, good, null, 10, 'NORMAL_RECEIPT', 'STOCK_RECEIPT', 1],
      [2, material, root, warehouse, cap, good, null, -4, 'BORROW', 'BORROW_DELIVERY', 2, { borrow_delivery_id: delivery.id, transfer_side: 'OUT' }],
      [3, material, co11, room, cap, good, line, 4, 'BORROW', 'BORROW_DELIVERY', 2, { borrow_delivery_id: delivery.id, transfer_side: 'IN' }],
      [4, material, co11, room, cap, good, line, -2, 'INTERNAL_TRANSFER', 'STOCK_TRANSFER', 3, { transfer_side: 'OUT' }],
      [5, material, co11, room2, cap, good, line, 2, 'INTERNAL_TRANSFER', 'STOCK_TRANSFER', 3, { transfer_side: 'IN' }],
      [6, material, co11, room, cap, good, line, -1, 'RETURN', 'BORROW_RETURN', 4, { borrow_return_line_id: returnLine.id, transfer_side: 'OUT' }],
      [7, material, root, warehouse, cap, good, null, 1, 'RETURN', 'BORROW_RETURN', 4, { borrow_return_line_id: returnLine.id, transfer_side: 'IN' }],
      [8, material, co12, room, muon, bad, null, 2, 'NORMAL_RECEIPT', 'STOCK_RECEIPT', 1],
      [9, zero, root, warehouse, cap, null, null, 5, 'NORMAL_RECEIPT', 'STOCK_RECEIPT', 1],
      [10, zero, root, warehouse, cap, null, null, -5, 'ISSUE', 'STOCK_TRANSFER', 5],
      [11, otherMeasure, root, warehouse, muon, null, null, 3, 'NORMAL_RECEIPT', 'STOCK_RECEIPT', 1],
      [12, material, root, warehouse, muon, null, null, 2, 'NORMAL_RECEIPT', 'STOCK_RECEIPT', 1],
      [13, material, root, warehouse, muon, null, null, -2, 'ISSUE', 'STOCK_TRANSFER', 5],
    ];
    for (const [index, ...args] of entries) await ledger(index, ...args);
    // NULL legacy is permitted by the ledger schema; map only to the owning Unit's representative warehouse.
    await ledger(200, legacy, co11, null, cap, null, null, 5, 'NORMAL_RECEIPT', 'STOCK_RECEIPT', 1);
    // 36 entries for one material, identical timestamp per day: cross three pages with zero net effect.
    for (let n = 0; n < 36; n++) await ledger(201 + n, material, root, warehouse, cap, good, null,
      n % 2 ? -1 : 1, n % 2 ? 'ISSUE' : 'NORMAL_RECEIPT', n % 2 ? 'STOCK_TRANSFER' : 'STOCK_RECEIPT', 6);
    for (const [i, row] of filler.entries()) await ledger(100 + i, row, root, warehouse, cap, null, null, 1, 'NORMAL_RECEIPT', 'STOCK_RECEIPT', 1);
  });
  console.log('Phase 8 additive fixture ready on dedicated test DB');
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
