// Form login with a freshly created test-only account; no JWT injection, no credential printed/stored.
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Only isolated Phase 8 test DB');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { sequelize, Unit, Role, User, Material } = require('../src/models');
async function main() {
  const password = crypto.randomBytes(25).toString('hex');
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const battalionRole = await Role.findOne({ where: { code: 'BATTALION_ADMIN' } });
  const coRole = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  const m = await Material.findOne({ where: { code: 'P8_QUAT' } });
  const api = app.listen(0), port = api.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const width of [375, 768, 1440]) for (const n of [5, 11, 12, 13]) {
      const unit = n === 5 ? root : await Unit.findOne({ where: { code: `COMPANY_${n}` } });
      const username = `p8_form_${n}_${crypto.randomBytes(6).toString('hex')}`;
      await User.create({ username, full_name: 'Form login test only', password_hash: await bcrypt.hash(password, 10), unit_id: unit.id, role_id: n === 5 ? battalionRole.id : coRole.id });
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(), errors = [], unexpected = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 500) unexpected.push(`${r.status()} ${r.url()}`) });
      await page.route('**/api/v1/**', async route => {
        const u = new URL(route.request().url());
        const response = await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` });
        await route.fulfill({ response });
      });
      await page.goto('http://127.0.0.1:5173/login');
      await page.getByLabel('Tên đăng nhập').fill(username);
      await page.getByLabel('Mật khẩu').fill(password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await page.getByRole('button', { name: 'Đăng xuất' }).waitFor();
      await page.goto('http://127.0.0.1:5173/stock/search');
      await page.getByRole('heading', { name: 'Tra cứu vật chất toàn hệ thống' }).waitFor();
      if (n === 13) await page.getByText('Không có vật chất có lịch sử/tồn phù hợp').waitFor();
      else await page.getByRole('status').filter({ hasText: 'vật chất · trang' }).waitFor();
      if (n !== 13) {
        await page.getByLabel('Tìm mã / tên vật chất').fill('P8_QUAT');
        await page.getByRole('cell', { name: 'P8_QUAT' }).waitFor();
        await page.getByRole('link', { name: 'P8_QUAT' }).click();
        await page.getByRole('heading', { name: /P8_QUAT · Quạt thử Phase 8/ }).waitFor();
        await page.getByRole('link', { name: 'Xem lịch sử ghi sổ →' }).click();
        await page.getByRole('heading', { name: 'Lịch sử ghi sổ vật chất' }).waitFor();
        await page.getByRole('status').filter({ hasText: 'bút toán · trang' }).waitFor();
      }
      if (n === 5) {
        for (const [code, quantity] of [['P8_NEGATIVE', '-3'], ['P8_BIGINT', '9007199254740993']]) {
          await page.goto('http://127.0.0.1:5173/stock/search');
          await page.getByLabel('Tìm mã / tên vật chất').fill(code);
          const row = page.locator('tbody tr').filter({ hasText: code });
          await row.waitFor();
          assert((await row.innerText()).includes(quantity));
          await row.getByRole('link', { name: code }).click();
          await page.getByText(`Tồn vật lý: ${BigInt(quantity).toLocaleString('vi-VN')}`, { exact: false }).first().waitFor();
          await page.getByRole('link', { name: 'Xem lịch sử ghi sổ →' }).click();
          await page.getByRole('cell', { name: quantity, exact: false }).first().waitFor();
        }
      }
      assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close();
      console.log('Phase 8 real form login + search PASS', n, width);
    }
  } finally { await browser.close(); api.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
