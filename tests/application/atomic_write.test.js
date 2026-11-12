'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {atomicWriteSync}=require('../../src/infrastructure/persistence/atomic_write');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-advisor-atomic-'));
  t.after(()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,'mcp-state.json');fs.writeFileSync(file,'old');return {dir,file};
}
const locked=code=>Object.assign(new Error('simulated lock'),{code});
test('transient sharing violations retry the same atomic rename and leave no temporary file',t=>{
  const {dir,file}=fixture(t),io=Object.create(fs),waits=[];let attempts=0;
  io.renameSync=(from,to)=>{if(++attempts<4)throw locked(['EPERM','EACCES','EBUSY'][attempts-1]);return fs.renameSync(from,to);};
  atomicWriteSync(file,'new',{io,wait:ms=>waits.push(ms),uuid:()=> 'first'});
  assert.equal(fs.readFileSync(file,'utf8'),'new');assert.equal(attempts,4);assert.deepEqual(waits,[20,40,80]);
  assert.deepEqual(fs.readdirSync(dir),['mcp-state.json']);
});
test('persistent or nontransient errors preserve the old file and clean only this attempt',t=>{
  const {dir,file}=fixture(t),foreign=file+'.foreign.tmp';fs.writeFileSync(foreign,'untouched');
  for(const [code,expected] of [['EBUSY',6],['ENOSPC',1]]){
    const io=Object.create(fs),waits=[];let attempts=0;
    io.renameSync=()=>{attempts++;throw locked(code);};
    assert.throws(()=>atomicWriteSync(file,'new',{io,wait:ms=>waits.push(ms),uuid:()=>code}),{code});
    assert.equal(attempts,expected);assert.equal(fs.readFileSync(file,'utf8'),'old');
    assert.equal(fs.readFileSync(foreign,'utf8'),'untouched');assert(!fs.existsSync(file+'.'+code+'.tmp'));
  }
});
test('a temp-name collision never truncates or removes another writer file',t=>{
  const {file}=fixture(t),foreign=file+'.same.tmp';fs.writeFileSync(foreign,'other writer');
  assert.throws(()=>atomicWriteSync(file,'new',{uuid:()=> 'same',wait:()=>{throw Error('must not retry collisions');}}),{code:'EEXIST'});
  assert.equal(fs.readFileSync(foreign,'utf8'),'other writer');assert.equal(fs.readFileSync(file,'utf8'),'old');
});
test('Electron renderers without SharedArrayBuffer still load and retry transient locks',t=>{
  const vm=require('node:vm'),{file}=fixture(t),module={exports:{}};let clock=0,attempts=0;
  const source=fs.readFileSync(require.resolve('../../src/infrastructure/persistence/atomic_write'),'utf8');
  const isolatedRequire=name=>name==='node:perf_hooks'?{performance:{now:()=>clock+=10}}:require(name);
  vm.runInNewContext(source,{module,require:isolatedRequire,SharedArrayBuffer:undefined});
  const io=Object.create(fs);io.renameSync=(from,to)=>{if(++attempts<3)throw locked('EPERM');fs.renameSync(from,to);};
  module.exports.atomicWriteSync(file,'new',{io,uuid:()=> 'renderer'});
  assert.equal(attempts,3);assert(clock>=60);assert.equal(fs.readFileSync(file,'utf8'),'new');
});
