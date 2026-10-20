const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, Unit, User, Role, Material, MaterialCategory, UnitOfMeasure, MaterialSource, StockLedgerEntry: Ledger, Location } = require('../src/models');

async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase7_verify');
  const units = {};
  for (const n of [5, 11, 12, 13]) units[n] = await Unit.findOne({ where: { code: n === 5 ? 'BATTALION_5' : `COMPANY_${n}` } });
  const users = { 5: await User.findOne({ where: { unit_id: units[5].id } }) };
  const role = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  const prefix = `P7OV${Date.now()}`;
  for (const n of [11, 12, 13]) users[n] = await User.create({ username: `${prefix}U${n}`, full_name: 'Overdue browser test', unit_id: units[n].id, role_id: role.id, password_hash: 'test-only' });
  const material = await Material.create({ code: `${prefix}M`, name: 'Overdue browser test', category_id: (await MaterialCategory.findOne()).id, unit_id: (await UnitOfMeasure.findOne()).id });
  const source = await MaterialSource.findOne();
  const warehouse = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } });
  const stores = {};
  for (const n of [11, 12, 13]) stores[n] = await Location.findOne({ where: { code: `LOC_COMPANY_${n}_STORE` } });
  assert(warehouse && source && Object.values(stores).every(Boolean));
  await Ledger.create({ material_id: material.id, unit_id: units[5].id, location_id: warehouse.id, source_id: source.id, condition_id: null, quantity_delta: 100, transaction_type: 'NORMAL_RECEIPT', reference_type: 'PHASE7_OVERDUE_FIXTURE', reference_id: material.id, occurred_at: new Date(), created_by: users[5].id });
  const server = app.listen(0), port = server.address().port;
  const token = u => jwt.sign({ sub: String(u.id), ver: 0 }, jwtConfig().secret, { expiresIn: '30m' });
  const api = async (who, method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token(users[who])}`, 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
    const j = await r.json(); assert([200, 201].includes(r.status), `${method} ${path}: ${r.status} ${JSON.stringify(j)}`); return j.data;
  };
  const names = {};
  async function make(n, suffix, due, state) {
    const code = `${prefix}_${n}_${suffix}`;
    const data = await api(n, 'POST', '/borrow', { code, company_unit_id: units[n].id, due_date: due, items: [{ material_id: material.id, source_id: source.id, quantity: 4, condition_id: null }] });
    names[code] = data.id;
    if (state !== 'DRAFT') {
      await api(n, 'POST', `/borrow/${data.id}/submit`, {});
      await api(5, 'POST', `/borrow/${data.id}/approve`, {});
      await api(5, 'POST', `/borrow/${data.id}/deliver`, { to_location_id: stores[n].id });
      if (state === 'PARTIAL' || state === 'RETURNED') {
        const detail = await api(5, 'GET', `/borrow/${data.id}`);
        const ret = await api(n, 'POST', `/borrow/${data.id}/returns`, { items: [{ borrow_line_id: detail.items[0].id, from_location_id: stores[n].id, quantity: state === 'PARTIAL' ? 2 : 4 }] });
        await api(5, 'POST', `/borrow/${data.id}/returns/${ret.id}/post`, {});
      }
    }
    return code;
  }
  let browser;
  try {
    const old = '2025-01-01', future = '2099-01-01';
    const a = await make(11, 'OVER', old, 'DELIVERED');
    const b = await make(11, 'PART', old, 'PARTIAL');
    await make(11, 'DONE', old, 'RETURNED');
    const notYet = await make(11, 'FUTURE', future, 'DELIVERED');
    const other12 = await make(12, 'OVER', old, 'DELIVERED');
    const other13 = await make(13, 'PART', old, 'PARTIAL');
    await make(12, 'FUTURE', future, 'DELIVERED');
    await make(13, 'DONE', old, 'RETURNED');
    for (let i = 0; i < 21; i++) await make(11, `D${i}`, future, 'DRAFT');
    // Actual cross-unit detail URL must be forbidden, not a nonexistent ID.
    for (const [n, id] of [[11, names[other12]], [12, names[a]], [13, names[a]]]) {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/borrow/${id}`, { headers: { Authorization: `Bearer ${token(users[n])}` } });
      assert.equal(r.status, 403);
    }
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    for (const width of [375, 768, 1440]) for (const n of [11, 12, 13, 5]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage(), errors = [], network = [], requests = [];
      let delayed = false;
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
      page.on('response', r => { if (r.status() >= 400) network.push(`${r.status()} ${r.url()}`) });
      page.on('request', r => { if (new URL(r.url()).pathname === '/api/v1/borrow') requests.push(new URL(r.url()).searchParams) });
      await page.route('**/api/v1/**', async route => {
        const u = new URL(route.request().url());
        const response = await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` });
        // Force stale overdue response to arrive after a newer unfiltered response in rapid-toggle test.
        if (u.pathname === '/api/v1/borrow' && u.searchParams.get('overdue') === 'true' && u.searchParams.get('search') === `${prefix}_11_` && delayed) await new Promise(resolve => setTimeout(resolve, 1000));
        try { await route.fulfill({ response }) } catch (e) { if (!/closed|handled|canceled|cancelled/i.test(e.message)) throw e }
      });
      await page.goto('http://127.0.0.1:5173/login');
      await page.evaluate(t => sessionStorage.setItem('access_token', t), token(users[n]));
      await page.goto('http://127.0.0.1:5173/stock/borrow');
      const card = page.locator('.account-card').filter({ has: page.getByRole('heading', { name: 'Danh sách yêu cầu · Theo dõi quá hạn' }) });
      const checkbox = card.getByRole('checkbox', { name: 'Chỉ quá hạn' });
      await checkbox.waitFor();
      await card.getByLabel('Tìm mã yêu cầu').fill(prefix);
      await page.waitForTimeout(500);
      await checkbox.check();
      await page.waitForTimeout(550);
      assert(requests.some(p => p.get('overdue') === 'true' && p.get('search') === prefix), `${width}/${n} missing overdue=true`);
      const codes = async () => card.locator('tbody tr td:first-child').allTextContents();
      const expected = n === 5 ? [a, b, other12, other13] : n === 11 ? [a, b] : n === 12 ? [other12] : [other13];
      assert.deepEqual((await codes()).sort(), expected.sort(), `${width}/${n} overdue list`);
      assert.equal(await checkbox.isChecked(), true);
      // Label and checkbox must be visible inside the filter container, without horizontal page overflow.
      assert(await checkbox.isVisible());
      const metrics = await page.evaluate(() => { const el = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Chỉ quá hạn')); const box = el.getBoundingClientRect(); const filters = el.closest('.account-filters').getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > innerWidth, x: box.x, right: box.right, filterLeft: filters.left, filterRight: filters.right } });
      assert.equal(metrics.overflow, false, `${width}/${n} horizontal overflow`);
      assert(metrics.x >= metrics.filterLeft - 1 && metrics.right <= metrics.filterRight + 1 && metrics.right <= width + 1, `${width}/${n} checkbox/label outside filters ${JSON.stringify(metrics)}`);
      await checkbox.uncheck();
      await page.waitForTimeout(550);
      assert(!requests.at(-1).has('overdue'), `${width}/${n} checkbox off still sends overdue`);
      assert(n === 11 ? (await card.innerText()).includes('25 yêu cầu') : n === 5 ? (await codes()).length > expected.length : (await codes()).length > expected.length, `${width}/${n} unfiltered restore`);
      if (n === 11) {
        assert(await card.getByRole('button', { name: 'Sau' }).isEnabled(), `${width} pagination next`);
        await card.getByRole('button', { name: 'Sau' }).click();
        await page.waitForTimeout(500);
        assert.equal(requests.at(-1).get('page'), '2');
        assert((await codes()).length > 0);
        await card.getByRole('button', { name: 'Trước' }).click();
        await page.waitForTimeout(500);
        await card.getByLabel('Trạng thái').selectOption('DELIVERED');
        await page.waitForTimeout(500);
        assert.deepEqual((await codes()).sort(), [a, notYet].sort());
        await checkbox.check();
        await page.waitForTimeout(500);
        assert.deepEqual((await codes()).sort(), [a, b].sort(), 'overdue overrides status (API semantics)');
        await checkbox.uncheck();
        await page.waitForTimeout(500);
        assert.deepEqual((await codes()).sort(), [a, notYet].sort(), 'status restored');
        await card.getByLabel('Từ hạn trả').fill('2099-01-01');
        await page.waitForTimeout(500);
        assert.deepEqual(await codes(), [notYet], 'date from + status');
        await checkbox.check();
        await page.waitForTimeout(500);
        assert.deepEqual(await codes(), [], 'future from + overdue empty');
        await card.getByLabel('Từ hạn trả').fill('');
        await card.getByLabel('Đến hạn trả').fill('2025-01-01');
        await page.waitForTimeout(500);
        assert.deepEqual((await codes()).sort(), [a, b].sort(), 'date to + overdue');
        await checkbox.uncheck();
        await page.waitForTimeout(500);
        assert.deepEqual(await codes(), [a], 'date to + status restored');
        await card.getByLabel('Đến hạn trả').fill('');
        await card.getByLabel('Trạng thái').selectOption('');
        await card.getByLabel('Tìm mã yêu cầu').fill(`${prefix}_11_`);
        await page.waitForTimeout(550);
        delayed = true;
        await checkbox.check();
        await page.waitForRequest(r => new URL(r.url()).pathname === '/api/v1/borrow' && new URL(r.url()).searchParams.get('overdue') === 'true' && new URL(r.url()).searchParams.get('search') === `${prefix}_11_`);
        await checkbox.uncheck();
        await page.waitForTimeout(1600);
        assert.equal(await checkbox.isChecked(), false);
        assert((await card.innerText()).includes('25 yêu cầu'), 'stale overdue response must not overwrite latest unfiltered list');
        delayed = false;
      }
      // Browser-managed API request against an existing cross-unit detail; not a nonexistent URL.
      if (n !== 5) {
        const foreign = n === 11 ? names[other12] : names[a];
        const forbidden = await page.request.get(`http://127.0.0.1:${port}/api/v1/borrow/${foreign}`, { headers: { Authorization: `Bearer ${token(users[n])}` } });
        assert.equal(forbidden.status(), 403);
      }
      assert.deepEqual(errors, [], `${width}/${n} console`);
      assert.deepEqual(network, [], `${width}/${n} network`);
      await ctx.close();
      console.log(`Phase 7 overdue Chrome ${width}px role ${n}: PASS`);
    }
  } finally { if (browser) await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => sequelize.close());
