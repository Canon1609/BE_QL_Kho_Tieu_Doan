const healthService = require("../services/health.service");

async function getHealth(req, res, next) {
  try {
    const data = await healthService.getHealth();
    return res.status(200).json({ success: true, message: "API and database are healthy", data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getHealth };
