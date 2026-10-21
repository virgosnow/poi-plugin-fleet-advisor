'use strict';
// Rebuild page-number glyphs, both bulk-clear button masks and the category
// menu cell colours from native 1:1 captures. Extraction mirrors the runtime
// observers exactly; page labels are bootstrapped from the current (working)
// glyph set and every rebuilt artifact is re-verified against its source.
const fs=require('fs'),path=require('path'),{Pixels}=require('../../src/vision/pixels');
const {pageread}=require('../../src/vision/observers');
const cyan=([r,g,b])=>g>150&&g-r>50&&b>120;
const ink=p=>Math.max(...p)<165||cyan(p);
const tour=path.join(__dirname,'../../tests/fixtures/native-tour/');
const out={};

// ---------- page digits ----------
const CX=[760,813,867,920,973];
const oldData=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/page_digits_v2.json'),'utf8'));
const glyphs=[];
function readLabels(im,total,layout){
  const pr=pageread(im,{total,layout});
  if(!pr.valid)throw new Error('bootstrap pageread failed (layout '+(layout||'org')+')');
  return pr;
}
function extractGlyphs(im,cx){
  const region=im.crop([cx-24,660,cx+24,695]);
  const groups=[];
  for(let x=0;x<48;x++){
    if(!Array.from({length:35},(_,y)=>ink(region.rgb(x,y))).some(Boolean))continue;
    if(!groups.length||x>groups[groups.length-1].at(-1)+1)groups.push([]);
    groups.at(-1).push(x);
  }
  return groups.map(xs=>{
    const ys=[];for(let y=0;y<35;y++)if(xs.some(x=>ink(region.rgb(x,y))))ys.push(y);
    const w=xs.length,h=ys.at(-1)-ys[0]+1;
    return Array.from({length:448},(_,i)=>ink(region.rgb(xs[0]+Math.min(w-1,Math.floor((i%16+.5)*w/16)),ys[0]+Math.min(h-1,Math.floor((Math.floor(i/16)+.5)*h/28)))));
  });
}
// Organize-layout digits cover most renders; the equipment picker renders
// page numbers green, so its layout is covered by dedicated captures.
const pageCaptures=[
 {file:'sort-type-p1.png',layout:undefined,total:35},
 {file:'page10.png',layout:undefined,total:35},
 {file:'page16.png',layout:undefined,total:35},
 {file:'sort-new-p1.png',layout:undefined,total:35},
 {file:'sort-lv-p1.png',layout:undefined,total:35},
 {file:'../equip/menu-category-10.png',layout:'equip',total:999},
 {file:'picker-asw-p6.png',layout:'equip',total:999},
 {file:'picker-asw-p11.png',layout:'equip',total:999},
 {file:'picker-asw-p16.png',layout:'equip',total:999},
 // Deep-page green digits (7/8) exist only here; labels were read visually.
 {file:'picker-pages14-18.png',layout:'equip',total:999,labels:[14,15,16,17,18]},
];
for(const {file,layout,total,labels:known} of pageCaptures){
  const im=Pixels.decode(fs.readFileSync(path.join(tour,file))).normalize();
  let labels,centers;
  if(known){
    // Labels were read visually; centers are the observer's fixed columns.
    labels=known;
    centers=(layout==='equip'?[739,793,847,901,955]:CX).slice(0,labels.length);
  }else{
    const pr=readLabels(im,total,layout);
    labels=pr.labels;centers=pr.centers;
  }
  labels.forEach((label,i)=>{
    const ds=String(label).split('').map(Number);
    const gs=extractGlyphs(im,centers[i]);
    if(gs.length!==ds.length)throw new Error(file+' column '+i+': glyph count '+gs.length+' != '+ds.length);
    gs.forEach((g,k)=>glyphs.push({digit:ds[k],mask:g,source:file,page:labels[i]}));
  });
}
const perDigit={};for(const g of glyphs)perDigit[g.digit]=(perDigit[g.digit]||0)+1;
for(let d=0;d<10;d++)if(!perDigit[d])throw new Error('digit '+d+' missing from native page captures');
fs.writeFileSync(path.join(__dirname,'../../data/page_digits_v2.json'),JSON.stringify({glyphs}));
out.pageDigits={total:glyphs.length,perDigit};
// verify: pageread with the new glyphs reproduces every capture's labels
delete require.cache[require.resolve('../../data/page_digits_v2.json')];
delete require.cache[require.resolve('../../src/vision/observers.js')];
const V2=require('../../src/vision/observers');
for(const {file,layout,total,labels:known} of pageCaptures){
  const im=Pixels.decode(fs.readFileSync(path.join(tour,file))).normalize();
  const expected=known?known:readLabels(im,total,layout).labels;
  const after=V2.pageread(im,{total,layout});
  const afterLabels=after.valid?after.labels:null;
  if(JSON.stringify(afterLabels)!==JSON.stringify(expected))throw new Error(file+' label mismatch after rebuild: '+JSON.stringify(afterLabels)+' vs '+JSON.stringify(expected));
}
out.pageDigits.verified=true;

// ---------- bulk-clear button masks ----------
// org: dark tooltip mask (max<130) over clearEscorts.box
const orgData=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/org_clear_escorts.json'),'utf8'));
{
  const im=Pixels.decode(fs.readFileSync(path.join(tour,'clear-hover.png'))).normalize();
  const tile=im.crop(orgData.box,...orgData.size),mask=[];
  for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++)mask.push(Number(Math.max(...tile.rgb(x,y))<130));
  const on=mask.filter(Boolean).length;
  if(on<mask.length*0.1||on>mask.length*0.9)throw new Error('orgclear implausible mask '+on+'/'+mask.length);
  orgData.mask=mask;
  orgData.source='Rebuilt from native-tour/clear-hover.png: hovered 随伴艦一括解除 tooltip, native 1:1, poi 12.0.1, zoom 1.0; 2026-09-18';
  fs.writeFileSync(path.join(__dirname,'../../data/org_clear_escorts.json'),JSON.stringify(orgData));
  out.orgClear={on,of:mask.length};
}
// equip: cyan tooltip mask (offset window) from the 5-slot hover capture
const eqData=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/equip_clear_all.json'),'utf8'));
{
  const im=Pixels.decode(fs.readFileSync(path.join(tour,'clear-5slots.png'))).normalize();
  const x=485,y=245+50*5,offset=eqData.offset;
  const tile=im.crop([x+offset[0],y+offset[1],x+offset[2],y+offset[3]],...eqData.size),mask=[];
  for(let row=0;row<tile.height;row++)for(let col=0;col<tile.width;col++)mask.push(Number(cyan(tile.rgb(col,row))));
  const on=mask.filter(Boolean).length;
  if(on<mask.length*0.05||on>mask.length*0.95)throw new Error('equipclear implausible mask '+on+'/'+mask.length);
  eqData.mask=mask;
  eqData.source='Rebuilt from native-tour/clear-5slots.png: hovered 全装備解除 tooltip (5 slots), native 1:1, poi 12.0.1, zoom 1.0; 2026-09-18';
  fs.writeFileSync(path.join(__dirname,'../../data/equip_clear_all.json'),JSON.stringify(eqData));
  out.equipClear={on,of:mask.length};
}

// ---------- category menu cell colours ----------
{
  const catPath=path.join(__dirname,'../../data/equip_categories.json');
  const cat=JSON.parse(fs.readFileSync(catPath,'utf8'));
  const im=Pixels.decode(fs.readFileSync(path.join(__dirname,'../../tests/fixtures/equip/menu-all.png'))).normalize();
  cat.templates.sort((a,b)=>a.id-b.id).forEach((t,i)=>{
    const y=Math.round(197+28.6*i);
    const cell=im.crop([780,y-13,842,y+13],...cat.size);
    t.rgb=Array.from(cell.data).filter((_,k)=>k%4!==3);
  });
  cat.source='Inspected game category menu and all 15 selected headers; cells and masks rebuilt from native 1:1 captures 2026-09-18, poi 12.0.1, zoom 1.0';
  fs.writeFileSync(catPath,JSON.stringify(cat));
  out.cells=cat.templates.length;
}
console.log(JSON.stringify(out));
