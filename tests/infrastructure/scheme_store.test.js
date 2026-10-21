'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {Schemes}=require('../../src/infrastructure/persistence/scheme_store');

function cacheDirectory(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-scheme-cache-'));
  t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'paa-scheme-cache-'));fs.rmSync(dir,{recursive:true,force:true});});
  return dir;
}

test('scheme cache counts actual bytes including owned backups and staging, and clears only its files',async t=>{
  const dir=cacheDirectory(t),library=new Schemes(dir);
  assert.deepEqual(await library.inspectCache(),{count:0,files:0,bytes:0});
  await library.set({name:'临时方案',scheme:{fleet:1,ships:[1]}});
  const backup=library.file+'.corrupt-123',staging=library.file+'.12345678-1234-1234-1234-123456789abc.tmp';
  fs.writeFileSync(backup,'损坏资料');fs.writeFileSync(staging,'temporary');
  fs.writeFileSync(path.join(dir,'mcp-state.json'),'keep');fs.writeFileSync(library.file+'.notes','keep');
  const bytes=[library.file,backup,staging].reduce((sum,f)=>sum+fs.statSync(f).size,0);
  assert.deepEqual(await library.inspectCache(),{count:1,files:3,bytes});
  assert.deepEqual(await library.clearCache(),{removed:3,failed:0});
  assert.deepEqual(await library.inspectCache(),{count:0,files:0,bytes:0});
  assert.equal(new Schemes(dir).list().total,0);assert.throws(()=>library.get('临时方案'),e=>e.code==='SCHEME_NOT_FOUND');
  assert.deepEqual(fs.readdirSync(dir).sort(),['mcp-state.json','schemes.json.notes']);
});

test('scheme cache clear serializes between saves and preserves a later save',async t=>{
  const library=new Schemes(cacheDirectory(t)),scheme={fleet:1,ships:[1]};
  const first=library.set({name:'before',scheme}),clear=library.clearCache(),last=library.set({name:'after',scheme});
  await Promise.all([first,clear,last]);
  assert.deepEqual(library.list().items.map(s=>s.name),['after']);
  assert.deepEqual(new Schemes(path.dirname(library.file)).list(),library.list());
  assert.equal((await library.inspectCache()).count,1);
});

test('failed cache removal preserves committed memory and retries Windows sharing errors',async t=>{
  const library=new Schemes(cacheDirectory(t));await library.set({name:'retain',scheme:{fleet:1,ships:[1]}});
  const unlink=fs.promises.unlink.bind(fs.promises);let calls=0;
  const mocked=t.mock.method(fs.promises,'unlink',async file=>{
    if(file===library.file){calls++;throw Object.assign(Error('busy'),{code:'EBUSY'});}return unlink(file);
  });
  assert.deepEqual(await library.clearCache(),{removed:0,failed:1});assert.equal(calls,3);
  assert.equal(library.list().total,1);assert.equal(new Schemes(path.dirname(library.file)).list().total,1);
  mocked.mock.restore();assert.deepEqual(await library.clearCache(),{removed:1,failed:0});
});

test('clearing corrupt cache removes backups and allows new schemes',async t=>{
  const dir=cacheDirectory(t);fs.writeFileSync(path.join(dir,'schemes.json'),'{bad');
  const library=new Schemes(dir,()=>123);assert(library.storeError);
  assert.deepEqual(await library.inspectCache(),{count:0,files:1,bytes:4});
  await library.clearCache();assert.equal(library.storeError,null);
  await library.set({name:'new',scheme:{fleet:1,ships:[1]}});assert.equal(library.list().total,1);
});

test('scheme cache inspection and clearing reject linked directories without following them',async t=>{
  const dir=cacheDirectory(t),outside=cacheDirectory(t),link=path.join(dir,'link');
  const other=new Schemes(outside);await other.set({name:'outside',scheme:{fleet:1,ships:[1]}});
  fs.symlinkSync(outside,link,'junction');const library=new Schemes(link);
  assert((await library.inspectCache()).error);await assert.rejects(library.clearCache(),/不是普通目录/);
  assert.equal(new Schemes(outside).list().total,1);
});

test('transient replacement errors retry without blocking readers or publishing unsaved data',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-retry-'));
  try{
    const library=new Schemes(dir),old={fleet:1,ships:[1]},next={fleet:2,ships:[2]};
    await library.set({name:'任务',scheme:old});
    const rename=fs.promises.rename.bind(fs.promises);let attempts=0,timerRan=false;
    const mocked=t.mock.method(fs.promises,'rename',async(...args)=>{
      const code=['EPERM','EACCES','EBUSY'][attempts++];
      if(code)throw Object.assign(Error('injected lock'),{code});
      return rename(...args);
    });
    const saving=library.set({name:'任务',scheme:next,overwrite:true});
    next.ships[0]=99; // A queued operation owns a snapshot of its input.
    setTimeout(()=>{timerRan=true;},0);
    assert.deepEqual(library.get('任务').scheme,old);
    assert.deepEqual(new Schemes(dir).get('任务').scheme,old);
    await saving;
    assert.equal(timerRan,true);assert.equal(attempts,4);
    assert.deepEqual(library.get('任务').scheme,{fleet:2,ships:[2]});
    assert.deepEqual(new Schemes(dir).get('任务').scheme,library.get('任务').scheme);
    assert.deepEqual(fs.readdirSync(dir),['schemes.json']);mocked.mock.restore();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('exhausted retries preserve disk and memory for overwrite and deletion, then allow recovery',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-retry-limit-'));
  try{
    const library=new Schemes(dir),scheme={fleet:1,ships:[1]};
    await library.set({name:'保留',scheme});
    const original=fs.readFileSync(library.file,'utf8');let attempts=0;
    const mocked=t.mock.method(fs.promises,'rename',async()=>{attempts++;throw Object.assign(Error('locked'),{code:'EPERM'});});
    for(const operation of [()=>library.set({name:'保留',scheme:{fleet:2,ships:[2]},overwrite:true}),()=>library.remove('保留')]){
      await assert.rejects(operation,e=>e.code==='SCHEME_STORE_WRITE_FAILED'&&e.cause.code==='EPERM'&&/原配置未更改/.test(e.message));
      assert.equal(fs.readFileSync(library.file,'utf8'),original);assert.deepEqual(library.get('保留').scheme,scheme);
      assert.deepEqual(fs.readdirSync(dir),['schemes.json']);
    }
    assert.equal(attempts,12);mocked.mock.restore();
    await library.set({name:'恢复',scheme});assert.equal(new Schemes(dir).list().total,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('non-transient write and rename errors fail once and keep the existing library',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-write-fail-'));
  try{
    const library=new Schemes(dir);await library.set({name:'原配置',scheme:{fleet:1,ships:[1]}});
    const original=fs.readFileSync(library.file,'utf8');
    for(const [method,code] of [['writeFile','ENOSPC'],['rename','EIO']]){
      let attempts=0;
      const mocked=t.mock.method(fs.promises,method,async()=>{attempts++;throw Object.assign(Error('disk error'),{code});});
      await assert.rejects(library.set({name:'失败',scheme:{fleet:1,ships:[2]}}),e=>e.cause.code===code);
      assert.equal(attempts,1);assert.equal(library.list().total,1);
      assert.equal(fs.readFileSync(library.file,'utf8'),original);assert.deepEqual(fs.readdirSync(dir),['schemes.json']);
      mocked.mock.restore();
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('overlapping saves and deletions are ordered and a rejected duplicate does not poison the queue',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-write-queue-'));
  try{
    const library=new Schemes(dir),scheme={fleet:1,ships:[1]};
    const results=await Promise.allSettled([
      library.set({name:'A',scheme}),library.set({name:'A',scheme}),
      library.set({name:'B',scheme}),library.remove('A'),library.set({name:'C',scheme})
    ]);
    assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected','fulfilled','fulfilled','fulfilled']);
    assert.equal(results[1].reason.code,'SCHEME_NAME_EXISTS');
    assert.deepEqual(new Schemes(dir).list().items.map(x=>x.name),['B','C']);
    assert.deepEqual(fs.readdirSync(dir),['schemes.json']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('saved library search and paging can retrieve every record beyond the old 100-item cap',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-source-test-'));
  try{const library=new Schemes(dir),scheme={fleet:1,ships:[1]};
    for(let n=0;n<121;n++)await library.set({name:`配置${String(n).padStart(3,'0')}`,scheme});
    await library.set({name:'翔鶴任务',scheme});
    const first=library.list({limit:100}),last=library.list({limit:100,offset:100});
    assert.equal(first.total,122);assert.equal(new Set([...first.items,...last.items].map(s=>s.name)).size,122);
    assert.deepEqual(library.list({search:'翔鹤'}).items.map(s=>s.name),['翔鶴任务']);
    assert.equal(library.list({search:'配置12'}).total,1);
    assert.equal(library.list({name:'配置001'}).items[0].name,'配置001');
    assert.throws(()=>library.list({offset:-1}),/offset/);assert.throws(()=>library.list({search:3}),/search/);
    assert.equal(new Schemes(dir).list({offset:120,limit:20}).items.length,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
