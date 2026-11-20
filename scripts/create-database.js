require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
  const required = ['TEST_DB_HOST', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD', 'ALLOW_TEST_DB_WRITE'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error('Refusing database creation: approved TEST_DB_* configuration is incomplete');
  if (process.env.ALLOW_TEST_DB_WRITE !== 'true' || process.env.TEST_DB_NAME !== 'ql_kho_tieu_doan_5_test')
    throw new Error('Refusing database creation: only explicitly approved ql_kho_tieu_doan_5_test is allowed');

  const database = process.env.TEST_DB_NAME;
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error("DB_NAME contains characters that are not allowed in a MySQL identifier");
  }

  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    charset: "utf8mb4",
  });

  try {
    const [identity] = await connection.query('SELECT @@hostname AS host, @@port AS port');
    if (String(identity[0].host).toLowerCase() !== String(process.env.TEST_DB_EXPECTED_SERVER || 'TRANQUOCANH').toLowerCase() || Number(identity[0].port) !== Number(process.env.TEST_DB_PORT || 3306))
      throw new Error('Refusing database creation: server identity could not be verified');
    const [rows] = await connection.execute(
      "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [database],
    );
    if (rows.length) {
      console.log(`Database ${database} already exists; left unchanged.`);
      return;
    }
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`Database ${database} created with utf8mb4_unicode_ci.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Database creation failed: ${error.message}`);
  process.exitCode = 1;
});
