'use strict';
const templates=require('../../data/port_return_button.json');

const point=(radius,angle)=>[Math.round(62.5+radius*Math.cos(angle)),Math.round(58+radius*Math.sin(angle))];
function meanPixel(im,x,y){
  const sum=[0,0,0];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)im.rgb(x+dx,y+dy).forEach((v,k)=>sum[k]+=v);
  return sum.map(v=>v/9);
}
function inspectPortReturn(im){
  // Lower-right arc avoids the adjacent account HUD entirely.
  const golden=([r,g,b])=>r>110&&g>80&&r-b>45&&g-b>25;
  let matched=false,borderBest=null;
  // A fractional viewport/animation can move a thin ring across a pixel.
  // Match the three arcs together at one offset, preserving every threshold.
  for(const [dx,dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){
    const arcs=[90,95,101].map(radius=>Array.from({length:16},(_,i)=>{
      const [x,y]=point(radius,(30+i*4)*Math.PI/180);return im.rgb(x+dx,y+dy);
    }));
    const bright=arcs[0].reduce((n,p)=>n+p[0],0)/16;
    const contrast=bright-arcs[1].reduce((n,p)=>n+p[0],0)/16;
    const goldCount=arcs[2].filter(golden).length;
    const score=Math.min(bright/185,contrast/35,goldCount/14);
    if(!borderBest||score>borderBest.score)borderBest={score,bright:Math.round(bright),contrast:Math.round(contrast),goldCount,dx,dy};
    if(bright>=185&&contrast>=35&&goldCount>=14){matched=true;break;}
  }
  // Three concentric arcs, not a single colour: bright inner edge, dark
  // separator, gold outer rim. They stay fixed while the title spins.
  if(!matched)return {valid:false,reason:'return button border missing or dimmed',border:borderBest};
  const {radii,angles,rgb}=templates.homeExclusion;
  const samples=radii.flatMap(r=>Array.from({length:angles},(_,i)=>meanPixel(im,...point(r,i*2*Math.PI/angles))).flat());
  let best=Infinity;
  for(const hover of [0,.2])for(let shift=0;shift<angles;shift++){
    let error=0;
    for(let ring=0;ring<radii.length;ring++)for(let a=0;a<angles;a++)for(let k=0;k<3;k++){
      const expected=rgb[(ring*angles+(a+shift)%angles)*3+k]*(1-hover)+255*hover;
      error+=Math.abs(samples[(ring*angles+a)*3+k]-expected);
    }
    best=Math.min(best,error/samples.length);
  }
  if(best<16)return {valid:false,reason:'home hide-UI button excluded'};
  return {valid:true,returnButton:{page:'port',x:62,y:58}};
}
const portReturn=im=>inspectPortReturn(im).returnButton||null;
module.exports={portReturn,inspectPortReturn};
