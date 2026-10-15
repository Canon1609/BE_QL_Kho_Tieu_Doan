const ApiError = require('../utils/ApiError');
const id = v => typeof v === 'string' && /^[1-9]\d{0,19}$/.test(v) && BigInt(v) <= 18446744073709551615n;
const allowed = ['code', 'name', 'type', 'parent_location_id', 'owner_unit_id', 'is_stock_holding', 'is_active', 'note'];
const types = ['GROUP', 'BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE', 'COMPANY_STORE'];
// The root is provisioned by migration; users cannot create another root.
const children = { GROUP: ['GROUP', 'BUILDING', 'WAREHOUSE', 'COMPANY_STORE'], BUILDING: ['FLOOR', 'ROOM'], FLOOR: ['ROOM'] };
function invalid(fields) { throw new ApiError(400, 'Vui lòng kiểm tra các trường được đánh dấu.', fields); }
function validate(body) {
  const errors = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid({ form: 'Dữ liệu địa điểm không hợp lệ.' });
  if (Object.keys(body).some(k => !allowed.includes(k))) errors.form = 'Dữ liệu địa điểm có trường không được hỗ trợ.';
  if (typeof body.code !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(body.code)) errors.code = 'Mã gồm 1–64 ký tự A–Z, 0–9, dấu _ hoặc -; bắt đầu bằng chữ hoặc số (ví dụ DN11).';
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 150 || body.name !== body.name.trim()) errors.name = 'Vui lòng nhập tên địa điểm (1–150 ký tự, không có khoảng trắng thừa ở đầu/cuối).';
  if (!types.includes(body.type)) errors.type = 'Vui lòng chọn loại địa điểm hợp lệ.';
  if (body.parent_location_id == null || !id(String(body.parent_location_id))) errors.parent_location_id = 'Vui lòng chọn địa điểm cha hợp lệ.';
  if (body.owner_unit_id != null && !id(String(body.owner_unit_id))) errors.owner_unit_id = 'Vui lòng chọn đơn vị quản trị hợp lệ.';
  if (typeof body.is_stock_holding !== 'boolean' || types.includes(body.type) && body.is_stock_holding !== ['ROOM', 'WAREHOUSE', 'COMPANY_STORE'].includes(body.type)) errors.type = 'Loại địa điểm và chức năng lưu giữ không phù hợp.';
  if (typeof body.is_active !== 'boolean') errors.is_active = 'Vui lòng chọn trạng thái hợp lệ.';
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > 5000)) errors.note = 'Ghi chú không được quá 5000 ký tự.';
  if (Object.keys(errors).length) invalid(errors);
  return body;
}
module.exports = { validate, id, children, invalid };
