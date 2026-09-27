require("dotenv").config();
const app = require("./app");
const { sequelize } = require("./models");

const port = Number(process.env.PORT || 5000);

async function start() {
  await sequelize.authenticate();
  const server = app.listen(port, () => console.log(`Backend listening on port ${port}`));
  const shutdown = async () => {
    server.close(async () => {
      await sequelize.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(`Backend startup failed: ${error.message}`);
  process.exitCode = 1;
});
