'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='loss_recoveries' AND column_name IN ('condition_id','received_by')"
    );
    const schema = Object.fromEntries(rows.map(row => [row.COLUMN_NAME || row.column_name, row.IS_NULLABLE || row.is_nullable]));
    if (schema.condition_id !== 'YES') await queryInterface.changeColumn('loss_recoveries', 'condition_id', { type: Sequelize.BIGINT.UNSIGNED, allowNull: true });
    if (schema.received_by !== 'YES') await queryInterface.changeColumn('loss_recoveries', 'received_by', { type: Sequelize.BIGINT.UNSIGNED, allowNull: true });
  },
  async down(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS count FROM loss_recoveries WHERE condition_id IS NULL OR received_by IS NULL");
    if (Number(rows[0].count) > 0) throw new Error('Cannot restore NOT NULL while nullable recovery rows exist');
    await queryInterface.changeColumn('loss_recoveries', 'condition_id', { type: Sequelize.BIGINT.UNSIGNED, allowNull: false });
    await queryInterface.changeColumn('loss_recoveries', 'received_by', { type: Sequelize.BIGINT.UNSIGNED, allowNull: false });
  },
};
