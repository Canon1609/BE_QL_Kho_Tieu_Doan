// Real Chrome/Vite error pages with real login form; isolated test DB only.
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Only Phase 8 test DB');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { sequelize, User, Role, Unit, Material, Location } = require('../src/models');
async function main() {
  const [co11, co12, role, material, unknown, warehouse] = await Promise.all([
    Unit.findOne({ where: { code: 'COMPANY_11' } }), Unit.findOne({ where: { code: 'COMPANY_12' } }),
    Role.findOne({ where: { code: 'COMPANY_ADMIN' } }), Material.findOne({ where: { code: 'P8_QUAT' } }),
    Material.findOne({ where: { code: 'P8_NEW' } }), Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } }),
  ]);
  const password = crypto.randomBytes(24).toString('hex');
  const username = `p8_http_browser_${crypto.randomBytes(6).toString('hex')}`;
  await User.create({ username, full_name: 'Phase 8 HTTP Chrome', password_hash: await bcrypt.hash(password, 10), unit_id: co11.id, role_id: role.id });
  const api = app.listen(0), port = api.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const width of [375, 768, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage(), responses = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.url().includes('/api/v1/search/materials') && r.status() >= 400) responses.push(r.status()) });
      await page.route('**/api/v1/**', async route => {
        const u = new URL(route.request().url());
        const response = await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` });
        await route.fulfill({ response });
      });
      await page.goto('http://127.0.0.1:5173/login');
      await page.getByLabel('Tên đăng nhập').fill(username); await page.getByLabel('Mật khẩu').fill(password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await page.getByRole('button', { name: 'Đăng xuất' }).waitFor();
      for (const [route, status] of [
        [`/stock/search/${material.id}?unit_id=${co12.id}`, 403],
        [`/stock/search/${material.id}?location_id=${warehouse.id}`, 404],
        [`/stock/search/${unknown.id}`, 404],
        [`/stock/search/${material.id}/history?unit_id=${co12.id}`, 403],
        [`/stock/search/${material.id}/history?location_id=${warehouse.id}`, 404],
        [`/stock/search/${unknown.id}/history`, 404],
      ]) {
        const before = responses.length;
        await page.goto(`http://127.0.0.1:5173${route}`);
        await page.getByRole('button', { name: 'Thử lại' }).waitFor();
        assert.deepEqual(responses.slice(before), [status]);
        assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
      }
      // List UI has no unauthorized Unit selector for a Company. Select a location visible in references
      // then intercept the list request as 403/404 to exercise status handling and Retry.
      for (const status of [403, 404]) {
        let injected = false;
        await page.route('**/api/v1/search/materials?*', async route => {
          if (!injected) { injected = true; await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: false, message: status === 403 ? 'Forbidden' : 'Không tìm thấy địa điểm trong phạm vi đơn vị' }) }); }
          else await route.fallback();
        });
        const before = responses.length;
        await page.goto('http://127.0.0.1:5173/stock/search');
        await page.getByRole('button', { name: 'Tải lại kết quả' }).waitFor();
        assert.equal(responses[before], status);
        await page.getByRole('button', { name: 'Tải lại kết quả' }).click();
        await page.getByRole('status').filter({ hasText: 'vật chất · trang' }).waitFor();
        await page.unroute('**/api/v1/search/materials?*');
        assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
      }
      assert.deepEqual(errors, []);
      await ctx.close();
      console.log('Phase 8 Chrome detail/history 403/404 actual + list injected 403/404', width, 'PASS');
    }
  } finally { await browser.close(); api.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
