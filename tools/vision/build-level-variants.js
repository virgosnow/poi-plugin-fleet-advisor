'use strict';
// Append resampled-form digit glyphs from an annotated live picker frame.
// The row levels are ground-truthed against the store before running this.
//   node tools/vision/build-level-variants.js <frame.png> 84,85,52,78,50,95,112,94,123,84
// Only rows whose segmentation matches the expected digit count are used;
// the native glyph library is kept and appended to, never rewritten.
const fs=require('fs'),path=require('path');
const {Pixels}=require('../../src/vision/pixels');
const {segment}=require('../../src/vision/numbers');
const frameFile=process.argv[2],expected=process.argv[3];
if(!frameFile||!expected)throw Error('Usage: node tools/vision/build-level-variants.js <frame.png> <csv of 10 row levels>');
const levels=expected.split(',').map(s=>s.trim());
if(levels.length!==10)throw Error('Need exactly 10 row levels');
const im=Pixels.decode(fs.readFileSync(frameFile)).normalize();
const file=path.join(__dirname,'../../data/level_digits.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const before=data.glyphs.length;
const added=[];
for(let row=0;row<10;row++){
  const want=levels[row];
  if(!/^\d+$/.test(want))continue;
  const box=[823,225+43*row,884,259+43*row];
  let picked=null;
  for(const threshold of [165,145,185]){
    const glyphs=segment(im,box,threshold);
    if(!glyphs.includes(null)&&glyphs.length===want.length){picked={threshold,glyphs};break;}
  }
  if(!picked){console.log('row'+row+' ('+want+'): segmentation mismatch, skipped');continue;}
  [...want].forEach((digit,i)=>{
    added.push({digit:Number(digit),mask:picked.glyphs[i].mask});
  });
  console.log('row'+row+' ('+want+') @thr'+picked.threshold+': '+want.length+' glyphs');
}
if(!added.length)throw Error('No glyphs extracted');
data.glyphs.push(...added);
data.source=(data.source||'')+'; +'+added.length+' glyphs from a 1.75 area-resampled picker page (row levels ground-truthed against the store), 2026-09-22';
fs.writeFileSync(file,JSON.stringify(data));
console.log('glyphs:',before,'->',data.glyphs.length);
