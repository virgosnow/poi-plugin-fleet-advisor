'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {antiAirBadge,antiAirCutins,fleetAntiAir,rocketBarrage,weightedAntiAir}=require('../../../src/domain/combat/anti_air_cutin');
const gear=(name,type=1,aa=10,icon=16)=>({type,master:{api_name:name,api_type:[0,0,type,icon],api_tyku:aa}});
const high=()=>gear('高角炮'),radar=()=>gear('对空电探',12,4,11),mg=()=>gear('机枪',21,9,15);
const read=(name,items,stype=2)=>antiAirCutins({master:{api_name:name,api_stype:stype},items});
const row=(rows,id)=>rows.find(c=>c.id===id);
test('generic CI bonuses reflect actual recipe and exclude Akizuki-only restrictions',()=>{
  const items=[high(),high(),radar()];let rows=read('测试舰',items);
  assert.equal(row(rows,5).multiplier,1.5);assert.equal(row(rows,5).fixed,4);
  assert.equal(row(rows,8).multiplier,1.4);assert(!row(read('秋月改',items),5));
  rows=read('秋月改',items);assert.equal(rows[0].id,1);assert.equal(rows[0].multiplier,1.7);assert.equal(rows[0].fixed,7);
  assert(!row(read('秋月改',[high(),radar()]),1));
});
test('Maya, Fletcher and Atlanta expose each eligible alternative without summing',()=>{
  let rows=read('摩耶改二',[high(),mg(),radar()],5);assert.equal(rows[0].id,10);assert.equal(rows[0].fixed,8);assert.equal(row(rows,11).multiplier,1.5);
  const f=gear('5inch単装砲 Mk.30改＋GFCS Mk.37');rows=read('Fletcher Mk.II',[f,f,radar()]);assert.equal(rows[0].id,34);assert.equal(rows[0].multiplier,1.6);
  const a=gear('GFCS Mk.37＋5inch連装両用砲(集中配備)');rows=read('Atlanta改',[a,a]);assert.equal(rows[0].id,38);assert.equal(rows[0].fixed,10);assert.equal(rows[0].multiplier,1.85);assert(row(rows,41));
});
test('modern dedicated recipes, expansion gear and unresolved values stay distinct',()=>{
  const gun=gear('10cm連装高角砲改＋高射装置改');let rows=read('初月改二',[gun,gun,radar()]);assert.equal(rows[0].id,48);assert.equal(rows[0].multiplier,1.75);
  const concentrated=gear('10cm連装高角砲群 集中配備'),range=gear('15m二重測距儀＋21号電探改二',13,8,11);
  rows=read('大和改二重',[concentrated,concentrated,range,mg()],9);assert.equal(rows[0].id,42);assert.equal(rows[0].fixed,10);
  rows=read('北上改三',[high(),radar()],4);assert.equal(row(rows,53).multiplier,null);assert.equal(row(rows,53).fixed,null);
  const b=antiAirBadge({master:{api_name:'秋月改',api_stype:2},items:[high(),high(),radar()]});
  assert.match(b.detail,/1型：64.4%，固定击坠×1.7，保底\+7机/);assert.match(b.detail,/每战择一/);
  assert.equal(b.detail.split('\n\n').length,3);assert(b.detail.startsWith('参考发动率：'));assert(!b.detail.includes('双高角炮'));
});

const close=(a,b)=>assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const target=(id,name,items,stype=2)=>({id,master:{api_name:name,api_stype:stype},items});
test('AACI rolls every eligible type independently; total is not the sum of base rolls',()=>{
  const t=target(1,'秋月改',[high(),high(),radar()]),before=JSON.stringify(t),context=fleetAntiAir([t]);
  close(context.total,1-(1-65/101)*(1-55/101)*(1-50/101));
  const badge=antiAirBadge(t,context);close(badge.rate,context.total);assert.equal(JSON.stringify(t),before);
  close(row(badge.cutins,1).rate,65/101);
  close(row(badge.cutins,2).rate,(1-65/101)*55/101);
  close(row(badge.cutins,3).rate,(1-65/101)*(1-55/101)*50/101);
  assert.match(badge.detail,/2型：19.4%，/);assert.match(badge.detail,/3型：8.0%，/);
  const newer=target(2,'初月改二',[gear('10cm連装高角砲改＋高射装置改'),gear('10cm連装高角砲改＋高射装置改'),radar()]);
  close(fleetAntiAir([newer]).total,1-(1-65/101)**2*(1-55/101)*(1-50/101));
});
test('AACI fleet priority and same-type position suppress lower-priority ships, not fleet coverage',()=>{
  const a=target(1,'秋月改',[high(),high(),radar()]),b=target(2,'秋月改',[high(),high(),radar()]);
  const single=fleetAntiAir([a]).total,c=fleetAntiAir([a,b]);
  close(c.total,1-(1-single)**2);assert(c.ships.get(1).rate>c.ships.get(2).rate);
  close(c.ships.get(1).rate+c.ships.get(2).rate,c.total);
  const atlanta=target(3,'Atlanta改',[gear('GFCS Mk.37＋5inch連装両用砲(集中配備)'),gear('GFCS Mk.37＋5inch連装両用砲(集中配備)')]);
  const fleet=fleetAntiAir([a,atlanta]),aRate=antiAirBadge(a,fleet).rate;
  close(aRate,single*(1-60/101)**2);
  const badge=antiAirBadge(a,fleet);
  close(badge.cutins.reduce((sum,c)=>sum+c.rate,0),badge.rate);
  for(const c of badge.cutins)assert(badge.detail.includes(`${c.id}型：${(c.rate*100).toFixed(1)+'%'}，`));
  const bBadge=antiAirBadge(b,c);
  close(row(bBadge.cutins,1).rate,(1-65/101)*65/101,'same-type position matters');
  assert.match(antiAirBadge(a,fleet).detail,/参考发动率：.*（本舰）\n全队参考发动率：/);
  const mixed=fleetAntiAir([a,target(4,'无对空',[gear('炮',2,0,2)])]);
  assert(!antiAirBadge(a,mixed).detail.includes('全队参考发动率'));
});

test('AACI per-type display distinguishes unknown rate from unknown effect and preserves the shared reading',()=>{
  const t=target(1,'北上改三',[high(),radar()],4),c=fleetAntiAir([t]),before=JSON.stringify([...c.ships]);
  const badge=antiAirBadge(t,c),newType=row(badge.cutins,53);
  assert(newType.rate>0);assert.equal(newType.multiplier,null);
  assert(badge.detail.includes(`53型：${(newType.rate*100).toFixed(1)+'%'}，击落加成待确认`));
  assert.equal(JSON.stringify([...c.ships]),before);
  const unknown=antiAirBadge(t,{...c,known:false,total:null});
  assert.match(unknown.detail,/53型：待确认，击落加成待确认/);
  assert(unknown.cutins.every(c=>c.rate===null));
});

test('AACI tooltip uses separate type/rate/effect cells and ordinary tooltips retain literal text',()=>{
  const {renderContent}=require('../../../src/ui/components/tooltip');
  const doc={createElement:()=>({className:'',children:[],textContent:'',appendChild(child){this.children.push(child);}})};
  const tip=doc.createElement();tip.className='paa-tooltip';
  const text='参考发动率：91.8%\n1型：64.4%，固定击坠×1.7，保底+7机\n10型：8.0%，固定击坠×1.65，保底+8机\n53型：待确认，击落加成待确认';
  renderContent(doc,tip,text,'aaci');
  assert.equal(tip.children[0].textContent,'参考发动率：91.8%');
  assert.equal(tip.children[1].className,'paa-tooltip-aa-grid');
  assert.deepEqual(tip.children[1].children.map(n=>n.textContent),[
    '类型','发动率','击落效果','1型','64.4%','固定击坠×1.7，保底+7机','10型','8.0%','固定击坠×1.65，保底+8机','53型','待确认','击落加成待确认']);
  const ordinary=doc.createElement();renderContent(doc,ordinary,text,'night');
  assert.equal(ordinary.textContent,text);assert.equal(ordinary.children.length,0);
  const unexpected=doc.createElement();renderContent(doc,unexpected,'未匹配的新格式 <b>安全文本</b>','aaci');
  assert.equal(unexpected.children[0].textContent,'未匹配的新格式 <b>安全文本</b>');
  const spaced=doc.createElement();renderContent(doc,spaced,'参考发动率：91.8%\n\n1型：64.4%，固定击坠×1.7，保底+7机\n\n每战择一。','aaci');
  assert.equal(spaced.children.length,3);assert(spaced.children.every(n=>n.className.includes('paa-tooltip-section')));
  assert.equal(spaced.children[1].children[0].className,'paa-tooltip-aa-grid');
  const optional=doc.createElement();renderContent(doc,optional,'固定发动\n\n\n攻击力：100 × 1击\n\n','asw');
  assert.equal(optional.children.length,2);assert.equal(optional.children[0].textContent,'固定发动');
  const power=optional.children[1].children[0];assert(power.className.includes('paa-tooltip-attack-single'));
  assert.equal(power.children[0].children[0].children[0].textContent,'攻击力');assert.equal(power.children[1].children[0].children[0].children[0].textContent,'100 × 1击');
  const single=doc.createElement();renderContent(doc,single,'固定发动','speed');assert.equal(single.children.length,0);assert.equal(single.textContent,'固定发动');
});

function barrageFixture(){
  const master={api_name:'测试航巡',api_stype:6,api_tyku:[20,70],api_ctype:999,api_aftershipid:'0'};
  const ship={api_ship_id:1,api_kyouka:[0,0,50,0,0],api_lucky:[20,99]};
  const t={id:1,master,ship,items:[],before:{slots:[],ex:-1},after:{slots:[],ex:-1}};
  const store={const:{$ships:{1:master},$equips:{}},info:{equips:{}}};
  const add=(id,type,name,aa,star=0,icon=0)=>{
    const e={id:t.items.length+100,master:{api_id:id,api_name:name,api_type:[0,0,type,icon],api_tyku:aa},type,
      instance:{api_slotitem_id:id,api_level:star}};
    t.items.push(e);t.after.slots.push(e.id);store.info.equips[e.id]=e.instance;store.const.$equips[id]=e.master;return e;
  };
  return {t,store,add,read:()=>rocketBarrage(t,store)};
}
test('barrage reference counts MG/high-angle/director/radar weights, stars and launcher count',()=>{
  const f=barrageFixture();assert.equal(f.read(),null);
  const rocket=f.add(274,21,'12cm30連装噴進砲改二',8);
  assert.equal(weightedAntiAir(f.store,f.t),118);close(f.read().rate,(118+18)/281);
  rocket.instance.api_level=9;assert.equal(weightedAntiAir(f.store,f.t),136);
  f.add(274,21,'12cm30連装噴進砲改二',8);close(f.read().rate,(184+18)/281+.15);
  f.t.items.pop();f.t.after.slots.pop();
  f.add(1,1,'高角',7,4,16);f.add(2,36,'高射',3,4);f.add(3,12,'电探',4,10);f.add(4,6,'飞机',12,10);
  assert.equal(weightedAntiAir(f.store,f.t),196);
  f.add(274,21,'12cm30連装噴進砲改二',8);assert.equal(f.read().rate,1);
  f.add(274,21,'12cm30連装噴進砲改二',8);assert.equal(f.read().rate,1);
  assert.equal(f.read().detail.split('\n\n').length,2);
});
test('barrage uses blue AA at 0.75, handles worn-panel fallback and unknown stats without guessing',()=>{
  const f=barrageFixture();f.t.master.api_name='伊勢改二';f.t.master.api_ctype=2;f.t.ship.api_ship_id=553;
  f.store.const.$ships={553:f.t.master};f.add(274,21,'12cm30連装噴進砲改二',8);
  f.add(319,6,'日向／伊势专属飞机',0);
  const blue=require('../../../src/domain/combat/equipment_bonuses').combatBonuses(f.store,f.t).antiAir;
  assert(blue>0);const weighted=2*Math.floor((118+.75*blue)/2);
  assert.equal(weightedAntiAir(f.store,f.t),weighted);close(f.read().rate,(weighted+18)/281+.25);
  f.t.before={slots:[100,101],ex:-1};f.t.ship.api_taiku=[78+blue,150];delete f.t.master.api_tyku;
  assert.equal(weightedAntiAir(f.store,f.t),weighted,'restore old raw and blue AA from panel');
  f.t.items=[];f.t.after.slots=[];assert.equal(weightedAntiAir(f.store,f.t),70,'removed blue AA cannot survive in hull');
  f.add(274,21,'12cm30連装噴進砲改二',8);delete f.t.ship.api_lucky;assert.equal(f.read().rate,null);
  assert.match(f.read().detail,/参考发动率：待确认/);
  f.t.ship.api_lucky=[20,99];delete f.t.ship.api_taiku;assert.equal(f.read().rate,null);
});
