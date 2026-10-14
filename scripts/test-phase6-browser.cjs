const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { chromium } = require('C:/Users/quoca/AppData/Local/Temp/p2-browser/node_modules/playwright');
const app = require('../src/app');
const { jwtConfig } = require('../src/services/auth.service');
const { sequelize, User, Unit, Role, Location, Material, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, StockLedgerEntry: Ledger, StockTransfer } = require('../src/models');
async function main() {
  assert.equal(process.env.DB_NAME, 'ql_kho_tieu_doan_5_phase6_verify');
  const origin = 'http://localhost:5173';
  assert.equal((await fetch(origin)).status, 200, 'Vite server required');
  const [root, companyUnit, unit13, role, room, category, source, condition] = await Promise.all([
    Unit.findOne({ where: { code: 'BATTALION_5' } }), Unit.findOne({ where: { code: 'COMPANY_11' } }), Unit.findOne({ where: { code: 'COMPANY_13' } }),
    Role.findOne({ where: { code: 'COMPANY_ADMIN' } }), Location.findOne({ where: { type: 'ROOM' }, order: [['id', 'DESC']] }),
    MaterialCategory.findOne(),
    MaterialSource.findOne(), ConditionLevel.findOne(),
  ]);
  const admin = await User.findOne({ where: { unit_id: root.id } });
  const material = await Material.create({ code: `P6BR_M_${Date.now()}`, name: 'Quạt thử nghiệm UI', category_id: category.id, unit_id: (await UnitOfMeasure.findOne()).id });
  const rootStore = await Location.findOne({ where: { code: 'LOC_BATTALION_5_WAREHOUSE' } });
  await Ledger.create({ unit_id: root.id, location_id: rootStore.id, material_id: material.id, source_id: source.id, condition_id: condition.id, quantity_delta: 10, transaction_type: 'OPENING_BALANCE', reference_type: 'PHASE6_BROWSER_FIXTURE', reference_id: material.id, occurred_at: new Date(), created_by: admin.id });
  const company = await User.create({ username: `P6BR_${Date.now()}`, full_name: 'Kiểm thử UI', role_id: role.id, unit_id: companyUnit.id, password_hash: 'test-only' });
  const company13 = await User.create({ username: `P6BR13_${Date.now()}`, full_name: 'Kiểm thử UI 13', role_id: role.id, unit_id: unit13.id, password_hash: 'test-only' });
  const shared = await Location.findOne({ where: { code: { [require('sequelize').Op.like]: 'P6F_%_PHONG_101' } }, order: [['id', 'DESC']] });
  assert(shared, 'Fixture C required');
  const sharedMaterial = await Material.findOne({ where: { code: shared.code.replace(/_PHONG_101$/, '_A_0') } });
  assert(sharedMaterial, 'Fixture C material required');
  const token = user => jwt.sign({ sub: String(user.id), ver: 0 }, jwtConfig().secret, { expiresIn: '10m' });
  const server = app.listen(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const code = `P6BR_${Date.now()}`;
  try {
    for (const [iteration, width] of [375,768,1440].entries()) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      const errors = [], network = [], trace = [];
      const stamp = () => new Date().toISOString();
      page.on('request', r => { if (r.url().includes('/api/v1/transfers')) trace.push(`${stamp()} → ${r.method()} ${r.url()}`) });
      page.on('response', r => { if (r.url().includes('/api/v1/transfers')) trace.push(`${stamp()} ← ${r.status()} ${r.url()}`) });
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/400 \(Bad Request\)|409 \(Conflict\)/.test(m.text())) errors.push(m.text()) });
      page.on('response', r => { if (r.status() >= 500) network.push(`${r.status()} ${r.url()}`) });
      await page.route('**/api/v1/**', async route => {
        const url = new URL(route.request().url());
        try {
          const response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
          await route.fulfill({ response });
        } catch (err) {
          // Navigation can cancel an in-flight route while Chrome is closing the page.
          if (!/Target closed|Route is already handled|ECONNRESET|net::ERR_ABORTED/.test(String(err))) throw err;
          trace.push(`${stamp()} canceled ${route.request().method()} ${url.pathname}: ${String(err).slice(0,100)}`);
          try { await route.abort('aborted') } catch { /* Route already canceled by navigation. */ }
        }
      });
      await page.goto(origin+'/login');
      await page.evaluate(t => sessionStorage.setItem('access_token',t), token(admin));
      const visit = async (url, heading) => { await page.goto(origin+url); try { await page.getByRole('heading', { name: heading }).waitFor({ timeout: 12000 }); } catch(e) { console.error('BROWSER VISIT',url,(await page.locator('body').innerText()).slice(0,1000),errors,network); throw e; } await page.waitForTimeout(300); const metrics = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, viewport: innerWidth })); assert(metrics.doc <= metrics.viewport, `${url} ${width} overflow ${JSON.stringify(metrics)}`) };
      await visit('/stock/locations','Địa điểm lưu giữ');
      await page.getByLabel('Tìm tên hoặc mã').fill(room.name);
      await page.getByRole('button', { name: new RegExp(room.name) }).first().waitFor();
      await page.getByLabel('Tìm tên hoặc mã').fill(room.code);
      await page.getByRole('button',{name:new RegExp(room.name)}).first().click();
      const floorRow = await Location.findByPk(room.parent_location_id);
      await page.getByLabel('Tìm tên hoặc mã').fill(floorRow.code);
      await page.getByRole('button',{name:new RegExp(floorRow.name)}).first().click();
      await page.getByRole('heading',{name:new RegExp(' › ')}).first().waitFor();
      await page.getByLabel('Tìm tên hoặc mã').fill('KHONG_CO_PHONG_NAY');
      await page.getByText('Không tìm thấy địa điểm.').waitFor();
      await page.getByLabel('Tìm tên hoặc mã').fill(room.code);
      await page.getByRole('button', { name: new RegExp(room.name) }).first().waitFor();
      await page.getByRole('button', { name: new RegExp(room.name) }).first().click();
      await page.getByRole('heading', { name: / › / }).first().waitFor();
      const locationCode = `${code}_${width}`;
      await page.getByRole('button', { name: 'Thêm địa điểm' }).click();
      await page.getByLabel('Mã *', { exact: true }).fill(locationCode);
      await page.getByLabel('Tên *', { exact: true }).fill('Phòng test UI');
      await page.getByLabel('Loại').selectOption('ROOM');
      await page.getByLabel('Địa điểm cha').selectOption(String(room.parent_location_id));
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Đã lưu địa điểm.').waitFor();
      await page.getByLabel('Tìm tên hoặc mã').fill(locationCode);
      await page.getByRole('button', { name: 'Phòng test UI' }).click();
      await page.getByLabel('Tên *', { exact: true }).fill('Phòng test UI đã sửa');
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Đã lưu địa điểm.').waitFor();
      await page.getByRole('button', { name: 'Phòng test UI đã sửa' }).click();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Xóa', exact: true }).click();
      await page.getByText('Đã xóa địa điểm.').waitFor();
      await page.getByLabel('Tìm tên hoặc mã').fill('');
      const treeRoot = page.getByRole('button', { name: 'Tiểu đoàn 5', exact: true }).first();
      await treeRoot.waitFor();
      await page.getByRole('button', { name: /Mở rộng Tiểu đoàn 5/ }).click();
      await page.getByRole('button', { name: 'Kho Tiểu đoàn 5' }).first().waitFor();
      await page.getByRole('button', { name: /Thu gọn Tiểu đoàn 5/ }).click();
      assert.equal(await page.getByRole('button', { name: 'Kho Tiểu đoàn 5' }).count(),0);
      await visit('/stock/issue','Cấp phát vật chất');
      await page.getByLabel('Mã phiếu').fill(`${locationCode}_INVALID`);
      await page.getByLabel('Đại đội nhận').selectOption(String(companyUnit.id));
      await page.getByLabel('Vật chất', { exact: false }).selectOption(String(material.id));
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      await page.getByLabel('Số lượng', { exact: false }).fill('0');
      await page.getByRole('button', { name: 'Lưu nháp' }).click();
      await page.getByText('Số lượng phải là số nguyên dương (ví dụ 5).').waitFor(); assert.equal(await page.getByLabel('Mã phiếu').inputValue(), `${locationCode}_INVALID`);
      await page.getByLabel('Mã phiếu').fill(`${locationCode}_ISS`);
      await page.getByLabel('Đại đội nhận').selectOption(String(companyUnit.id));
      assert(await page.getByLabel('Nơi nhận').inputValue(), 'Company store default');
      await page.getByLabel('Nơi nhận').selectOption(String(room.id));
      await page.getByLabel('Vật chất', { exact: false }).selectOption(String(material.id));
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      await page.getByLabel('Tình trạng', { exact: false }).selectOption(String(condition.id));
      await page.getByLabel('Số lượng', { exact: false }).fill('1');
      await page.getByRole('button', { name: 'Lưu nháp' }).click();
      await page.getByText('Đã tạo phiếu nháp.').waitFor();
      await page.getByLabel('Tìm mã / chứng từ').fill(`${locationCode}_ISS`);
      await page.getByRole('button', { name: 'Xem' }).first().click();
      await page.getByRole('heading', { name: new RegExp(`Phiếu ${locationCode}_ISS`) }).waitFor();
      await page.getByRole('button', { name: 'Đóng' }).click();
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      await page.getByRole('heading', { name: 'Sửa phiếu nháp' }).waitFor();
      await page.getByLabel('Số chứng từ').fill('Đã sửa UI');
      await page.evaluate(() => { window.__events=[]; for(const name of ['invalid','submit','click']) document.addEventListener(name,e=>{if(name!=='click'||e.target.type==='submit') window.__events.push([new Date().toISOString(),name,e.target.outerHTML.slice(0,180),[...document.querySelectorAll('#transfer-editor :invalid')].map(x=>x.outerHTML.slice(0,180))])},true) });
      await page.getByRole('button', { name: 'Lưu nháp' }).click();
      try { await page.getByText('Đã sửa phiếu nháp.').waitFor({timeout: 15000}); } catch(e) { console.error('EDIT ISSUE DIAGNOSTIC', { trace:trace.slice(-25), dom:await page.evaluate(() => ({ events:window.__events, editor:document.querySelector('#transfer-editor')?.innerText.slice(-500), button:document.querySelector('#transfer-editor button[type=submit]')?.outerHTML, invalid:[...document.querySelectorAll('#transfer-editor :invalid')].map(x=>x.outerHTML.slice(0,200)) })), errors, network }); throw e; }
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Xóa' }).first().click();
      await page.getByText('Đã xóa phiếu nháp.').waitFor();
      await page.getByLabel('Mã phiếu').fill(`${locationCode}_ISS`);
      await page.getByLabel('Đại đội nhận').selectOption(String(companyUnit.id));
      await page.getByLabel('Nơi nhận').selectOption(String(room.id));
      await page.getByLabel('Vật chất', { exact: false }).selectOption(String(material.id));
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      await page.getByLabel('Tình trạng', { exact: false }).selectOption(String(condition.id));
      await page.getByLabel('Số lượng', { exact: false }).fill('1');
      await page.getByRole('button', { name: 'Lưu nháp' }).click();
      await page.getByText('Đã tạo phiếu nháp.').waitFor();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Ghi sổ' }).first().click();
      try { await page.getByText('Đã ghi sổ phiếu.').waitFor({ timeout: 8000 }); } catch(e) { console.error('POST ISSUE:', (await page.locator('body').innerText()).slice(0,1800)); throw e; }
      await visit('/stock/internal-transfer','Điều chuyển nội bộ vật chất');
      await page.getByLabel('Mã phiếu').fill(`${locationCode}_INVALID`);
      await page.getByLabel('Đại đội chịu trách nhiệm').selectOption(String(companyUnit.id));
      await page.getByLabel('Nơi chuyển').selectOption(String(room.id));
      await page.getByLabel('Nơi nhận').selectOption(String(room.id));
      await page.getByLabel('Vật chất', { exact: false }).selectOption(String(material.id));
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      await page.getByLabel('Số lượng', { exact: false }).fill('1');
      await page.getByRole('button', { name: 'Lưu nháp' }).click();
      await page.getByText('Nơi nhận phải khác nơi chuyển.').waitFor(); assert.equal(await page.getByLabel('Mã phiếu').inputValue(), `${locationCode}_INVALID`);
      await page.getByLabel('Mã phiếu').fill(`${locationCode}_MOVE`);
      await page.getByLabel('Đại đội chịu trách nhiệm').selectOption(String(companyUnit.id));
      await page.getByLabel('Nơi chuyển').selectOption(String(room.id));
      const store = await Location.findOne({ where: { code: 'LOC_COMPANY_11_STORE' } });
      await page.getByLabel('Nơi nhận').selectOption(String(store.id));
      await page.getByLabel('Vật chất', { exact: false }).selectOption(String(material.id));
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      await page.getByLabel('Tình trạng', { exact: false }).selectOption(String(condition.id));
      await page.getByLabel('Số lượng', { exact: false }).fill('1');
      await page.getByRole('button', { name: 'Lưu nháp' }).click();
      await page.getByText('Đã tạo phiếu nháp.').waitFor();
      await page.getByLabel('Tìm mã / chứng từ').fill(`${locationCode}_MOVE`);
      await page.getByRole('button', { name: 'Xem' }).first().click();
      await page.getByRole('heading', { name: new RegExp(`Phiếu ${locationCode}_MOVE`) }).waitFor();
      await page.getByRole('button', { name: 'Đóng' }).click();
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      await page.getByRole('heading', { name: 'Sửa phiếu nháp' }).waitFor();
      await page.getByLabel('Số chứng từ').fill('Đã sửa UI');
      await page.evaluate(() => { window.__submitTrace = []; const form = document.querySelector('#transfer-editor form'); form.addEventListener('submit', () => window.__submitTrace.push([new Date().toISOString(),'submit']), { capture: true }); form.addEventListener('click', e => { if (e.target.type === 'submit') window.__submitTrace.push([new Date().toISOString(),'click submit']) }, { capture: true }) });
      // Reproduce the original race deterministically: list reload stays pending during draft edit.
      let releaseList, held = false;
      const listGate = new Promise(resolve => { releaseList = resolve });
      const holdList = async route => {
        if (!held && route.request().method() === 'GET') { held = true; await listGate }
        await route.fallback();
      };
      await page.route('**/api/v1/transfers?*', holdList);
      await page.getByLabel('Tìm mã / chứng từ').fill(`${locationCode}_MOVE_`);
      const start = stamp();
      try {
        await page.getByText('Đang tải phiếu…').waitFor();
        assert(held, 'GET list must be pending');
        assert(await page.getByRole('button', { name: 'Lưu nháp' }).isEnabled(), 'List loading must not disable draft submit');
        await page.getByRole('button', { name: 'Lưu nháp' }).click();
        await page.getByText('Đã sửa phiếu nháp.').waitFor({ timeout: 15000 });
      } catch(e) { console.error('EDIT MOVE DIAGNOSTIC', {start, end:stamp(), trace:trace.slice(-25), dom:await page.evaluate(() => ({ events:window.__submitTrace, button:document.querySelector('#transfer-editor button[type=submit]')?.outerHTML, editor:document.querySelector('#transfer-editor')?.innerText.slice(-400), alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.innerText), invalid:[...document.querySelectorAll('#transfer-editor :invalid')].map(x=>x.outerHTML.slice(0,200)) })), errors, network }); throw e; }
      finally { releaseList(); await page.unroute('**/api/v1/transfers?*', holdList) }
      const edited = await StockTransfer.findOne({where:{code:`${locationCode}_MOVE`}});
      assert.equal(edited.status,'DRAFT'); assert.equal(edited.document_no,'Đã sửa UI');
      assert.equal(trace.filter(e=>e.includes(`→ PATCH http://localhost:5000/api/v1/transfers/${edited.id}`)).length,1,'One initial PATCH per edit');
      assert.equal(await Ledger.count({where:{reference_type:'STOCK_TRANSFER',reference_id:edited.id}}),0);
      await visit('/stock/internal-transfer','Điều chuyển nội bộ vật chất');
      await page.getByLabel('Tìm mã / chứng từ').fill(`${locationCode}_MOVE`);
      await page.getByRole('row').filter({hasText:`${locationCode}_MOVE`}).getByRole('button',{name:'Xem'}).click();
      await page.getByText('Đã sửa UI').waitFor();
      await page.getByRole('button',{name:'Đóng'}).click();
      let injected = false;
      const failureRoute = async route => {
        if(!injected && route.request().method()==='GET' && /\/transfers\/\d+$/.test(new URL(route.request().url()).pathname)) { injected=true; await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Dịch vụ tạm gián đoạn'})}) }
        else await route.fallback();
      };
      await page.route('**/api/v1/transfers/*', failureRoute);
      await page.getByRole('row').filter({hasText:`${locationCode}_MOVE`}).getByRole('button',{name:'Xem'}).click();
      try { await page.getByRole('alert').getByText('Dịch vụ tạm gián đoạn').waitFor({timeout:10000}); } catch(e) { console.error('GET RETRY DIAGNOSTIC',{injected, trace:trace.slice(-15), body:(await page.locator('body').innerText()).slice(0,850),errors,network}); throw e; }
      assert(injected);
      await page.unroute('**/api/v1/transfers/*', failureRoute);
      await page.getByRole('row').filter({hasText:`${locationCode}_MOVE`}).getByRole('button',{name:'Xem'}).click();
      await page.getByText('Đã sửa UI').waitFor();
      await page.getByRole('button',{name:'Đóng'}).click();
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      await page.getByRole('heading',{name:'Sửa phiếu nháp'}).waitFor();
      await page.getByLabel('Số chứng từ').fill('Retry sau lỗi');
      let rejectedPut = false;
      const putFailure = async route => {
        if(!rejectedPut && route.request().method()==='PATCH') { rejectedPut=true; await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Không lưu được, thử lại'})}) }
        else await route.fallback();
      };
      await page.route('**/api/v1/transfers/*', putFailure);
      await page.getByRole('button',{name:'Lưu nháp'}).click();
      try { await page.getByRole('alert').getByText('Không lưu được, thử lại').waitFor({timeout:10000}); } catch(e) { console.error('PUT RETRY DIAGNOSTIC',{ rejectedPut, trace:trace.slice(-12), editor:await page.locator('#transfer-editor').innerText(), errors, network }); throw e; }
      assert(rejectedPut);
      assert.equal((await StockTransfer.findByPk(edited.id)).document_no,'Đã sửa UI');
      assert.equal(await Ledger.count({where:{reference_type:'STOCK_TRANSFER',reference_id:edited.id}}),0);
      await page.unroute('**/api/v1/transfers/*',putFailure);
      await page.getByRole('button',{name:'Lưu nháp'}).click();
      await page.getByText('Đã sửa phiếu nháp.').waitFor();
      assert.equal((await StockTransfer.findByPk(edited.id)).document_no,'Retry sau lỗi');
      assert.equal(trace.filter(e=>e.includes(`→ PATCH http://localhost:5000/api/v1/transfers/${edited.id}`)).length,3,'Initial save, injected failure and one retry; no duplicate submit');
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Xóa' }).first().click();
      await page.getByText('Đã xóa phiếu nháp.').waitFor();
      await page.getByLabel('Mã phiếu').fill(`${locationCode}_MOVE`);
      await page.getByLabel('Đại đội chịu trách nhiệm').selectOption(String(companyUnit.id));
      await page.getByLabel('Nơi chuyển').selectOption(String(room.id));
      await page.getByLabel('Nơi nhận').selectOption(String(store.id));
      await page.getByLabel('Vật chất', { exact: false }).selectOption(String(material.id));
      await page.getByLabel('Nguồn', { exact: false }).selectOption(String(source.id));
      await page.getByLabel('Tình trạng', { exact: false }).selectOption(String(condition.id));
      await page.getByLabel('Số lượng', { exact: false }).fill('1');
      await page.getByRole('button', { name: 'Lưu nháp' }).click();
      await page.getByText('Đã tạo phiếu nháp.').waitFor();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Ghi sổ' }).first().click();
      await page.getByText('Đã ghi sổ phiếu.').waitFor();
      assert.equal((await StockTransfer.findOne({where:{code:`${locationCode}_MOVE`}})).status,'POSTED');
      await visit('/stock/internal-transfer','Điều chuyển nội bộ vật chất');
      await page.getByLabel('Tìm mã / chứng từ').fill(`${locationCode}_MOVE`);
      await page.getByRole('row').filter({hasText:`${locationCode}_MOVE`}).getByRole('button',{name:'Xem'}).click();
      await page.getByRole('heading',{name:new RegExp(`Phiếu ${locationCode}_MOVE · ĐÃ GHI SỔ`)}).waitFor();
      assert.equal(await page.getByRole('row').filter({hasText:`${locationCode}_MOVE`}).getByRole('button',{name:'Sửa'}).count(),0);
      await visit('/company/assets','Vật chất của Đại đội');
      await page.getByLabel('Đại đội', { exact: false }).selectOption(String(companyUnit.id));
      await page.getByLabel('Tìm mã / tên vật chất').fill(material.code);
      await page.getByRole('row').filter({ hasText: material.code }).getByRole('button', { name: 'Chi tiết' }).click();
      await page.getByRole('heading', { name: 'Đang ở kho / phòng' }).waitFor();
      await page.getByRole('heading', { name: 'Lịch sử cấp phát / thu hồi / điều chuyển' }).waitFor();
      await page.getByRole('heading', { name: new RegExp(material.code) }).waitFor();
      await page.getByText(`Tổng hiện giữ: ${iteration + 1} `, { exact: false }).waitFor();
      assert((await page.getByRole('row').filter({ hasText: 'Điều chuyển nội bộ' }).count()) >= 2);
      const history = await page.locator('section.account-card').filter({ has: page.getByRole('heading', { name: 'Lịch sử cấp phát / thu hồi / điều chuyển' }) }).innerText();
      assert(history.includes(room.name) && history.includes(store.name), 'History must show both rooms/locations');
      await page.goto(origin+'/login');
      await page.evaluate(t => sessionStorage.setItem('access_token',t), token(company));
      await visit('/company/assets','Vật chất của Đại đội');
      assert.equal(await page.getByText('Điều chuyển nội bộ').count(),0);
      assert.equal(await page.getByRole('link', { name: 'Địa điểm lưu giữ' }).count(),1);
      await page.getByLabel('Tìm mã / tên vật chất').fill(material.code);
      await page.getByRole('row').filter({ hasText: material.code }).getByRole('button', { name: 'Chi tiết' }).click();
      await page.getByRole('heading', { name: 'Đang ở kho / phòng' }).waitFor();
      await page.getByRole('heading', { name: new RegExp(material.code) }).waitFor();
      await page.getByText(`Tổng hiện giữ: ${iteration + 1} `, { exact: false }).waitFor();
      const scoped = await page.locator('section.account-card').filter({ has: page.getByRole('heading', { name: 'Lịch sử cấp phát / thu hồi / điều chuyển' }) }).innerText();
      assert(scoped.includes(room.name) && scoped.includes(store.name), 'Scoped history: '+scoped.slice(0,1700));
      const forbidden = async url => { await page.goto(origin+url); await page.getByRole('heading',{name:'Không có quyền truy cập'}).waitFor(); assert.equal(await page.getByRole('button',{name:'Lưu nháp'}).count(),0) };
      for(const url of ['/stock/issue','/stock/internal-transfer','/stock/balance','/stock/receipts']) await forbidden(url);
      await visit('/stock/locations','Địa điểm lưu giữ');
      assert.equal(await page.getByRole('button', { name: 'Thêm địa điểm' }).count(), 0);
      await forbidden('/stock/internal-transfer');
      for(const [user, quantity, foreign] of [[company,'4','2'],[company13,'2','4']]) {
        await page.goto(origin+'/login'); await page.evaluate(t=>sessionStorage.setItem('access_token',t),token(user));
        await visit('/company/assets','Vật chất của Đại đội');
        assert.equal(await page.getByText('Đại đội', {exact:true}).count(),0);
        for(const menu of ['Cấp phát','Điều chuyển nội bộ','Tồn kho']) assert.equal(await page.getByRole('link',{name:menu,exact:true}).count(),0);
        await page.getByLabel('Tìm mã / tên vật chất').fill(sharedMaterial.name);
        const assetRow = page.getByRole('row').filter({hasText:sharedMaterial.code}); await assetRow.waitFor();
        assert((await assetRow.innerText()).includes(quantity));
        await assetRow.getByRole('button',{name:'Chi tiết'}).click();
        await page.getByRole('heading',{name:new RegExp(sharedMaterial.code)}).waitFor();
        const detail = await page.locator('section.account-card').filter({has:page.getByRole('heading',{name:new RegExp(sharedMaterial.code)})}).innerText();
        assert(detail.includes(`Tổng hiện giữ: ${quantity} `) && detail.includes(shared.name));
        assert(!detail.includes(`Tổng hiện giữ: ${foreign} `));
        if(user===company13) assert(detail.includes('Phong_103'));
        await forbidden('/stock/internal-transfer');
      }
      const canceled = trace.filter(e=>e.includes('canceled'));
      assert(errors.every(e=>/503 \(Service Unavailable\)/.test(e)) && errors.length === 2 && network.length === 2 && network.every(e=>e.includes('503')) && canceled.every(e=>/canceled GET /.test(e)), JSON.stringify({ errors, network, canceled }));
      console.log('Browser PASS', { width, locationCode, unexpectedConsoleErrors: 0, injected503: network.length, canceledGET: canceled.length, overflow: false });
      await ctx.close();
    }
    assert((await Ledger.count({ where: { material_id: material.id } })) > 0);
  } finally { await browser.close(); server.close(); await sequelize.close(); }
}
main().catch(e => { console.error(e); process.exitCode=1 });
