function notFound(req, res) {
  return res.status(404).json({ success: false, message: "Route not found", data: null });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const code = error.statusCode || error.status;
  const status = Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
  // Only expose explicitly approved 400 messages, never parser/ORM internals.
  const safeBadRequest = new Set(['Google Sign-In is not configured', 'Invalid Google credential']);
  const message = status === 500 ? "Internal server error" : status === 413 ? "Request too large" : status === 400 ? (safeBadRequest.has(error.message) ? error.message : "Invalid request") : error.message || "Request rejected";
  return res.status(status).json({ success: false, message, data: null });
}

module.exports = { notFound, errorHandler };
