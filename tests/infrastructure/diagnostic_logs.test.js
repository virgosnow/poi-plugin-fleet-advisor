'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DiagnosticLogs}=require('../../src/infrastructure/cache/diagnostic_logs');
const {PerformanceLogs}=require('../../src/infrastructure/cache/performance_logs');
const {inspectCache,maintainCache}=require('../../src/infrastructure/cache/recommendation_cache');

function fixture(t){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-diagnostics-'));
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const root=path.join(parent,'cache'),legacy=path.join(parent,'old');fs.mkdirSync(legacy);
  return {root,legacy,logs:new DiagnosticLogs(root)};
}
test('all log types share cache accounting and clearing without removing unrelated files',async t=>{
  const f=fixture(t),run=f.logs.write('run',{status:'ok'}),job=f.logs.write('job',{records:[{stage:'test'}]});
  assert(run&&job);assert(f.logs.sync('started','started'));assert(f.logs.sync('identity_verified','verified'));
  assert((await new PerformanceLogs(f.root).write({level:'stages'})).saved);
  const foreign=path.join(f.logs.directory,'notes.json');fs.writeFileSync(foreign,'keep');
  assert.equal((await inspectCache(f.root)).logs.files,4);
  const sync=fs.readdirSync(f.logs.directory).find(name=>name.startsWith('sync-'));
  assert.equal(fs.readFileSync(path.join(f.logs.directory,sync),'utf8').trim().split('\n').length,2);
  await maintainCache(f.root,{clear:'logs'});assert.equal((await inspectCache(f.root)).logs.files,0);
  assert.equal(fs.readFileSync(foreign,'utf8'),'keep');
  assert(f.logs.sync('identity_verified','new event'));
  const fresh=fs.readFileSync(path.join(f.logs.directory,sync),'utf8');assert(!fresh.includes('started'));
});
test('legacy run logs move once and unrecognized files stay in place',async t=>{
  const f=fixture(t),old='run-2026-11-07T12-34-56-789Z.json';
  fs.writeFileSync(path.join(f.legacy,old),'legacy');fs.writeFileSync(path.join(f.legacy,'notes.json'),'keep');
  f.logs.migrateRuns(f.legacy);f.logs.migrateRuns(f.legacy);
  const files=await inspectCache(f.root);assert.equal(files.logs.files,1);
  assert.equal(fs.readFileSync(path.join(f.logs.directory,fs.readdirSync(f.logs.directory)[0]),'utf8'),'legacy');
  assert.deepEqual(fs.readdirSync(f.legacy),['notes.json']);
});
test('failed migration leaves old files intact and linked directories are rejected',t=>{
  const f=fixture(t),old='run-2026-11-07T12-34-56-789Z.json';
  fs.writeFileSync(path.join(f.legacy,old),'legacy');f.logs.getLimitBytes=()=>0;f.logs.migrateRuns(f.legacy);
  assert(fs.existsSync(path.join(f.legacy,old)));
  const other=fixture(t),outside=path.join(other.legacy,'outside');fs.mkdirSync(outside);
  fs.mkdirSync(other.root);fs.symlinkSync(outside,other.logs.directory,'junction');
  assert.equal(other.logs.write('run',{status:'test'}),null);assert.equal(other.logs.sync('started','test'),false);
  assert.deepEqual(fs.readdirSync(outside),[]);
});
