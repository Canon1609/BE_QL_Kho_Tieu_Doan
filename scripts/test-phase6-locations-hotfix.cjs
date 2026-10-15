const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, User, Unit, Location } = require('../src/models');

async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify', 'Only isolated test DB is allowed');
  const origin = 'http://localhost:5173';
  assert.equal((await fetch(origin)).status, 200);
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const admin = await User.findOne({ where: { unit_id: root.id } });
  const token = jwt.sign({ sub: String(admin.id), ver: 0 }, jwtConfig().secret, { expiresIn: '15m' });
  const server = app.listen(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const code = `P6_HOTFIX_${Date.now()}`;
  try {
    for (const width of [375, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [], failures = [];
      let injectFailure = true, injectedCount = 0;
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/503 \(Service Unavailable\)/.test(m.text())) errors.push(m.text()); });
      page.on('response', r => { if (r.status() >= 500 && !(r.status() === 503 && new URL(r.url()).pathname === '/api/v1/locations')) failures.push(`${r.status()} ${r.url()}`); });
      await page.route('**/api/v1/**', async route => {
        const url = new URL(route.request().url());
        if (injectFailure && route.request().method() === 'GET' && url.pathname === '/api/v1/locations') {
          injectFailure = false;
          injectedCount++;
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Internal server error' }) });
        }
        try {
          const response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
          await route.fulfill({ response });
        } catch (err) {
          if (!/Target closed|Route is already handled|Fetch response has been disposed|ECONNRESET|net::ERR_ABORTED/.test(String(err))) throw err;
          try { await route.abort('aborted') } catch { /* navigation canceled GET */ }
        }
      });
      await page.goto(`${origin}/login`);
      await page.evaluate(t => sessionStorage.setItem('access_token', t), token);
      await page.goto(`${origin}/stock/locations`);
      await page.getByRole('button', { name: 'Thử lại' }).waitFor();
      assert.equal(await page.getByText('Chưa có địa điểm.').count(), 0);
      assert(await page.getByText('Máy chủ đang gặp sự cố.').count());
      await page.screenshot({ path: join(tmpdir(), `phase6-locations-error-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Thử lại' }).click();
      await page.getByRole('button', { name: 'Tiểu đoàn 5', exact: true }).first().waitFor();
      const check = page.getByLabel('Đang hoạt động');
      assert(await check.isChecked());
      const box = await check.boundingBox();
      const label = await page.locator('.checkbox-field > label').boundingBox();
      assert(box && label && box.x >= label.x && box.x + box.width <= label.x + label.width);
      assert(Math.abs(box.y + box.height / 2 - (label.y + label.height / 2)) < 2);
      const metrics = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, width: innerWidth }));
      assert(metrics.doc <= metrics.width, JSON.stringify(metrics));
      await page.getByLabel('Mã *', { exact: true }).fill(`${code}_${width}`);
      await page.getByLabel('Tên *', { exact: true }).fill('Dãy nhà kiểm thử');
      await page.getByLabel('Địa điểm cha').selectOption({ label: 'Tiểu đoàn 5' });
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Đã lưu địa điểm.').waitFor();
      await page.getByLabel('Tìm tên hoặc mã').fill(`${code}_${width}`);
      await page.getByRole('button', { name: 'Dãy nhà kiểm thử' }).click();
      await page.getByLabel('Tên *', { exact: true }).fill('Dãy nhà đã sửa');
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Đã lưu địa điểm.').waitFor();
      await page.getByRole('button', { name: 'Dãy nhà đã sửa' }).click();
      assert.equal(await page.getByLabel('Tên *', { exact: true }).inputValue(), 'Dãy nhà đã sửa');
      await page.screenshot({ path: join(tmpdir(), `phase6-locations-success-${width}.png`), fullPage: true });
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Xóa', exact: true }).click();
      await page.getByText('Đã xóa địa điểm.').waitFor();
      assert.equal(await Location.count({ where: { code: `${code}_${width}` } }), 0);
      assert.equal(injectedCount, 1); assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      console.log(`Chrome ${width}: 503→retry, GET 200, CRUD, alignment, screenshot, console/network PASS`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await sequelize.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
