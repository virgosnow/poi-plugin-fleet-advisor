'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PNG}=require('pngjs');

test('recognition fixtures contain only allowed pixels and no private HUD or PNG metadata',()=>{
  const root=path.resolve(__dirname,'../..'),manifest=require('../fixtures/privacy.json');
  const actual=fs.readdirSync(path.join(__dirname,'../fixtures'),{recursive:true}).filter(n=>n.endsWith('.png')).map(n=>'tests/fixtures/'+n.replaceAll('\\','/')).sort();
  assert.deepEqual(manifest.fixtures.map(f=>f.path).sort(),actual);
  for(const row of manifest.fixtures){
    const file=path.resolve(root,row.path);assert(file.startsWith(path.join(root,'tests','fixtures')+path.sep));
    const bytes=fs.readFileSync(file),png=PNG.sync.read(bytes),allowed=new Uint8Array(png.width*png.height);
    assert.deepEqual([png.width,png.height],[row.width,row.height],row.path);
    for(let offset=8;offset<bytes.length;){
      const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
      assert(['IHDR','IDAT','IEND'].includes(type),row.path+': unexpected PNG metadata '+type);offset+=length+12;
    }
    for(const [x0,y0,x1,y1] of row.rects){
      assert(x0>=0&&y0>=0&&x1<=png.width&&y1<=png.height&&x0<x1&&y0<y1);
      for(let y=y0;y<y1;y++)allowed.fill(1,y*png.width+x0,y*png.width+x1);
    }
    for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
      const pixel=y*png.width+x,p=pixel*4,privateHeader=x>=Math.floor(160*png.width/1200)&&y<Math.floor(100*png.height/720);
      if(png.data[p+3]!==255)assert.fail(row.path+': transparent data');
      if((!allowed[pixel]||privateHeader)&&(png.data[p]|png.data[p+1]|png.data[p+2])!==0)assert.fail(row.path+': pixels outside privacy boundary');
    }
  }
});
