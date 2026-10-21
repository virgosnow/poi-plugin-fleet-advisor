'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const F=require('../../tools/dev/live-update-files');
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poi-update-test-')),source=path.join(root,'source'),installed=path.join(root,'installed');
  const pkg={name:'poi-plugin-fleet-advisor',main:'index.js',files:['index.js','data/'],dependencies:{pngjs:'7.0.0'}};
  for(const dir of [source,installed]){fs.mkdirSync(path.join(dir,'data'),{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg));fs.writeFileSync(path.join(dir,'index.js'),'module.exports={version:1};');}
  fs.writeFileSync(path.join(source,'index.js'),'module.exports={version:2};');fs.writeFileSync(path.join(source,'data/new.json'),'{"sample":true}');
  fs.mkdirSync(path.join(installed,'logs'));fs.writeFileSync(path.join(installed,'logs/keep.json'),'{}');
  return {root,source,installed,pkg};
}
test('full runtime manifest includes new assets and metadata, verifies copies and rolls back exact files',()=>{
  const f=fixture(),s=F.prepare(f.source,f.installed);
  assert.equal(s.files.length,3);F.apply(s);
  assert.match(fs.readFileSync(path.join(f.installed,'index.js'),'utf8'),/version:2/);
  assert(fs.existsSync(path.join(f.installed,'data/new.json')));F.restore(s);
  assert.match(fs.readFileSync(path.join(f.installed,'index.js'),'utf8'),/version:1/);
  assert(!fs.existsSync(path.join(f.installed,'data/new.json')));assert(fs.existsSync(path.join(f.installed,'logs/keep.json')));
});
test('dependency upgrades refuse before writes',()=>{
  const f=fixture();f.pkg.dependencies.pngjs='8.0.0';fs.writeFileSync(path.join(f.source,'package.json'),JSON.stringify(f.pkg));
  assert.throws(()=>F.prepare(f.source,f.installed),/contract changed/);assert.match(fs.readFileSync(path.join(f.installed,'index.js'),'utf8'),/version:1/);
});
test('invalid JS and JSON refuse before stopping the plugin',()=>{
  for(const [name,value] of [['index.js','const x=;'],['data/new.json','{bad}']]){const f=fixture();fs.writeFileSync(path.join(f.source,name),value);assert.throws(()=>F.prepare(f.source,f.installed));}
});
test('out of tree manifests and application data are refused',()=>{
  for(const name of ['../secret.js','logs/','node_modules/']){const f=fixture();f.pkg.files.push(name);fs.writeFileSync(path.join(f.source,'package.json'),JSON.stringify(f.pkg));assert.throws(()=>F.prepare(f.source,f.installed),/escapes|Non-runtime/);}
});
test('file drift aborts before copying and rollback does not overwrite the new external edit',()=>{
  const f=fixture(),s=F.prepare(f.source,f.installed);fs.writeFileSync(path.join(f.installed,'index.js'),'external edit');
  assert.throws(()=>F.apply(s),/changed during preparation/);F.restore(s);assert.equal(fs.readFileSync(path.join(f.installed,'index.js'),'utf8'),'external edit');assert.deepEqual(s.written,[]);
});

test('hot updates exclude development sea-map PNGs but retain metadata and common symbols',()=>{
  const f=fixture(),maps=path.join(f.source,'data/sortie/maps');fs.mkdirSync(maps,{recursive:true});
  for(const name of ['1-1.png','5-6.png','map_common.png','index.json','.npmignore'])
    fs.writeFileSync(path.join(maps,name),name.endsWith('.json')?'{}':'reference');
  const s=F.prepare(f.source,f.installed),names=s.files.map(v=>v.name.replace(/\\/g,'/'));
  assert(names.includes('data/sortie/maps/index.json'));assert(names.includes('data/sortie/maps/map_common.png'));
  assert(!names.some(n=>n.endsWith('/1-1.png')||n.endsWith('/5-6.png')||n.endsWith('/.npmignore')));
});
