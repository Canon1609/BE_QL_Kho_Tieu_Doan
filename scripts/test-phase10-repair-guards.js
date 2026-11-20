'use strict';
const assert=require('node:assert/strict');
const migration=require('../migrations/20261102000100-create-damage-repair');
const service=require('../src/services/damage-repair.service');
(async()=>{assert.equal(typeof migration.up,'function');assert.equal(typeof migration.down,'function');assert.deepEqual(Object.keys(service).sort(),['createAllocation','get','mutate','open']);await assert.rejects(migration.down(),/Non-destructive migration/);const controller=require('../src/controllers/damage-repair.controller');for(const action of ['allocate','action'])assert.equal(typeof controller[action],'function');const routes=require('../src/routes/damage-repair.routes');assert.ok(routes);console.log('PASS: repair migration/service/controller/routes load; rollback fails closed; no DB connection')})().catch(e=>{console.error(e);process.exit(1)});
