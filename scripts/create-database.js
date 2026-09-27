require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  const database = process.env.DB_NAME;
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error("DB_NAME contains characters that are not allowed in a MySQL identifier");
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: "utf8mb4",
  });

  try {
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
