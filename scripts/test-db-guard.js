'use strict';
// Require this as the first statement in every test/fixture entrypoint, before
// importing models or opening API clients. It fails closed unless the approved
// test connection is configured. The Sequelize pool's afterConnect hook checks
// DATABASE()/server/port on the actual connection used by every query/write.
const { getApprovedTestConfig } = require('../src/config/database');
function assertTestWriterEnvironment() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Refusing test writer: NODE_ENV=test is required (this is not target proof)');
  const approved = getApprovedTestConfig(process.env);
  if (approved.database !== 'ql_kho_tieu_doan_5_test') throw new Error('Refusing test writer: database is not approved');
  return approved;
}
const approved = assertTestWriterEnvironment();
const verifySequelize = async sequelize => {
  if (!sequelize || sequelize.config?.database !== approved.database || sequelize.config?.host !== approved.host || Number(sequelize.config?.port) !== Number(approved.port))
    throw new Error('Refusing test writer: Sequelize instance does not match approved test config');
  await sequelize.authenticate();
  const [rows] = await sequelize.query('SELECT DATABASE() AS db, @@hostname AS host, @@port AS port');
  const actual = rows[0];
  if (actual.db !== approved.database || String(actual.host).toLowerCase() !== String(process.env.TEST_DB_EXPECTED_SERVER || 'TRANQUOCANH').toLowerCase() || Number(actual.port) !== Number(approved.port))
    throw new Error('Refusing test writer: actual DB identity mismatch');
};
module.exports = verifySequelize;
module.exports.assertTestWriterEnvironment = assertTestWriterEnvironment;
