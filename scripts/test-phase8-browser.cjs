const assert = require('node:assert/strict');
if (process.env.DB_NAME !== 'ql_kho_tieu_doan_5_phase8_verify') throw Error('Chỉ DB Phase 8 test độc lập');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const jwt = require('jsonwebtoken');
const { jwtConfig } = require('../src/services/auth.service');
const app = require('../src/app');
const { sequelize, User, Unit, Material } = require('../src/models');
async function main() {
  const root = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const companies = await Promise.all([11, 12, 13].map(async n => Unit.findOne({ where: { code: `COMPANY_${n}` } })));
  const [admin, ...companyUsers] = await Promise.all([root, ...companies].map(unit => User.findOne({ where: { unit_id: unit.id, is_active: true } })));
  const material = await Material.findOne({ where: { code: 'P8_QUAT' } });
  assert(admin && companyUsers.every(Boolean) && material);
  const api = app.listen(0), port = api.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const token = u => jwt.sign({ sub: String(u.id), ver: u.auth_version }, jwtConfig().secret, { expiresIn: '20m' });
  try {
    for (const width of [375, 768, 1440]) {
      for (const actor of [admin, ...companyUsers]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage(), errors = [], network = [];
        let inject = ''; 
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
        page.on('response', r => { if (r.status() >= 400) network.push(`${r.status()} ${r.url()}`) });
        await page.route('**/api/v1/**', async route => {
          const u = new URL(route.request().url());
          if (inject && u.pathname.startsWith('/api/v1/search/materials') && !u.pathname.endsWith('/units')) {
            const mode = inject; inject = '';
            if (mode === 'offline') return route.abort('failed');
            return route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false,"message":"Internal server error"}' });
          }
          const response = await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` });
          await route.fulfill({ response });
        });
        await page.goto('http://127.0.0.1:5173/login');
        await page.evaluate(t => sessionStorage.setItem('access_token', t), token(actor));
        await page.goto('http://127.0.0.1:5173/stock/search');
        await page.getByRole('heading', { name: 'Tra cứu vật chất toàn hệ thống' }).waitFor();
        if (actor.id === companyUsers[2].id) await page.getByText('Không có vật chất có lịch sử/tồn phù hợp').waitFor();
        else await page.getByRole('status').filter({ hasText: 'vật chất · trang' }).waitFor();
        assert(await page.getByRole('link', { name: 'Tra cứu vật chất' }).count() === 1);
        await page.getByLabel('Tìm mã / tên vật chất').fill('P8_QUAT');
        if (actor.id !== companyUsers[2].id) await page.getByRole('cell', { name: 'P8_QUAT' }).waitFor();
        else await page.getByText('Không có vật chất có lịch sử/tồn phù hợp').waitFor();
        const row = page.locator('tbody tr').filter({ hasText: 'P8_QUAT' });
        if ([admin.id, companyUsers[0].id, companyUsers[1].id].includes(actor.id))
          assert((await row.innerText()).includes(actor.id === admin.id ? '12' : actor.id === companyUsers[0].id ? '3' : '2')); 
        else assert.equal(await row.count(), 0);
        if (actor.id === companyUsers[2].id) {
          assert.deepEqual(errors, []); assert.deepEqual(network, []);
          assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
          await ctx.close(); console.log('Phase 8 Chrome empty company', width, 'ĐĐ13 PASS'); continue;
        }
        await page.getByRole('link', { name: 'P8_QUAT' }).click();
        await page.getByRole('heading', { name: /P8_QUAT · Quạt thử Phase 8/ }).waitFor();
        assert((await page.locator('main').innerText()).includes(actor.id === admin.id ? 'Tồn vật lý: 12' : actor.id === companyUsers[0].id ? 'Tồn vật lý: 3' : 'Tồn vật lý: 2'));
        await page.getByRole('link', { name: 'Xem lịch sử ghi sổ →' }).click();
        await page.getByRole('heading', { name: 'Lịch sử ghi sổ vật chất' }).waitFor();
        await page.getByRole('status').filter({ hasText: 'bút toán · trang' }).waitFor();
        await page.getByLabel('Loại giao dịch').fill('RETURN');
        if (actor.id === companyUsers[1].id) await page.getByText('Không có phát sinh trong khoảng lọc').waitFor();
        else await page.getByRole('status').filter({ hasText: `${actor.id === admin.id ? '2' : '1'} bút toán · trang` }).waitFor();
        await page.getByLabel('Từ ngày').fill('2026-10-04');
        await page.getByLabel('Đến ngày').fill('2026-10-04');
        if (actor.id === companyUsers[1].id) await page.getByText('Không có phát sinh trong khoảng lọc').waitFor();
        else await page.getByRole('status').filter({ hasText: 'bút toán · trang' }).waitFor();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert(!overflow, `${width}px page overflow`);
        assert.deepEqual(errors, [], `${width}px console/page errors`);
        assert.deepEqual(network, [], `${width}px HTTP errors`);
        if (actor.id === admin.id) {
          // Exercise real Vite UI error/retry at each viewport. Expected failures are excluded from the earlier clean-network assertion.
          for (const [path, mode, reload] of [
            ['/stock/search', 'offline', 'Tải lại kết quả'],
            ['/stock/search', '500', 'Tải lại kết quả'],
            [`/stock/search/${material.id}`, 'offline', 'Thử lại'],
            [`/stock/search/${material.id}`, '500', 'Thử lại'],
            [`/stock/search/${material.id}/history`, 'offline', 'Thử lại'],
            [`/stock/search/${material.id}/history`, '500', 'Thử lại'],
          ]) {
            inject = mode;
            await page.goto(`http://127.0.0.1:5173${path}`);
            await page.getByRole('button', { name: reload }).waitFor();
            await page.getByRole('button', { name: reload }).click();
            if (path === '/stock/search') await page.getByRole('status').filter({ hasText: 'vật chất · trang' }).waitFor();
            else if (path.endsWith('/history')) await page.getByRole('status').filter({ hasText: 'bút toán · trang' }).waitFor();
            else await page.getByRole('heading', { name: /P8_QUAT · Quạt thử Phase 8/ }).waitFor();
            assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
          }
          assert(errors.every(text => /Failed to load resource: (net::ERR_FAILED|the server responded with a status of 500)/.test(text)), `${width}px unexpected console errors: ${errors}`);
          assert.equal(errors.length, 6, 'six intentional request failures');
        }
        await ctx.close();
        console.log('Phase 8 Chrome list/detail/history', width, actor.id === admin.id ? 'TĐ' : actor.id === companyUsers[0].id ? 'ĐĐ11' : 'ĐĐ12', 'PASS');
      }
    }
  } finally { await browser.close(); api.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
