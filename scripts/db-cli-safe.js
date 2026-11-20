'use strict';
// All npm Sequelize CLI entrypoints are test-only and fail closed. This wrapper
// rejects caller overrides (especially --url/--env) and authenticates against
// the approved target before invoking CLI with an explicit --env test.
require('dotenv').config();
const { spawnSync } = require('node:child_process');
const { Sequelize } = require('sequelize');
const { getApprovedTestConfig } = require('../src/config/database');

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.some(arg => ['--url', '--env', '--config'].includes(arg) || arg.startsWith('--url=') || arg.startsWith('--env=') || arg.startsWith('--config=')))
    throw new Error('Refusing Sequelize CLI arguments; command and environment overrides are not allowed');
  const command = args[0];
  const writeCommands = new Set(['db:seed','db:seed:all','db:migrate','db:migrate:undo','db:migrate:undo:all','db:seed:undo','db:seed:undo:all']);
  if (writeCommands.has(command) && process.env.NODE_ENV !== 'test') throw new Error('Refusing Sequelize CLI writer: NODE_ENV=test is required');
  const config = getApprovedTestConfig(process.env);
  const sequelize = new Sequelize(config);
  try {
    await sequelize.authenticate(); // beforeConnect verifies DATABASE(), server hostname and port.
    const [rows] = await sequelize.query('SELECT DATABASE() AS db, @@hostname AS host, @@port AS port');
    const row = rows[0];
    if (row.db !== 'ql_kho_tieu_doan_5_test' || String(row.host).toLowerCase() !== String(process.env.TEST_DB_EXPECTED_SERVER || 'TRANQUOCANH').toLowerCase() || Number(row.port) !== config.port)
      throw new Error('Refusing Sequelize CLI: actual database identity did not match approved test target');
  } finally { await sequelize.close(); }
  const cli = require.resolve('sequelize-cli/lib/sequelize');
  const result = spawnSync(process.execPath, [cli, ...args, '--env', 'test', '--config', require.resolve('../src/config/database')], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}
main().catch(error => { console.error(`Safe DB CLI refused/failed: ${error.message}`); process.exitCode = 1; });
