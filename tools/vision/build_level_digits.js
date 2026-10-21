'use strict';
const fs=require('fs'),path=require('path'),{Pixels}=require('../../src/vision/pixels'),{segment}=require('../../src/vision/numbers');
// Labels were read directly from the full saved screenshots, not inferred
// from the desired target. Keep sample provenance in the generated data.
// All samples are native 1:1 captures (zoom 1.0). Row levels were read
// visually from the captures; header cells use the remodel-screen box.
const rowBox=row=>[823,225+43*row,884,259+43*row];
const headBox=()=>[744,160,790,195];
const tour='../../tests/fixtures/native-tour/';
const samples=[
 [tour+'sort-type-p1.png',[92,91,92,91,92,91,10,95,10,90],rowBox],
 [tour+'sort-lv-p1.png',[99,98,98,98,97,97,97,97,96,96],rowBox],
 [tour+'level-ushio.png',[87],headBox],
 [tour+'level-yura.png',[94],headBox],
 [tour+'level-shoho.png',[123],headBox],
 // The confirmation card uses a different font from rows/remodel headers.
 // Its 6 otherwise falls within the ambiguity margin of the row-font 8.
 ['../../tests/fixtures/identity/2422-card.png',[67],()=>[1120,160,1195,199]],
];
const glyphs=[];
for(const [name,levels,box] of samples){
 const im=Pixels.decode(fs.readFileSync(path.join(__dirname,name))).normalize();
 levels.forEach((level,row)=>{
  for(const threshold of [165,145,185]){
   const chars=segment(im,box(row),threshold);
   if(chars.includes(null)||chars.length!==String(level).length)continue;
   chars.forEach((g,i)=>glyphs.push({digit:Number(String(level)[i]),mask:g.mask,source:name+':row'+row,threshold}));
  }
 });
}
if(new Set(glyphs.map(g=>g.digit)).size!==10)throw Error('Incomplete digit calibration: '+JSON.stringify([...new Set(glyphs.map(g=>g.digit))].sort()));
fs.writeFileSync(path.join(__dirname,'../../data/level_digits.json'),JSON.stringify({source:'Visually labelled row, remodel header and confirmation-card level glyphs; native 1:1 captures, 2026-09-18, poi 12.0.1, zoom 1.0',glyphs}));
console.log('level_digits rebuilt:',glyphs.length,'glyphs');
