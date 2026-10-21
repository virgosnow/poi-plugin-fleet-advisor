'use strict';
const W=20,H=32;
function segment(im,box,threshold=165) {
  const tile=im.crop(box),fg=(x,y)=>{
    const [r,g,b]=tile.rgb(x,y);
    return Math.max(r,g,b)<threshold||(g-r>28&&g>100&&b>80);
  };
  const columns=[];
  for(let x=0;x<tile.width;x++) {
    if(!Array.from({length:tile.height},(_,y)=>fg(x,y)).some(Boolean))continue;
    if(!columns.length||x>columns.at(-1).at(-1)+1)columns.push([]);
    columns.at(-1).push(x);
  }
  return columns.map(xs=>{
    const ys=[];for(let y=0;y<tile.height;y++)if(xs.some(x=>fg(x,y)))ys.push(y);
    const width=xs.length,height=ys.at(-1)-ys[0]+1;
    if(width<2||width>32||height<9||height>42)return null;
    const mask=Array.from({length:W*H},(_,i)=>{
      const x=xs[0]+Math.min(width-1,Math.floor((i%W+.5)*width/W));
      const y=ys[0]+Math.min(height-1,Math.floor((Math.floor(i/W)+.5)*height/H));
      return Number(fg(x,y));
    });
    return {width,height,mask};
  });
}
function readNumber(im,box) {
  const templates=require('../../data/level_digits.json').glyphs;
  const votes=[];
  for(const threshold of [165,145,185,205]){
    const glyphs=segment(im,box,threshold);
    if(glyphs.length<1||glyphs.length>3||glyphs.includes(null))continue;
    const digits=[];
    for(const glyph of glyphs){
      const scores=Array.from({length:10},(_,digit)=>({digit,score:Math.min(...templates.filter(t=>t.digit===digit).map(t=>glyph.mask.reduce((sum,v,i)=>sum+(v!==t.mask[i]),0)/(W*H)))})).sort((a,b)=>a.score-b.score);
      if(scores[0].score>.22||scores[1].score-scores[0].score<.035)break;
      digits.push(scores[0].digit);
    }
    if(digits.length===glyphs.length&&(digits[0]!==0||digits.length===1))votes.push(Number(digits.join('')));
  }
  if(!votes.length||new Set(votes).size!==1)return {valid:false,reason:'ambiguous numeric glyphs'};
  return {valid:true,value:votes[0]};
}
module.exports={segment,readNumber};
