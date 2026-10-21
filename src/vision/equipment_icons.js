'use strict';
const fs=require('fs'),path=require('path');
const {Pixels}=require('./pixels');
const index=require('../../data/equip_icon_index.json').icons;
let templates;
const gray=p=>p[0]*.299+p[1]*.587+p[2]*.114;
function load() {
  if(!templates)templates=index.flatMap(e=>{
    const image=Pixels.decode(fs.readFileSync(path.join(__dirname,'../../data/icons',e.file)));
    let x0=image.width,y0=image.height,x1=0,y1=0;
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {
      const at=(y*image.width+x)*4,alpha=image.data[at+3]/255;
      if(alpha>.15){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
      for(let k=0;k<3;k++)image.data[at+k]=Math.round(image.data[at+k]*alpha+230*(1-alpha));
    }
    if(x1<=x0||y1<=y0)return [];
    return [.65,.8,1,1.2].map(scale=>{
      const w=Math.max(6,Math.floor((x1-x0)*scale)),h=Math.max(6,Math.floor((y1-y0)*scale));
      const pixels=image.crop([x0,y0,x1,y1],w,h).samples([0,0,w,h]).map(gray);
      const mean=pixels.reduce((a,b)=>a+b,0)/pixels.length,values=pixels.map(v=>v-mean),norm=Math.sqrt(values.reduce((a,b)=>a+b*b,0));
      return {t3:e.t3,w,h,values,norm};
    });
  });
  return templates;
}
function classify(im,box) {
  const cell=im.crop(box),w=cell.width,h=cell.height,pixels=cell.samples([0,0,w,h]).map(gray),scores=new Map();
  for(const tpl of load()) {
    if(tpl.w>w||tpl.h>h||tpl.norm<1)continue;
    let best=-1;
    for(let y=0;y<=h-tpl.h;y++)for(let x=0;x<=w-tpl.w;x++) {
      let sum=0,square=0,dot=0;
      for(let ty=0;ty<tpl.h;ty++)for(let tx=0;tx<tpl.w;tx++) {
        const v=pixels[(y+ty)*w+x+tx];sum+=v;square+=v*v;dot+=v*tpl.values[ty*tpl.w+tx];
      }
      const norm=Math.sqrt(Math.max(0,square-sum*sum/(tpl.w*tpl.h)));
      if(norm>1)best=Math.max(best,dot/(norm*tpl.norm));
    }
    scores.set(tpl.t3,Math.max(scores.get(tpl.t3)||-1,best));
  }
  const ranked=[...scores].sort((a,b)=>b[1]-a[1]);
  // Aircraft icon families (fighter/bomber/attacker silhouettes) correlate
  // ~0.95 with each other, so the 0.04 separation rule cannot hold for them.
  // A near-perfect top score is decisive on its own: on live picker captures
  // every >=0.98 top match was the correct icon type.
  return ranked.length&&ranked[0][1]>=.6&&(!ranked[1]||ranked[0][1]-ranked[1][1]>=.04||ranked[0][1]>=.98)?ranked[0][0]:0;
}
module.exports={classify};
