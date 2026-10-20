const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { vietnamToday } = require('../src/utils/vietnamDate');
const { sequelize, Unit, User, Role, Material, MaterialCategory, UnitOfMeasure, MaterialSource, StockLedgerEntry: Ledger, Location } = require('../src/models');
const vnDate = (shift = 0, now = new Date()) => {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(Date.parse(`${date}T00:00:00Z`) + shift * 86400000).toISOString().slice(0, 10);
};
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase7_verify');
  assert.equal(vietnamToday(new Date('2026-10-18T16:59:59Z')), '2026-10-18');
  assert.equal(vietnamToday(new Date('2026-10-18T17:00:00Z')), '2026-10-19');
  assert.equal(vnDate(0, new Date('2026-10-18T16:59:59Z')), '2026-10-18');
  assert.equal(vnDate(0, new Date('2026-10-18T17:00:00Z')), '2026-10-19');
  const prefix = `P7WARN${Date.now()}`;
  const units = {}, users = {}, stores = {};
  const role = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  for (const n of [5, 11, 12, 13]) {
    units[n] = await Unit.findOne({ where: { code: n === 5 ? 'BATTALION_5' : `COMPANY_${n}` } });
    users[n] = n === 5 ? await User.findOne({ where: { unit_id: units[n].id } }) : await User.create({ username: `${prefix}U${n}`, full_name: 'Test overdue warning', role_id: role.id, unit_id: units[n].id, password_hash: 'test-only' });
    if (n !== 5) stores[n] = await Location.findOne({ where: { code: `LOC_COMPANY_${n}_STORE` } });
  }
  const mat = await Material.create({ code: `${prefix}M`, name: 'Overdue warning material', category_id: (await MaterialCategory.findOne()).id, unit_id: (await UnitOfMeasure.findOne()).id });
  const source = await MaterialSource.findOne(), warehouse = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } });
  await Ledger.create({ material_id: mat.id, source_id: source.id, unit_id: units[5].id, location_id: warehouse.id, quantity_delta: 500, transaction_type: 'NORMAL_RECEIPT', reference_type: 'PHASE7_WARNING_FIXTURE', reference_id: mat.id, occurred_at: new Date(), created_by: users[5].id });
  const server = app.listen(0), port = server.address().port;
  const token = n => jwt.sign({ sub: String(users[n].id), ver: 0 }, jwtConfig().secret, { expiresIn: '30m' });
  const api = async (n, method, path, body, status = 200) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token(n)}`, 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
    const text = await r.text();
    assert.equal(r.status, status, `${method} ${path} ${r.status} ${text}`);
    return JSON.parse(text).data;
  };
  const ids = {};
  async function make(n, name, shift, state) {
    const code = `${prefix}_${n}_${name}`;
    const row = await api(n, 'POST', '/borrow', { code, company_unit_id: units[n].id, due_date: vnDate(shift), items: [{ material_id: mat.id, source_id: source.id, condition_id: null, quantity: 50 }] }, 201);
    ids[name] = row.id;
    if (state === 'DRAFT') return code;
    await api(n, 'POST', `/borrow/${row.id}/submit`, {});
    if (state === 'SUBMITTED') return code;
    if (state === 'REJECTED') { await api(5, 'POST', `/borrow/${row.id}/reject`, { note: 'Test' }); return code; }
    await api(5, 'POST', `/borrow/${row.id}/approve`, {});
    if (state === 'APPROVED') return code;
    await api(5, 'POST', `/borrow/${row.id}/deliver`, { to_location_id: stores[n].id });
    return code;
  }
  async function pay(n, id, amount) {
    const detail = await api(n, 'GET', `/borrow/${id}`);
    const ret = await api(n, 'POST', `/borrow/${id}/returns`, { items: [{ borrow_line_id: detail.items[0].id, from_location_id: stores[n].id, quantity: amount }] }, 201);
    await api(5, 'POST', `/borrow/${id}/returns/${ret.id}/post`, {});
  }
  let browser;
  try {
    const full = await make(11, 'FULL', -4, 'DELIVERED');
    const partial = await make(11, 'PART', -4, 'DELIVERED');
    await pay(11, ids.PART, 20);
    const returned = await make(11, 'DONE', -4, 'DELIVERED'); await pay(11, ids.DONE, 50);
    const today = await make(11, 'TODAY', 0, 'DELIVERED');
    const tomorrow = await make(11, 'TOMORROW', 1, 'DELIVERED');
    const draft = await make(11, 'DRAFT', -4, 'DRAFT');
    const submitted = await make(11, 'SUBMITTED', -4, 'SUBMITTED');
    const rejected = await make(11, 'REJECTED', -4, 'REJECTED');
    const approved = await make(11, 'APPROVED', -4, 'APPROVED');
    const twelve = await make(12, 'TWELVE', -4, 'DELIVERED');
    const thirteen = await make(13, 'THIRTEEN', -4, 'DELIVERED');
    const list = async (n, overdue) => api(n, 'GET', `/borrow?search=${prefix}&page=1${overdue ? '&overdue=true' : ''}`);
    for (const [n, expected] of [[11, [full, partial]], [12, [twelve]], [13, [thirteen]], [5, [full, partial, twelve, thirteen]]]) {
      const data = await list(n, true);
      assert.deepEqual(data.items.map(x => x.code).sort(), expected.sort());
      assert.equal(data.total, expected.length);
      assert.deepEqual(data.items.map(x => Number(x.outstanding_quantity)).sort((a,b) => a-b), n === 11 ? [30,50] : n === 5 ? [30,50,50,50] : [50]);
    }
    const all = await list(11, false);
    for (const code of [returned, today, tomorrow, draft, submitted, rejected, approved]) assert(all.items.some(x => x.code === code && (x.status === 'RETURNED' || !x.delivery || x.due_date >= vnDate() || x.outstanding_quantity === '0')));
    for (const n of [11, 12, 13]) await api(n, 'GET', `/borrow/${n === 11 ? ids.TWELVE : ids.FULL}`, null, 403);
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    for (const width of [375, 768, 1440]) for (const n of [11, 12, 13, 5]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage(), errors = [], network = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
      page.on('response', r => { if (r.status() >= 400) network.push(r.status()) });
      await page.route('**/api/v1/**', async route => { const u = new URL(route.request().url()); await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` }) }) });
      await page.goto('http://127.0.0.1:5173/login');
      await page.evaluate(t => sessionStorage.setItem('access_token', t), token(n));
      await page.goto('http://127.0.0.1:5173/stock/borrow');
      const card = page.locator('.account-card').filter({ has: page.getByRole('heading', { name: 'Danh sách yêu cầu · Theo dõi quá hạn' }) });
      await card.getByLabel('Tìm mã yêu cầu').fill(prefix);
      await card.getByRole('checkbox', { name: 'Chỉ quá hạn' }).check();
      const expected = n === 5 ? [full, partial, twelve, thirteen] : n === 11 ? [full, partial] : n === 12 ? [twelve] : [thirteen];
      await page.waitForFunction(count => document.querySelector('.account-card tbody')?.rows.length === count, expected.length);
      const codes = await card.locator('tbody tr td:first-child').allTextContents();
      assert.deepEqual(codes.sort(), expected.sort());
      for (const tr of await card.locator('tbody tr').all()) {
        assert((await tr.locator('.borrow-overdue').innerText()).includes('Quá hạn 4 ngày'));
        assert([30, 50].includes(Number(await tr.locator('td').nth(4).innerText())));
      }
      await card.locator('tbody tr').filter({ hasText: n === 11 || n === 5 ? partial : n === 12 ? twelve : thirteen }).getByRole('button', { name: 'Chi tiết' }).click();
      await page.getByRole('status').filter({ hasText: 'Quá hạn 4 ngày · Còn phải trả:' }).waitFor();
      assert((await page.locator('.borrow-overdue[role="status"]').innerText()).includes(n === 11 || n === 5 ? '30' : '50'));
      await card.getByRole('checkbox', { name: 'Chỉ quá hạn' }).uncheck();
      if (n === 11) {
        await card.getByLabel('Tìm mã yêu cầu').fill(`${prefix}_11_`);
        await page.waitForFunction(() => document.querySelector('.account-card tbody')?.rows.length === 9);
        for (const code of [returned, today, tomorrow, draft, submitted, rejected, approved]) {
          const row = card.locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: code }) });
          assert.equal(await row.locator('.borrow-overdue').count(), 0, code);
        }
        const done = card.locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: returned }) });
        assert.equal((await done.locator('td').nth(4).innerText()).trim(), '0');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      await ctx.close();
      console.log(`Phase 7 warning ${width}px role ${n} PASS`);
    }
    await pay(11, ids.PART, 30);
    const after = await list(11, true);
    assert.deepEqual(after.items.map(x => x.code), [full]);
    assert.equal((await api(11, 'GET', `/borrow/${ids.PART}`)).status, 'RETURNED');
    assert.equal((await list(11, false)).items.find(x => x.code === partial).outstanding_quantity, '0');
    // Reopen the fully returned request in the real UI: no active warning in either view.
    const ctx = await browser.newContext({ viewport: { width: 375, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.route('**/api/v1/**', async route => { const u = new URL(route.request().url()); await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` }) }) });
      await page.goto('http://127.0.0.1:5173/login');
      await page.evaluate(t => sessionStorage.setItem('access_token', t), token(11));
      await page.goto('http://127.0.0.1:5173/stock/borrow');
      const card = page.locator('.account-card').filter({ has: page.getByRole('heading', { name: 'Danh sách yêu cầu · Theo dõi quá hạn' }) });
      await card.getByLabel('Tìm mã yêu cầu').fill(partial);
      await card.locator('tbody tr').filter({ hasText: partial }).getByRole('button', { name: 'Chi tiết' }).click();
      await page.getByRole('heading', { name: `${partial} · Đã trả hết` }).waitFor();
      assert.equal(await page.locator('.borrow-overdue').count(), 0);
      assert.equal((await card.locator('tbody tr td').nth(4).innerText()).trim(), '0');
      await card.getByRole('checkbox', { name: 'Chỉ quá hạn' }).check();
      await page.getByText('Không có yêu cầu phù hợp.').waitFor();
      assert.equal(await page.locator('.borrow-overdue').count(), 0);
    } finally { await ctx.close(); }
  } finally { if (browser) await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
