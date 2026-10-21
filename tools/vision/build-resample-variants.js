'use strict';
// Calibration only. These captures are training data, never holdout evidence.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Pixels}=require('../../src/vision/pixels');
const sourceRoot=path.join(__dirname,'../../tests/fixtures/zoom175');
const sources={};
function frame(name){const b=fs.readFileSync(path.join(sourceRoot,name+'.png'));sources[name]=crypto.createHash('sha256').update(b).digest('hex');return Pixels.decode(b).normalize();}
const result={version:1,provenance:{source:'live capture 2026-09-22',rawSize:[2097,1258],canonicalSize:[1200,720],resample:'area',training:true,sources},sort:[],borrow:{},pageDigits:[]};
for(const [mode,file,template,threshold] of [['level','picker-sort4','org_sort_level',190],['new','picker-new','org_sort_new',190]]){
  const t=require('../../data/'+template+'.json'),im=frame(file).crop(t.box,...t.size),mask=[];
  for(let y=0;y<im.height;y++)mask.push(Array.from({length:im.width},(_,x)=>Math.min(...im.rgb(x,y))>threshold?'1':'0').join(''));
  result.sort.push({mode,box:t.box,size:t.size,threshold,mask});
}
const borrow=require('../../data/equip_borrow.json');
for(const [key,files] of [['stock',['equippicker-p1']],['others',['equippicker-others']],['sort',['equippicker-p1','equippicker-others']]]){
  const t=borrow[key];result.borrow[key]=files.map(file=>{const tile=frame(file).crop(t.box,...t.size);return {box:t.box,size:t.size,rgb:[...tile.data].filter((_,i)=>i%4!==3)};});
}
// Selected cyan page 5, using the same ink and glyph sizing as pageread.
const cyan=([r,g,b])=>g>150&&g-r>50&&b>120;
const ink=p=>Math.max(...p)<165||cyan(p)||(p[1]>140&&p[1]-p[0]>40&&p[1]-p[2]>40);
const region=frame('picker-p2').crop([949,660,997,695]);
const xs=[],ys=[];
for(let x=0;x<48;x++)if(Array.from({length:35},(_,y)=>ink(region.rgb(x,y))).some(Boolean))xs.push(x);
for(let y=0;y<35;y++)if(xs.some(x=>ink(region.rgb(x,y))))ys.push(y);
if(!xs.length||!ys.length||xs.at(-1)-xs[0]+1!==xs.length)throw Error('Unexpected page-5 calibration bounds');
const w=xs.length,h=ys.at(-1)-ys[0]+1;
result.pageDigits.push({digit:5,mask:Array.from({length:448},(_,i)=>Number(ink(region.rgb(xs[0]+Math.min(w-1,Math.floor((i%16+.5)*w/16)),ys[0]+Math.min(h-1,Math.floor((Math.floor(i/16)+.5)*h/28))))))});
// Preserve per-scale category variants merged in by merge-category-variants.js.
const previous=path.join(__dirname,'../../data/resample_variants.json');
if(fs.existsSync(previous)){const prior=JSON.parse(fs.readFileSync(previous,'utf8'));if(prior.categories)result.categories=prior.categories;}
fs.writeFileSync(path.join(__dirname,'../../data/resample_variants.json'),JSON.stringify(result));
console.log('Wrote resample variants with source hashes; thresholds unchanged.');
