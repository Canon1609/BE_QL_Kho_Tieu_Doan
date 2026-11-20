'use strict';
// Opt-in integration test. Guard must execute before importing application models.
const verifyTestWriter = require('./test-db-guard');
const assert = require('node:assert/strict');
const { sequelize, LossFollowupEvent, LossFollowup, DamageLossReport, User, StockLedgerEntry } = require('../src/models');
const service = require('../src/services/loss-followup.service');

(async () => {
  try {
    await verifyTestWriter(sequelize);
    const [reports] = await sequelize.query("SELECT r.id,r.unit_id,f.id followup_id FROM damage_loss_reports r LEFT JOIN loss_followups f ON f.report_id=r.id WHERE r.incident_type='LOSS' AND r.status='COMPLETED' ORDER BY r.id LIMIT 1");
    if (!reports.length) throw new Error('Test database needs a pre-provisioned COMPLETED LOSS fixture and followup; this script does not create reports or run migrations');
    const report=reports[0];
    const [users] = await sequelize.query("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.unit_id=:unit AND u.is_active=1 AND r.code='COMPANY_ADMIN' ORDER BY u.id LIMIT 1",{replacements:{unit:report.unit_id}});
    if (!users.length) throw new Error('Test database needs an active COMPANY_ADMIN fixture in the report unit');
    const user=await User.findByPk(users[0].id,{include:['role','unit']});
    const beforeLedger=await StockLedgerEntry.count();
    const inputs=[
      {responsibility_status:'VERIFYING',responsible_user_id:String(user.id),conclusion:'Đang xác minh',notes:'Đang kiểm tra số lượng'},
      {responsibility_status:'CONCLUDED',responsible_user_id:String(user.id),conclusion:'Mất 10 bộ quân phục nữ',notes:'Đã đối chiếu thông tin'},
      {responsibility_status:'RESOLVED',responsible_user_id:String(user.id),conclusion:'Mất 10 bộ quân phục nữ',notes:'Đã hoàn tất xử lý hồ sơ'},
    ];
    const created=[];
    for (const input of inputs) {
      const result=await service.update(String(report.id),input,user);
      assert.ok(result.events.some(e=>e.event_type==='FOLLOWUP_UPDATED'&&e.payload?.snapshot?.notes===input.notes));
      const event=result.events.find(e=>e.event_type==='FOLLOWUP_UPDATED');created.push(event.id);
    }
    const [rows]=await sequelize.query('SELECT id,payload FROM loss_followup_events WHERE id IN (:ids) ORDER BY id',{replacements:{ids:created}});
    assert.equal(rows.length,3);
    for(let i=0;i<3;i++)assert.deepEqual(rows.find(x=>String(x.id)===String(created[i])).payload.snapshot,{
      responsibility_status:inputs[i].responsibility_status,responsible_user_id:String(user.id),responsible_name:user.full_name,conclusion:inputs[i].conclusion,notes:inputs[i].notes,
    });
    const get=await service.get(String(report.id),user);
    for(let i=0;i<3;i++)assert.deepEqual(get.events.find(e=>String(e.id)===String(created[i])).payload.snapshot,rows.find(x=>String(x.id)===String(created[i])).payload.snapshot);
    assert.equal(await StockLedgerEntry.count(),beforeLedger,'Saving follow-up must not post ledger entries');
    // Rollback proof: a transactional event insert failure must leave follow-up unchanged.
    const followup=await LossFollowup.findOne({where:{report_id:report.id}});const old=followup.toJSON();
    const originalCreate=LossFollowupEvent.create;LossFollowupEvent.create=async()=>{throw new Error('injected event insert failure')};
    try { await assert.rejects(service.update(String(report.id),{...inputs[2],notes:'must rollback'},user),/injected event insert failure/); }
    finally { LossFollowupEvent.create=originalCreate; }
    await followup.reload();assert.equal(followup.notes,old.notes);assert.equal(followup.conclusion,old.conclusion);
    const [newRows]=await sequelize.query('SELECT id FROM loss_followup_events WHERE id IN (:ids)',{replacements:{ids:created}});assert.equal(newRows.length,3);
    console.log('PASS test DB: three database writes, SELECT snapshots, GET replay, event failure rollback, no ledger delta',JSON.stringify({report_id:report.id,event_ids:created}));
  } finally { await sequelize.close(); }
})().catch(error=>{console.error('BLOCKED/FAIL test-loss-followup-snapshots:',error.message);process.exitCode=1});
