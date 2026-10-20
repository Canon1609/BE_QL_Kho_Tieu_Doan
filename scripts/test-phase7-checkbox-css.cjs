// Read-only Chrome/Vite CSS hotfix check. Run with DB_NAME=ql_kho_tieu_doan_5_phase7_verify.
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, User, Unit } = require('../src/models');

async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase7_verify', 'Never run on development DB');
  const stage = process.argv[2];
  assert(['before', 'after'].includes(stage));
  const server = app.listen(0);
  const port = server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const units = await Promise.all([5, 11, 12, 13].map(async n => {
      const unit = await Unit.findOne({ where: { code: n === 5 ? 'BATTALION_5' : `COMPANY_${n}` } });
      assert(unit, `Missing unit ${n}`);
      const user = await User.findOne({ where: { unit_id: unit.id }, order: [['id', 'ASC']] });
      assert(user, `Missing user ${n}`);
      return [n, user];
    }));
    for (const width of [375, 768, 1440]) for (const [role, user] of units.filter(([n]) => stage === 'after' || n === 5 || n === 11)) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      const errors = [], badResponses = [], queries = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
      page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`) });
      page.on('request', r => { const url = new URL(r.url()); if (url.pathname === '/api/v1/borrow') queries.push(url.searchParams.toString()) });
      await page.route('**/api/v1/**', async route => {
        const url = new URL(route.request().url());
        await route.continue({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
      });
      try {
        await page.goto('http://127.0.0.1:5173/login');
        const token = jwt.sign({ sub: String(user.id), ver: 0 }, jwtConfig().secret, { expiresIn: '15m' });
        await page.evaluate(value => sessionStorage.setItem('access_token', value), token);
        await page.goto('http://127.0.0.1:5173/stock/borrow');
        const filters = page.locator('.account-filters');
        const checkbox = filters.getByRole('checkbox', { name: 'Chỉ quá hạn' });
        await checkbox.waitFor();
        await page.getByRole('status').filter({ hasText: 'Đang tải yêu cầu' }).waitFor({ state: 'hidden', timeout: 20000 });
        const measure = () => filters.evaluate(el => {
          const label = [...el.querySelectorAll('label')].find(l => l.textContent.includes('Chỉ quá hạn'));
          const input = label.querySelector('input');
          const a = input.getBoundingClientRect(), b = label.getBoundingClientRect(), f = el.getBoundingClientRect();
          const textRange = document.createRange();
          // The text is a separate text node inside the wrapping label.
          const text = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          textRange.selectNodeContents(text);
          const t = textRange.getBoundingClientRect();
          return { checkbox: { x: a.x, y: a.y, width: a.width, height: a.height }, text: { x: t.x, y: t.y, width: t.width, height: t.height }, label: { x: b.x, width: b.width }, filter: { x: f.x, right: f.right }, display: getComputedStyle(label).display, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        const initial = await measure();
        assert.equal(await filters.getByLabel('Đại đội').count(), role === 5 ? 1 : 0);
        const filename = path.resolve(__dirname, `../../docs/tests/phase-07/evidence/checkbox-${stage}-${role}-${width}.png`);
        await filters.screenshot({ path: filename });
        if (stage === 'after') {
          const m = initial;
          assert.equal(m.overflow, false, JSON.stringify(m));
          assert(m.checkbox.width >= 18 && m.checkbox.width <= 20 && m.checkbox.height >= 18 && m.checkbox.height <= 20, JSON.stringify(m));
          assert(m.text.x - (m.checkbox.x + m.checkbox.width) >= 7 && m.text.x - (m.checkbox.x + m.checkbox.width) <= 11, JSON.stringify(m));
          assert(Math.abs(m.text.y + m.text.height / 2 - (m.checkbox.y + m.checkbox.height / 2)) <= 2, JSON.stringify(m));
          assert(m.checkbox.y < m.text.y + m.text.height && m.checkbox.y + m.checkbox.height > m.text.y, JSON.stringify(m));
          assert(m.label.x >= m.filter.x - 1 && m.label.x + m.label.width <= m.filter.right + 1 && m.filter.right <= width + 1, JSON.stringify(m));
          assert(!await checkbox.isChecked());
          assert.equal(await filters.locator('input').count(), 4); // search, two dates, checkbox
          assert.equal(await filters.locator('select').count(), role === 5 ? 2 : 1);
          const layout = await filters.evaluate(el => [...el.children].map(child => ({ left: child.getBoundingClientRect().left, right: child.getBoundingClientRect().right, top: child.getBoundingClientRect().top, bottom: child.getBoundingClientRect().bottom })));
          for (let i = 0; i < layout.length; i++) {
            assert(layout[i].left >= m.filter.x - 1 && layout[i].right <= m.filter.right + 1, `filter ${i} outside grid: ${JSON.stringify(layout)}`);
            for (let j = 0; j < i; j++) {
              assert(layout[i].left >= layout[j].right - 1 || layout[j].left >= layout[i].right - 1 || layout[i].top >= layout[j].bottom - 1 || layout[j].top >= layout[i].bottom - 1, `filter overlap ${i}/${j}: ${JSON.stringify(layout)}`);
            }
          }
          // Hit the square, then the label text, then text again. Each must toggle without writes.
          await checkbox.click();
          assert(await checkbox.isChecked());
          await page.waitForTimeout(450);
          assert(new URLSearchParams(queries.at(-1)).get('overdue') === 'true', JSON.stringify(queries));
          const textAfterSquare = (await measure()).text;
          await page.mouse.click(textAfterSquare.x + 3, textAfterSquare.y + textAfterSquare.height / 2);
          assert(!await checkbox.isChecked(), 'Text click did not turn off');
          await page.waitForTimeout(450);
          assert(!new URLSearchParams(queries.at(-1)).has('overdue'), JSON.stringify(queries));
          const textAfterOff = (await measure()).text;
          await page.mouse.click(textAfterOff.x + 3, textAfterOff.y + textAfterOff.height / 2);
          assert(await checkbox.isChecked(), 'Text click did not turn on');
          await page.waitForTimeout(450);
          assert(new URLSearchParams(queries.at(-1)).get('overdue') === 'true');
        }
        assert.deepEqual(errors, [], `console/pageerror ${width}/${role}`);
        assert.deepEqual(badResponses, [], `network ${width}/${role}`);
        console.log(`${stage} ${width}/${role}: ${JSON.stringify(initial)}; requests=${queries.length}; screenshot=${filename}`);
      } finally { await ctx.close() }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await sequelize.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 });
