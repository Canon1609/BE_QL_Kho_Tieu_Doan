// Read-only diagnostic on the existing development database. Never prints auth material.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const { User, Role, Unit, sequelize } = require('../src/models');
const { jwtConfig } = require('../src/services/auth.service');
const origin = 'http://localhost:5173';
(async () => {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5', 'Only development DB is allowed');
  const users = await User.findAll({ where: { is_active: true }, include: [{ model: Role, as: 'role' }, { model: Unit, as: 'unit' }] });
  const admin = users.find(u => u.role?.code === 'BATTALION_ADMIN' && u.unit?.code === 'BATTALION_5' && u.unit.is_active);
  assert(admin, 'No active battalion admin for read-only browser probe');
  const token = jwt.sign({ sub: String(admin.id), ver: admin.auth_version }, jwtConfig().secret, { expiresIn: '5m' });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  const page = await context.newPage();
  const failures = [], status = [], modules = [];
  let intentionalDisconnect = false;
  page.on('pageerror', e => failures.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !(intentionalDisconnect && /ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()))) failures.push('console: ' + m.text().replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]')); });
  page.on('response', async r => {
    const u = new URL(r.url());
    if (u.port === '5000' && u.pathname.startsWith('/api/v1/')) {
      status.push([u.pathname + u.search, r.status()]);
      try {
        if (r.status() === 304) return;
        const body = await r.text();
        if (/password_hash|google_sub|jwt_secret|(?:"stack"|sequelize(?:database|connection|validation))|(?:select|insert)\s+.{1,80}\s+(?:from|into)\s|eyJ[A-Za-z0-9_-]{16,}\./i.test(body) || [process.env.DB_PASSWORD, process.env.JWT_SECRET].filter(x => x && x.length >= 8).some(x => body.includes(x))) failures.push('unsafe response: ' + u.pathname);
      } catch (e) { if (!/body is unavailable|Target closed|Request context disposed|No resource with given identifier/i.test(e.message)) failures.push('response unreadable: ' + u.pathname + ' (' + e.message.slice(0, 90) + ')'); }
      if (r.status() >= 500) failures.push('HTTP ' + r.status() + ': ' + u.pathname);
    }
    if (u.port === '5173' && /\/src\/.*\.jsx$/.test(u.pathname) && r.status() !== 304) {
      try { const body = await r.text(); if (!r.ok() || !body.trim()) modules.push(`${u.pathname}: HTTP ${r.status()}, length ${body.length}`); } catch (e) { modules.push(`${u.pathname}: read error ${e.message}`); }
    }
  });
  try {
    // Existing admin identity with short-lived locally signed JWT; no password available or changed.
    await page.goto(origin + '/login');
    await page.evaluate(t => sessionStorage.setItem('access_token', t), token);
    for (const path of ['/stock/issue', '/stock/recall', '/stock/balance', '/company/assets', '/stock/issue', '/stock/recall', '/stock/issue']) {
      await page.goto(origin + path);
      const heading = { '/stock/issue': 'Cấp phát vật chất', '/stock/recall': 'Thu hồi vật chất', '/stock/balance': 'Tồn kho Tiểu đoàn', '/company/assets': 'Tài sản đơn vị' }[path];
      await page.getByRole('heading', { name: heading }).waitFor();
      if (path === '/stock/issue' || path === '/stock/recall') {
        await page.getByText('Đang tải phiếu…').waitFor({ state: 'hidden' });
        await page.getByText('Không có phiếu phù hợp.').waitFor();
        assert.equal(await page.getByRole('alert').count(), 0, 'Unexpected list alert');
        assert(status.some(([p,s]) => p.startsWith(`/api/v1/transfers?transfer_type=${path.endsWith('issue') ? 'ISSUE' : 'RECALL'}`) && s === 200));
      }
      if (path === '/company/assets') {
        const co = await Unit.findOne({ where: { code: 'COMPANY_11' } });
        await page.getByLabel('Đại đội', { exact: false }).selectOption(String(co.id));
        await page.getByText('Không có vật chất phù hợp.').waitFor();
        await page.waitForFunction(id => performance.getEntriesByType('resource').some(e => e.name.includes(`/api/v1/transfers/company-assets/${id}`)), String(co.id));
        await page.waitForTimeout(100);
        assert(status.some(([p,s]) => p.startsWith(`/api/v1/transfers/company-assets/${co.id}`) && s === 200), JSON.stringify(status.slice(-8)));
      }
      await page.waitForLoadState('networkidle');
    }
    // Real network offline/online in Chromium, not an API response mock.
    intentionalDisconnect = true;
    await context.setOffline(true);
    await page.getByLabel('Tìm mã / chứng từ').fill('NO_MATCH_DEV_RETRY');
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Tải lại' }).waitFor();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Tải lại' }).click();
    await page.getByText('Không có phiếu phù hợp.').waitFor();
    await page.getByRole('alert').waitFor({ state: 'hidden' });
    intentionalDisconnect = false;
    await page.reload();
    await page.getByRole('heading', { name: 'Cấp phát vật chất' }).waitFor();
    await page.getByText('Đang tải phiếu…').waitFor({ state: 'hidden' });
    await page.reload();
    await page.getByRole('heading', { name: 'Cấp phát vật chất' }).waitFor();
    await page.getByText('Đang tải phiếu…').waitFor({ state: 'hidden' });
    assert(status.some(([p,s]) => p.startsWith('/api/v1/transfers?transfer_type=ISSUE') && s === 200));
    assert(status.some(([p,s]) => p.startsWith('/api/v1/transfers?transfer_type=RECALL') && s === 200));
    assert.deepEqual(modules.slice(0, 4), [], 'JS module response failed; first samples');
    assert.deepEqual(failures.slice(0, 4), [], 'Console/network failed; first samples');
    console.log('DEVELOPMENT BROWSER PASS: real localhost:5173 → localhost:5000, no mocked API, 375px, routes/reloads, issue/recall empty, offline/retry recovered, no 500/pageerror/module empty; requests:', JSON.stringify([...new Map(status).entries()]));
  } finally { await browser.close(); await sequelize.close(); }
})().catch(e => { console.error('Development browser failed:', e.message); process.exitCode = 1; });
