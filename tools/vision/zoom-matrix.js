'use strict';
// node tools/vision/zoom-matrix.js <captureDir> [--method area|bilinear]
// --expectations <json> supplies manually verified labels for old legs.
const fs=require('fs'),path=require('path');
const {Pixels}=require('../../src/vision/pixels');
const V=require('../../src/vision/observers');
const {readNumber}=require('../../src/vision/numbers');
const {resampleArea,resampleBilinear}=require('./resample');
function matches(actual,expected){
  if(expected===null||typeof expected!=='object')return actual===expected;
  if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>matches(actual[i],v));
  return actual!==null&&typeof actual==='object'&&Object.entries(expected).every(([k,v])=>matches(actual[k],v));
}
async function judge(im,check,observer=new V.Observer()){
  if(!check.expected||typeof check.expected.valid!=='boolean')throw Error('Check needs an explicit expected.valid label');
  const actual=check.kind==='sortread'?await V.sortread(im):check.kind==='level'?readNumber(im,check.box):await observer.observe(check.kind,im,check.arg||{});
  return {status:matches(actual,check.expected)?'PASS':'FAIL',kind:check.kind,expected:check.expected,actual};
}
function fileInside(dir,relative){
  if(typeof relative!=='string')throw Error('Capture filename missing');
  const root=path.resolve(dir),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))throw Error('Capture path escapes leg');
  return file;
}
async function runMatrix(dir,{method=null,expectations={}}={}){
  if(method!==null&&!['area','bilinear'].includes(method))throw Error('Unsupported resample method');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'env.json'),'utf8'));
  if(!manifest.captures||typeof manifest.captures!=='object')throw Error('Capture manifest missing');
  const report={dir,method:method||'collector',env:manifest.env,collectionOk:manifest.ok??null,collectionError:manifest.error??null,results:[]};
  for(const [name,capture] of Object.entries(manifest.captures)){
    const checks=expectations[name]||capture.checks;
    if(!Array.isArray(checks)||!checks.length){report.results.push({name,status:'UNLABELED'});continue;}
    let im;
    try{
      const file=fileInside(dir,method?capture.raw:capture.rs);
      if(!fs.existsSync(file)){report.results.push({name,status:'MISSING',file});continue;}
      im=Pixels.decode(fs.readFileSync(file));
      if(method)im=(method==='area'?resampleArea:resampleBilinear)(im,1200,720);
      im.normalize();
    }catch(error){report.results.push({name,status:'ERROR',error:error.message});continue;}
    for(const check of checks){
      try{report.results.push({name,...await judge(im,check)});}
      catch(error){report.results.push({name,kind:check.kind,status:'ERROR',error:error.message});}
    }
  }
  report.summary=Object.fromEntries(['PASS','FAIL','ERROR','MISSING','UNLABELED'].map(status=>[status,report.results.filter(r=>r.status===status).length]));
  report.ok=manifest.ok!==false&&report.results.length>0&&report.summary.PASS>0&&Object.entries(report.summary).every(([key,n])=>key==='PASS'||n===0);
  return report;
}
if(require.main===module){
  const args=process.argv.slice(2),value=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
  const labels=value('--expectations');
  runMatrix(args[0],{method:value('--method')||null,expectations:labels?JSON.parse(fs.readFileSync(labels,'utf8')):{}})
    .then(report=>{console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;},error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={runMatrix,judge,matches,fileInside};
