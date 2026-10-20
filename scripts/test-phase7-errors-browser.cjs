// B11: real Chrome, Vite, isolated DB; intercept only targeted requests.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, Unit, User, Role, Material, MaterialCategory, UnitOfMeasure, MaterialSource, StockLedgerEntry: Ledger, Location, BorrowRequest } = require('../src/models');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase7_verify');
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } }), co = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const admin = await User.findOne({ where: { unit_id: root.id } });
  const role = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  const company = await User.create({ username: `P7ERR_${Date.now()}`, full_name: 'Phase 7 error test', role_id: role.id, unit_id: co.id, password_hash: 'test-only' });
  const mat = await Material.create({ code: `P7ERR_M_${Date.now()}`, name: 'Chrome error Phase 7', category_id: (await MaterialCategory.findOne()).id, unit_id: (await UnitOfMeasure.findOne()).id });
  const source = await MaterialSource.findOne(), wh = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } }), store = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
  await Ledger.create({ material_id: mat.id, unit_id: root.id, location_id: wh.id, source_id: source.id, condition_id: null, quantity_delta: 15, transaction_type: 'NORMAL_RECEIPT', reference_type: 'PHASE7_ERROR_FIXTURE', reference_id: mat.id, occurred_at: new Date(), created_by: admin.id });
  const server = app.listen(0), port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const token = u => jwt.sign({ sub: String(u.id), ver: 0 }, jwtConfig().secret, { expiresIn: '20m' });
  try {
    for (const width of [375,768,1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } }), page = await ctx.newPage(), errors = [], unexpected = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Network Error/.test(m.text())) errors.push(m.text()) });
      let inject = null, count = 0;
      await page.route('**/api/v1/**', async route => {
        const req = route.request(), u = new URL(req.url()), path = u.pathname;
        if (inject && req.method() === inject.method && inject.path.test(path)) {
          const mode = inject.mode; inject = null; count++;
          if (mode === 'network') return route.abort('failed');
          if (mode === 'timeout') { const response = await route.fetch({ url: `http://127.0.0.1:${port}${path}${u.search}` }); await new Promise(resolve => setTimeout(resolve,11000)); return route.fulfill({ response }); }
          return route.fulfill({ status: mode, contentType: 'application/json', body: JSON.stringify({ success: false, message: mode === 409 ? 'Mã yêu cầu đã tồn tại' : mode === 503 ? 'Dịch vụ tạm gián đoạn' : 'Dữ liệu không hợp lệ', ...(mode === 400 ? { errors: { due_date: 'Hạn trả không hợp lệ.' } } : {}) }) });
        }
        try { const response = await route.fetch({ url: `http://127.0.0.1:${port}${path}${u.search}` }); if (response.status() >= 400) unexpected.push(`${response.status()} ${path}`); await route.fulfill({ response }); } catch (e) { unexpected.push(`${path}: ${e.message}`); await route.abort() }
      });
      const visit = async who => { await page.goto('http://127.0.0.1:5173/login'); await page.evaluate(t => sessionStorage.setItem('access_token', t), token(who)); await page.goto('http://127.0.0.1:5173/stock/borrow'); await page.getByRole('heading', { name: 'Mượn / Trả vật chất' }).waitFor(); await page.getByRole('heading', { name: 'Danh sách yêu cầu · Theo dõi quá hạn' }).waitFor(); await page.waitForTimeout(500); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false) };
      await visit(company);
      const code = `P7ERR_${Date.now()}_${width}`;
      const fill = async () => { await page.getByLabel('Mã yêu cầu *').fill(code); await page.getByLabel('Hạn trả *').fill('2026-12-31'); await page.getByLabel('Vật chất *').selectOption(String(mat.id)); await page.getByLabel('Nguồn *').selectOption(String(source.id)); await page.getByLabel('Số lượng *').fill('4') };
      await fill(); inject = { method: 'GET', path: /\/borrow$/, mode: 'network' }; await page.getByLabel('Tìm mã yêu cầu').fill('P7ERR'); await page.getByText('Không tải được danh sách:').waitFor(); assert.equal(await page.getByLabel('Mã yêu cầu *').inputValue(), code);
      await page.getByRole('button', { name: 'Thử lại danh sách' }).click(); await page.getByText('Không tải được danh sách:').waitFor({ state: 'hidden' });
      const save = () => page.getByRole('button', { name: 'Lưu nháp' }).click();
      inject = { method: 'POST', path: /\/borrow$/, mode: 400 }; await save(); await page.getByText('Hạn trả không hợp lệ.').waitFor(); assert.equal(await page.getByLabel('Mã yêu cầu *').inputValue(), code);
      inject = { method: 'POST', path: /\/borrow$/, mode: 409 }; await save(); await page.getByText('Mã đã tồn tại. Vui lòng chọn mã khác.').waitFor(); assert.equal(await page.getByLabel('Mã yêu cầu *').inputValue(), code);
      inject = { method: 'POST', path: /\/borrow$/, mode: 503 }; await save(); await page.getByText('Lỗi lưu hoặc xác nhận:').waitFor(); assert.equal(await page.getByLabel('Mã yêu cầu *').inputValue(), code);
      await save(); await page.getByText('Đã lưu yêu cầu nháp.').waitFor(); assert.equal(await BorrowRequest.count({ where: { code } }), 1);
      await page.getByLabel('Tìm mã yêu cầu').fill(code); await page.getByRole('button', { name: 'Chi tiết' }).first().click();
      await page.getByRole('button', { name: 'Gửi duyệt' }).click(); await page.getByText('Đã gửi yêu cầu.').waitFor();
      await visit(admin); await page.getByLabel('Tìm mã yêu cầu').fill(code); await page.getByRole('button', { name: 'Chi tiết' }).first().click();
      await page.getByRole('button', { name: 'Duyệt', exact: true }).click(); await page.getByText('Đã duyệt.').waitFor();
      await page.getByRole('button', { name: 'Xác nhận giao' }).click(); await page.getByText('Vui lòng chọn nơi nhận.').waitFor();
      await page.getByLabel('Nơi nhận *').selectOption(String(store.id));
      inject = { method: 'POST', path: /\/deliver$/, mode: 'timeout' }; page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Xác nhận giao' }).click();
      await page.getByText('Trạng thái ghi chưa rõ; tạm khóa').waitFor({ timeout: 18000 });
      assert.equal(await page.getByRole('button', { name: 'Xác nhận giao' }).isDisabled(), true);
      assert.equal((await BorrowRequest.findOne({ where: { code } })).status, 'DELIVERED');
      await page.getByRole('button', { name: 'Kiểm tra trạng thái trên server' }).click(); await page.getByText('Trạng thái phiếu', { exact: false }).waitFor();
      const doc = await BorrowRequest.findOne({ where: { code } });
      assert.equal(await Ledger.count({ where: { transaction_type: 'BORROW', material_id: mat.id, borrow_delivery_id: { [require('sequelize').Op.ne]: null } } }), (width === 375 ? 1 : width === 768 ? 2 : 3) * 2);
      assert.equal(doc.status, 'DELIVERED'); assert.equal(count, 5);
      // A write that never reached the server must also remain locked after network failure.
      await visit(company);
      const offlineCode = `P7OFF_${Date.now()}_${width}`;
      await page.getByLabel('Mã yêu cầu *').fill(offlineCode);
      await page.getByLabel('Hạn trả *').fill('2026-12-31');
      await page.getByLabel('Vật chất *').selectOption(String(mat.id));
      await page.getByLabel('Nguồn *').selectOption(String(source.id));
      await page.getByLabel('Số lượng *').fill('1');
      inject = { method: 'POST', path: /\/borrow$/, mode: 'network' }; await save();
      await page.getByText('Trạng thái ghi chưa rõ; tạm khóa').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Lưu nháp' }).isDisabled(), true);
      assert.equal(await page.getByLabel('Mã yêu cầu *').inputValue(), offlineCode);
      assert.equal(await BorrowRequest.count({ where: { code: offlineCode } }), 0);
      await page.getByRole('button', { name: 'Kiểm tra trạng thái trên server' }).click();
      await page.getByText('Chưa thấy mã').waitFor();
      assert.equal(await BorrowRequest.count({ where: { code: offlineCode } }), 0);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await ctx.close(); console.log('B11 Chrome',width,'PASS');
    }
  } finally { await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
