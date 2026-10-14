const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const { sequelize, Location, Unit, User, Role } = require('../src/models');
const { jwtConfig } = require('../src/services/auth.service');
const app = require('../src/app');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify');
  const origin = 'http://localhost:5173'; assert.equal((await fetch(origin)).status, 200);
  const root = await Location.findOne({ where: { code: 'LOC_BATTALION_5_ROOT' } });
  const store = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
  const unit = await Unit.findOne({ where: { code: 'BATTALION_5' } });
  const admin = await User.findOne({ where: { unit_id: unit.id } });
  const companyUnit = await Unit.findOne({ where: { code: 'COMPANY_11' } });
  const companyRole = await Role.findOne({ where: { code: 'COMPANY_ADMIN' } });
  const company = await User.findOne({ where: { unit_id: companyUnit.id, role_id: companyRole.id } });
  assert(company);
  const token = u => jwt.sign({ sub: String(u.id), ver: 0 }, jwtConfig().secret, { expiresIn: '15m' });
  const server = app.listen(0); const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const code = `P6VALID_${Date.now()}`, created = [];
  const payload = (suffix, name, type, parent, owner = null) => ({ code: `${code}_${suffix}`, name, type, parent_location_id: parent, owner_unit_id: owner, is_stock_holding: type === 'ROOM', is_active: true, note: '' });
  async function request(method, url, body, user = admin) { const res = await fetch(`http://127.0.0.1:${port}/api/v1${url}`, { method, headers: { Authorization: `Bearer ${token(user)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, body: await res.json() }; }
  try {
    const invalid = await request('POST', '/locations', payload('BAD', 'Dãy nhà Đại đội 11', 'BUILDING', store.id));
    assert.equal(invalid.status, 400); assert.match(invalid.body.errors.parent_location_id, /không thể nằm trong Kho Đại đội 11/);
    assert.equal((await request('GET', '/locations')).status, 200);
    const badCode = await request('POST', '/locations', { ...payload('BAD', 'Dãy nhà', 'BUILDING', root.id), code: 'sai mã' });
    assert.equal(badCode.status, 400); assert(badCode.body.errors.code);
    const badName = await request('POST', '/locations', { ...payload('BAD', 'Dãy nhà', 'BUILDING', root.id), name: ' ' });
    assert.equal(badName.status, 400); assert(badName.body.errors.name);
    assert.equal((await request('POST', '/locations', payload('FORBIDDEN', 'Dãy nhà', 'BUILDING', root.id), company)).status, 403);
    for (const width of [375, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage();
      const consoleErrors = [], network = [];
      page.on('pageerror', e => consoleErrors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/400 \(Bad Request\)|409 \(Conflict\)/.test(m.text())) consoleErrors.push(m.text()); });
      page.on('response', r => { if (r.status() >= 500) network.push(`${r.status()} ${r.url()}`); });
      await page.route('**/api/v1/**', async route => { const url = new URL(route.request().url()); try { const response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` }); await route.fulfill({ response }); } catch (err) { if (!/Target closed|Route is already handled|Fetch response has been disposed|ECONNRESET|net::ERR_ABORTED/.test(String(err))) throw err; try { await route.abort('aborted'); } catch { /* navigation canceled GET */ } } });
      await page.goto(`${origin}/login`); await page.evaluate(t => sessionStorage.setItem('access_token', t), token(admin)); await page.goto(`${origin}/stock/locations`);
      await page.getByRole('button', { name: 'Tiểu đoàn 5', exact: true }).waitFor();
      assert.equal(await page.locator('.location-tree .location-node').filter({ hasText: 'LOC_COMPANY_11_STORE' }).count(), 0);
      const add = async (suffix, name, type, parentLabel) => {
        await page.getByRole('button', { name: 'Thêm địa điểm' }).click();
        await page.getByLabel('Mã *').fill(`${code}_${width}_${suffix}`);
        await page.getByLabel('Tên *').fill(name);
        await page.getByLabel('Loại *').selectOption(type);
        await page.getByLabel('Địa điểm cha *').selectOption(String(parentLabel));
        await page.getByRole('button', { name: 'Lưu', exact: true }).click();
        await page.getByText('Đã lưu địa điểm.').waitFor();
        const row = await Location.findOne({ where: { code: `${code}_${width}_${suffix}` } }); assert(row); created.push(row.id);
        return row;
      };
      await page.getByLabel('Mã *').fill('sai mã'); await page.getByRole('button', { name: 'Lưu', exact: true }).click(); await page.getByText(/Mã gồm 1–64 ký tự/).last().waitFor();
      await page.getByLabel('Mã *').fill(`${code}_${width}_BAD`); await page.getByLabel('Tên *').fill(' '); await page.getByRole('button', { name: 'Lưu', exact: true }).click(); await page.getByText(/Vui lòng nhập tên địa điểm/).waitFor();
      await page.getByLabel('Tên *').fill('Dãy nhà test'); await page.getByLabel('Địa điểm cha *').selectOption({ label: 'Tiểu đoàn 5' });
      await page.getByRole('button', { name: 'Lưu', exact: true }).click(); await page.getByText('Đã lưu địa điểm.').waitFor();
      const building = await Location.findOne({ where: { code: `${code}_${width}_BAD` } }); created.push(building.id);
      await page.getByRole('button', { name: 'Thêm địa điểm' }).click(); await page.getByLabel('Mã *').fill(`${code}_${width}_BAD`); await page.getByLabel('Tên *').fill('Bản sao'); await page.getByLabel('Địa điểm cha *').selectOption({ label: 'Tiểu đoàn 5' }); await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Mã địa điểm đã tồn tại.').last().waitFor(); assert.equal(await page.getByLabel('Tên *').inputValue(), 'Bản sao');
      await page.getByLabel('Loại *').selectOption('FLOOR'); assert.equal(await page.getByLabel('Địa điểm cha *').inputValue(), '');
      assert.equal(await page.getByLabel('Địa điểm cha *').locator('option', { hasText: 'Kho Đại đội 11' }).count(), 0);
      await page.getByLabel('Loại *').selectOption('BUILDING');
      assert.equal(await page.getByLabel('Địa điểm cha *').locator('option', { hasText: 'Kho Đại đội 11' }).count(), 0);
      const b2 = await add('DN11', 'Dãy nhà Đại đội 11', 'BUILDING', root.id);
      const floor = await add('T1', 'Tầng 1', 'FLOOR', b2.id);
      for (const no of [101, 102]) await add(`P${no}`, `Phòng ${no}`, 'ROOM', floor.id);
      assert.equal(String(floor.parent_location_id), String(b2.id));
      await page.getByLabel('Tìm tên hoặc mã').fill(`${code}_${width}_P101`); await page.getByRole('button', { name: 'Phòng 101' }).waitFor();
      assert.equal(await page.locator('.location-tree .location-node').filter({ hasText: 'P101_' }).count(), 0);
      const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert(metrics.scroll <= metrics.width, JSON.stringify(metrics));
      assert.deepEqual(consoleErrors, []); assert.deepEqual(network, []);
      console.log('VALIDATION BROWSER PASS', width, '400 fields, duplicate 409, tree, create building/floor/2 rooms, responsive');
      await context.close();
    }
  } finally {
    await browser.close();
    for (const id of created.reverse()) { const row = await Location.findByPk(id); if (row) await row.destroy(); }
    await new Promise(resolve => server.close(resolve)); await sequelize.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
