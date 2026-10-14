// Isolated Phase 6 DB only. Real Chrome/Vite, API served by this process; no development writes.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, Unit, User, Role, Location, Material, MaterialCategory, UnitOfMeasure, MaterialSource, StockLedgerEntry: Ledger, StockTransfer } = require('../src/models');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify', 'Refusing non-Phase-6 test DB');
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const company = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const admin = await User.findOne({ where: { unit_id: root.id, is_active: true } });
  const companyRole = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  const category = await MaterialCategory.findOne({ where: { is_active: true } });
  const measure = await UnitOfMeasure.findOne({ where: { is_active: true } });
  const source = await MaterialSource.findOne({ where: { is_active: true } });
  const rooms = await Location.findAll({ where: { type: 'ROOM', is_active: true, is_stock_holding: true }, order: [['id', 'DESC']] });
  assert(rooms.length >= 2, 'Two holding rooms required');
  const [r101, r102] = rooms.slice(0, 2);
  const code = `P6HF_${Date.now()}`;
  const material = await Material.create({ code, name: 'Giường sắt chiến sĩ (hotfix test)', category_id: category.id, unit_id: measure.id });
  const companyUser = await User.create({ username: code, full_name: 'Kiểm thử quyền hotfix', role_id: companyRole.id, unit_id: company.id, password_hash: 'test-only' });
  const token = user => jwt.sign({ sub: String(user.id), ver: user.auth_version }, jwtConfig().secret, { expiresIn: '10m' });
  for (const [room, qty] of [[r101, 10], [r102, 15]]) await Ledger.create({ unit_id: company.id, location_id: room.id, material_id: material.id, source_id: source.id, condition_id: null, quantity_delta: qty, transaction_type: 'OPENING_BALANCE', reference_type: 'PHASE6_HOTFIX_FIXTURE', reference_id: material.id, occurred_at: new Date(), created_by: admin.id });
  const sums = async () => {
    const rows = await Ledger.findAll({ where: { unit_id: company.id, material_id: material.id, source_id: source.id, condition_id: null }, attributes: ['location_id', [sequelize.fn('SUM', sequelize.col('quantity_delta')), 'quantity']], group: ['location_id'], raw: true });
    return [r101, r102].map(room => Number(rows.find(r => String(r.location_id) === String(room.id))?.quantity || 0));
  };
  const server = app.listen(0);
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    assert.deepEqual(await sums(), [10, 15]);
    for (const width of [375, 768, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      const network = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let injectList400 = width === 768;
      await page.route('**/api/v1/**', async route => {
        const u = new URL(route.request().url());
        if (injectList400 && route.request().method() === 'GET' && u.pathname === '/api/v1/transfers') {
          injectList400 = false;
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Invalid request', data: null }) });
          return;
        }
        const response = await route.fetch({ url: `http://127.0.0.1:${server.address().port}${u.pathname}${u.search}` }); await route.fulfill({ response });
      });
      page.on('response', response => { if (response.url().includes('/api/v1/transfers?')) network.push([new URL(response.url()).search, response.status()]); });
      await page.goto('http://localhost:5173/login');
      await page.evaluate(t => sessionStorage.setItem('access_token', t), token(admin));
      await page.goto('http://localhost:5173/stock/internal-transfer');
      if (width === 768) {
        await page.getByText('Không tải được danh sách phiếu: Không thể hoàn tất thao tác. Vui lòng kiểm tra dữ liệu và thử lại.').waitFor();
        assert.equal(await page.getByText('Không có phiếu phù hợp.').count(), 0, 'List error must not look empty');
        await page.getByRole('button', { name: 'Tải lại' }).click();
      }
      await page.waitForFunction(() => document.querySelector('.account-card')?.textContent.includes('phiếu'));
      await page.getByText('Đang tải phiếu…').waitFor({ state: 'hidden' });
      assert(network.some(([q,s]) => q.includes('transfer_type=INTERNAL_TRANSFER') && s === 200), JSON.stringify(network));
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 375) {
        await page.getByLabel('Mã phiếu *').fill(code);
        await page.getByLabel('Đại đội chịu trách nhiệm *').selectOption(String(company.id));
        await page.getByLabel('Nơi chuyển').selectOption(String(r102.id));
        await page.getByLabel('Nơi nhận').selectOption(String(r101.id));
        await page.getByLabel('Vật chất *').selectOption(String(material.id));
        await page.getByLabel('Nguồn *').selectOption(String(source.id));
        await page.getByLabel('Số lượng *').fill('5');
        await page.getByRole('button', { name: 'Lưu nháp' }).click();
        await page.getByText('Đã tạo phiếu nháp.').waitFor();
        assert.deepEqual(await sums(), [10, 15], 'DRAFT changed balance');
        const draft = await StockTransfer.findOne({ where: { code } });
        assert.equal(draft.status, 'DRAFT');
        page.once('dialog', d => d.accept());
        await page.getByRole('button', { name: 'Ghi sổ' }).first().click();
        await page.getByText('Đã ghi sổ phiếu.').waitFor();
        assert.deepEqual(await sums(), [15, 10]);
        const entries = await Ledger.findAll({ where: { reference_type: 'STOCK_TRANSFER', reference_id: draft.id } });
        assert.deepEqual(entries.map(e => e.quantity_delta).sort((a,b) => a-b), [-5,5]);
        assert(entries.every(e => String(e.unit_id) === String(company.id) && String(e.source_id) === String(source.id) && e.condition_id === null));
        const again = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers/${draft.id}/post`, { method: 'POST', headers: { Authorization: `Bearer ${token(admin)}`, 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(again.status, 409);
        assert.deepEqual(await sums(), [15,10]);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
      console.log(`Chrome ${width} PASS: GET list 200, no overflow; balances ${JSON.stringify(await sums())}`);
    }
    const ctx = await browser.newContext({ viewport: { width: 375, height: 900 } });
    const companyPage = await ctx.newPage();
    await companyPage.route('**/api/v1/**', async route => { const u = new URL(route.request().url()); const response = await route.fetch({ url: `http://127.0.0.1:${server.address().port}${u.pathname}${u.search}` }); await route.fulfill({ response }); });
    await companyPage.goto('http://localhost:5173/login');
    await companyPage.evaluate(t => sessionStorage.setItem('access_token', t), token(companyUser));
    await companyPage.goto('http://localhost:5173/stock/internal-transfer');
    await companyPage.getByText(/không có quyền|Không có quyền|Truy cập bị từ chối/i).first().waitFor();
    assert.equal(await companyPage.getByRole('button', { name: 'Lưu nháp' }).count(), 0);
    await ctx.close();
    const unauth = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers?transfer_type=INTERNAL_TRANSFER&page=1`);
    assert.equal(unauth.status, 401);
    const badList = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers?transfer_type=INTERNAL_TRANSFER&page=0`, { headers: { Authorization: `Bearer ${token(admin)}` } });
    assert.equal(badList.status, 400);
    assert.equal((await badList.json()).message, 'Invalid request');
    const forbidden = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers`, { method: 'POST', headers: { Authorization: `Bearer ${token(companyUser)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code + '_FORBIDDEN' }) });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await sums(), [15,10]);
    console.log('Phase 6 internal hotfix PASS (test DB only)');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await sequelize.close(); }
}
main().catch(e => { console.error('HOTFIX FAIL:', e); process.exitCode = 1 });
