'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Pixels}=require('../../src/vision/pixels');
const V=require('../../src/vision/observers');
const {WorkerObserver}=require('../../src/vision/worker_observer');
const fixture=name=>Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures',name+'.png'))).normalize();
test('live NEW label is recognized without OCR and unsupported sorts are rejected',async()=>{
  assert.deepEqual(await V.sortread(fixture('org/sort-new')),{valid:true,mode:'new',direction:'desc'});
  assert(!(await V.sortread(fixture('org/sort-type'),{recognize:async()=>({text:'',confidence:0})})).valid);
});

test('live combined battleship and destroyer filter reads NEW and the final page group together',async()=>{
  const observer=new V.Observer({recognize(){throw Error('Combined picker should not need OCR');}});
  const result=await observer.observe('picker',fixture('org/list-native'),{fleet:2,total:17});
  assert(result.valid);assert.deepEqual(result.sort,{valid:true,mode:'new',direction:'desc'});
  assert.deepEqual(result.filter.states,[1,0,0,0,1,0,0,0]);
  assert(result.page.valid);assert.equal(result.page.activePage,16);assert.deepEqual(result.page.labels,[13,14,15,16,17]);
  assert(!(await observer.observe('picker',fixture('org/list-native'),{fleet:1,total:17})).valid);
});

test('live Lv label uses its template instead of unreliable Japanese OCR',async()=>{
  assert.deepEqual(await V.sortread(fixture('org/sort-lv')),{valid:true,mode:'level',direction:'desc'});
});
test('native-tour sorting labels match the canonical templates without OCR',async()=>{
  for(const [name,mode] of [['native-tour/sort-new-p1','new'],['native-tour/sort-lv-p1','level']])
    assert.deepEqual(await V.sortread(fixture(name)),{valid:true,mode,direction:'desc'});
});

test('four reported ship identities pass row and confirmation checks on native captures',async()=>{
  const ships=[{id:2422,name:'弥生改',level:67,page:28,row:2},{id:5426,name:'望月改',level:60,page:23,row:9},
    {id:7052,name:'瑞鳳改二乙',level:88,page:20,row:3},{id:4385,name:'千歳航改二',level:85,page:26,row:6}];
  const observer=new V.Observer({});
  {
    for(const ship of ships) {
      const arg={fleet:2,total:35,mask:[1,1,1,1,1,1,1,1],expectedLevel:ship.level,page:ship.page,row:ship.row};
      assert.deepEqual(await observer.observe('rowidentity',fixture('identity/'+ship.id+'-row'),arg),{valid:true,level:ship.level});
      assert.deepEqual(await observer.observe('cardidentity',fixture('identity/'+ship.id+'-card'),arg),{valid:true,level:ship.level,commit:{x:1032,y:669}});
    }
    const im=fixture('identity/5426-card');
    // Cross-ship check: this card shows level 60 but Yayoi's target level is 67.
    assert(!(await observer.observe('cardidentity',im,{fleet:2,total:35,mask:[1,1,1,1,1,1,1,1],expectedLevel:67,page:23,row:9})).valid);
    // Same-name same-level duplicates resolve to the same level digits, so
    // they no longer refuse: whichever instance the row is, the plan holds
    // the monitor pins the exact instance.
    const dup=await observer.observe('cardidentity',im,{fleet:2,total:35,mask:[1,1,1,1,1,1,1,1],expectedLevel:60,page:23,row:9});
    assert(dup.valid&&dup.commit,'duplicate instance should confirm');
  }
});
test('live organization screen is distinct from picker and confirmation overlays',async()=>{
  const observer=new V.Observer({});
  assert.deepEqual(await observer.observe('screen',fixture('org/fleet')),{valid:true,mode:'organization'});
  for(const name of ['org/sort-new-normalized','org/sort-repair-normalized','org/page06-card'])assert.equal((await observer.observe('screen',fixture(name))).valid,false,name);
});

test('bulk-clear observation requires the full fleet screen, correct tab, hovered button and tooltip',async()=>{
  const im=fixture('org/clear-hover'),arg={fleet:2};
  const observer=new V.Observer({recognize(){throw Error('Tooltip template should not need OCR');}});
  assert.deepEqual(await observer.observe('orgclear',im,arg),{valid:true,tab:{valid:true,selected:[2]},commit:{x:625,y:178}});
  for(const fleet of [0,1,3,4,5])assert(!(await observer.observe('orgclear',im,{fleet})).valid);
  for(const name of ['org/fleet','org/sort-lv-normalized','org/page06-card','equip/confirm'])assert(!(await observer.observe('orgclear',fixture(name),arg)).valid);
  for(const box of [[549,126,720,150],[576,166,680,188]]) {
    const changed=new Pixels(im.width,im.height,Buffer.from(im.data));
    for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++)changed.data.fill(230,(y*im.width+x)*4,(y*im.width+x)*4+3);
    assert(!(await observer.observe('orgclear',changed,arg)).valid);
  }
});
test('live remodel fleet 2 does not also select the gray fleet 3 label',async()=>{
  const observer=new V.Observer({});
  assert.deepEqual(await observer.observe('equipTabs',fixture('equip/fleet2'),{fleet:2}),{valid:true,selected:[2]});
  assert(!(await observer.observe('equipTabs',fixture('equip/fleet2'),{fleet:3})).valid);
});

test('remodel navigation requires base layout and rejects every stored picker or overlay',async()=>{
  const observer=new V.Observer(),positive=new Set(['equip/normal-remove','equip/normal-remove-3','equip/normal-remove-4','equip/fleet2','equip/clear-hover-3','equip/clear-hover-5','equip/remodel-fail-ushio',
    'native-tour/clear-3slots','native-tour/clear-5slots','native-tour/level-shoho','native-tour/level-ushio','native-tour/level-yura']);
  for(const file of fs.readdirSync(path.join(__dirname,'../fixtures'),{recursive:true}).filter(f=>f.endsWith('.png'))) {
    const name=file.replace(/\\/g,'/').slice(0,-4),result=await observer.observe('screen',fixture(name));
    assert.equal(result.mode==='equipment',positive.has(name),name);
  }
  // An undimmed fleet tab is insufficient when a dialog covers the panel.
  const covered=fixture('equip/fleet2');
  for(let y=200;y<550;y++)for(let x=460;x<900;x++)covered.data.fill(100,(y*covered.width+x)*4,(y*covered.width+x)*4+3);
  assert((await observer.observe('equipTabs',covered)).valid);
  assert(!(await observer.observe('screen',covered)).valid);
});
test('equipment screen optionally returns the selected fleet without accepting an overlay',async()=>{
  const observer=new V.Observer(),frame=fixture('equip/fleet2');
  assert.deepEqual(await observer.observe('screen',frame,{includeFleet:true}),{valid:true,mode:'equipment',fleet:2});
  assert.deepEqual(await observer.observe('screen',frame),{valid:true,mode:'equipment'});
  assert(!(await observer.observe('screen',fixture('equip/confirm'),{includeFleet:true})).valid);
});

test('all-equipment removal recognizes the hovered label at the correct slot-count height',async()=>{
  const observer=new V.Observer({recognize(){throw Error('Equipment tooltip should not need OCR');}});
  for(const [name,fleet,slots,y] of [['equip/clear-hover-3',2,3,395],['equip/clear-hover-5',1,5,495]]) {
    const im=fixture(name);
    assert.deepEqual(await observer.observe('equipclear',im,{fleet,slots}),{valid:true,tab:{valid:true,selected:[fleet]},commit:{x:485,y}});
    for(const wrongSlots of [0,1,2,4,6])assert(!(await observer.observe('equipclear',im,{fleet,slots:wrongSlots})).valid);
    assert(!(await observer.observe('equipclear',im,{fleet:fleet===1?2:1,slots})).valid);
    const covered=new Pixels(im.width,im.height,Buffer.from(im.data));
    for(let row=y-10;row<y+12;row++)for(let x=474;x<556;x++)covered.data.fill(230,(row*im.width+x)*4,(row*im.width+x)*4+3);
    assert(!(await observer.observe('equipclear',covered,{fleet,slots})).valid);
  }
  for(const name of ['equip/fleet2','equip/confirm','equip/picker-transport','org/fleet'])
    assert(!(await observer.observe('equipclear',fixture(name),{fleet:2,slots:3})).valid);
});
test('live transport menu, list icons and confirmation are recognized',async()=>{
  const observer=new V.Observer({});
  const cells=await observer.observe('cells',fixture('equip/category-menu'));
  assert.deepEqual(cells.categories,Array.from({length:15},(_,i)=>i));
  assert.deepEqual(cells.centers[10],{x:811,y:483});
  const list=fixture('equip/picker-transport');
  for(const [row,t3] of [[0,20],[1,20],[2,25],[3,25]]) {
    const cy=Math.round(218+44.75*row),box=[552,cy-15,594,cy+15];
    assert((await observer.observe('rowicon',list,{box,t3})).valid);
    assert(!(await observer.observe('rowicon',list,{box,t3:t3===20?25:20})).valid);
  }
  assert((await observer.observe('pix',fixture('equip/confirm'),{pts:[[1075,655],[1040,655]],exp:[[19,113,114],[18,124,124]],tol:45})).valid);
});
test('dark category menu keeps the all-equipment row readable',async()=>{
  const observer=new V.Observer({});
  const cells=await observer.observe('cells',fixture('zoom125/category-menu-darkrows'));
  assert.equal(cells.valid,false);
  assert.equal(cells.categories[0],0);
  assert.deepEqual(cells.centers[0],{x:811,y:197});
});

test('live bomber picker rows classify despite similar aircraft icon family',async()=>{
  const observer=new V.Observer({}),im=fixture('equip/picker-airbomber-p1');
  // Bomber/fighter silhouettes mutually correlate ~0.95, so the 0.04
  // separation rule fails; the 0.99-tier top match must be accepted as-is.
  for(const [row,t3] of [[0,7],[1,7],[2,7]]) {
    const cy=Math.round(218+44.75*row),box=[546,cy-22,599,cy+22];
    assert((await observer.observe('rowicon',im,{box,t3})).valid,'row '+row);
    assert(!(await observer.observe('rowicon',im,{box,t3:8})).valid,'row '+row);
  }
});

test('equipment picker reads the retained category and page together without OCR',async()=>{
  const observer=new V.Observer({recognize(){throw Error('Category should not need OCR');}}),im=fixture('equip/picker-transport');
  const result=await observer.observe('equippicker',im,{total:161});
  assert(result.valid);assert.equal(result.primary,20);assert.equal(result.page.activePage,1);
  const covered=new Pixels(im.width,im.height,Buffer.from(im.data));
  for(let y=156;y<181;y++)for(let x=785;x<840;x++)covered.data.fill(230,(y*im.width+x)*4,(y*im.width+x)*4+3);
  const unknown=await observer.observe('equippicker',covered,{total:161});
  assert(unknown.valid);assert.equal(unknown.primary,null);assert.equal(unknown.page.activePage,1);
  for(const name of ['equip/category-menu','equip/fleet2','equip/confirm','org/fleet'])
    assert(!(await observer.observe('equippicker',fixture(name),{total:161})).valid,name);
});
for(const [name,page] of Object.entries({'org/page01':1,'org/page06b':6,'org/page11':11,'org/page11-alt':11})) {
  test('saved screenshot page '+name,async()=>{
    const im=fixture(name);assert.equal(V.pageread(im,{total:35}).activePage,page);
    assert.deepEqual(V.filterstate(im).states,[1,0,0,0,1,0,0,1]);
    assert(V.orgtab(im,2).valid);assert(!V.orgtab(im,1).valid);
    assert.deepEqual(await V.sortread(im),{valid:true,mode:'type',direction:'desc'});
  });
}
test('blank screens cannot confirm sort, filters, or pages',async()=>{
  for(const color of [0,255]) {
    const im=new Pixels(1200,720,Buffer.alloc(1200*720*4,color));
    assert(!V.pageread(im,{total:35}).valid);assert(!V.filterstate(im).valid);assert(!V.orgtab(im,2).valid);
    assert(!(await V.sortread(im,{recognize:async()=>({text:'NEW',confidence:100})})).valid);
  }
});
test('confirmation overlay is rejected as a page bar',()=>assert(!V.pageread(fixture('org/page06-card'),{total:35}).valid));
test('confirmation card gates on level digits and the teal 変更 button',async()=>{
  const arg={expectedLevel:92};
  const observer=new V.Observer({}),result=await observer.observe('cardidentity',fixture('org/page06-card'),arg);
  // p06 carries a GREY 変更 button (this row cannot actually be
  // re-organized), which must refuse even though the level matches.
  assert(!result.valid&&result.reason==='confirmation button not available (grey)',JSON.stringify(result));
  const wrong=await observer.observe('cardidentity',fixture('org/page06-card'),{expectedLevel:88});
  assert(!wrong.valid,'wrong expected level must refuse');
});

test('organization five-slot card skips unreadable level but still requires available confirmation',async()=>{
  const observer=new V.Observer(),im=fixture('identity/musashi-five-slot-card');
  assert.deepEqual(await observer.observe('cardidentity',im,{checkLevel:false}),{valid:true,commit:{x:1032,y:669}});
  assert(!(await observer.observe('cardidentity',im,{expectedLevel:97})).valid,'reproduce the old level-read failure');
  assert.deepEqual(await observer.observe('cardidentity',im,{expectedLevel:1,checkLevel:false}),{valid:true,commit:{x:1032,y:669}});
  const grey=new Pixels(im.width,im.height,Buffer.from(im.data));
  for(let y=646;y<690;y++)for(let x=1020;x<1103;x++){
    const p=(y*grey.width+x)*4,value=Math.round(grey.rgb(x,y).reduce((n,v)=>n+v,0)/3);
    grey.data.fill(value,p,p+3);
  }
  assert.deepEqual(await observer.observe('cardidentity',grey,{checkLevel:false}),{valid:false,reason:'confirmation button not available (grey)'});
});
test('isolated worker returns observations and rejects after dispose',{timeout:30000},async()=>{
  const observer=new WorkerObserver();
  try {
    await observer.start();const result=await observer.observe('pageread',fixture('org/page11').png(),{total:35});
    assert.equal(result.activePage,11);
  }finally{await observer.dispose();}
  await assert.rejects(observer.observe('pageread',Buffer.alloc(0),{}));
});

test('all 15 real equipment category headers and the full menu are recognized',async()=>{
  const observer=new V.Observer({recognize(){throw Error('Category recognition must not require OCR');}});
  for(let category=0;category<15;category++){
    const r=await observer.observe('equippicker',fixture('equip/menu-category-'+category),{total:161});
    assert(r.valid,'category '+category);assert.equal(r.category,category);
  }
  const menu=await observer.observe('cells',fixture('equip/menu-all'));
  assert(menu.valid);assert.deepEqual(menu.categories,Array.from({length:15},(_,i)=>i));
  assert(!(await observer.observe('equippicker',fixture('equip/menu-all'),{total:161})).valid);
});

test('ship level glyphs are independent of Japanese OCR and cover grey, green and blue digits',()=>{
  const {readNumber}=require('../../src/vision/numbers');
  for(const [name,expected] of [['org/list-normalized',[92,78,92,90,97,91,93,95,96,71]],['org/sort-new-normalized',[30,31,49,1,1,22,1,1,1,1]]]){
    const im=fixture(name);
    assert.deepEqual(expected.map((_,row)=>readNumber(im,[823,225+43*row,884,259+43*row])),expected.map(value=>({valid:true,value})));
  }
  assert.deepEqual(readNumber(fixture('org/page06-card'),[1120,160,1195,199]),{valid:true,value:92});
  // The remodel-screen header cell renders digits differently from organize
  // rows; the ushio capture's '8' broke matching against organize-only glyphs.
  assert.deepEqual(readNumber(fixture('equip/remodel-fail-ushio'),[744,160,790,195]),{valid:true,value:87});
  assert(!readNumber(new Pixels(1200,720,Buffer.alloc(1200*720*4,255)),[823,225,884,259]).valid);
});

test('union-filter predicted row anchors on position and level digits',async()=>{
  const observer=new V.Observer({});
  const arg={row:0,fleet:2,total:17,page:16,mask:[1,0,0,0,1,0,0,0],expectedLevel:92};
  // The predicted row reads level 92 (Fuso Kai Ni) and passes. A wrong
  // expected level refuses; same-name same-level duplicates no longer
  // refuse (monitor + store confirmation pin the exact instance).
  assert.deepEqual(await observer.observe('rowidentity',fixture('org/list-native'),arg),{valid:true,level:92});
  assert(!(await observer.observe('rowidentity',fixture('org/list-native'),{...arg,expectedLevel:71})).valid);
  assert.deepEqual(await observer.observe('rowidentity',fixture('org/list-native'),{...arg,expectedLevel:71,checkLevel:false}),{valid:true});
  assert(!(await observer.observe('rowidentity',fixture('org/list-native'),{...arg,page:15,checkLevel:false})).valid,'page mismatch still refuses');
});
