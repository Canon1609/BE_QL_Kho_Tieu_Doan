// Phase 8 copy-only UI regression. API reads isolated Phase 8 DB; no fixture or development writes.
const assert = require('node:assert/strict');
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const jwt = require('jsonwebtoken');
const { jwtConfig } = require('../src/services/auth.service');
const app = require('../src/app');
const { sequelize, User, Unit } = require('../src/models');
async function main() {
  const [root, company] = await Promise.all(['BATTALION_5', 'COMPANY_11'].map(code => Unit.findOne({ where: { code } })));
  assert(root && company);
  const [admin, coAdmin] = await Promise.all([root, company].map(u => User.findOne({ where: { unit_id: u.id, is_active: true } })));
  assert(admin && coAdmin);
  const server = app.listen(0), port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const token = u => jwt.sign({ sub: String(u.id), ver: u.auth_version }, jwtConfig().secret, { expiresIn: '20m' });
  const headers = ['Mã vật chất', 'Tên vật chất', 'Loại vật chất', 'Đơn vị tính', 'Tổng số hiện có', 'Số lượng không ràng buộc mượn', 'Số lượng đang giữ do mượn'];
  try {
    for (const width of [375, 768, 1440]) for (const [actor, role] of [[admin, 'TĐ'], [coAdmin, 'ĐĐ11']]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage(), errors = [], unexpected = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
      page.on('response', r => { if (r.status() >= 400) unexpected.push(`${r.status()} ${r.url()}`) });
      await page.route('**/api/v1/**', async route => {
        const u = new URL(route.request().url());
        const r = await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` });
        await route.fulfill({ response: r });
      });
      await page.goto('http://127.0.0.1:5173/login');
      await page.evaluate(t => sessionStorage.setItem('access_token', t), token(actor));
      await page.goto('http://127.0.0.1:5173/stock/search');
      const result = page.getByRole('status').filter({ hasText: 'vật chất · trang' });
      await result.waitFor();
      assert((await page.locator('main').innerText()).includes('Tổng số hiện có bao gồm vật chất không ràng buộc mượn'));
      assert((await page.locator('main').innerText()).includes('Hai phần này đã nằm trong tổng số, không cộng thêm lần nữa.'));
      const heads = await page.locator('thead th').allTextContents();
      assert.deepEqual(heads, headers);
      const toggle = page.getByRole('checkbox', { name: 'Hiển thị cả vật chất đã hết tồn' });
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await page.getByText('Chỉ hiển thị vật chất đã từng có giao dịch trong kho.').count(), 1);
      await page.getByLabel('Tìm mã / tên vật chất').fill('P8_ZERO');
      await page.getByText('Không có vật chất có lịch sử/tồn phù hợp').waitFor();
      // Click the words, not the input. The entire label must toggle the checkbox.
      await page.getByText('Hiển thị cả vật chất đã hết tồn').click();
      assert.equal(await toggle.isChecked(), true);
      if (role === 'TĐ') {
        await page.getByRole('cell', { name: 'P8_ZERO' }).waitFor();
        assert.equal(await page.getByRole('cell', { name: 'P8_NEW' }).count(), 0);
      } else {
        await page.getByText('Không có vật chất có lịch sử/tồn phù hợp').waitFor();
        assert.equal(await page.getByRole('cell', { name: 'P8_ZERO' }).count(), 0);
      }
      await page.getByText('Hiển thị cả vật chất đã hết tồn').click();
      assert.equal(await toggle.isChecked(), false);
      if (role === 'TĐ') await page.getByRole('cell', { name: 'P8_ZERO' }).waitFor({ state: 'detached' });
      await page.getByLabel('Tìm mã / tên vật chất').fill('');
      await result.waitFor();
      const checkLayout = async () => {
        const measurements = await page.evaluate(() => {
          const label = document.querySelector('.search-check');
          const input = label.querySelector('input');
          const text = label.querySelector('span');
          const table = document.querySelector('.search-page .table-scroll');
          return { overflow: document.documentElement.scrollWidth > innerWidth,
            aligned: Math.abs((input.getBoundingClientRect().top + input.getBoundingClientRect().bottom) / 2 - (text.getBoundingClientRect().top + text.getBoundingClientRect().bottom) / 2) < 18,
            tableScroll: table.scrollWidth > table.clientWidth };
        });
        assert(!measurements.overflow, `${role} ${width}: tràn trang`);
        assert(measurements.aligned, `${role} ${width}: checkbox lệch nhãn`);
        if (width === 375) assert(measurements.tableScroll, 'bảng mobile phải cuộn bên trong');
      };
      await checkLayout();
      await page.getByLabel('Tìm mã / tên vật chất').fill('P8_QUAT');
      const row = page.locator('tbody tr').filter({ hasText: 'P8_QUAT' });
      await row.waitFor();
      const cells = await row.locator('td').allTextContents();
      assert.deepEqual(cells.slice(4), role === 'TĐ' ? ['12', '9', '3'] : ['3', '0', '3']);
      if (role === 'TĐ') {
        await page.locator('.search-filters label').filter({ hasText: 'Toàn Tiểu đoàn' }).locator('select').selectOption(String(company.id));
        await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes('P8_QUAT') && r.querySelectorAll('td')[4]?.textContent === '3'));
        assert.deepEqual((await row.locator('td').allTextContents()).slice(4), ['3', '0', '3']);
        await page.locator('.search-filters label').filter({ hasText: 'Toàn Tiểu đoàn' }).locator('select').selectOption('');
        await page.getByRole('cell', { name: '12', exact: true }).waitFor();
      } else assert.equal(await page.locator('.search-filters label').filter({ hasText: 'Toàn Tiểu đoàn' }).count(), 0);
      const sourceRequest = page.waitForResponse(r => r.url().includes('/api/v1/search/materials?') && new URL(r.url()).searchParams.has('source_id') && r.status() === 200);
      await page.locator('.search-filters label').filter({ hasText: 'Mọi nguồn' }).locator('select').selectOption({ index: 1 });
      await sourceRequest;
      await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
      await page.getByRole('cell', { name: 'P8_QUAT' }).waitFor();
      await page.getByLabel('Sắp xếp').selectOption('physical');
      const sortRequest = page.waitForResponse(r => r.url().includes('/api/v1/search/materials?') && new URL(r.url()).searchParams.get('sort') === 'physical' && new URL(r.url()).searchParams.get('direction') === 'desc' && r.status() === 200);
      await page.getByLabel('Thứ tự').selectOption('desc');
      await sortRequest;
      assert.equal(await page.getByLabel('Sắp xếp').inputValue(), 'physical');
      if (role === 'TĐ') {
        await page.getByRole('button', { name: 'Sau' }).click();
        await page.getByRole('status').filter({ hasText: 'trang 2' }).waitFor();
        await page.getByRole('button', { name: 'Trước' }).click();
        await page.getByRole('status').filter({ hasText: 'trang 1' }).waitFor();
      }
      await checkLayout();
      assert.deepEqual(errors, [], `${role} ${width}: console`);
      assert.deepEqual(unexpected, [], `${role} ${width}: HTTP`);
      await ctx.close();
      console.log(`Phase 8 list Vietnamese copy/checkbox/filter/sort/page Chrome ${role} ${width} PASS`);
    }
  } finally { await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
