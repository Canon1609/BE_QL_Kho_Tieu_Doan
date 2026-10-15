class ApiError extends Error {
  constructor(statusCode, message, fields) {
    super(message);
    this.statusCode = statusCode;
    if (fields) this.fields = fields;
  }
}
module.exports = ApiError;
