'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'src');
function scripts(directory){return fs.readdirSync(directory,{recursive:true}).filter(name=>name.endsWith('.js')).map(name=>path.join(directory,name));}
function imports(file){
  return [...fs.readFileSync(file,'utf8').matchAll(/(?<![.\w])require\(['"](\.[^'"]+)['"]\)/g)].map(match=>{
    const resolved=path.resolve(path.dirname(file),match[1]);
    return path.extname(resolved)?resolved:fs.existsSync(resolved+'.js')?resolved+'.js':path.join(resolved,'index.js');
  });
}
test('runtime imports resolve and domain rules remain independent of execution, UI and application services',()=>{
  for(const file of scripts(source))for(const target of imports(file)){
    assert(fs.existsSync(target),path.relative(root,file)+' -> '+target);
    if(file.startsWith(path.join(source,'domain')+path.sep)&&target.startsWith(source+path.sep)){
      const layer=path.relative(source,target).split(path.sep)[0];
      assert(['domain','shared','config'].includes(layer),path.relative(root,file)+' imports '+layer);
    }
  }
});
test('recommendation responsibilities have no circular dependency between the six search modules',()=>{
  const names=['context','scoring','fitting','strategies','normal','expedition'];
  const files=new Set(names.map(name=>path.join(source,'recommendation',name+'.js'))),complete=new Set();
  function visit(file,active=new Set()){
    if(complete.has(file))return;
    assert(!active.has(file),'Circular recommendation dependency: '+file);
    const next=new Set([...active,file]);
    for(const target of imports(file))if(files.has(target))visit(target,next);
    complete.add(file);
  }
  for(const file of files)visit(file);
  const api=require('../../src/recommendation');
  assert.deepEqual(Object.keys(api).sort(),['airLoadout','recommendExpeditionEquipment','recommendExpeditionFleet','recommendExpeditionGoals','recommendNormalEquipment','recommendNormalFleet','recommendNormalFleetParallel','recommendationBatch','routeAirReference'].sort());
});
