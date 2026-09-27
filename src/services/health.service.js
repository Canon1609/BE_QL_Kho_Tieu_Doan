const { sequelize } = require("../models");

async function getHealth() {
  await sequelize.authenticate();
  return { api: "healthy", database: "connected" };
}

module.exports = { getHealth };
