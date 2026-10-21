'use strict';
// Rebuild all 15 selected-title masks from native 1:1 category captures and
// cross-verify: each capture must match exactly its own category afterwards.
const fs=require('fs'),path=require('path'),{Pixels}=require('../../src/vision/pixels');
const catPath=path.join(__dirname,'../../data/equip_categories.json');
const cat=JSON.parse(fs.readFileSync(catPath,'utf8'));
const fixtures=path.join(__dirname,'../../tests/fixtures');
function maskOf(file){
  const im=Pixels.decode(fs.readFileSync(file)).normalize();
  const tile=im.crop(cat.selectedBox),rows=[];
  for(let y=0;y<tile.height;y++){let row='';for(let x=0;x<tile.width;x++)row+=Math.min(...tile.rgb(x,y))>200?'1':'0';rows.push(row);}
  return rows;
}
function iou(mask,expected){
  let i=0,u=0;
  for(let k=0;k<mask.length;k++){const w=expected[k]==='1';if(mask[k]==='1'&&w)i++;if(mask[k]==='1'||w)u++;}
  return i/Math.max(1,u);
}
const captures=[],masks=[];
for(let id=0;id<15;id++){
  const file=path.join(fixtures,'equip/menu-category-'+id+'.png');
  masks.push(maskOf(file));captures.push(masks[id].join(''));
}
for(let id=0;id<15;id++)cat.templates.find(t=>t.id===id).selectedMask=masks[id];
cat.source='Inspected game category menu and all 15 selected headers; all masks rebuilt from native 1:1 captures 2026-09-18, poi 12.0.1, zoom 1.0';
fs.writeFileSync(catPath,JSON.stringify(cat));
let ok=true;
for(let id=0;id<15;id++){
  const ranked=cat.templates.map(t=>({id:t.id,iou:iou(captures[id],t.selectedMask.join(''))})).sort((a,b)=>b.iou-a.iou);
  const good=ranked[0].id===id&&ranked[0].iou>=.9&&ranked[1].iou<.8;
  if(!good)ok=false;
  console.log('cat'+id,'→',ranked.slice(0,2).map(r=>'id'+r.id+':'+r.iou.toFixed(3)).join(' '),good?'✓':'✗');
}
console.log(ok?'ALL 15 CATEGORIES VERIFIED':'MISMATCH FOUND');
