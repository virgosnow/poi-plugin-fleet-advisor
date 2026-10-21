'use strict';
// File-only portion of the local updater. No npm, lifecycle or game calls.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function inside(root,name) {
  const dest=path.resolve(root,name),rel=path.relative(root,dest);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('Path escapes package: '+name);
  // Refuse symlinks in either source or destination, including parent folders.
  let at=root;
  for(const part of rel.split(path.sep)) {
    at=path.join(at,part);
    if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())throw Error('Linked package entry: '+name);
  }
  return dest;
}
function prepare(sourceRoot,installedRoot) {
  const source=fs.realpathSync(sourceRoot),installed=fs.realpathSync(installedRoot);
  if(source===installed)throw Error('Source and installed package must differ');
  const pkg=JSON.parse(fs.readFileSync(inside(source,'package.json'),'utf8'));
  const old=JSON.parse(fs.readFileSync(inside(installed,'package.json'),'utf8'));
  if(pkg.name!=='poi-plugin-fleet-advisor'||old.name!==pkg.name)throw Error('Only poi-plugin-fleet-advisor is supported');
  if(pkg.type==='module'||(pkg.main||'index.js')!==(old.main||'index.js'))throw Error('Entry/module type changes require a full install');
  for(const key of ['dependencies','optionalDependencies','peerDependencies','type']) {
    if(JSON.stringify(pkg[key]||{})!==JSON.stringify(old[key]||{}))throw Error('Dependency/module contract changed: '+key);
  }
  if(!Array.isArray(pkg.files))throw Error('Missing package file manifest');
  const names=new Set(['package.json']);
  function walk(name) {
    // Match the distribution's development-map exclusion during hot updates.
    if(path.basename(name)==='.npmignore'||/^data[\\/]sortie[\\/]maps[\\/]\d+-\d+\.png$/.test(name))return;
    if(name.split(/[\\/]/).some(x=>['node_modules','logs','.git'].includes(x)))throw Error('Non-runtime directory in manifest');
    const target=inside(source,name);
    if(fs.statSync(target).isDirectory())for(const child of fs.readdirSync(target))walk(path.join(name,child));
    else names.add(name);
  }
  pkg.files.forEach(walk);
  if(!names.has(pkg.main||'index.js'))throw Error('Entry missing from file manifest');
  const files=[...names].sort().map(name=>{
    const from=inside(source,name),to=inside(installed,name),data=fs.readFileSync(from);
    const before=fs.existsSync(to)?fs.readFileSync(to):null;
    if(name.endsWith('.json'))JSON.parse(data.toString('utf8'));
    if(name.endsWith('.js'))new (require('vm').Script)(data.toString('utf8'),{filename:name});
    return {name,sha256:hash(data),beforeHash:before?hash(before):null,data:data.toString('base64'),before:before?.toString('base64')??null};
  });
  return {source,installed,files};
}
function apply(snapshot) {
  snapshot.written=[];
  // Detect changes between preparation and disabling the plugin before writes.
  for(const f of snapshot.files) {
    const dest=inside(snapshot.installed,f.name),actual=fs.existsSync(dest)?hash(fs.readFileSync(dest)):null;
    if(actual!==f.beforeHash)throw Error('Installed file changed during preparation: '+f.name);
  }
  for(const f of snapshot.files) {
    const dest=inside(snapshot.installed,f.name);
    snapshot.written.push(f.name);
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,Buffer.from(f.data,'base64'));
    if(hash(fs.readFileSync(dest))!==f.sha256)throw Error('Copy verification failed: '+f.name);
  }
}
function restore(snapshot) {
  for(const f of snapshot.files) {
    if(!snapshot.written?.includes(f.name))continue;
    const dest=inside(snapshot.installed,f.name);
    if(f.before===null){if(fs.existsSync(dest))fs.unlinkSync(dest);}
    else {fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,Buffer.from(f.before,'base64'));}
  }
}
module.exports={prepare,apply,restore};
