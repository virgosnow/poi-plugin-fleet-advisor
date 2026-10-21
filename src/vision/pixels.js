'use strict';
const {PNG} = require('pngjs');

// Area-average resampling: the correct kernel for downsampling and the one
// the per-scale template variants were calibrated against.
function resampleArea(src,dw,dh){
  const sx=src.width/dw,sy=src.height/dh,dst=new Pixels(dw,dh,Buffer.alloc(dw*dh*4));
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
    const x0=x*sx,y0=y*sy,x1=(x+1)*sx,y1=(y+1)*sy;let r=0,g=0,b=0,a=0,n=0;
    for(let yy=Math.floor(y0);yy<Math.min(src.height,Math.ceil(y1));yy++)
      for(let xx=Math.floor(x0);xx<Math.min(src.width,Math.ceil(x1));xx++){
        const w=(Math.min(x1,xx+1)-Math.max(x0,xx))*(Math.min(y1,yy+1)-Math.max(y0,yy)),p=(yy*src.width+xx)*4;
        r+=src.data[p]*w;g+=src.data[p+1]*w;b+=src.data[p+2]*w;a+=src.data[p+3]*w;n+=w;
      }
    const p=(y*dw+x)*4;
    dst.data[p]=Math.round(r/n);dst.data[p+1]=Math.round(g/n);dst.data[p+2]=Math.round(b/n);dst.data[p+3]=Math.round(a/n);
  }
  return dst;
}

class Pixels {
  constructor(width, height, data) { this.width = width; this.height = height; this.data = data; }
  static decode(buffer) { const p = PNG.sync.read(buffer); return new Pixels(p.width,p.height,p.data); }
  // PNG IHDR width/height without a full decode (offsets 16/20, big endian).
  static pngSize(buffer) {
    if(!Buffer.isBuffer(buffer)||buffer.length<24||buffer.readUInt32BE(12)!==0x49484452)throw new Error('Not a PNG buffer');
    return [buffer.readUInt32BE(16),buffer.readUInt32BE(20)];
  }
  rgb(x,y) { const p=(Math.floor(y)*this.width+Math.floor(x))*4; return Array.from(this.data.subarray(p,p+3)); }
  crop(box, width = box[2]-box[0], height = box[3]-box[1]) {
    const [x0,y0,x1,y1] = box;
    if (!(0<=x0 && x0<x1 && x1<=this.width && 0<=y0 && y0<y1 && y1<=this.height)) throw new Error('Crop outside screenshot');
    const data = Buffer.alloc(width*height*4);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const sx=Math.max(x0,Math.min(x1-1,x0+(x+.5)*(x1-x0)/width-.5));
      const sy=Math.max(y0,Math.min(y1-1,y0+(y+.5)*(y1-y0)/height-.5));
      const ax=Math.floor(sx), ay=Math.floor(sy), dx=sx-ax, dy=sy-ay;
      for(let k=0;k<3;k++) {
        const at=(xx,yy)=>this.data[(yy*this.width+xx)*4+k];
        data[(y*width+x)*4+k]=Math.round((at(ax,ay)*(1-dx)+at(Math.min(ax+1,x1-1),ay)*dx)*(1-dy)+(at(ax,Math.min(ay+1,y1-1))*(1-dx)+at(Math.min(ax+1,x1-1),Math.min(ay+1,y1-1))*dx)*dy);
      }
      data[(y*width+x)*4+3]=255;
    }
    return new Pixels(width,height,data);
  }
  normalize() {
    if(Math.abs(this.width/this.height-1200/720)>.006) throw new Error('Unsupported screenshot aspect ratio');
    if(this.width===1200&&this.height===720)return this;
    // Higher device scale factors render the same 1200x720 CSS area with more
    // physical pixels; area-average them back onto the template coordinate
    // system. Verified live at 1.25/1.5/1.75. Upsampling has no source detail
    // to average and was never calibrated, so it stays refused.
    if(this.width<1200) throw new Error(`Game rendered at ${this.width}x${this.height}; upsampling is unsupported. Use a device scale factor >= 1 and retry.`);
    return resampleArea(this,1200,720);
  }
  png() { return PNG.sync.write({width:this.width,height:this.height,data:this.data}); }
  samples(box) { const out=[];for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++)out.push(this.rgb(x,y));return out; }
}
module.exports = {Pixels,resampleArea};
