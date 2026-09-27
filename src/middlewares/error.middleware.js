function notFound(req, res) {
  return res.status(404).json({ success: false, message: "Route not found", data: null });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  return res.status(status).json({ success: false, message: status === 500 ? "Internal server error" : error.message, data: null });
}

module.exports = { notFound, errorHandler };
