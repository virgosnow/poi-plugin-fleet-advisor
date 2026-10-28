'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {Pixels,resampleArea}=require('../../src/vision/pixels');
const {classify}=require('../../src/vision/equipment_icons');
// Inspect private math helpers without adding a runtime/public diagnostics API.
const filename=require.resolve('../../src/vision/equipment_icons'),instrumented=new Module(filename,module);
instrumented.filename=filename;instrumented.paths=Module._nodeModulePaths(path.dirname(filename));
instrumented._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.math={load,match,decide,prefixStats,windowBounds,exactNorm};',filename);
const math=instrumented.exports.math,templates=math.load();
const fixture=name=>Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures',name+'.png'))).normalize();
const gray=p=>p[0]*.299+p[1]*.587+p[2]*.114;

// Independent brute-force oracle: the original complete template/window scan.
// Keep its arithmetic order so equivalence checks compare every score exactly,
// rather than checking only the winning label or relaxing a numeric tolerance.
function reference(im,box){
  const cell=im.crop(box),w=cell.width,h=cell.height,pixels=cell.samples([0,0,w,h]).map(gray),scores=new Map();
  for(const tpl of templates){
    if(tpl.w>w||tpl.h>h||tpl.norm<1)continue;
    let best=-1;
    for(let y=0;y<=h-tpl.h;y++)for(let x=0;x<=w-tpl.w;x++){
      let sum=0,square=0,dot=0;
      for(let ty=0;ty<tpl.h;ty++)for(let tx=0;tx<tpl.w;tx++){
        const v=pixels[(y+ty)*w+x+tx];sum+=v;square+=v*v;dot+=v*tpl.values[ty*tpl.w+tx];
      }
      const norm=Math.sqrt(Math.max(0,square-sum*sum/(tpl.w*tpl.h)));
      if(norm>1)best=Math.max(best,dot/(norm*tpl.norm));
    }
    scores.set(tpl.t3,Math.max(scores.get(tpl.t3)||-1,best));
  }
  return scores;
}
function equivalent(im,box,label){
  const expected=reference(im,box);
  assert.deepEqual(math.match(im,box),expected,label+': all type scores');
  assert.equal(classify(im,box),math.decide(expected),label+': public classifier');
}

test('all live transport and similar-aircraft rows retain every brute-force score',()=>{
  for(const [name,rows] of [['equip/picker-transport',[0,1,2,3]],['equip/picker-airbomber-p1',[0,1,2]]]){
    const im=fixture(name);
    for(const row of rows){const y=Math.round(218+44.75*row);equivalent(im,[546,y-22,599,y+22],name+row);}
  }
});

test('narrow icon regions and supported resampling retain the exact classification scores',()=>{
  const source=fixture('equip/picker-transport');
  equivalent(source,[552,203,594,233],'narrow box');
  for(const scale of [1.25,1.5,1.75]){
    const im=resampleArea(source,1200*scale,720*scale).normalize();
    equivalent(im,[546,196,599,240],'scale '+scale);
  }
});

test('every icon family retains its complete score vector on independent synthetic cells',()=>{
  for(const [i,entry] of require('../../data/equip_icon_index.json').icons.entries()){
    const icon=Pixels.decode(fs.readFileSync(path.join(__dirname,'../../data/icons',entry.file)));
    for(let p=0;p<icon.data.length;p+=4){
      const alpha=icon.data[p+3]/255;
      for(let k=0;k<3;k++)icon.data[p+k]=Math.round(icon.data[p+k]*alpha+230*(1-alpha));
    }
    const tile=icon.crop([0,0,icon.width,icon.height],32,30),im=new Pixels(53,44,Buffer.alloc(53*44*4,230));
    const x=4+i%8,y=3+i%5;
    for(let j=0;j<tile.height;j++)for(let k=0;k<tile.width;k++){
      const a=(j*tile.width+k)*4,b=((j+y)*im.width+k+x)*4;
      for(let c=0;c<4;c++)im.data[b+c]=tile.data[a+c];
    }
    equivalent(im,[0,0,53,44],'icon '+entry.t3);
  }
});

test('flat, covered, low-contrast and noisy cells retain every reference score without stale cell caches',()=>{
  let seed=41;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(const mode of ['black','white','near-flat','noise','covered']){
    const im=new Pixels(53,44,Buffer.alloc(53*44*4,mode==='black'?0:mode==='white'?255:230));
    if(mode==='near-flat')for(let i=0;i<im.data.length;i+=4)im.data[i]=230+random(2);
    if(mode==='noise')for(let i=0;i<im.data.length;i++)im.data[i]=random(256);
    if(mode==='covered'){
      const tile=fixture('equip/picker-airbomber-p1').crop([546,196,599,240]);im.data.set(tile.data);
      for(let y=0;y<44;y++)for(let x=20;x<53;x++)im.data.fill(230,(y*53+x)*4,(y*53+x)*4+3);
    }
    equivalent(im,[0,0,53,44],mode);
    im.data.fill(0);equivalent(im,[0,0,53,44],mode+' mutated in place');
  }
});

test('window bounds enclose passing reference norms, including almost-flat variance near one',()=>{
  let seed=17;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let run=0;run<100;run++){
    const w=20+random(45),h=20+random(35),pixels=Array.from({length:w*h},()=>gray([random(256),random(256),random(256)]));
    if(run<8){pixels.fill(128);pixels[Math.floor(pixels.length/2)]+=[0,.5,.999999,1,1.000001,1.01,2,10][run];}
    const tw=6+random(w-5),th=6+random(h-5),bounds=math.windowBounds(math.prefixStats(pixels,w,h),w,h,tw,th);
    let at=0;
    for(let y=0;y<=h-th;y++)for(let x=0;x<=w-tw;x++){
      const exact=math.exactNorm(pixels,w,x,y,tw,th),bound=bounds[at++];
      if(!bound)assert(exact<=1,'cannot reject a passing reference norm');
      else if(exact>1)assert(bound<=exact,'lower bound must not overestimate the reference norm');
    }
  }
});

test('confidence, separation, near-perfect and stable tie rules retain their exact thresholds',()=>{
  const decide=entries=>math.decide(new Map(entries));
  assert.equal(decide([[7,.6],[8,.5]]),7);
  assert.equal(decide([[7,.6-Number.EPSILON],[8,.5]]),0);
  assert.equal(decide([[7,.75],[8,.71]]),7);
  assert.equal(decide([[7,.75],[8,.71+Number.EPSILON]]),0);
  assert.equal(decide([[7,.98],[8,.979]]),7);
  assert.equal(decide([[7,.98-Number.EPSILON],[8,.979]]),0);
  assert.equal(decide([[8,.99],[7,.99]]),8);
  assert.equal(decide([[8,.9],[7,.9]]),0);
});
