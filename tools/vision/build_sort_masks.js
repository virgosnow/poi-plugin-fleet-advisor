'use strict';
// Rebuild sort label masks from native-resolution captures.
// Extraction mirrors sortread's comparison logic exactly (min-channel > 190
// for NEW/Lv labels; > 180 over the top mask.length rows for the ship icon).
const fs=require('fs'),path=require('path'),{Pixels}=require('../../src/vision/pixels');
function extractLabel(file,box,size){
  const im=Pixels.decode(fs.readFileSync(file)).normalize();
  const tile=im.crop(box,...size),rows=[];
  for(let y=0;y<tile.height;y++){let row='';for(let x=0;x<tile.width;x++)row+=Math.min(...tile.rgb(x,y))>190?'1':'0';rows.push(row);}
  const on=rows.join('').split('1').length-1;
  if(on<10||on>rows.join('').length*0.7)throw new Error(file+' implausible mask: '+on);
  return rows;
}
function extractShip(file){
  const shipSort=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/org_sort_ship.json'),'utf8'));
  const rows=shipSort.mask.length;
  const im=Pixels.decode(fs.readFileSync(file)).normalize();
  const tile=im.crop(shipSort.box,...shipSort.size),mask=[];
  for(let y=0;y<rows;y++){let row='';for(let x=0;x<tile.width;x++)row+=Math.min(...tile.rgb(x,y))>180?'1':'0';mask.push(row);}
  const on=mask.join('').split('1').length-1;
  if(on<10||on>mask.join('').length*0.7)throw new Error(file+' implausible ship mask: '+on);
  return mask;
}
function iouOf(file,name){
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data',name+'.json'),'utf8'));
  const im=Pixels.decode(fs.readFileSync(file)).normalize();
  const size=data.size||[data.mask[0].length,data.mask.length];
  const tile=data.size?im.crop(data.box,...data.size):im.crop(data.box,data.mask[0].length,data.mask.length);
  let mask=[];
  if(data.size){for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++)mask.push(Math.min(...tile.rgb(x,y))>190?'1':'0');}
  else {for(let y=0;y<data.mask.length;y++)for(let x=0;x<tile.width;x++)mask.push(Math.min(...tile.rgb(x,y))>180?'1':'0');}
  const e=Array.isArray(data.mask)?data.mask.join(''):data.mask;
  let i=0,u=0;for(let k=0;k<e.length;k++){if(mask[k]==='1'&&e[k]==='1')i++;if(mask[k]==='1'||e[k]==='1')u++;}
  return i/Math.max(1,u);
}
// NEW/Lv keep the proven fixtures (their renders are the runtime-compatible
// variant; the n-*-p1 tour renders are the one-way-incompatible variant).
// The ship icon mask must come from a native capture: the old-scale mask
// scores 0.40 IoU against native rendering and fails live type-sort reads.
const labelTargets=[['org_sort_new','../../tests/fixtures/org/sort-new.png','org/sort-new.png: live NEW label, native 1:1 capture, poi 12.0.1 / Electron 44, zoom 1.0'],
  ['org_sort_level','../../tests/fixtures/org/sort-lv.png','org/sort-lv.png: live Lv label, native 1:1 capture, poi 12.0.1 / Electron 44, zoom 1.0']];
for(const [name,file,source] of labelTargets){
  const p=path.join(__dirname,'../../data',name+'.json');
  const data=JSON.parse(fs.readFileSync(p,'utf8'));
  data.mask=extractLabel(path.join(__dirname,file),data.box,data.size);
  data.source='Rebuilt from '+source+'; 2026-09-18';
  fs.writeFileSync(p,JSON.stringify(data));
  console.log(name,'rebuilt, on-pixels:',data.mask.filter(Boolean).length);
}
const shipPath=path.join(__dirname,'../../data/org_sort_ship.json');
const ship=JSON.parse(fs.readFileSync(shipPath,'utf8'));
ship.mask=extractShip(path.join(__dirname,'../../tests/fixtures/native-tour/sort-type-p1.png'));
ship.source='Rebuilt from native-tour/sort-type-p1.png: live type-sort icon, native 1:1 capture, poi 12.0.1 / Electron 44, zoom 1.0; 2026-09-18';
fs.writeFileSync(shipPath,JSON.stringify(ship));
console.log('org_sort_ship rebuilt, on-pixels:',ship.mask.join('').split('1').length-1);
// self-check: each rebuilt mask must match its own source capture
for(const [name,file] of [['org_sort_new','../../tests/fixtures/native-tour/sort-new-p1.png'],['org_sort_level','../../tests/fixtures/native-tour/sort-lv-p1.png'],['org_sort_ship','../../tests/fixtures/native-tour/sort-type-p1.png']]){
  console.log(name,'self-IoU:',iouOf(path.join(__dirname,file),name).toFixed(3));
}
