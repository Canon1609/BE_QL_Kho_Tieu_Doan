// Phase 5 acceptance-only browser/API audit against isolated test DB. No credential/token output.
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { sequelize, Role, Unit, User, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, StockLedgerEntry } = require('../src/models');
const origin = 'http://localhost:5173';
const basePath = '/api/v1';
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase5_verify');
  assert.equal((await fetch(origin)).status, 200);
  const server = app.listen(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const code = `P5C_${Date.now()}`;
  const failures = [], seen = new Set(), statuses = new Map();
  function inspect(path, status, body) {
    const key = path.replace(/\/\d+(?=\/|\?|$)/g, '/:id');
    seen.add(key); statuses.set(status, (statuses.get(status) || 0) + 1);
    const secrets = [process.env.DB_PASSWORD, process.env.JWT_SECRET].filter(s => s && s.length >= 8);
    if (/password_hash|google_sub|google.?(?:credential|token)|jwt_secret|sequelize(?:database|connection|validation|unique|foreign|timeout)|(?:select|insert|update|delete)\s+.{1,80}\s+(?:from|into|where|set)\s|(?:access_token|eyJ[A-Za-z0-9_-]{16,}\.)/i.test(body) || secrets.some(s => body.includes(s)) || /(?:"stack"|at\s+\S+\s*\([^)]*:\d+:\d+\))/.test(body)) failures.push(`${status} ${key}`);
  }
  async function api(path, token, method = 'GET', data) {
    const r = await fetch(`http://127.0.0.1:${port}${basePath}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data && JSON.stringify(data) });
    const text = await r.text();
    if (path !== '/auth/login') inspect(path, r.status, text); // login intentionally returns JWT
    return { status: r.status, body: JSON.parse(text) };
  }
  try {
    const [root, company11, br, cr, cat, measure, source, cond] = await Promise.all([
      Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), Role.findOne({ where: { code: 'COMPANY_ADMIN' } }),
      MaterialCategory.findOne({ where: { code: 'QUAN_TRANG' } }), UnitOfMeasure.findOne({ where: { code: 'BO' } }), MaterialSource.findOne({ where: { code: 'NHAN_CAP' } }), ConditionLevel.findOne({ where: { code: 'H1' } }),
    ]);
    assert([root, company11, br, cr, cat, measure, source, cond].every(Boolean));
    // Only test identities; do not alter development users or persist the password in docs.
    const password = `P5only_${require('node:crypto').randomBytes(18).toString('hex')}`;
    const hash = await bcrypt.hash(password, 10);
    const admin = await User.create({ username: `${code}_b`, full_name: 'Kiểm thử Tiểu đoàn', password_hash: hash, role_id: br.id, unit_id: root.id });
    const company = await User.create({ username: `${code}_c`, full_name: 'Kiểm thử Đại đội', password_hash: hash, role_id: cr.id, unit_id: company11.id });
    const material = await Material.create({ code, name: 'Vật chất nghiệm thu', category_id: cat.id, unit_id: measure.id });
    const item = qty => ({ material_id: String(material.id), source_id: String(source.id), condition_id: String(cond.id), quantity: qty });
    const draft = (suffix, type, qty) => ({ code: `${code}_${suffix}`, transfer_type: type, transfer_date: '2026-09-30', company_unit_id: String(company11.id), items: [item(qty)] });
    const login = async username => {
      const r = await api('/auth/login', null, 'POST', { username, password });
      assert.equal(r.status, 200); assert(r.body.data.token); return r.body.data.token;
    };
    const token = await login(admin.username);
    assert.equal((await api('/auth/me', token)).status, 200);
    const opening = await api('/stock/receipts', token, 'POST', { code: `${code}_OPEN`, receipt_type: 'OPENING_BALANCE', receipt_date: '2026-09-30', items: [item(50)] });
    assert.equal(opening.status, 201);
    assert.equal((await api(`/stock/receipts/${opening.body.data.id}/post`, token, 'POST', {})).status, 200);
    const balance = async () => {
      const [w, c] = await Promise.all([api(`/stock/balance?material_id=${material.id}`, token), api(`/transfers/company-assets/${company11.id}?material_id=${material.id}`, token)]);
      assert.equal(w.status, 200); assert.equal(c.status, 200);
      return [w.body.data[0]?.quantity || '0', c.body.data[0]?.quantity || '0'];
    };
    const ledgerCount = async () => StockLedgerEntry.count({ where: { material_id: material.id } });
    assert.deepEqual(await balance(), ['50', '0']);
    const ctx = await browser.newContext({ viewport: { width: 375, height: 900 } });
    const page = await ctx.newPage(), errors = [], modules = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/\b(400|403|409|503)\s*\(/.test(m.text())) errors.push(m.text()) });
    page.on('response', async r => {
      if (/\/src\/.*\.(?:jsx|js)(?:\?|$)/.test(r.url())) {
        try { if (!r.ok() || !(await r.text()).trim()) modules.push(r.url().split('?')[0]); } catch (e) { modules.push(e.message) }
      }
    });
    let failNextList = false;
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url());
      if (failNextList && url.pathname === '/api/v1/transfers' && route.request().method() === 'GET') {
        failNextList = false;
        const body = JSON.stringify({ success: false, message: 'Dịch vụ tạm thời không khả dụng.' });
        inspect(url.pathname + url.search, 503, body);
        return route.fulfill({ status: 503, contentType: 'application/json', body });
      }
      const response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
      // Do not inspect login JSON: login returns a JWT by contract. Audit other response bodies.
      if (url.pathname !== '/api/v1/auth/login') inspect(url.pathname + url.search, response.status(), await response.text());
      await route.fulfill({ response });
    });
    async function browserLogin(username, remember) {
      await page.goto(`${origin}/login`);
      await page.getByLabel('Tên đăng nhập').fill(username);
      await page.getByLabel('Mật khẩu').fill(password);
      if (remember) await page.getByLabel('Ghi nhớ đăng nhập').check();
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await page.getByRole('button', { name: 'Đăng xuất' }).waitFor();
    }
    await browserLogin(admin.username, false);
    assert(await page.evaluate(() => Boolean(sessionStorage.getItem('access_token') && !localStorage.getItem('access_token'))));
    await page.reload(); await page.getByRole('button', { name: 'Đăng xuất' }).waitFor();
    await page.goto(`${origin}/admin/accounts`); await page.getByRole('heading', { name: /Quản lý tài khoản|Tài khoản/ }).first().waitFor();
    await page.getByText(admin.username, { exact: true }).first().waitFor();
    await page.goto(`${origin}/catalog/materials`); await page.getByRole('heading', { name: 'Danh mục · Vật chất' }).waitFor();
    await page.getByLabel('Tìm mã / tên').fill(code);
    await page.getByText(code, { exact: true }).first().waitFor();
    await page.goto(`${origin}/stock/receipts`); await page.getByRole('heading', { name: 'Nhập kho · Tồn đầu kỳ' }).waitFor();
    await page.goto(`${origin}/stock/balance`); await page.getByRole('heading', { name: 'Tồn kho Tiểu đoàn' }).waitFor();
    await page.getByLabel('Tìm mã / vật chất').fill(code);
    await page.getByRole('button', { name: 'Lịch sử' }).first().click();
    await page.getByText('Tồn đầu kỳ').first().waitFor();
    for (const type of ['ISSUE', 'RECALL']) {
      await page.goto(`${origin}/stock/${type.toLowerCase()}`);
      await page.getByRole('heading', { name: type === 'ISSUE' ? 'Cấp phát vật chất' : 'Thu hồi vật chất' }).waitFor();
      await page.getByText('Đang tải phiếu…').waitFor({ state: 'hidden' });
      const form = page.locator('#transfer-editor form');
      const save = form.getByRole('button', { name: 'Lưu nháp' });
      await save.click();
      assert.equal(await form.locator('input:invalid, select:invalid').count() > 0, true);
      await page.getByRole('alert').getByText('Vui lòng điền các trường bắt buộc và nhập số lượng nguyên dương.').waitFor();
      await page.getByLabel('Mã phiếu').fill(`${code}_${type}_UI`);
      await page.getByLabel(type === 'ISSUE' ? 'Đại đội nhận' : 'Đại đội thu hồi từ').selectOption(String(company11.id));
      await page.getByLabel('Vật chất', { exact: false }).selectOption(String(material.id));
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      await page.getByLabel('Tình trạng', { exact: false }).selectOption(String(cond.id));
      const quantity = page.getByLabel('Số lượng', { exact: false });
      for (const bad of ['0', '-1', '1.5']) {
        await quantity.fill(bad);
        await save.click();
        assert(await quantity.evaluate(e => !e.validity.valid), `HTML quantity validation ${bad}`);
        await page.getByRole('alert').getByText('Vui lòng điền các trường bắt buộc và nhập số lượng nguyên dương.').waitFor();
        assert.equal(await page.getByLabel('Mã phiếu').inputValue(), `${code}_${type}_UI`);
      }
      await quantity.fill('9007199254740992');
      await save.click();
      await page.getByRole('alert').getByText('Mỗi dòng cần vật chất, nguồn và số lượng nguyên dương.').waitFor();
      await quantity.fill('1');
      await page.getByLabel('Nguồn', { exact: false }).selectOption('');
      await save.click(); assert(await page.getByLabel('Nguồn', { exact: false }).evaluate(e => !e.validity.valid));
      await page.getByRole('alert').getByText('Vui lòng điền các trường bắt buộc và nhập số lượng nguyên dương.').waitFor();
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      // The last item cannot be removed in UI. API validates zero-item payload independently below.
      assert(await form.getByRole('button', { name: 'Bỏ dòng' }).isDisabled());
      assert.deepEqual(await balance(), type === 'ISSUE' ? ['50', '0'] : ['49', '1']);
      failNextList = true;
      await page.getByRole('button', { name: 'Tải lại' }).count();
      await page.getByLabel('Tìm mã / chứng từ').fill(`TRIGGER_503_${code}`);
      await page.getByRole('alert').getByText('Dịch vụ tạm thời không khả dụng.').waitFor();
      assert.equal(await page.getByLabel('Mã phiếu').inputValue(), `${code}_${type}_UI`);
      await page.getByRole('button', { name: 'Tải lại' }).click();
      await page.getByText('Không có phiếu phù hợp.').waitFor();
      await page.getByRole('alert').waitFor({ state: 'hidden' });
      await page.getByLabel('Tìm mã / chứng từ').fill('');
      await quantity.fill(type === 'ISSUE' ? '60' : '999');
      await save.click(); await page.getByRole('status').getByText('Đã tạo phiếu nháp.').waitFor();
      const newId = (await api(`/transfers?search=${code}_${type}_UI`, token)).body.data.items.find(x => x.code === `${code}_${type}_UI`).id;
      const before = await balance(), count = await ledgerCount();
      assert.equal((await api(`/transfers/${newId}`, token)).status, 200);
      await page.getByLabel('Tìm mã / chứng từ').fill(`${code}_${type}_UI`);
      await page.getByText(`${code}_${type}_UI`, { exact: true }).first().waitFor();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Ghi sổ' }).first().click();
      await page.getByRole('alert').waitFor();
      assert.deepEqual(await balance(), before); assert.equal(await ledgerCount(), count);
      assert.equal((await api(`/transfers/${newId}`, token)).body.data.status, 'DRAFT');
      // Restore a usable draft by editing instead of creating extra stock entries.
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      await page.getByRole('heading', { name: 'Sửa phiếu nháp' }).waitFor();
      await quantity.fill('1'); await save.click();
      await page.getByRole('status').getByText('Đã sửa phiếu nháp.').waitFor();
      assert.equal((await api(`/transfers/${newId}`, token)).body.data.status, 'DRAFT');
      // Only post ISSUE so that RECALL has actual company stock to validate against.
      if (type === 'ISSUE') {
        page.once('dialog', d => d.accept());
        await page.getByRole('button', { name: 'Ghi sổ' }).first().click();
        await page.getByRole('status').getByText('Đã ghi sổ phiếu.').waitFor();
        assert.deepEqual(await balance(), ['49', '1']);
      }
      await page.reload(); await page.getByRole('heading', { name: type === 'ISSUE' ? 'Cấp phát vật chất' : 'Thu hồi vật chất' }).waitFor();
    }
    const invalid = draft('BAD', 'ISSUE', 0); invalid.items = [];
    assert.equal((await api('/transfers', token, 'POST', invalid)).status, 400);
    assert.equal((await api('/transfers', token, 'POST', draft('BADQ', 'ISSUE', -1))).status, 400);
    assert.equal((await api(`/transfers/${company11.id}/post`, token, 'POST', { unexpected: 1 })).status, 400);
    assert.deepEqual(await balance(), ['49', '1']);
    const recallId = (await api(`/transfers?search=${code}_RECALL_UI`, token)).body.data.items.find(x => x.code === `${code}_RECALL_UI`).id;
    assert.equal((await api(`/transfers/${recallId}/post`, token, 'POST', {})).status, 200);
    assert.equal((await api(`/transfers/${recallId}/post`, token, 'POST', {})).status, 409);
    assert.deepEqual(await balance(), ['50', '0']);
    assert.equal((await api('/stock/references', token)).status, 200);
    assert.equal((await api(`/transfers/company-assets/${company11.id}/history?material_id=${material.id}`, token)).status, 200);
    assert.equal((await api(`/transfers/company-assets/${company11.id}?material_id=${material.id}`, token)).status, 200);
    assert.equal((await api(`/stock/ledger?material_id=${material.id}`, token)).status, 200);
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await page.goto(`${origin}/stock/issue`); await page.getByRole('heading', { name: 'Đăng nhập hệ thống' }).waitFor();
    await browserLogin(admin.username, true);
    assert(await page.evaluate(() => Boolean(localStorage.getItem('access_token') && !sessionStorage.getItem('access_token'))));
    await page.reload(); await page.getByRole('button', { name: 'Đăng xuất' }).waitFor();
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await page.goto(`${origin}/admin/accounts`); await page.getByRole('heading', { name: 'Đăng nhập hệ thống' }).waitFor();
    await browserLogin(company.username, false);
    assert.equal(await page.getByRole('link', { name: 'Tài khoản', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Cấp phát' }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Thu hồi' }).count(), 0);
    await page.goto(`${origin}/stock/issue`); await page.waitForURL('**/forbidden');
    await page.goto(`${origin}/stock/recall`); await page.waitForURL('**/forbidden');
    await page.goto(`${origin}/admin/accounts`); await page.waitForURL('**/forbidden');
    const companyToken = await login(company.username);
    assert.equal((await api('/auth/me', companyToken)).status, 200);
    assert.equal((await api('/transfers', companyToken)).status, 403);
    assert.equal((await api(`/transfers/company-assets/${root.id}`, companyToken)).status, 403);
    assert.equal((await api(`/transfers/company-assets/${company11.id}/history`, companyToken)).status, 200);
    const health = await api('/health', null); assert.equal(health.status, 200); assert.equal(health.body.data.database, 'connected');
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
    assert.deepEqual(errors, [], 'Unexpected console/page errors'); assert.deepEqual(modules, [], 'Empty Vite module'); assert.deepEqual(failures, [], 'Sensitive API response');
    assert([200, 201, 400, 403, 409, 503].every(s => statuses.has(s)));
    console.log('CLOSEOUT PASS: UI validation/503-retry/balances, password auth/session/logout/RBAC, P1-P4 browser smoke, response audit, Vite routes/reloads; observed HTTP statuses:', [...statuses.keys()].sort((a,b)=>a-b), 'audited paths:', seen.size);
  } finally { await browser.close(); server.close(); await sequelize.close(); }
}
main().catch(e => { console.error('Closeout failed:', e.message); process.exitCode = 1; });
