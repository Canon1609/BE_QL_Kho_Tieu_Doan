// Chrome + real Vite + isolated Phase 6 API. All writes are confined to the verified test database.
const assert = require('node:assert/strict');
assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify', 'Never test-write development DB');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, User, Unit, Role, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, Location, StockReceipt, StockTransfer } = require('../src/models');
async function main() {
  const [[db]] = await sequelize.query('SELECT DATABASE() AS name');
  assert.equal(db.name, 'ql_kho_tieu_doan_5_phase6_verify');
  const vite = await fetch('http://localhost:5173/'); assert.equal(vite.status, 200);
  const viteModule = await fetch('http://localhost:5173/src/pages/AccountsPage.jsx'); assert.equal(viteModule.status, 200);
  const [battalion, c11, c13, companyRole, material, source, condition, store11, room] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Unit.findOne({ where: { code: 'COMPANY_13' } }), Role.findOne({ where: { code: 'COMPANY_ADMIN' } }),
    Material.findOne({ where: { is_active: true } }), MaterialSource.findOne({ where: { is_active: true } }), ConditionLevel.findOne({ where: { is_active: true } }),
    Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } }), Location.findOne({ where: { type: 'ROOM', is_active: true, is_stock_holding: true } }),
  ]);
  assert([battalion, c11, c13, companyRole, material, source, condition, store11, room].every(Boolean), 'Missing Phase 6 fixtures');
  const admin = await User.findOne({ where: { unit_id: battalion.id, is_active: true } });
  const company11 = await User.findOne({ where: { unit_id: c11.id, role_id: companyRole.id, is_active: true } });
  const company13 = await User.findOne({ where: { unit_id: c13.id, role_id: companyRole.id, is_active: true } });
  assert(admin && company11 && company13);
  const token = u => jwt.sign({ sub: String(u.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const prefix = `P6INPUT_${Date.now()}`;
  const made = { users: [], materials: [], categories: [], units: [], receipts: [], transfers: [] };
  async function api(path, who, method = 'GET', data) {
    const res = await fetch(base + path, { method, headers: { ...(who ? { Authorization: `Bearer ${token(who)}` } : {}), 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const text = await res.text(); assert(!/Sequelize|sqlMessage|password_hash|stack/i.test(text));
    return { status: res.status, body: JSON.parse(text) };
  }
  async function start(page, user) {
    await page.goto('http://localhost:5173/login');
    await page.evaluate(value => sessionStorage.setItem('access_token', value), token(user));
  }
  try {
    const unauthorized = await api('/users', null); assert.equal(unauthorized.status, 401);
    const b = await api('/stock/references', admin); assert.equal(b.status, 200); assert(b.body.data.sources.length && b.body.data.conditions.length);
    for (const [u, other] of [[company11, c13], [company13, c11]]) {
      for (const p of ['/users', '/stock/receipts', '/stock/references', '/transfers', '/stock/balance']) assert.equal((await api(p, u)).status, 403, p);
      for (const kind of ['materials', 'categories', 'units']) {
        assert.equal((await api(`/catalog/${kind}`, u)).status, 200);
        assert.equal((await api(`/catalog/${kind}`, u, 'POST', { code: `${prefix}_NO`, name: 'Không được tạo' })).status, 403);
      }
      assert.equal((await api('/locations', u)).status, 200);
      assert.equal((await api('/locations', u, 'POST', {})).status, 403);
      assert.equal((await api(`/locations/balance?unit_id=${other.id}`, u)).status, 403);
      assert.equal((await api(`/transfers/company-assets/${other.id}`, u)).status, 403);
      assert.equal((await api(`/transfers/company-assets/${other.id}/history`, u)).status, 403);
      assert.equal((await api(`/transfers/company-assets/${u.unit_id}`, u)).status, 200);
    }
    const invalid = await api('/stock/receipts', admin, 'POST', { code: 'mã sai', receipt_type: 'NORMAL_RECEIPT', receipt_date: '2026-02-30', items: [] });
    assert.equal(invalid.status, 400);
    for (const width of [375, 768, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } }); const page = await ctx.newPage();
      const errors = [], unexpected5xx = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/400 \(Bad Request\)|409 \(Conflict\)/.test(m.text())) errors.push(m.text()); });
      page.on('response', r => { if (r.status() >= 500) unexpected5xx.push(`${r.status()} ${r.url()}`); });
      await page.route('**/api/v1/**', async route => { const url = new URL(route.request().url());
        try { const response = await route.fetch({ url: `${base}${url.pathname.slice('/api/v1'.length)}${url.search}` }); await route.fulfill({ response }); }
        catch (err) { if (!/Target closed|Route is already handled|ECONNRESET|net::ERR_ABORTED|Fetch response has been disposed/.test(String(err))) throw err; try { await route.abort('aborted'); } catch { /* navigation canceled */ } }
      });
      const visit = async (path, heading, user = admin) => {
        await start(page, user); await page.goto('http://localhost:5173' + path);
        await page.getByRole('heading', { name: heading }).first().waitFor({ timeout: 15000 });
        await page.waitForTimeout(350);
        const metrics = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert(metrics.document <= metrics.viewport, `${path} ${width} overflow ${JSON.stringify(metrics)}`);
      };
      const field = (editor, label) => page.locator(`${editor} ${['Vật chất','Nguồn','Số lượng'].includes(label) ? '.receipt-item ' : ''}.form-field`).filter({ has: page.locator('label > span').filter({ hasText: label }) }).first();
      const required = async (editor, labels) => { for (const label of labels) { const f = field(editor, label); await f.waitFor(); assert((await f.locator('label').innerText()).includes('*'), `${editor} ${label} required mark`); assert((await f.locator('.field-help').count()) > 0, `${editor} ${label} helper absent`); assert((await f.locator('.field-help').innerText()).length > 5, `${editor} ${label} helper`); } };
      const fieldError = async (editor, label) => { const f = field(editor, label); await f.locator('.field-error').waitFor(); assert((await f.locator('.field-error').innerText()).length > 8); };
      const aligned = async (editor) => { const positions = await page.locator(`${editor} .form-field input, ${editor} .form-field select, ${editor} .form-field textarea`).evaluateAll(nodes => nodes.map(n => ({ left: n.getBoundingClientRect().left, width: n.getBoundingClientRect().width }))); assert(positions.every(p => p.left >= 0 && p.left + p.width <= width + 1), `${editor} controls offscreen`); };
      try {
        await visit('/admin/accounts', 'Quản trị · Tài khoản');
        await required('#account-editor', ['Tên đăng nhập', 'Họ tên', 'Đại đội', 'Mật khẩu (12–72 ký tự)', 'Xác nhận mật khẩu']); await aligned('#account-editor');
        await page.locator('#account-editor button[type=submit]').click(); await fieldError('#account-editor', 'Tên đăng nhập'); await fieldError('#account-editor', 'Họ tên'); await fieldError('#account-editor', 'Đại đội'); await fieldError('#account-editor', 'Mật khẩu (12–72 ký tự)');
        await page.locator('#account-editor input[name=username]').fill('sai tên'); await page.locator('#account-editor input[name=full_name]').fill('Cán bộ kiểm thử'); await page.locator('#account-editor input[name=password]').fill('TestingOnly12345'); await page.locator('#account-editor input[name=confirm]').fill('Sai xác nhận'); await page.locator('#account-editor select[name=unit_id]').selectOption(String(c11.id));
        await page.locator('#account-editor button[type=submit]').click(); await fieldError('#account-editor', 'Tên đăng nhập'); await fieldError('#account-editor', 'Xác nhận mật khẩu');
        const username = `${prefix}_${width}`;
        await page.locator('#account-editor input[name=username]').fill(username); await page.locator('#account-editor input[name=confirm]').fill('TestingOnly12345');
        await page.locator('#account-editor button[type=submit]').click(); await page.getByText('Đã tạo tài khoản Đại đội.').waitFor();
        const created = await User.findOne({ where: { username } }); assert(created); made.users.push(created.id);
        await page.getByRole('row').filter({ hasText: username }).getByRole('button', { name: 'Đặt lại mật khẩu' }).click();
        await page.getByRole('button', { name: 'Xác nhận đặt lại' }).click(); await fieldError('.account-card:has(h3:text("Đặt lại mật khẩu"))', 'Mật khẩu mới (12–72 ký tự)');
        await page.getByRole('button', { name: 'Hủy', exact: true }).first().click();
        await page.locator('#account-editor input[name=username]').fill(username); await page.locator('#account-editor input[name=full_name]').fill('Bản sao kiểm thử'); await page.locator('#account-editor select[name=unit_id]').selectOption(String(c11.id)); await page.locator('#account-editor input[name=password]').fill('TestingOnly12345'); await page.locator('#account-editor input[name=confirm]').fill('TestingOnly12345');
        await page.locator('#account-editor button[type=submit]').click(); await fieldError('#account-editor', 'Tên đăng nhập'); assert.equal(await page.locator('#account-editor input[name=full_name]').inputValue(), 'Bản sao kiểm thử');
        for (const [kind, heading] of [['categories','Danh mục · Loại vật chất'], ['units','Danh mục · Đơn vị tính'], ['materials','Danh mục · Vật chất']]) {
          await visit(`/catalog/${kind}`, heading); await required('#catalog-editor', kind === 'materials' ? ['Mã', 'Tên', 'Loại vật chất', 'Đơn vị tính'] : ['Mã','Tên']); await aligned('#catalog-editor');
          await page.locator('#catalog-editor button[type=submit]').click(); await fieldError('#catalog-editor', 'Mã'); await fieldError('#catalog-editor', 'Tên');
          await page.locator('#catalog-editor input').first().fill('mã sai'); await page.locator('#catalog-editor button[type=submit]').click(); await fieldError('#catalog-editor', 'Mã');
          const code = `${prefix}_${width}_${kind === 'categories' ? 'C' : kind === 'units' ? 'U' : 'M'}`; const name = `Kiểm thử ${kind} ${width}`;
          await page.locator('#catalog-editor input').first().fill(code); await page.locator('#catalog-editor input').nth(1).fill(name);
          if (kind === 'materials') {
            const cat = await MaterialCategory.findByPk(made.categories.at(-1)); const uom = await UnitOfMeasure.findByPk(made.units.at(-1));
            await page.locator('#catalog-editor select').first().selectOption(String(cat.id)); await page.locator('#catalog-editor select').nth(1).selectOption(String(uom.id));
          }
          await page.locator('#catalog-editor button[type=submit]').click(); await page.getByText('Đã tạo mới.').waitFor();
          const model = kind === 'categories' ? MaterialCategory : kind === 'units' ? UnitOfMeasure : Material;
          const saved = await model.findOne({ where: { code } }); assert(saved); made[kind].push(saved.id);
          await page.locator('#catalog-editor input').first().fill(code); await page.locator('#catalog-editor input').nth(1).fill('Bản sao danh mục');
          if (kind === 'materials') { await page.locator('#catalog-editor select').first().selectOption(String(made.categories.at(-1))); await page.locator('#catalog-editor select').nth(1).selectOption(String(made.units.at(-1))); }
          await page.locator('#catalog-editor button[type=submit]').click(); await fieldError('#catalog-editor', 'Mã'); assert.equal(await page.locator('#catalog-editor input').nth(1).inputValue(), 'Bản sao danh mục');
        }
        await visit('/stock/receipts', 'Nhập kho · Tồn đầu kỳ');
        await required('#receipt-editor', ['Mã phiếu','Ngày','Vật chất','Nguồn','Số lượng']); await aligned('#receipt-editor');
        await page.locator('#receipt-editor button[type=submit]').click(); await fieldError('#receipt-editor', 'Mã phiếu'); await fieldError('#receipt-editor', 'Vật chất'); await fieldError('#receipt-editor', 'Nguồn'); await fieldError('#receipt-editor', 'Số lượng');
        const receiptCode = `${prefix}_${width}_R`; await field('#receipt-editor', 'Mã phiếu').locator('input').fill(receiptCode);
        await page.locator('#receipt-editor .receipt-item select').first().selectOption(String(material.id)); await page.locator('#receipt-editor .receipt-item select').nth(1).selectOption(String(source.id));
        assert((await page.locator('#receipt-editor .receipt-item select').nth(1).locator('option:checked').innerText()).includes(source.name));
        assert((await page.locator('#receipt-editor .receipt-item select').nth(2).locator('option').allInnerTexts()).includes(condition.name));
        await page.locator('#receipt-editor .receipt-item input[type=number]').fill('1.5'); await page.locator('#receipt-editor button[type=submit]').click(); await fieldError('#receipt-editor', 'Số lượng');
        await page.locator('#receipt-editor .receipt-item input[type=number]').fill('1'); await page.locator('#receipt-editor button[type=submit]').click(); await page.getByText('Đã tạo phiếu nháp.').waitFor();
        const receipt = await StockReceipt.findOne({ where: { code: receiptCode } }); assert(receipt && receipt.status === 'DRAFT'); made.receipts.push(receipt.id);
        await field('#receipt-editor', 'Mã phiếu').locator('input').fill(receiptCode);
        await page.locator('#receipt-editor .receipt-item select').first().selectOption(String(material.id)); await page.locator('#receipt-editor .receipt-item select').nth(1).selectOption(String(source.id));
        await page.locator('#receipt-editor .receipt-item input[type=number]').fill('1'); await page.locator('#receipt-editor button[type=submit]').click();
        await fieldError('#receipt-editor', 'Mã phiếu'); assert.equal(await page.locator('#receipt-editor .receipt-item input[type=number]').inputValue(), '1');
        await visit('/stock/issue', 'Cấp phát vật chất');
        for (const [type, path, title] of [['ISSUE','/stock/issue','Cấp phát vật chất'], ['RECALL','/stock/recall','Thu hồi vật chất'], ['INTERNAL_TRANSFER','/stock/internal-transfer','Điều chuyển nội bộ vật chất']]) {
          if (type !== 'ISSUE') await visit(path, title);
          await required('#transfer-editor', ['Mã phiếu', 'Ngày', type === 'ISSUE' ? 'Đại đội nhận' : 'Đại đội chịu trách nhiệm', 'Vật chất', 'Nguồn', 'Số lượng']); await aligned('#transfer-editor');
          await page.locator('#transfer-editor button[type=submit]').click(); await fieldError('#transfer-editor', 'Mã phiếu'); await fieldError('#transfer-editor', 'Vật chất'); await fieldError('#transfer-editor', 'Nguồn'); await fieldError('#transfer-editor', 'Số lượng');
          const code = `${prefix}_${width}_${type === 'ISSUE' ? 'I' : type === 'RECALL' ? 'C' : 'T'}`;
          await field('#transfer-editor', 'Mã phiếu').locator('input').fill(code);
          await field('#transfer-editor', type === 'ISSUE' ? 'Đại đội nhận' : 'Đại đội chịu trách nhiệm').locator('select').selectOption(String(c11.id));
          if (type === 'INTERNAL_TRANSFER') { await page.getByLabel('Nơi chuyển').selectOption(String(store11.id)); await page.getByLabel('Nơi nhận').selectOption(String(store11.id)); }
          if (type === 'ISSUE') await page.getByLabel('Nơi nhận').selectOption(String(room.id));
          await page.locator('#transfer-editor .receipt-item select').first().selectOption(String(material.id)); await page.locator('#transfer-editor .receipt-item select').nth(1).selectOption(String(source.id));
          await page.locator('#transfer-editor .receipt-item input[type=number]').fill('0'); await page.locator('#transfer-editor button[type=submit]').click(); await fieldError('#transfer-editor', 'Số lượng');
          if (type === 'INTERNAL_TRANSFER') { await page.locator('#transfer-editor .receipt-item input[type=number]').fill('1'); await page.locator('#transfer-editor button[type=submit]').click(); await fieldError('#transfer-editor', 'Nơi nhận'); await page.getByLabel('Nơi nhận').selectOption(String(room.id)); }
          await page.locator('#transfer-editor .receipt-item input[type=number]').fill('1'); await page.locator('#transfer-editor button[type=submit]').click(); await page.getByText('Đã tạo phiếu nháp.').waitFor();
          const draft = await StockTransfer.findOne({ where: { code } }); assert(draft && draft.status === 'DRAFT'); made.transfers.push(draft.id);
          await field('#transfer-editor', 'Mã phiếu').locator('input').fill(code);
          await field('#transfer-editor', type === 'ISSUE' ? 'Đại đội nhận' : 'Đại đội chịu trách nhiệm').locator('select').selectOption(String(c11.id));
          if (type === 'INTERNAL_TRANSFER') { await page.getByLabel('Nơi chuyển').selectOption(String(store11.id)); await page.getByLabel('Nơi nhận').selectOption(String(room.id)); }
          if (type === 'ISSUE') await page.getByLabel('Nơi nhận').selectOption(String(room.id));
          await page.locator('#transfer-editor .receipt-item select').first().selectOption(String(material.id)); await page.locator('#transfer-editor .receipt-item select').nth(1).selectOption(String(source.id));
          await page.locator('#transfer-editor .receipt-item input[type=number]').fill('1'); await page.locator('#transfer-editor button[type=submit]').click();
          await fieldError('#transfer-editor', 'Mã phiếu'); assert.equal(await page.locator('#transfer-editor .receipt-item input[type=number]').inputValue(), '1');
        }
        await visit('/stock/locations', 'Địa điểm lưu giữ'); await page.getByRole('button', { name: 'Thêm địa điểm' }).click();
        await page.getByLabel('Mã *').fill('mã sai'); await page.getByRole('button', { name: 'Lưu', exact: true }).click(); await page.getByText(/Mã gồm 1–64 ký tự/).last().waitFor();
        assert((await page.locator('.location-editor .form-field').count()) > 4);
        for (const checkbox of await page.locator('.location-editor input[type=checkbox]').all()) { const box = await checkbox.boundingBox(); assert(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width, 'Location checkbox alignment'); }
        for (const [who, other] of [[company11, c13], [company13, c11]]) {
          await visit('/company/assets', 'Vật chất của Đại đội', who);
          assert.equal(await page.locator('.sidebar a[href="/stock/receipts"]').count(), 0);
          assert.equal(await page.locator('.sidebar a[href="/admin/accounts"]').count(), 0);
          assert.equal(await page.locator('.sidebar a[href="/company/assets"]').count(), 1);
          await visit('/catalog/materials', 'Danh mục · Vật chất', who); assert.equal(await page.locator('#catalog-editor').count(), 0);
          await visit('/stock/locations', 'Địa điểm lưu giữ', who); assert.equal(await page.getByRole('button', { name: 'Thêm địa điểm' }).count(), 0);
          for (const url of ['/admin/accounts','/stock/receipts','/stock/issue','/stock/recall','/stock/internal-transfer','/stock/balance']) { await visit(url, 'Không có quyền truy cập', who); }
          assert.equal((await api(`/locations/balance?unit_id=${other.id}`, who)).status, 403);
        }
        assert.deepEqual(errors, []); assert.deepEqual(unexpected5xx, []);
        console.log(`INPUT BROWSER PASS ${width} accounts/catalogs/receipts/issue/recall/internal/locations RBAC; API real; 0 overflow/pageerror/5xx`);
      } finally { await ctx.close(); }
    }
  } finally {
    await browser.close();
    // Only this test's draft rows, catalogue rows and accounts; never touch seeded/historical data.
    for (const id of made.transfers.reverse()) { const row = await StockTransfer.findByPk(id); if (row?.status === 'DRAFT') await api(`/transfers/${id}`, admin, 'DELETE'); }
    for (const id of made.receipts.reverse()) { const row = await StockReceipt.findByPk(id); if (row?.status === 'DRAFT') await api(`/stock/receipts/${id}`, admin, 'DELETE'); }
    for (const [kind, model] of [['materials', Material], ['categories', MaterialCategory], ['units', UnitOfMeasure]]) for (const id of made[kind].reverse()) { const row = await model.findByPk(id); if (row && row.code.startsWith(prefix)) { const res = await api(`/catalog/${kind}/${id}`, admin, 'DELETE'); assert.equal(res.status, 200, `fixture cleanup ${kind}`); } }
    for (const id of made.users.reverse()) { const row = await User.findByPk(id); if (row && row.username.startsWith(prefix)) { const res = await api(`/users/${id}`, admin, 'DELETE'); assert.equal(res.status, 200, 'fixture cleanup user'); } }
    await new Promise(resolve => server.close(resolve)); await sequelize.close();
  }
}
main().catch(err => { console.error(err); process.exitCode = 1 });
