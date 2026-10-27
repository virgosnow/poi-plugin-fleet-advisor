'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {equipmentEffects,groundBadge,groundConfiguration,routeGroundTargets,routeGroundEncounters,groundPower,groundCombatContext,fleetGroundScore,carrierGroundState}=require('../../../src/domain/combat/installation_attack');
const {groundLoadout,groundLoadouts}=require('../../../src/recommendation/loadout/ground_fitting');
const fixture=require('../../helpers/workbench_fixture');
const item=(name,type=24,stars=0)=>({master:{api_name:name,api_type:[0,0,type,0]},instance:{api_level:stars}});
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const effect=(names,target='soft',options={})=>equipmentEffects(names.map(n=>typeof n==='string'?item(n):n),target,options);
const profile=(name='港湾棲姫')=>({examples:[['A','B']],mapPreview:{nodes:[{id:'B',enemies:[{originalName:name}]}]}});

test('installation modifiers depend on target, not equipment category or map name',()=>{
  near(effect(['三式弾']).multiplier,2.5);near(effect(['三式弾'],'pillbox').multiplier,1);
  near(effect(['三式弾'],'island').multiplier,1.75);
  near(effect(['WG42 (Wurfgerät 42)']).multiplier,1.3);near(effect(['WG42 (Wurfgerät 42)']).addition,75);
  const e=effect(['WG42 (Wurfgerat 42)','艦載型 四式20cm対地噴進砲']);near(e.multiplier,1.625);near(e.addition,130);
  assert.equal(effect(['大発動艇(新型未收录)']).status,'unknown');
});
test('landing base is applied once; star averages and separate kami improvements stack',()=>{
  const army=item('大発動艇(八九式中戦車＆陸戦隊)',24,10),regiment=item('特大発動艇＋戦車第11連隊');
  const e=effect([army,regiment]);near(e.multiplier,2.31*1.8);near(e.addition,25);
  const kami=item('特二式内火艇',46,10),combo=effect([army,kami],'supply');
  near(combo.multiplier,2.52*2);near(combo.postMultiplier,3.1824*(1.7*4/3));
  assert.equal(combo.status,'known');
  near(effect([army,army]).multiplier,1.4*1.95*1.2);
  near(effect(['大発動艇','大発動艇']).multiplier,1.4);
});
test('affine steps retain the correct multiplication and addition order',()=>{
  const e=effect(['特大発動艇＋一式砲戦車']);near(e.multiplier,4.914);near(e.addition,74.5);
  const m4=effect(['M4A1 DD']);near(m4.multiplier,2.156);near(m4.addition,35);
  const katsu=effect(['特四式内火艇改']);near(katsu.multiplier,2.2176);near(katsu.addition,74.2);
  assert.equal(effect(['M4A1 DD','特大発動艇＋チハ改']).status,'unknown','unverified family stacking is not invented');
});
test('game API halfwidth names match fullwidth wiki equipment names',()=>{
  near(effect(['大発動艇(八九式中戦車&陸戦隊)']).multiplier,2.1);
  near(effect(['特大発動艇+戦車第11連隊']).multiplier,2.52);
  near(effect(['大発動艇(II号戦車/北アフリカ仕様)']).multiplier,2.1);
});
test('carrier ground attacks need live compatible aircraft and use the carrier power formula',()=>{
  const ordinary={...item('彗星',7),planes:18},torpedo={...item('流星',8),planes:18};
  const bomber={...item('F4U-1D',7),planes:18};bomber.master.api_baku=7;
  assert.equal(carrierGroundState([ordinary,torpedo]),'blocked');assert.equal(carrierGroundState([torpedo]),'ready');
  assert.equal(carrierGroundState([ordinary,bomber]),'ready');assert.equal(carrierGroundState([{...bomber,planes:0},ordinary]),'blocked');
  assert.equal(carrierGroundState([{...bomber,planes:null},ordinary]),'unknown');
  near(groundPower([bomber],['soft'],50,11),Math.floor((55+Math.floor(7*1.3)+15)*1.5)+25);
  assert.equal(groundPower([ordinary,torpedo,item('大発動艇')],['soft'],50,7),0);
});
test('armed landing synergy and day/night differences are explicit',()=>{
  const names=['武装大発','大発動艇'];near(effect(names).multiplier,1.4*1.1*1.2);near(effect(names).addition,10);
  near(effect(names,'soft',{night:true}).multiplier,1.4*1.2);
  const both=effect(['武装大発','装甲艇(AB艇)','特二式内火艇']);near(both.addition,20);
  near(effect(['武装大発','武装大発']).addition,0,'identical support boats alone have no synergy');
});
test('ground tooltip lists target attack power and preserves unknown attribute state',()=>{
  const badge=groundBadge({master:{api_stype:2},items:[item('WG42 (Wurfgerät 42)',37),item('特二式内火艇',46)]});
  assert.deepEqual(badge.categories.map(c=>c.label),['对地·登陆作战','对地·火箭弹']);assert.match(badge.detail,/软皮设施/);assert.match(badge.detail,/炮台小鬼/);
  assert.match(badge.detail,/集积地栖姬\n昼战攻击力：待确认 × 1击/);assert.equal(badge.state,'unknown');
  assert(!/上限前|上限后|加算|公式依据/.test(badge.detail));assert.equal(badge.attacks.length,4);
  assert(!groundBadge({master:{api_stype:2},items:[item('普通主炮',1)]}));
});

function referenceTarget(){
  const store=fixture(),ship=store.info.ships[1],master=store.const.$ships[1];
  Object.assign(master,{api_name:'测试重巡',api_stype:5,api_ctype:0,api_houg:[50,100],api_raig:[40,100],api_aftershipid:'0'});
  Object.assign(ship,{api_karyoku:[100,100],api_raisou:[40,100],api_kyouka:[10,0,0,0,0]});
  const items=[{...item('主炮',2),id:1,type:2,instance:{api_level:0,api_slotitem_id:1}},
    {...item('主炮',2),id:2,type:2,instance:{api_level:0,api_slotitem_id:2}},
    {...item('三式弾',18),id:3,type:18,instance:{api_level:0,api_slotitem_id:35}},
    {...item('WG42 (Wurfgerät 42)',37),id:4,type:37,instance:{api_level:0,api_slotitem_id:126}}];
  const state={slots:[1,2,3,4],ex:-1},target={id:1,ship,master,items,before:state,after:state};
  return {store,target};
}
test('ground reference power applies target effects before caps and supply bonus after, ignoring torpedo',()=>{
  const {store,target}=referenceTarget(),before=JSON.stringify([store,target]);
  const badge=groundBadge(target,store);
  assert.deepEqual(badge.attacks.map(r=>[r.target,r.day,r.night,r.nightHits]),[
    ['soft',234,371,2],['pillbox',224,291,2],['island',230,366,2],['supply',292,463,2]
  ]);
  assert.match(badge.detail,/软皮设施（港湾／北方）\n昼战攻击力：234 × 1击\n夜战攻击力：371 × 2击/);
  assert(!/上限前|加算|公式依据/.test(badge.detail));assert.equal(JSON.stringify([store,target]),before);
  target.ship.api_raisou=[999,999];target.master.api_raig=[999,999];
  assert.deepEqual(groundBadge(target,store).attacks,badge.attacks,'land attacks never use torpedo');
});
test('ground reference power uses intrinsic stats, current draft bonuses and day/night improvements',()=>{
  const {store,target}=referenceTarget();
  target.items[0].master.api_houg=20;target.items[1].master.api_houg=20;
  target.after={slots:[1,2,3,4,5],ex:-1};target.ship.api_karyoku=[9999,9999];
  let badge=groundBadge(target,store);assert.equal(badge.attacks[0].day,234);
  target.items[0].instance.api_level=9;
  assert(groundBadge(target,store).attacks[0].night>badge.attacks[0].night);
  delete target.ship.api_kyouka;badge=groundBadge(target,store);
  assert(badge.attacks.every(r=>r.day===null&&r.night===null));assert.equal(badge.state,'unknown');
});
test('carrier ground power uses bomber conversion and slot capacity; submarines only attack land at night',()=>{
  const {store,target}=referenceTarget();target.master.api_stype=11;target.master.api_maxeq=[18];
  target.items=[{...item('F4U-1D',7),id:1,type:7,instance:{api_level:0,api_slotitem_id:277}}];
  target.items[0].master.api_baku=7;target.before=target.after={slots:[1],ex:-1};
  let badge=groundBadge(target,store);assert.equal(badge.attacks[0].day,218);assert.equal(badge.attacks[0].night,null);
  assert(!badge.detail.includes('夜战攻击力'));
  target.master.api_maxeq=[0];badge=groundBadge(target,store);assert.equal(badge.state,'blocked');assert.equal(badge.attacks[0].day,null);
  assert.match(badge.detail,/昼战攻击力：不可用/);
  const sub=referenceTarget();sub.target.master.api_stype=13;badge=groundBadge(sub.target,sub.store);
  assert(badge.attacks.every(r=>r.day===null&&r.night!==null));
});

test('Hayasui Kai landing and aviation share the daytime carrier formula only with a drafted torpedo bomber',()=>{
  const {store,target}=referenceTarget();
  Object.assign(target.master,{api_name:'速吸改',api_stype:22,api_maxeq:[0,6,1]});target.ship.api_karyoku=[50,50];
  target.items=[{...item('大発動艇(八九式中戦車＆陸戦隊)'),id:1,type:24},
    {...item('流星',8),id:2,type:8},{...item('零式水上偵察機',10),id:3,type:10}];
  target.items[1].master.api_baku=5;target.items[1].master.api_raig=99;target.items[2].master.api_baku=2;
  target.before=target.after={slots:[1,2,3],ex:-1};
  const original=JSON.stringify([store,target]);let b=groundBadge(target,store);
  assert.deepEqual(b.categories.map(c=>c.id),['landing','aircraft']);
  assert.equal(b.attacks[0].day,223,'cap(floor((55*2.1+floor(7*1.3)+15)*1.5)+25)');
  assert.equal(b.attacks[0].night,115);assert.equal(b.attacks[0].nightReference,true);
  assert.match(b.detail,/夜战参考攻击力：115 × 1击/);
  assert(!b.detail.includes('昼战按普通炮击'));
  const nightReference=b.attacks.map(r=>r.night);
  assert(new Set(nightReference).size>1,'each installation keeps its own effect');
  assert.equal(JSON.stringify([store,target]),original);
  target.items[1].master.api_raig=999;
  assert.deepEqual(groundBadge(target,store).attacks,b.attacks,'neither day nor night land attacks use torpedo stat');
  target.master.api_maxeq[1]=0;b=groundBadge(target,store);assert.equal(b.state,'blocked');assert.equal(b.attacks[0].day,null);
  assert.equal(b.attacks[0].night,115,'surface night reference does not need live aircraft');
  target.master.api_maxeq[1]=null;b=groundBadge(target,store);assert.equal(b.state,'unknown');assert.equal(b.attacks[0].day,null);
  assert.equal(b.attacks[0].night,115);
  target.items.splice(1,1);target.before=target.after={slots:[1,-1,3],ex:-1};b=groundBadge(target,store);
  assert.deepEqual(b.categories.map(c=>c.id),['landing']);assert(b.attacks[0].night!==null,'removing torpedo bomber restores ordinary shelling');
  assert.deepEqual(b.attacks.map(r=>r.night),nightReference,'aircraft daytime conversion never leaks into night power');
  assert(!b.attacks.some(r=>r.nightReference));assert(!b.detail.includes('夜战参考攻击力'));
  for(const name of ['速吸','神威改母','しまね丸改','熊野丸改']){
    target.master.api_name=name;target.master.api_stype=name==='熊野丸改'?17:22;
    target.items.push({...item('流星',8),id:2,type:8});
    assert.deepEqual(groundBadge(target,store).categories.map(c=>c.id),['landing'],name+' cannot inherit Hayasui Kai aviation');
    target.items.pop();
  }
});

test('Hayasui Kai whole-loadout score shares daytime conversion and surface night reference with the badge',()=>{
  const store=fixture(),ship=store.info.ships[1],master=store.const.$ships[1];
  Object.assign(master,{api_name:'速吸改',api_stype:22,api_houg:[50,50],api_raig:[0,0],api_ctype:0,api_aftershipid:'0',api_slot_num:3,api_maxeq:[6,0,1]});
  Object.assign(ship,{api_slot:[101,102,103],api_slot_ex:-1,api_onslot:[6,0,1],api_karyoku:[50,50],api_raisou:[0,0],api_lucky:[8,99],api_kyouka:[0,0,0,0,0]});
  for(const [id,name,type,bomb]of [[101,'流星',8,5],[102,'大発動艇(八九式中戦車＆陸戦隊)',24,0],[103,'零式水上偵察機',10,2]]){
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0],api_baku:bomb};store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};
  }
  const entry={id:1,slots:[101,102,103],ex:-1},p=profile(),scheme={fleet:1,ships:[entry]},before=JSON.stringify([store,scheme]);
  const score=groundCombatContext(store,scheme,p).score(entry);
  assert.equal(score.attacks[0].day,223);assert.equal(score.attacks[0].night,115);
  assert.equal(JSON.stringify([store,scheme]),before);
  const items=[{...item('流星',8),planes:6},{...item('大発動艇(八九式中戦車＆陸戦隊)'),planes:0}];
  assert(groundPower(items,['soft'],50,22,master)>groundPower(items,['soft'],50,22,{api_stype:22,api_name:'速吸'}));
});
test('ground badges group by presentation and merge equipment without distinct effects',()=>{
  const army='大発動艇(八九式中戦車&陸戦隊)',kami='特二式内火艇',wg='WG42 (Wurfgerät 42)';
  for(const [names,labels]of [
    [['三式弾'],['攻击']],[[wg],['火箭弹']],[[wg,wg],['火箭弹']],[[army],['登陆作战']],[[kami],['登陆作战']],
    [[army,kami],['登陆作战']],[[army,kami,wg],['登陆作战','火箭弹']],[['三式弾',wg],['火箭弹']],
    [['特大発動艇+戦車第11連隊',kami],['登陆作战']],[['特四式内火艇改',wg],['登陆作战','火箭弹']],
    [['大発動艇'],['攻击']],[['大発動艇',wg],['火箭弹']],[['武装大発'],['登陆作战']],
    [['武装大発','大発動艇'],['登陆作战']],[['武装大発',wg],['登陆作战','火箭弹']],
    [['二式12cm迫撃砲改'],['火箭弹']],[[wg,'二式12cm迫撃砲改'],['火箭弹']]
  ])assert.deepEqual(groundConfiguration(names.map(n=>item(n))).categories.map(c=>c.label),labels.map(l=>l==='攻击'?'对地攻击':'对地·'+l),JSON.stringify(names));
  assert.equal(groundConfiguration([item('F4U-1D',7)],{carrier:true}).label,'对地·航空轰炸');
  const single=groundConfiguration([item('特大発動艇＋III号戦車J型')]);
  assert.equal(single.summary,'陆战队','one vehicle with multiple effect groups is not counted twice');
  const combo=groundConfiguration([item(army),item(kami),item(wg),item(wg)]);
  assert.equal(combo.summary,'陆战队＋特二式内火艇＋对地火箭×2');
  assert.match(combo.equipment,/WG42 \(Wurfgerät 42\) ×2/);
  const rare=groundConfiguration([item('三式弾'),item(army),item(kami),item(wg)]);
  assert.deepEqual(rare.categories.map(c=>c.id),['landing','rocket']);assert.equal(rare.summary,'三式弹＋陆战队＋特二式内火艇＋对地火箭');
});

test('only confirmed animation pairs get two labels; empty aircraft slots do not add aviation',()=>{
  const army=item('大発動艇(八九式中戦車&陸戦隊)'),bomber={...item('F4U-1D',7),planes:18};
  const read=items=>groundConfiguration(items,{carrier:true});
  assert.deepEqual(read([army,bomber]).categories.map(c=>c.id),['landing','aircraft']);
  assert.deepEqual(read([army,{...item('流星',8),planes:18}]).categories.map(c=>c.id),['landing','aircraft']);
  assert.deepEqual(read([army,{...bomber,planes:0}]).categories.map(c=>c.id),['landing']);
  assert.equal(read([item('大発動艇'),bomber]).label,'对地·航空轰炸');
  for(const items of [[bomber,item('WG42 (Wurfgerät 42)')],[army,bomber,item('WG42 (Wurfgerät 42)')]]){
    assert.equal(read(items).label,'对地攻击');assert.equal(read(items).unverifiedMix,true);
  }
  const shell=equipmentEffects([item('三式弾'),item('WG42 (Wurfgerät 42)')]);
  near(shell.multiplier,2.5*1.3);near(shell.addition,75);
  const combined=groundBadge({master:{api_stype:2},items:[army,item('特二式内火艇')]});
  assert.equal(combined.categories.length,1);assert.equal(combined.effects.length,4);
  assert.match(combined.detail,/软皮设施/);
  assert.match(combined.detail,/\n昼战攻击力：/);assert(!combined.detail.includes(' · '));
});

test('Momochi beaching requires her hull and land units, not Daihatsu army boats',()=>{
  const unit=item('九七式中戦車(チハ)',52),kami=item('特二式内火艇',46),rocket=item('WG42 (Wurfgerät 42)',37),mortar=item('二式12cm迫撃砲改',15);
  const read=(items,master={api_name:'第百一号輸送艦改'})=>groundConfiguration(items,{master});
  for(const master of [{api_id:727},{api_id:945},{api_name:'第百一号輸送艦'},{api_name:'第百一号输送舰改'}]){
    const cfg=read([unit],master);assert.equal(cfg.label,'对地·接岸登陆');assert.equal(cfg.categories[0].state,'ready');
    assert.deepEqual(cfg.beaching,{units:1,tanks:1,active:true});
  }
  assert.equal(read([unit],{api_name:'神州丸改',api_stype:17}).beaching,null);
  for(const items of [[item('大発動艇')],[item('大発動艇(八九式中戦車&陸戦隊)')],[kami]])assert.equal(read(items).beaching,null);
  assert.deepEqual(read([unit,unit,unit]).beaching,{units:3,tanks:2,active:true});
  assert.deepEqual(read([unit,kami]).categories.map(c=>c.id),['beaching']);
  for(const overrides of [rocket,mortar]){
    const single=read([unit,overrides]);assert.equal(single.beaching.active,false);assert.deepEqual(single.categories.map(c=>c.id),['rocket']);
    assert.deepEqual(read([unit,kami,overrides]).categories.map(c=>c.id),['landing','rocket']);
  }
});

test('beaching tooltip separates confirmed animation counts from unresolved attack power',()=>{
  const {store,target}=referenceTarget();target.master.api_name='第百一号輸送艦改';target.master.api_stype=17;
  target.items=[{...item('陸軍歩兵部隊',52),type:52},{...item('九七式中戦車(チハ)',52),type:52}];
  const before=JSON.stringify([store,target]),p=profile('集積地棲姫');
  let badge=groundBadge(target,store,{profile:p});assert.equal(badge.label,'对地·接岸登陆');
  assert.equal(badge.categories[0].state,'ready');assert.match(badge.detail,/陆战部队：2件\n演出战车：2辆/);
  assert.match(badge.detail,/优先攻击陆上目标/);assert.match(badge.detail,/集積地棲姫（B 点）/);
  assert.match(badge.detail,/攻击力：待确认 × 1击/);assert.match(badge.detail,/陆战部队对地倍率未收录/);
  assert(badge.attacks.every(a=>a.day===null&&a.night===null&&a.dayHits===1&&a.nightHits===1));
  assert.equal(JSON.stringify([store,target]),before);
  assert.equal(groundBadge(target,store,{profile:profile('戦艦ル級')}),null);
  target.items.push({...item('二式12cm迫撃砲改',15),type:15});badge=groundBadge(target,store,{profile:p});
  assert.equal(badge.label,'对地·火箭弹');assert.match(badge.detail,/接岸登陆演出被迫击炮覆盖/);assert(!badge.detail.includes('演出战车'));
});
test('target discovery uses only selected paths and excludes flooded surface ships',()=>{
  const p=profile();p.mapPreview.nodes.push({id:'C',enemies:[{originalName:'砲台小鬼'}]});
  assert.deepEqual(routeGroundTargets(p),['soft']);
  assert.deepEqual(routeGroundTargets({...p,examples:[['C']]}),['pillbox']);
  assert.deepEqual(routeGroundTargets(profile('集積地棲姫III バカンスmode')),[]);
  const raid=profile('飛行場姫');raid.mapPreview.nodes[0].kind='aerialRaid';assert.deepEqual(routeGroundTargets(raid),[],'air raids do not expose a land installation for shelling');
  assert(groundPower([item('三式弾',18)],['soft'],80,5)>groundPower([item('三式弾',18)],['pillbox'],80,5));
});
function fittingFixture(){
  const store=fixture(),sm=store.const.$ships[1],ship=store.info.ships[1];
  sm.api_slot_num=4;sm.api_maxeq=[0,0,0,0];ship.api_slot=[-1,-1,-1,-1];ship.api_slot_ex=-1;
  store.const.$shipTypes[3]={api_equip_type:{1:1,18:1,24:1,37:1,46:1,12:1}};
  let next=600;const equip=(name,type,stats={},stars=0)=>{
    const id=next++;store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0],...stats};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:stars};return id;
  };
  const guns=[equip('主炮1',1,{api_houg:6}),equip('主炮2',1,{api_houg:6})];
  const armor=equip('电探',12,{api_saku:2});
  const ids={army:equip('大発動艇(八九式中戦車＆陸戦隊)',24,{},10),kami:equip('特二式内火艇',46,{},10),wg:equip('WG42 (Wurfgerät 42)',37),shell:equip('三式弾',18)};
  const inventory=Object.values(store.info.equips).map(e=>({id:e.api_id,master:store.const.$equips[e.api_slotitem_id]}));
  return {store,ids,inventory,scheme:{fleet:1,ships:[{id:1,slots:[...guns,armor,-1],ex:-1}]}};
}
test('fitter builds a combination after the first item and respects held slots and inventory',()=>{
  const f=fittingFixture(),before=JSON.stringify(f.store),p=profile('集積地棲姫');
  const result=groundLoadout(f.store,f.scheme,f.inventory,{profile:p});assert(result);
  const ids=result.ships[0].slots.concat(result.ships[0].ex).filter(id=>id>0);
  assert(ids.includes(f.ids.kami));assert(ids.includes(f.ids.army));assert.equal(new Set(ids).size,ids.length);
  const heldSlots=[{...f.scheme.ships[0],keep:{0:true,1:true,2:true,3:true,ex:true}}];
  assert.equal(groundLoadout(f.store,f.scheme,f.inventory,{profile:p,heldSlots}),null);
  assert.equal(groundLoadout(f.store,f.scheme,f.inventory,{profile:profile('戦艦ル級')}),null);
  assert.equal(JSON.stringify(f.store),before);
  const soft=groundLoadout(f.store,f.scheme,f.inventory,{profile:profile()});
  assert(soft.ships[0].slots.some(id=>Number(f.store.const.$equips[id]?.api_type?.[2])===1),'retain at least one gun on soft installation routes');
});

function combatFixture(){
  const f=fittingFixture(),{store}=f;
  Object.assign(store.const.$ships[1],{api_houg:[60,100],api_ctype:0,api_aftershipid:'0',api_maxeq:[0,0,2,0]});
  Object.assign(store.info.ships[1],{api_karyoku:[60,100],api_kyouka:[0,0,0,0,0],api_lucky:[20,50]});
  store.const.$shipTypes[3].api_equip_type[10]=1;
  store.const.$equips[620]={api_id:620,api_name:'水偵',api_type:[0,0,10,0],api_saku:8};
  store.info.equips[620]={api_id:620,api_slotitem_id:620,api_level:0,api_alv:0};
  store.const.$equips[621]={api_id:621,api_name:'艦戦',api_type:[0,0,6,0],api_tyku:8};
  store.info.equips[621]={api_id:621,api_slotitem_id:621,api_level:0,api_alv:0};
  Object.assign(store.const.$ships[2],{api_stype:11,api_maxeq:[18,0]});
  Object.assign(store.info.ships[2],{api_slot:[621,-1],api_onslot:[18,0]});
  f.scheme.ships.push({id:2,slots:[621,-1],ex:-1});
  f.inventory=Object.values(store.info.equips).map(e=>({id:e.api_id,master:store.const.$equips[e.api_slotitem_id]}));
  f.p=profile();f.p.mapPreview.nodes.unshift({id:'A',kind:'battle',enemies:[{originalName:'戦艦ル級'}]});
  f.reference={status:'known',paths:[['A','B']],nodes:[{id:'A',kind:'battle',noAirBattle:true},
    {id:'B',kind:'battle',boss:true,enemyAirPower:0,antiAir:{status:'known',fixed:0,proportion:0}}]};
  f.guns=f.scheme.ships[0].slots.slice(0,2);
  return f;
}

test('ground score combines day/night double attacks and uses the land node air state after losses',()=>{
  const f=combatFixture(),entry={id:1,slots:[...f.guns,620,f.ids.shell],ex:-1};
  const scheme={...f.scheme,ships:[entry,f.scheme.ships[1]]};
  const context=groundCombatContext(f.store,scheme,f.p,{airReference:f.reference});
  const reading=context.score(entry).attacks[0];
  assert(reading.dayDoubleRate>0);assert.equal(reading.nightHits,2);
  const noScout={...entry,slots:[...f.guns,f.ids.wg,f.ids.shell]};
  assert.equal(context.score(noScout).attacks[0].dayDoubleRate,0);
  const thirdGun=structuredClone(f.store);thirdGun.const.$equips[622]={api_id:622,api_name:'第三主炮',api_type:[0,0,1,1]};
  thirdGun.info.equips[622]={api_id:622,api_slotitem_id:622,api_level:0};
  assert.equal(groundCombatContext(thirdGun,scheme,f.p,{airReference:f.reference}).score({...entry,slots:[...f.guns,622,f.ids.shell]}).attacks[0].nightHits,1,
    'three main guns must not receive a double-attack bonus');
  const high={...f.reference,nodes:f.reference.nodes.map(n=>n.id==='B'?{...n,enemyAirPower:999}:n)};
  assert.equal(groundCombatContext(f.store,scheme,f.p,{airReference:high}).score(entry).attacks[0].dayDoubleRate,0);
  const loss={status:'estimated',paths:[{steps:[{node:'A',before:{min:100},required:{superiority:30,supremacy:60}},
    {node:'B',before:{min:10},required:{superiority:30,supremacy:60}}]}]};
  assert.equal(groundCombatContext(f.store,scheme,f.p,{airReference:f.reference,airEstimate:loss}).score(entry).attacks[0].dayDoubleRate,0,
    'departure air power must not stand in for arrival air state');
  const empty=structuredClone(f.store);empty.info.ships[2].api_onslot=[0,0];
  assert.equal(groundCombatContext(empty,scheme,f.p,{airReference:f.reference}).score(entry).attacks[0].dayDoubleRate,0);
  const noCapacity=structuredClone(f.store);noCapacity.const.$ships[1].api_maxeq=[0,0,0,0];
  assert.equal(groundCombatContext(noCapacity,scheme,f.p,{airReference:f.reference}).score(entry).attacks[0].dayDoubleRate,0);
});

test('whole ground packages restore double guns, retain depot specialists and preserve fixed slots',()=>{
  const f=combatFixture(),before=JSON.stringify(f.store);
  const bare={id:1,slots:[f.ids.army,f.ids.kami,f.ids.wg,f.ids.shell],ex:-1};
  const scheme={...f.scheme,ships:[bare,f.scheme.ships[1]]};
  const variants=groundLoadouts(f.store,scheme,f.inventory,{profile:f.p,airReference:f.reference});
  assert(variants.length&&variants.length<=3);
  assert(variants.some(s=>s.ships[0].slots.filter(id=>f.guns.includes(id)).length===2),'a whole package escapes the all-ground local optimum');
  const best=variants[0].ships[0];assert.equal(best.slots.filter(id=>f.guns.includes(id)).length,2);
  assert(best.slots.includes(f.ids.shell));
  const depot=groundLoadout(f.store,f.scheme,f.inventory,{profile:profile('集積地棲姫'),airReference:f.reference});
  assert(depot.ships[0].slots.includes(f.ids.army)&&depot.ships[0].slots.includes(f.ids.kami),JSON.stringify(depot));
  const three=structuredClone(f.store);three.const.$ships[1].api_slot_num=3;three.const.$ships[1].api_maxeq=[0,0,0];
  three.info.ships[1].api_slot=[-1,-1,-1];
  const compact={...f.scheme,ships:[{id:1,slots:[...f.guns,f.ids.shell],ex:-1},f.scheme.ships[1]]};
  const specialist=groundLoadout(three,compact,f.inventory,{profile:profile('集積地棲姫'),airReference:f.reference});
  assert(specialist.ships[0].slots.includes(f.ids.army)&&specialist.ships[0].slots.includes(f.ids.kami));
  assert.equal(specialist.ships[0].slots.filter(id=>f.guns.includes(id)).length,0,'a three-slot depot specialist can beat double guns');
  const keep={...bare,keep:{0:true,1:true,2:true,3:true,ex:true}};
  assert.deepEqual(groundLoadouts(f.store,scheme,f.inventory,{profile:f.p,heldSlots:[keep],airReference:f.reference}),[]);
  for(const s of variants){const ids=s.ships.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0);assert.equal(new Set(ids).size,ids.length);}
  assert.equal(JSON.stringify(f.store),before);
});

test('mixed-route ground fitting may replace excess sonar but retains the escort and manual packages',()=>{
  const f=combatFixture(),{store}=f;
  store.const.$equips[580]={api_id:580,api_name:'测试声呐',api_type:[0,0,14,14],api_tais:12};
  store.const.$shipTypes[2]={api_equip_type:{14:1}};
  Object.assign(store.info.ships[1],{api_taisen:[20,20]});
  const escorts=[3,4].map((id,n)=>{
    Object.assign(store.const.$ships[id],{api_ctype:0,api_aftershipid:'0'});
    Object.assign(store.info.ships[id],{api_taisen:[90,90]});
    return {id,slots:[8000+n,-1],ex:0};
  });
  for(const id of [8000,8001,8002])store.info.equips[id]={api_id:id,api_slotitem_id:580,api_level:0};
  const hitter={id:1,slots:[...f.guns,8002,f.ids.shell],ex:-1};
  const scheme={...f.scheme,ships:[hitter,f.scheme.ships[1],...escorts]};
  const p={...f.p,targetNodes:['B'],counts:{asw:{maximum:1},surface:{maximum:1}},
    mapPreview:{nodes:f.p.mapPreview.nodes.map(node=>({...node,kind:node.id==='A'?'asw':'battle'}))}};
  const inventory=Object.values(store.info.equips).map(e=>({id:e.api_id,master:store.const.$equips[e.api_slotitem_id]}));
  const before=JSON.stringify(store),variants=groundLoadouts(store,scheme,inventory,{profile:p,airReference:f.reference});
  assert(variants.some(s=>!s.ships[0].slots.includes(8002)&&s.ships[0].slots.filter(id=>f.guns.includes(id)).length===2));
  for(const s of variants)for(const escort of escorts)assert.deepEqual(s.ships.find(e=>e.id===escort.id),escort);
  const locked=groundLoadouts(store,scheme,inventory,{profile:p,heldSlots:[{...hitter,keep:{2:true}}],airReference:f.reference});
  assert(locked.every(s=>s.ships[0].slots[2]===8002));
  assert.equal(JSON.stringify(store),before);
});

test('conditional ground references never override the selected route air state',()=>{
  const {store,target}=referenceTarget();target.items.push({...item('水上侦察机',10),id:5,type:10});
  target.after={slots:[1,2,3,4,5],ex:-1};target.master.api_maxeq=[0,0,0,0,4];
  assert.equal(groundBadge(target,store,{conditionalDayDouble:true}).attacks[0].dayHits,2);
  const p=profile(),context={combatPlanes:true,states:new Map([['B','none']])};
  const read=()=>groundBadge(target,store,{profile:p,context,conditionalDayDouble:true});
  assert.equal(read().attacks[0].dayHits,1);context.states.set('B','superiority');
  let badge=read();assert.equal(badge.attacks[0].dayHits,2);assert(!badge.attacks[0].dayConditional);
  assert.match(badge.detail,/昼战连击按路线制空估算/);
  context.combatPlanes=false;assert.equal(read().attacks[0].dayHits,1);
});

test('ground ranking and tooltip follow selected enemy identities and omit off-route target categories',()=>{
  const f=combatFixture(),entry={id:1,slots:[...f.guns,620,f.ids.shell],ex:-1};
  const p={...f.p,mapPreview:{nodes:[...f.p.mapPreview.nodes,{id:'C',kind:'battle',enemies:[{originalName:'集積地棲姫',name:'集积地栖姬'}]}]}};
  assert.deepEqual(routeGroundEncounters(p).map(n=>n.targets),[['soft']]);
  const {store,target}=referenceTarget();
  let badge=groundBadge(target,store,{profile:p});
  assert.equal(badge.attacks.length,1);assert.match(badge.detail,/港湾棲姫（B 点）/);
  assert(!/集积地|离岛|炮台/.test(badge.detail));
  const depot={...p,examples:[['C']]};badge=groundBadge(target,store,{profile:depot});
  assert.equal(badge.attacks.length,1);assert.match(badge.detail,/集积地栖姬（C 点）/);assert(!badge.detail.includes('港湾'));
  assert.equal(groundBadge(target,store,{profile:profile('戦艦ル級')}),null);
  const score=fleetGroundScore(f.store,{...f.scheme,ships:[entry,f.scheme.ships[1]]},p,undefined,{airReference:f.reference});
  assert.deepEqual(score.targets,['soft']);
  const pending=groundBadge(target,store,{profile:{...p,examples:[]}});assert.equal(pending.attacks.length,0);assert.match(pending.detail,/选择路线/);
  const unknown=groundBadge(target,store,{profile:{examples:[['A']],mapPreview:{nodes:[{id:'A',kind:'battle',enemies:[],threatStatus:'unknown'}]}}});
  assert.equal(unknown.state,'unknown');assert.match(unknown.detail,/敌情资料不足/);assert.equal(unknown.attacks.length,0);
});

test('shared ground scores retain flagship, air state, enemy and fleet scouting dependencies',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner'),f=combatFixture();
  const entry={...f.scheme.ships[0],slots:[...f.guns,620,f.ids.shell]},scheme={...f.scheme,ships:[entry,f.scheme.ships[1]]};
  const poor={...f.reference,nodes:f.reference.nodes.map(n=>({...n,enemyAirPower:n.noAirBattle?0:1000}))};
  const reads=[()=>groundCombatContext(f.store,scheme,f.p,{airReference:f.reference}).score(entry),
    ()=>groundCombatContext(f.store,scheme,f.p,{airReference:f.reference}).score(entry,undefined,{flagship:false}),
    ()=>groundCombatContext(f.store,scheme,f.p,{airReference:poor}).score(entry),
    ()=>groundCombatContext(f.store,scheme,profile('砲台小鬼'),{airReference:f.reference}).score(entry),
    ()=>groundCombatContext(f.store,scheme,f.p,{airReference:f.reference}).score({...entry,slots:[...f.guns,f.ids.wg,f.ids.shell]})];
  const expected=reads.map(read=>read());
  assert.notDeepEqual(expected[0],expected[2]);assert.notDeepEqual(expected[0],expected[3]);
  withEquipmentIndexCache(f.store,()=>{for(let i=0;i<3;i++)reads.forEach((read,j)=>assert.deepEqual(read(),expected[j]));});
  f.store.info.ships[2].api_sakuteki[0]+=80;
  const live=reads[0]();assert.deepEqual(withEquipmentIndexCache(f.store,reads[0]),live);
});

test('ground fitting memo preserves held slots, inventory, enemy, air conditions and returned ownership',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner');
  const {PerformanceTrace}=require('../../../src/shared/performance_trace');
  const f=combatFixture(),base={profile:f.p,airReference:f.reference};
  const options=[base,{...base,packages:false},{...base,heldSlots:f.scheme.ships.map(e=>({...e,keep:Object.fromEntries(e.slots.map((_,i)=>[i,true]))}))},
    {...base,profile:profile('集積地棲姫')},{...base,airReference:{...f.reference,nodes:f.reference.nodes.map(n=>({...n,enemyAirPower:9999}))}}];
  const expected=options.map(o=>groundLoadouts(f.store,f.scheme,f.inventory,o));assert(expected[0].length);
  const reduced=f.inventory.slice(0,2),less=groundLoadouts(f.store,f.scheme,reduced,base),trace=new PerformanceTrace();
  trace.run(()=>withEquipmentIndexCache(f.store,()=>{
    for(let repeat=0;repeat<2;repeat++)options.forEach((o,i)=>{
      const result=groundLoadouts(f.store,f.scheme,f.inventory,o);assert.deepEqual(result,expected[i]);
      if(result[0])result[0].ships[0].slots.fill(-1);
    });
    assert.deepEqual(groundLoadouts(f.store,f.scheme,reduced,base),less);
  }));
  assert(trace.counters['loadout.ground.hit']>=5);
});

test('ground damage facts survive changed air states without reusing fleet scouting or flagship rates',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner'),f=combatFixture();
  const entry={...f.scheme.ships[0],slots:[...f.guns,620,f.ids.shell]},scheme={...f.scheme,ships:[entry,f.scheme.ships[1]]};
  const cases=[];
  for(const enemy of [0,20,5000])for(const name of ['港湾棲姫','砲台小鬼','集積地棲姫'])for(const flagship of [true,false]){
    const ref={...f.reference,nodes:f.reference.nodes.map(n=>({...n,enemyAirPower:enemy}))};
    const p=profile(name);cases.push(()=>groundCombatContext(f.store,scheme,p,{airReference:ref,scoreCache:new Map()}).score(entry,80,{flagship}));
  }
  const expected=cases.map(read=>read());
  withEquipmentIndexCache(f.store,()=>{for(let pass=0;pass<2;pass++)cases.forEach((read,i)=>assert.deepEqual(read(),expected[i]));});
  f.store.info.ships[entry.id].api_karyoku[0]+=30;
  const fresh=cases[0]();assert.deepEqual(withEquipmentIndexCache(f.store,cases[0]),fresh);
});

test('ground broad fitting skips combat preparation when every slot is held',()=>{
  const {PerformanceTrace}=require('../../../src/shared/performance_trace'),f=combatFixture();
  const trace=new PerformanceTrace(),heldSlots=f.scheme.ships.map(e=>({...e,
    keep:{...Object.fromEntries(e.slots.map((_,i)=>[i,true])),ex:true}}));
  const result=trace.run(()=>groundLoadouts(f.store,f.scheme,f.inventory,
    {profile:f.p,airReference:f.reference,packages:false,heldSlots}));
  assert.deepEqual(result,[]);assert.equal(trace.counters['ground.context.miss']||0,0);
  assert.equal(trace.counters['ground.noCandidates'],f.scheme.ships.length);
});

test('different ground trials share preparation without sharing mutable results or stock allocation',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner');
  const {PerformanceTrace}=require('../../../src/shared/performance_trace'),f=combatFixture();
  const base={profile:f.p,airReference:f.reference,packages:false};
  // Distinct holds bypass the complete-result cache without changing the plan.
  const options=[base,{...base,heldSlots:[{id:2,keep:{}}]},
    {...base,heldSlots:[{id:1,keep:{}},{id:2,keep:{}}]}];
  const expected=options.map(o=>groundLoadouts(f.store,f.scheme,f.inventory,o));
  assert(expected[0].length);
  const trace=new PerformanceTrace(),before=JSON.stringify([f.scheme,f.inventory]);
  trace.run(()=>withEquipmentIndexCache(f.store,()=>options.forEach((o,i)=>{
    const actual=groundLoadouts(f.store,f.scheme,f.inventory,o);assert.deepEqual(actual,expected[i]);
    const ids=actual[0].ships.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0);
    assert.equal(ids.length,new Set(ids).size);
    actual[0].ships[0].slots.fill(-1);
  })));
  assert.equal(trace.counters['ground.inventory.build'],1);
  assert(trace.counters['ground.context.hit']>0);
  assert.equal(JSON.stringify([f.scheme,f.inventory]),before);
});

test('shared ground preparation distinguishes changed fleet order, equipment ownership, enemy and air input',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner'),f=combatFixture();
  const base={profile:f.p,airReference:f.reference,packages:false};
  const occupied=structuredClone(f.scheme);occupied.ships[1].slots[1]=f.ids.shell;
  const changed=structuredClone(f.scheme);changed.ships[0].slots[2]=620;
  const cases=[[f.scheme,base],[{...f.scheme,ships:f.scheme.ships.slice().reverse()},base],[occupied,base],[changed,base],
    [f.scheme,{...base,profile:profile('集積地棲姫')}],
    [f.scheme,{...base,airReference:{...f.reference,nodes:f.reference.nodes.map(n=>({...n,enemyAirPower:9999}))}}]];
  const expected=cases.map(([s,o])=>groundLoadouts(f.store,s,f.inventory,o));
  withEquipmentIndexCache(f.store,()=>cases.forEach(([s,o],i)=>assert.deepEqual(groundLoadouts(f.store,s,f.inventory,o),expected[i])));
  for(const result of expected[2]){
    const ids=result.ships.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0);assert.equal(ids.length,new Set(ids).size);
  }
  // New searches and live reads must rebuild legality after master permissions change.
  f.store.const.$shipTypes[3].api_equip_type={1:1,10:1};
  const fresh=groundLoadouts(f.store,f.scheme,f.inventory,base);
  assert.notDeepEqual(fresh,expected[0]);
  assert.deepEqual(withEquipmentIndexCache(f.store,()=>groundLoadouts(f.store,f.scheme,f.inventory,base)),fresh);
});
