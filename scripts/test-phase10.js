'use strict';
// Guard MUST be the first project import. Never use development configuration here.
const verifyTestWriter = require('./test-db-guard');
const hardStop = setTimeout(() => { console.error('P10 harness exceeded 120s; stopping process to release test connections'); process.exit(2); }, 120000);
hardStop.unref();
for (const key of ['TEST_DB_HOST','TEST_DB_PORT','TEST_DB_NAME','TEST_DB_USER','TEST_DB_PASSWORD','TEST_DB_EXPECTED_SERVER']) if (!process.env[key]) throw new Error(`Refusing Phase 10 harness: ${key} must be explicitly configured`);
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { QueryTypes } = require('sequelize');

async function main() {
  const { sequelize, Role, Unit, User, Location, MaterialCategory, UnitOfMeasure, MaterialSource, ConditionLevel, Material, StockLedgerEntry, DamageLossReport, DamageLossItem, BorrowRequest, BorrowLine } = require('../src/models');
  await verifyTestWriter(sequelize);
  const [tables] = await sequelize.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()");
  const required = ['roles','units','users','locations','material_categories','units_of_measure','material_sources','condition_levels','materials','stock_ledger_entries','damage_loss_reports','damage_loss_items','borrow_requests','borrow_lines'];
  for (const name of required) assert(tables.some(t => (t.TABLE_NAME || t.table_name) === name), `Missing table ${name}; apply approved test migrations first`);

  const txOpts = { logging: false };
  const ensure = async (model, code, defaults) => (await model.findOrCreate({ where: { code }, defaults, ...txOpts }))[0];
  const tag = `P10TEST_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  let battalion, company, battalionRole, companyRole, category, measure, source, good, damaged, material, location, rootUser, companyUser;
  try {
    battalionRole = await Role.findOne({where:{code:'BATTALION_ADMIN'}});
    companyRole = await Role.findOne({where:{code:'COMPANY_ADMIN'}});
    battalion = await Unit.findOne({where:{code:'BATTALION_5',type:'BATTALION',is_active:true}});
    if(!battalionRole||!companyRole||!battalion) throw new Error('Test DB must already contain active BATTALION_ADMIN, COMPANY_ADMIN, and BATTALION_5 reference rows; no shared reference data is created');
    company = await ensure(Unit,`${tag}_UNIT`,{name:`${tag} Unit`,type:'COMPANY',parent_id:battalion.id,is_active:true});
    // Existing BATTALION_5 is only reused as a scope anchor; all test business data is tagged and isolated.
    category = await ensure(MaterialCategory,`${tag}_CAT`,{name:`${tag} category`,is_active:true});
    measure = await ensure(UnitOfMeasure,`${tag}_EA`,{name:'test unit',is_active:true});
    source = await ensure(MaterialSource,`${tag}_SRC`,{name:`${tag} source`,is_active:true});
    good = await ensure(ConditionLevel,`${tag}_GOOD`,{name:`${tag} good`,scope:'GENERAL',is_active:true});
    damaged = await ConditionLevel.findOne({where:{code:'DAMAGED',name:'Hỏng',scope:'GENERAL',is_active:true}});
    if(!damaged) throw new Error('Approved DAMAGED condition is absent/inactive; run the approved test-only seeder first');
    const password_hash = 'P10_TEST_ONLY_NOT_A_CREDENTIAL';
    rootUser = await User.create({username:`${tag}_ROOT`,password_hash,full_name:`${tag} Root`,role_id:battalionRole.id,unit_id:battalion.id,is_active:true});
    companyUser = await User.create({username:`${tag}_COMPANY`,password_hash,full_name:`${tag} Company`,role_id:companyRole.id,unit_id:company.id,is_active:true});
    location = await Location.create({code:`${tag}_LOC`,name:`${tag} location`,type:'STORE',owner_unit_id:company.id,is_stock_holding:true,is_active:true});
    material = await Material.create({code:`${tag}_MAT`,name:`${tag} material`,category_id:category.id,unit_id:measure.id,is_active:true});
    const service = require('../src/services/damage-loss.service');
    const userShape = async u => ({...u.get({plain:true}),role:await Role.findByPk(u.role_id),unit:await Unit.findByPk(u.unit_id)});
    const root = await userShape(rootUser), companyAdmin = await userShape(companyUser);
    const addLedger = (condition_id,delta,ref) => StockLedgerEntry.create({material_id:material.id,unit_id:company.id,location_id:location.id,source_id:source.id,condition_id,transaction_type:'P10_FIXTURE',quantity_delta:delta,reference_type:'P10_TEST',reference_id:1,occurred_at:new Date(),created_by:rootUser.id});
    const setBalance = async (condition,qty) => {const [rows]=await sequelize.query('SELECT COALESCE(SUM(quantity_delta),0) q FROM stock_ledger_entries WHERE material_id=:m AND unit_id=:u AND location_id=:l AND source_id=:s AND condition_id=:c AND borrow_line_id IS NULL',{replacements:{m:material.id,u:company.id,l:location.id,s:source.id,c:condition},type:QueryTypes.SELECT});const diff=BigInt(qty)-BigInt(rows.q);if(diff)await addLedger(condition,diff,`set ${qty}`)};
    const sqlSnapshot = async () => {const [rows]=await sequelize.query(`SELECT e.material_id,e.unit_id,e.location_id,e.source_id,e.condition_id,mu.code AS unit_code,mu.name AS unit_name,CAST(SUM(e.quantity_delta) AS CHAR) quantity FROM stock_ledger_entries e JOIN materials m ON m.id=e.material_id JOIN units_of_measure mu ON mu.id=m.unit_id WHERE e.material_id=:m AND e.unit_id=:u AND e.location_id=:l AND e.source_id=:s AND e.borrow_line_id IS NULL GROUP BY e.material_id,e.unit_id,e.location_id,e.source_id,e.condition_id,mu.code,mu.name HAVING SUM(e.quantity_delta)<>0 ORDER BY e.condition_id`,{replacements:{m:material.id,u:company.id,l:location.id,s:source.id},type:QueryTypes.SELECT});return rows};
    const report = async (type,qty,cond=good.id,borrow_line_id=null) => {const r=await service.save(null,{incident_type:type,unit_id:String(company.id),discovered_on:'2026-01-01',description:`${tag} fixture`,note:'',items:[{material_id:String(material.id),location_id:String(location.id),source_id:String(source.id),condition_id:cond?String(cond):null,borrow_line_id:borrow_line_id?String(borrow_line_id):null,quantity:qty}]},companyAdmin);return r};
    const totalSQL=rows=>rows.reduce((s,x)=>s+BigInt(x.quantity),0n);
    const tests=[];const test=async(name,fn)=>{try{await fn();tests.push([name,'PASS']);console.log('PASS',name)}catch(e){tests.push([name,'FAIL']);console.error('FAIL',name,e.message)}};

    await test('create + submit do not alter physical stock',async()=>{await setBalance(good.id,20);const before=await sqlSnapshot();const r=await report('DAMAGE',3);await service.transition(r.id,'SUBMIT',companyAdmin);assert.deepEqual(await sqlSnapshot(),before)});
    await test('DAMAGE writes exact OUT/IN and preserves physical total; independent SQL by full dimensions/unit',async()=>{await setBalance(good.id,20);const before=await sqlSnapshot();const r=await report('DAMAGE',3);await service.transition(r.id,'SUBMIT',companyAdmin);await service.transition(r.id,'COMPLETE',root);const after=await sqlSnapshot();const total=x=>x.reduce((s,a)=>s+BigInt(a.quantity),0n);assert.equal(total(after),total(before));const [ledger]=await sequelize.query("SELECT transaction_type,quantity_delta,material_id,unit_id,location_id,source_id,condition_id FROM stock_ledger_entries WHERE reference_type='DAMAGE_LOSS' AND reference_id=:id AND material_id=:m AND unit_id=:u AND location_id=:l AND source_id=:s ORDER BY id",{replacements:{id:r.id,m:material.id,u:company.id,l:location.id,s:source.id},type:QueryTypes.SELECT});assert.equal(ledger.length,2);assert.deepEqual(ledger.map(x=>[x.transaction_type,Number(x.quantity_delta)]),[['DAMAGE_CONDITION_OUT',-3],['DAMAGE_CONDITION_IN',3]]);assert(ledger.some(x=>String(x.condition_id)===String(good.id)));assert(ledger.some(x=>String(x.condition_id)===String(damaged.id)));assert(after.every(x=>x.unit_code===measure.code&&x.unit_name===measure.name))});
    await test('LOSS does not require DAMAGED and records exact decrease',async()=>{await setBalance(good.id,20);const before=await sqlSnapshot();const r=await report('LOSS',4);await service.transition(r.id,'SUBMIT',companyAdmin);await service.transition(r.id,'COMPLETE',root);const after=await sqlSnapshot();assert.equal(totalSQL(after),totalSQL(before)-4n);const [out]=await sequelize.query("SELECT COUNT(*) n, SUM(quantity_delta) delta FROM stock_ledger_entries WHERE reference_type='DAMAGE_LOSS' AND reference_id=:id AND transaction_type='DAMAGE_LOSS_OUT' AND material_id=:m AND unit_id=:u AND location_id=:l AND source_id=:s AND condition_id=:c",{replacements:{id:r.id,m:material.id,u:company.id,l:location.id,s:source.id,c:good.id},type:QueryTypes.SELECT});assert.equal(Number(out.n),1);assert.equal(BigInt(out.delta),-4n)});
    await test('repeat completion rejected without duplicate ledger',async()=>{const r=await report('LOSS',1);await service.transition(r.id,'SUBMIT',companyAdmin);await service.transition(r.id,'COMPLETE',root);const before=await StockLedgerEntry.count({where:{reference_type:'DAMAGE_LOSS',reference_id:r.id}});await assert.rejects(service.transition(r.id,'COMPLETE',root));assert.equal(await StockLedgerEntry.count({where:{reference_type:'DAMAGE_LOSS',reference_id:r.id}}),before)});
    await test('insufficient stock rejected without ledger/status change',async()=>{await setBalance(good.id,20);const r=await report('LOSS',5);await setBalance(good.id,2);await service.transition(r.id,'SUBMIT',companyAdmin);await assert.rejects(service.transition(r.id,'COMPLETE',root));assert.equal((await DamageLossReport.findByPk(r.id)).status,'SUBMITTED');assert.equal(await StockLedgerEntry.count({where:{reference_type:'DAMAGE_LOSS',reference_id:r.id}}),0)});
    await test('COMPANY_ADMIN cannot complete',async()=>{const r=await report('LOSS',1);await service.transition(r.id,'SUBMIT',companyAdmin);await assert.rejects(service.transition(r.id,'COMPLETE',companyAdmin));assert.equal((await DamageLossReport.findByPk(r.id)).status,'SUBMITTED')});
    await test('borrowed item blocked',async()=>{const request=await BorrowRequest.create({code:`${tag}_BORROW`,company_unit_id:company.id,due_date:'2026-12-31',status:'DELIVERED',created_by:companyUser.id});const line=await BorrowLine.create({request_id:request.id,material_id:material.id,source_id:source.id,condition_id:good.id,quantity:2});await StockLedgerEntry.create({material_id:material.id,unit_id:company.id,location_id:location.id,source_id:source.id,condition_id:good.id,borrow_line_id:line.id,transaction_type:'P10_BORROW_FIXTURE',quantity_delta:2,reference_type:'P10_TEST',reference_id:1,occurred_at:new Date(),created_by:rootUser.id});const r=await report('LOSS',1,good.id,line.id);await service.transition(r.id,'SUBMIT',companyAdmin);await assert.rejects(service.transition(r.id,'COMPLETE',root));assert.equal((await DamageLossReport.findByPk(r.id)).status,'SUBMITTED')});
    await test('transaction failure rolls back ledger and status',async()=>{const r=await report('DAMAGE',1);await service.transition(r.id,'SUBMIT',companyAdmin);const original=StockLedgerEntry.create;let n=0;StockLedgerEntry.create=async(...args)=>{if(++n===2)throw new Error('P10 injected failure');return original.apply(StockLedgerEntry,args)};try{await assert.rejects(service.transition(r.id,'COMPLETE',root),/P10 injected failure/)}finally{StockLedgerEntry.create=original}assert.equal((await DamageLossReport.findByPk(r.id)).status,'SUBMITTED');assert.equal(await StockLedgerEntry.count({where:{reference_type:'DAMAGE_LOSS',reference_id:r.id}}),0)});
    await test('concurrent confirmations serialize; exactly one succeeds and one ledger pair',async()=>{const r=await report('DAMAGE',1);await service.transition(r.id,'SUBMIT',companyAdmin);const timer=setTimeout(()=>{console.error('Concurrency test exceeded 30s; terminating test process so MySQL releases/rolls back open transactions');process.exit(2)},30000);timer.unref();let results;try{results=await Promise.allSettled([service.transition(r.id,'COMPLETE',root),service.transition(r.id,'COMPLETE',root)])}finally{clearTimeout(timer)}assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);assert.equal(await StockLedgerEntry.count({where:{reference_type:'DAMAGE_LOSS',reference_id:r.id}}),2)});
    console.log(`SUMMARY ${tests.filter(x=>x[1]==='PASS').length}/${tests.length} PASS`);
    if(tests.some(x=>x[1]==='FAIL'))process.exitCode=1;
  } finally {
    // Intentionally retain tagged P10TEST fixtures and ledger evidence for SQL audit; no destructive cleanup.
    clearTimeout(hardStop);
    await sequelize.close();
  }
}
main().catch(e=>{console.error('P10 harness refused/failed:',e.message);process.exitCode=1});
