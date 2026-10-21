'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {Pixels}=require('../../src/vision/pixels');
const {readNumber}=require('../../src/vision/numbers');
const {Observer}=require('../../src/vision/observers');

test('native 1200x720 frames pass through normalize unchanged',()=>{
  const im=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures/org/fleet.png')));
  assert.strictEqual(im.normalize(),im);
});
test('larger device-scale frames are area-resampled onto the template grid and stay readable',async()=>{
  const observer=new Observer();
  // Synthetic 1.5x physical frame: upscale a real 1200x720 home capture with
  // bilinear (geometry test only — recognition quality is covered by the zoom
  // matrix against real rendered frames) and check normalize brings observers
  // back to a working state.
  const {resampleBilinear}=require('../../tools/vision/resample');
  const native=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures/org/fleet.png')));
  const screen=await observer.observe('screen',native);
  assert.equal(screen.mode,'organization');
  for(const [w,h] of [[1800,1080],[1500,900]]){
    const physical=resampleBilinear(native,w,h);
    assert.equal(physical.width,w);
    const normalized=physical.normalize();
    assert.deepEqual([normalized.width,normalized.height],[1200,720]);
    assert.equal((await observer.observe('screen',normalized)).mode,'organization');
  }
  // Deterministic output: the same physical frame normalizes to identical pixels.
  const one=resampleBilinear(native,1800,1080).normalize();
  const two=resampleBilinear(native,1800,1080).normalize();
  assert(Buffer.compare(one.data,two.data)===0);
});
test('upsampled or smaller-than-template frames are refused with guidance',()=>{
  const small=new Pixels(900,540,Buffer.alloc(900*540*4));
  assert.throws(()=>small.normalize(),/upsampling is unsupported[\s\S]*device scale factor >= 1/);
  const odd=new Pixels(1234,700,Buffer.alloc(1234*700*4));
  assert.throws(()=>odd.normalize(),/aspect ratio/);
});
test('pngSize reads IHDR dimensions without a full decode',()=>{
  const im=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures/org/fleet.png')));
  const buffer=im.png();
  assert.deepEqual(Pixels.pngSize(buffer),[1200,720]);
  assert.throws(()=>Pixels.pngSize(buffer.subarray(0,20)),/Not a PNG/);
  assert.throws(()=>Pixels.pngSize(Buffer.from('not a png at all..........')),/Not a PNG/);
});
test('host capture refuses mid-run size drift',async()=>{
  const {PoiHost}=require('../../src/host/poi_host');
  const a=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures/org/fleet.png'))).png();
  const b=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures/zoom125/equipment-initial.png')));
  const bigger=Buffer.from(b.png());
  // Rewrite the IHDR of an otherwise valid PNG to simulate a size change.
  bigger.writeUInt32BE(2097,16);bigger.writeUInt32BE(1258,20);
  const commands=[a,bigger,a];
  const host=new PoiHost({window:{getStore:()=>({})}});
  host.command=async()=>({data:commands.shift().toString('base64')});
  host.check=()=>{};
  const first=await host.capture();
  assert.deepEqual(Pixels.pngSize(first),[1200,720]);
  await assert.rejects(()=>host.capture(),/Capture size changed mid-run \(1200x720 -> 2097x1258\)/);
  assert.equal(host.error,'Capture size changed mid-run (1200x720 -> 2097x1258)');
});
test('async observers are never called without await across the codebase',()=>{
  // sortread is async; a bare call resolves to a Promise whose .valid is
  // undefined — the class of bug that produced phantom sort failures twice.
  const fs=require('fs'),path=require('path');
  const roots=['src','tools','tests'].map(d=>path.join(__dirname,'../..',d));
  const files=[];
  const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()&&!['node_modules','fixtures'].includes(e.name))walk(p);else if(e.isFile()&&e.name.endsWith('.js'))files.push(p);}};
  roots.forEach(walk);
  const bare=[];
  for(const file of files){
    const src=fs.readFileSync(file,'utf8').split('\n');
    src.forEach((line,i)=>{
      if(/(^|[^.\w])sortread\(/.test(line)&&!/await|\.then|=>|function|async sortread|'sortread'|\"sortread\"|test\(/.test(line))
        bare.push(file+':'+(i+1)+':'+line.trim().slice(0,60));
    });
  }
  assert.deepEqual(bare,[],'bare sortread calls found');
});
test('205 threshold tier does not disturb native level reads',()=>{
  // The 4th tier exists for bright gradient digits on resampled frames; every
  // native source of truth must still read its exact level through the full
  // four-tier vote.
  const cases=[
    ['identity/2422-row.png',[823,225+43*2,884,259+43*2],67],
    ['identity/2422-card.png',[1120,160,1195,199],67],
    ['identity/5426-card.png',[1120,160,1195,199],60],
    ['identity/7052-card.png',[1120,160,1195,199],88],
    ['identity/4385-card.png',[1120,160,1195,199],85],
  ];
  for(const [name,box,truth] of cases){
    const im=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures',name))).normalize();
    const r=readNumber(im,box);
    assert.equal(r.valid&&r.value===truth,true,name+' got '+(r.valid?r.value:r.reason));
  }
});
