'use strict';
// Runtime resampling lives in src/vision/pixels.js (Pixels.normalize).
// The re-export keeps the zoom tooling on the single implementation;
// bilinear remains here as the offline comparison baseline only.
const {Pixels,resampleArea}=require('../../src/vision/pixels');
function resampleBilinear(src,dw,dh){
  const dst=new Pixels(dw,dh,Buffer.alloc(dw*dh*4));
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
    const fx=Math.min(src.width-1.001,Math.max(0,(x+0.5)*src.width/dw-0.5)),
      fy=Math.min(src.height-1.001,Math.max(0,(y+0.5)*src.height/dh-0.5)),
      x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0,p=(y*dw+x)*4;
    for(let c=0;c<4;c++){
      const a=src.data[(y0*src.width+x0)*4+c],b=src.data[(y0*src.width+x0+1)*4+c],
        d=src.data[((y0+1)*src.width+x0)*4+c],e=src.data[((y0+1)*src.width+x0+1)*4+c];
      dst.data[p+c]=Math.round(a*(1-tx)*(1-ty)+b*tx*(1-ty)+d*(1-tx)*ty+e*tx*ty);
    }
  }
  return dst;
}

module.exports={resampleArea,resampleBilinear};
