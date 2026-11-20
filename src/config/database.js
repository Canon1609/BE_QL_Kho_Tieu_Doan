require("dotenv").config();
const { Sequelize } = require("sequelize");
const mysql = require('mysql2/promise');

function getDatabaseConfig(env = process.env) {
  if (env.NODE_ENV === 'test') {
    const test = getApprovedTestConfig(env);
    return { ...test, define: { underscored: true, timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' } };
  }
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD || "",
    dialect: "mysql",
    logging: false,
    define: {
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  };
}

function getApprovedTestConfig(env = process.env) {
  const database = env.TEST_DB_NAME || '';
  const developmentDatabase = env.DB_NAME || '';
  if (!env.TEST_DB_HOST || !database) throw new Error('Test DB is not configured; TEST_DB_HOST and TEST_DB_NAME are required');
  if (database.toLowerCase() !== 'ql_kho_tieu_doan_5_test') throw new Error('Test DB name must match the explicitly approved ql_kho_tieu_doan_5_test');
  if (database.toLowerCase() === developmentDatabase.toLowerCase()) throw new Error('Refusing test DB identical to configured development DB');
  if (env.ALLOW_TEST_DB_WRITE !== 'true') throw new Error('Test DB writes require explicit ALLOW_TEST_DB_WRITE=true approval');
  const port = Number(env.TEST_DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid approved test DB port');
  return { username: env.TEST_DB_USER || '', password: env.TEST_DB_PASSWORD || '', database,
    host: env.TEST_DB_HOST, port, dialect: 'mysql', logging: false,
    // This hook runs on Sequelize's actual physical connection before it can be
    // returned to any query/transaction. Validate identity on that same socket;
    // a separate preflight connection would leave a target-switching gap.
    hooks: { afterConnect: connection => new Promise((resolve, reject) => {
      connection.query('SELECT DATABASE() AS db, @@hostname AS host, @@port AS port', (error, rows) => {
        if (error) return reject(new Error('Refusing DB connection: unable to verify test target identity'));
        const actual = rows?.[0];
        if (actual?.db !== 'ql_kho_tieu_doan_5_test' || String(actual?.host).toLowerCase() !== String(env.TEST_DB_EXPECTED_SERVER || 'TRANQUOCANH').toLowerCase() || Number(actual?.port) !== port)
          return reject(new Error('Refusing DB connection: actual connection is not the approved test target'));
        resolve();
      });
    }) } };
}

const config = {
  // Sequelize CLI cannot fall back to development credentials: the development
  // entry is intentionally unconnectable. The application uses getDatabaseConfig().
  development: { username: '', password: '', database: '', host: '', port: 3306, dialect: 'mysql', logging: false },
  test: (() => {
    try { return { ...getApprovedTestConfig(), define: { underscored: true, timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' } }; }
    catch { return { username: '', password: '', database: '', host: '', port: 3306, dialect: 'mysql', logging: false }; }
  })(),
  // CLI environments other than the explicitly approved test target must not
  // carry application/development credentials.
  production: { username: '', password: '', database: '', host: '', port: 3306, dialect: 'mysql', logging: false },
};

let sequelize;
function getSequelize() {
  if (!sequelize) sequelize = new Sequelize(getDatabaseConfig());
  return sequelize;
}

module.exports = config;
module.exports.getDatabaseConfig = getDatabaseConfig;
module.exports.getApprovedTestConfig = getApprovedTestConfig;
module.exports.getSequelize = getSequelize;
