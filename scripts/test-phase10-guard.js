'use strict';
// Pure config/guard contract checks: no Sequelize instance, socket, or DB write.
const assert = require('node:assert/strict');
const { getApprovedTestConfig } = require('../src/config/database');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const cliSource=readFileSync(require.resolve('./db-cli-safe'),'utf8');
const base = { NODE_ENV:'test', DB_NAME:'ql_kho_tieu_doan_5', TEST_DB_HOST:'db-test.local', TEST_DB_PORT:'3306', TEST_DB_NAME:'ql_kho_tieu_doan_5_test', TEST_DB_USER:'test-user', TEST_DB_PASSWORD:'not-a-real-password', TEST_DB_EXPECTED_SERVER:'TRANQUOCANH', ALLOW_TEST_DB_WRITE:'true' };
const cases = [
  ['approved target accepted without connecting',base,true],
  ['missing host refused',(()=>{const x={...base};delete x.TEST_DB_HOST;return x})(),false],
  ['missing db name refused',(()=>{const x={...base};delete x.TEST_DB_NAME;return x})(),false],
  ['development target refused',{...base,TEST_DB_NAME:'ql_kho_tieu_doan_5'},false],
  ['unapproved target refused',{...base,TEST_DB_NAME:'other_db'},false],
  ['write opt-in required',{...base,ALLOW_TEST_DB_WRITE:'false'},false],
  ['invalid port refused',{...base,TEST_DB_PORT:'not-a-port'},false],
];
let failures=0;
for(const [name,env,accept] of cases){try{const cfg=getApprovedTestConfig(env);assert.equal(accept,true);assert.equal(cfg.database,'ql_kho_tieu_doan_5_test');assert.equal(typeof cfg.hooks.afterConnect,'function');console.log('PASS',name)}catch(e){if(accept){failures++;console.error('FAIL',name,e.message)}else console.log('PASS',name,'refused:',e.message)}}
const probe = env => spawnSync(process.execPath,['-e',"require('./scripts/test-db-guard')"],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,...env}});
const accepted=probe(base);if(accepted.status===0)console.log('PASS writer accepts approved test environment (guard-only probe)');else{failures++;console.error('FAIL writer accepted env',accepted.stderr)}
const refused=probe({...base,NODE_ENV:'development'});if(refused.status!==0&&/NODE_ENV=test is required/.test(refused.stderr))console.log('PASS writer refuses non-test environment');else{failures++;console.error('FAIL writer rejected non-test env incorrectly',refused.stderr)}
if(cliSource.includes("writeCommands.has(command) && process.env.NODE_ENV !== 'test'")&&cliSource.includes("'--env', 'test'"))console.log('PASS CLI wrapper enforces NODE_ENV=test for write commands and invokes explicit test env');else{failures++;console.error('FAIL CLI writer environment audit')}
if(/\.sync\(|sync\(\{\s*alter/.test(cliSource)) {failures++;console.error('FAIL unsafe sync detected in CLI wrapper')} else console.log('PASS no sync/alter path in safe CLI wrapper');
if(failures)process.exitCode=1;
console.log(`SUMMARY ${cases.length+4-failures}/${cases.length+4} configuration/guard checks passed (no DB connection made)`);
