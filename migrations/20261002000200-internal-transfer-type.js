'use strict';
module.exports = {
  async up(q, S) { await q.changeColumn('stock_transfers', 'transfer_type', { type: S.STRING(32), allowNull: false }); },
  async down(q, S) {
    const [rows] = await q.sequelize.query("SELECT COUNT(*) AS n FROM stock_transfers WHERE transfer_type = 'INTERNAL_TRANSFER'");
    if (Number(rows[0].n)) throw Error('Cannot narrow type with internal transfers');
    await q.changeColumn('stock_transfers', 'transfer_type', { type: S.STRING(16), allowNull: false });
  },
};
