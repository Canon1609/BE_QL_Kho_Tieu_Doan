function notFound(req, res) {
  return res.status(404).json({ success: false, message: "Route not found", data: null });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const code = error.statusCode || error.status;
  const schemaCode = error.original?.code || error.parent?.code;
  const missingRepairSchema = req.originalUrl.startsWith('/api/v1/damage-repair') &&
    (error.name === 'SequelizeDatabaseError' || error.name === 'SequelizeForeignKeyConstraintError') &&
    (error.original?.code === 'ER_NO_SUCH_TABLE' || error.original?.code === 'ER_BAD_FIELD_ERROR' ||
      error.parent?.code === 'ER_NO_SUCH_TABLE' || error.parent?.code === 'ER_BAD_FIELD_ERROR');
  const status = missingRepairSchema ? 503 : Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
  if (status === 500) console.error('Unhandled API error', { method: req.method, path: req.originalUrl, error });
  if (missingRepairSchema) console.error('Damage repair schema is not ready', { method: req.method, path: req.originalUrl, code: schemaCode });
  // Only expose explicitly approved 400 messages, never parser/ORM internals.
  const safeBadRequest = new Set(['Google Sign-In is not configured', 'Invalid Google credential']);
  const damageLoss = req.originalUrl.startsWith('/api/v1/damage-loss');
  const lossFollowup = req.originalUrl.startsWith('/api/v1/loss-followup');
  const unavailableLossFollowupSchema = lossFollowup && (error.name === 'SequelizeDatabaseError' || error.name === 'SequelizeForeignKeyConstraintError') && ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(schemaCode);
  const message = unavailableLossFollowupSchema ? 'Chức năng tìm thấy lại chưa được thiết lập đầy đủ. Vui lòng liên hệ người quản lý hệ thống.' : missingRepairSchema ? 'Chức năng sửa chữa chưa được thiết lập đầy đủ. Vui lòng liên hệ người quản lý hệ thống.' : status === 500 ? (lossFollowup ? 'Chưa thể xử lý đề nghị tìm thấy lại. Vui lòng thử lại.' : req.originalUrl.startsWith('/api/v1/damage-repair') ? 'Chưa thể lưu thông tin sửa chữa. Vui lòng thử lại.' : "Internal server error") : status === 413 ? "Request too large" : status === 400 ? (error.damageLossSafe ? error.message : error.fields && error.statusCode === 400 ? error.message : safeBadRequest.has(error.message) ? error.message : "Invalid request") : error.message || "Request rejected";
  return res.status(status).json({ success: false, message, data: null, ...([400, 409].includes(status) && error.fields ? { errors: error.fields } : damageLoss && status === 400 && error.damageLossSafe ? { errors: error.fields } : {}) });
}

module.exports = { notFound, errorHandler };
