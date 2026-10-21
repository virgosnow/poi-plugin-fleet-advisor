'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {fleetMechanisms,fleetSpeed,aircraftCapacity}=require('../../../src/domain/combat/ship_mechanisms');

function setup(name='测试舰',type=2){
  const store=fixture();Object.assign(store.const.$ships[1],{api_name:name,api_stype:type,api_slot_num:5,api_maxeq:[0,0,4,4,4]});
  Object.assign(store.info.ships[1],{api_slot:[-1,-1,-1,-1,-1],api_onslot:[0,0,4,4,4],api_slot_ex:-1,api_taisen:[100,100],api_nowhp:30,api_maxhp:30});
  let next=100;
  const equip=(name,type,stats={})=>{
    const id=next++;store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0],...stats};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};return id;
  };
  const draft={id:1,slots:[-1,-1,-1,-1,-1],ex:-1};
  const read=(key,entries=[draft])=>fleetMechanisms(store,entries).get(1).find(b=>b.key===key);
  const worn=()=>{store.info.ships[1].api_slot=draft.slots.slice();store.info.ships[1].api_slot_ex=draft.ex;};
  return {store,draft,equip,read,worn};
}

test('Momochi has a confirmed beaching label for drafted land units, with the proper override priority',()=>{
  const f=setup('第百一号輸送艦改',17),unit=f.equip('九七式中戦車(チハ)',52),kami=f.equip('特二式内火艇',46),rocket=f.equip('WG42 (Wurfgerät 42)',37);
  f.draft.slots[0]=unit;f.worn();
  let badge=f.read('ground');assert.equal(badge.label,'对地·接岸登陆');assert.equal(badge.variant,'beaching');assert.equal(badge.state,'ready');
  f.draft.slots[1]=kami;assert.equal(f.read('ground').variant,'beaching');
  f.draft.slots[2]=rocket;const badges=fleetMechanisms(f.store,[f.draft]).get(1).filter(b=>b.key==='ground');
  assert.equal(badges.length,1);assert.equal(badges[0].variant,'combined');assert.equal(badges[0].label,'对地·登陆／火箭');
  assert.deepEqual(badges[0].categories.map(c=>c.id),['landing','rocket']);
  f.draft.slots.fill(-1);assert.equal(f.read('ground'),undefined,'old worn land units cannot activate a draft label');
  f.draft.slots[0]=unit;f.store.const.$ships[1].api_name='神州丸改';assert.notEqual(f.read('ground').variant,'beaching');
});

test('day air attacks include seaplane cruisers and tenders and use fully supplied draft slots',()=>{
  for(const [name,type]of [['矢矧改二乙',3],['最上改二特',6],['伊勢改二',10],['瑞穂',16],['伊401改',14]]){
    const f=setup(name,type);f.draft.slots[2]=f.equip('瑞雲',11);f.store.info.ships[1].api_onslot.fill(0);
    const before=JSON.stringify([f.store,f.draft]),badge=f.read('opening-air');
    assert.equal(badge.label,'开幕航空攻击');assert.equal(badge.state,'ready');assert.match(badge.detail,/开幕航空战中攻击敌舰/);
    assert(!badge.detail.includes('炮击阶段也可'));assert.equal(JSON.stringify([f.store,f.draft]),before);
    f.store.info.ships[1].api_nowhp=1;assert.equal(f.read('opening-air').state,'ready');
    f.draft.slots[0]=f.draft.slots[2];f.draft.slots[2]=-1;assert.equal(f.read('opening-air').state,'blocked');
    delete f.store.const.$ships[1].api_maxeq;assert.equal(f.read('opening-air').state,'unknown');
    f.store.const.$ships[1].api_maxeq=[0,0,4,4,4];f.draft.ex=f.draft.slots[0];f.draft.slots[0]=-1;
    assert(!f.read('opening-air'),'expansion aircraft do not launch');
  }
});

test('day air attack types exclude fighters, scouts, ASW patrol planes and land-based jets',()=>{
  const f=setup('赤城改二',11);
  for(const type of [7,8,11,57,58]){f.draft.slots[2]=f.equip('攻击机',type);assert.equal(f.read('opening-air').state,'ready');}
  for(const type of [6,9,10,25,26,41,45,56,59]){f.draft.slots[2]=f.equip('非对舰攻击机',type);assert(!f.read('opening-air'));}
  const land=f.equip('Ho229',57);f.store.const.$equips[land].api_type[0]=21;f.draft.slots[2]=land;
  assert(!f.read('opening-air'));f.draft.slots[2]=-1;assert(!f.read('opening-air'));
});

test('opening air badges separate seaplane and carrier aircraft without duplicating equal plane families',()=>{
  const f=setup('测试舰',6);f.draft.slots[2]=f.equip('瑞雲',11);f.draft.slots[3]=f.equip('瑞雲12型',11);
  const read=()=>fleetMechanisms(f.store,[f.draft]).get(1).filter(b=>b.key==='opening-air');
  assert.deepEqual(read().map(b=>[b.variant,b.state]),[['seaplane','ready']]);
  f.draft.slots[4]=f.equip('流星',8);assert.deepEqual(read().map(b=>b.variant),['aircraft','seaplane']);
  f.store.const.$ships[1].api_maxeq[4]=0;assert.deepEqual(read().map(b=>b.state),['blocked','ready']);
  f.store.const.$ships[1].api_maxeq[2]=null;f.draft.slots[3]=-1;
  assert.deepEqual(read().map(b=>b.state),['blocked','unknown'],'each family uses only its own aircraft capacity');
  f.draft.slots.fill(-1);assert.equal(read().length,0,'old equipped aircraft do not survive draft removal');
});

test('only carrier opening ASW requests aircraft artwork; synergy always retains depth-charge artwork',()=>{
  const f=setup('大鷹改二',7);f.draft.slots[2]=f.equip('四式水中聴音機',14);f.draft.slots[3]=f.equip('三式爆雷投射機',15);f.draft.slots[4]=f.equip('九七式艦攻(九三一空)',8,{api_tais:7});
  for(const type of [7,11,18]){
    f.store.const.$ships[1].api_stype=type;
    assert.equal(f.read('asw-synergy').effect,undefined);
    // Known unconditional carrier opening ASW also receives the same artwork.
    if(type===7)assert.equal(f.read('asw').effect,'aviation');
  }
  f.store.const.$ships[1].api_stype=2;
  assert.equal(f.read('asw').effect,undefined);assert.equal(f.read('asw-synergy').effect,undefined);
});

test('opening air attacks remain available to damaged carriers without promising shelling attacks',()=>{
  for(const type of [7,11,18]){
    const f=setup('测试空母',type);f.draft.slots[2]=f.equip('流星',8);
    assert.equal(f.read('opening-air').state,'ready');assert(!f.read('opening-air').detail.includes('炮击阶段'));
    f.store.info.ships[1].api_nowhp=15;
    assert.equal(f.read('opening-air').state,'ready');
    f.store.info.ships[1].api_nowhp=7;assert.equal(f.read('opening-air').state,'ready');
    delete f.store.info.ships[1].api_nowhp;assert.equal(f.read('opening-air').state,'ready');
  }
});

test('every ship has a speed badge which follows draft engines and expansion slots',()=>{
  const f=setup('夕張改二特',3);f.store.const.$ships[1].api_soku=5;f.store.info.ships[1].api_soku=5;
  f.store.info.equips[301]={api_slotitem_id:33,api_level:0};f.store.const.$equips[33]={api_name:'改良型艦本式タービン',api_type:[0,0,17,0]};
  assert.equal(fleetSpeed(f.store,[f.draft]).label,'含低速舰');assert.equal(f.read('speed').label,'低速');assert.equal(f.read('speed').tier,1);
  f.draft.ex=301;
  const reading=fleetSpeed(f.store,[f.draft]);assert.equal(reading.label,'高速统一');
  assert.equal(reading.ships[0].boosted,true);assert.match(reading.detail,/夕張改二特：高速/);assert.match(reading.detail,/提速装备：改良型艦本式タービン/);
  assert.equal(f.read('speed').label,'高速');assert.equal(f.read('speed').state,'ready');assert.equal(f.read('speed').tier,2);
  f.worn();f.store.info.ships[1].api_soku=10;assert.equal(f.read('speed').state,'ready');
  f.draft.ex=-1;assert.equal(f.read('speed').label,'低速');assert.equal(fleetSpeed(f.store,[f.draft]).ships[0].speed,'slow');
  assert.equal(fleetSpeed(f.store,[]).label,'速力 —');
});

test('base speed is certain after stripping live propulsion, including Taiho',()=>{
  for(const [name,type,base]of [['大鳳改',18,10],['未知特殊舰',99,5]]){
    const f=setup(name,type);f.store.const.$ships[1].api_soku=base;
    const turbine=f.equip('改良型艦本式タービン',17),boiler=f.equip('強化型艦本式缶',17);
    f.store.info.equips[turbine].api_slotitem_id=33;f.store.info.equips[boiler].api_slotitem_id=34;
    f.store.info.ships[1].api_slot=[turbine,boiler,-1,-1,-1];f.store.info.ships[1].api_soku=15;
    const before=JSON.stringify(f.store),reading=fleetSpeed(f.store,[f.draft]),badge=f.read('speed');
    assert.equal(reading.status,'computed');assert.equal(reading.ships[0].boosted,false);
    assert.equal(badge.state,'ready');assert.equal(badge.label,base===10?'高速':'低速');
    assert.match(badge.detail,/速度群：/);assert(!/预计|推算/.test(reading.label+badge.detail));assert.equal(JSON.stringify(f.store),before);
  }
  const f=setup('大鳳',18);f.store.const.$ships[1].api_soku=10;delete f.store.info.ships[1].api_soku;
  assert.equal(f.read('speed').state,'ready');
  const turbine=f.equip('改良型艦本式タービン',17);f.store.info.equips[turbine].api_slotitem_id=33;f.draft.ex=turbine;
  assert.equal(f.read('speed').state,'ready','a turbine alone does not boost Taiho');
});

test('known boosted speed badges show exact tiers and only unresolved rules need confirmation',()=>{
  const f=setup('大鳳改',18);f.store.const.$ships[1].api_soku=10;
  const boiler=f.equip('新型高温高圧缶',17),second=f.equip('新型高温高圧缶',17);
  for(const id of [boiler,second])Object.assign(f.store.info.equips[id],{api_slotitem_id:87,api_level:7});
  f.draft.slots[0]=boiler;
  assert.equal(f.read('speed').label,'高速+');assert.equal(f.read('speed').state,'ready');
  f.draft.slots[1]=second;
  const badge=f.read('speed');assert.equal(badge.label,'最速');assert.equal(badge.state,'ready');assert(!/预计/.test(badge.detail+fleetSpeed(f.store,[f.draft]).label));
  f.draft.slots[1]=-1;delete f.store.info.equips[boiler].api_level;
  assert.equal(f.read('speed').label,'速力待确认');assert.equal(f.read('speed').state,'unknown');assert.match(f.read('speed').detail,/改修资料缺失/);
});

test('speed tooltips expose the native group and actual draft engines with stars and counts',()=>{
 const f=setup('大鳳改',18);f.store.const.$ships[1].api_soku=10;
 assert.equal(f.read('speed').detail,'速度群：高速 A 群');
 const boiler=f.equip('新型高温高圧缶',17),second=f.equip('新型高温高圧缶',17);
 f.store.const.$equips[87]=f.store.const.$equips[boiler];
 for(const id of [boiler,second])Object.assign(f.store.info.equips[id],{api_slotitem_id:87,api_level:7});
 f.draft.slots[0]=boiler;f.draft.ex=second;
 let badge=f.read('speed');assert.equal(badge.detail,'速度群：高速 A 群\n\n提速装备：新型高温高圧缶 ★7 ×2');
 assert.doesNotMatch(badge.detail,/固定|发动|当前速力|基础速力/);
 f.worn();f.store.info.ships[1].api_soku=20;
 assert.match(f.read('speed').detail,/速度群：高速 A 群/,'observed speed also carries its group');
 f.draft.slots[0]=-1;f.draft.ex=-1;badge=f.read('speed');assert.equal(badge.detail,'速度群：高速 A 群');
 f.store.const.$ships[1].api_name='未收录舰';f.store.const.$ships[1].api_stype=99;
 assert.match(f.read('speed').detail,/速度群：待确认/);
 const boiler2=f.equip('新型高温高圧缶',17);f.store.info.equips[boiler2].api_slotitem_id=87;f.draft.ex=boiler2;
 const unknown=f.read('speed');assert.equal(unknown.state,'unknown');assert.match(unknown.detail,/速度群：待确认/);assert.doesNotMatch(unknown.detail,/固定|发动|当前速力|基础速力/);
});

test('draft mechanisms ignore old equipment, include expansion slots and leave state untouched',()=>{
  const f=setup('夕張改二丁',3),torpedo=f.equip('甲標的 甲型',22),sonar=f.equip('四式水中聴音機',14,{api_tais:12});
  f.store.info.ships[1].api_slot=[torpedo,sonar,-1,-1,-1];
  assert(!f.read('torpedo'));assert.equal(f.read('asw').state,'ready','unconditional ASW stays certain after stripping gear');
  f.draft.slots[0]=torpedo;f.draft.ex=f.equip('発煙装置(煙幕)',54);
  const before=JSON.stringify(f.store),draft=JSON.stringify(f.draft);
  assert.equal(f.read('torpedo').state,'ready');assert.equal(f.read('smoke').state,'blocked');
  assert.equal(f.read('smoke',[f.draft,...[2,3,4].map(id=>({id,slots:[-1,-1],ex:-1}))]).state,'conditional');
  assert.equal(JSON.stringify(f.store),before);assert.equal(JSON.stringify(f.draft),draft);
});

test('ASW thresholds use calculated bonuses, and equivalent replacement copies remain certain',()=>{
  const f=setup(),sonar=f.equip('声呐',14,{api_tais:10});f.draft.slots[0]=sonar;f.worn();
  f.store.info.ships[1].api_taisen=[99,100];assert(!f.read('asw'));
  f.store.info.ships[1].api_taisen=[100,100];assert.equal(f.read('asw').state,'ready');
  f.store.info.equips[999]={...f.store.info.equips[sonar],api_id:999};f.draft.slots[0]=999;
  assert.equal(f.read('asw').state,'ready');
  f.store.info.equips[999].api_level=4;assert.equal(f.read('asw').state,'ready');
  f.draft.slots[0]=f.equip('强声呐',14,{api_tais:15});assert.equal(f.read('asw').state,'ready');
  assert.match(f.read('asw').detail,/\n对潜：105\n门槛：100/);f.draft.slots[0]=-1;assert(!f.read('asw'));
});

test('escort ASW needs sonar at 60 or raw equipment ASW at 75',()=>{
  const f=setup('海防舰',1);f.store.info.ships[1].api_taisen=[75,75];assert(!f.read('asw'));
  f.draft.ex=f.equip('九五式爆雷',15,{api_tais:4});f.worn();assert.equal(f.read('asw').state,'ready');
  f.store.info.ships[1].api_taisen=[60,60];assert(!f.read('asw'));
  f.draft.ex=f.equip('声呐',14,{api_tais:4});f.worn();assert.equal(f.read('asw').state,'ready');
});

test('light carriers need the correct aircraft, Kaga Go is supported, and Suzuya does not get an ordinary CVL result',()=>{
  const f=setup('龍驤改二',7);f.store.info.ships[1].api_taisen=[65,65];
  f.draft.slots[2]=f.equip('高对潜舰爆',7,{api_tais:10});f.worn();assert(!f.read('asw'));
  f.draft.slots[2]=f.equip('对潜舰攻',8,{api_tais:7});f.worn();assert.equal(f.read('asw').state,'ready');
  f.store.info.ships[1].api_taisen=[64,65];assert(!f.read('asw'));
  f.store.const.$ships[1].api_name='加賀改二護';f.store.const.$ships[1].api_stype=11;
  f.store.info.ships[1].api_onslot[2]=0;assert.equal(f.read('asw').state,'ready','opening ASW still works after aircraft loss');
  f.store.const.$ships[1].api_name='鈴谷航改二';f.store.const.$ships[1].api_stype=7;
  assert.equal(f.read('asw').state,'unknown');f.draft.ex=f.equip('声呐',40);assert.equal(f.read('asw').state,'unknown');
});

test('unconditional Fletcher remodels and Hyuga aircraft rule are recognized',()=>{
  const f=setup('Fletcher改 Mod.2');assert.equal(f.read('asw').state,'ready');
  f.store.const.$ships[1].api_name='Heywood L.E.';assert(!f.read('asw'));
  f.store.const.$ships[1].api_name='Heywood L.E.改';assert.equal(f.read('asw').state,'ready');
  f.store.const.$ships[1].api_name='日向改二';f.store.const.$ships[1].api_stype=10;
  f.draft.slots[2]=f.equip('オ号観測機改',25);assert(!f.read('asw'));
  f.draft.slots[3]=f.equip('オ号観測機改',25);assert.equal(f.read('asw').state,'ready');
});

test('AACI needs full combinations, counts expansion gear and distinguishes Akizuki ordinary guns',()=>{
  const f=setup(),gun=f.equip('10cm連装高角砲',1,{api_type:[0,0,1,16],api_tyku:7});
  f.draft.slots[0]=gun;f.draft.ex=f.equip('对空电探',12,{api_tyku:4});assert(!f.read('aaci'));
  f.store.const.$equips[gun].api_tyku=10;assert.equal(f.read('aaci').state,'ready');
  f.draft.ex=-1;assert(!f.read('aaci'));
  f.store.const.$ships[1].api_name='秋月改';f.store.const.$equips[gun].api_tyku=7;
  f.draft.ex=f.equip('水上电探',12,{api_tyku:0});assert(!f.read('aaci'),'single ordinary gun + radar no longer qualifies');
  f.draft.slots[1]=f.equip('高角炮',1,{api_type:[0,0,1,16],api_tyku:7});assert.equal(f.read('aaci').state,'ready');
});

test('special AACI does not require a radar for Maya, Atlanta or Fletcher gun pairs',()=>{
  const f=setup('摩耶改二',5);f.draft.slots[0]=f.equip('高角炮',4,{api_type:[0,0,4,16],api_tyku:7});
  f.draft.ex=f.equip('特殊机枪',21,{api_tyku:9});assert.equal(f.read('aaci').state,'ready');
  f.store.const.$ships[1].api_name='测试重巡';assert(!f.read('aaci'));
  for(const [name,gear] of [['Atlanta改','5inch連装両用砲(集中配備)'],['Johnston改','5inch単装砲 Mk.30 改']]){
    f.store.const.$ships[1].api_name=name;f.draft.ex=-1;
    f.draft.slots=[f.equip(gear,1),f.equip(gear,1),-1,-1,-1];assert.equal(f.read('aaci').state,'ready');
    f.draft.slots[1]=-1;assert(!f.read('aaci'));
  }
});

test('opening torpedo requires level 10 or a midget submarine and is not disabled by damage',()=>{
  const f=setup('伊58',13);f.store.info.ships[1].api_lv=9;assert(!f.read('torpedo'));
  f.store.info.ships[1].api_lv=10;assert.equal(f.read('torpedo').state,'ready');
  f.store.info.ships[1].api_nowhp=15;assert.equal(f.read('torpedo').state,'ready');
  f.store.info.ships[1].api_nowhp=7;assert.equal(f.read('torpedo').state,'ready');
  assert.match(f.read('torpedo').detail,/鱼雷\n攻击力：\d+ × 1击/);assert.equal(f.read('torpedo').attacks[0].label,'鱼雷');
  f.store.const.$ships[1].api_stype=4;assert(!f.read('torpedo'),'CLT without midget must not get opening torpedo');
});

test('spotting uses full slot capacity, appropriate guns and recon rather than water fighters',()=>{
  const f=setup('战舰',9),gun=f.equip('主炮',3),gun2=f.equip('主炮',3),recon=f.equip('水侦',10);
  f.draft.slots=[gun,gun2,recon,-1,-1];f.worn();assert.equal(f.read('spotting').state,'conditional');
  assert.equal(f.read('spotting').label,'昼战连击');assert.match(f.read('spotting').detail,/昼战连击\n攻击力：/);
  f.store.info.ships[1].api_onslot[2]=0;assert.equal(f.read('spotting').state,'conditional');
  f.store.const.$ships[1].api_maxeq[2]=0;assert.equal(f.read('spotting').state,'blocked');
  f.store.const.$ships[1].api_maxeq[2]=4;
  f.draft.slots[2]=f.equip('水战',45);assert(!f.read('spotting'));
  f.draft.slots[2]=f.equip('新装水侦',10);assert.equal(f.read('spotting').state,'conditional');
  f.draft.slots[1]=f.equip('穿甲弹',19);assert(!f.read('spotting'),'main + AP alone is not spotting');
  f.draft.ex=f.equip('副炮',4);assert.match(f.read('spotting').detail,/主彻 CI/);
  f.store.info.ships[1].api_nowhp=7;assert.equal(f.read('spotting').state,'blocked');
  f.store.const.$ships[1].api_stype=16;assert(!f.read('spotting'),'seaplane tender is not a gun spotting ship');
});

test('day double attack shows per-hit power after the daytime cap and retains CI and availability distinctions',()=>{
  const f=setup('测试战舰',9),a=f.equip('主炮',3),b=f.equip('主炮',3),recon=f.equip('水侦',10);
  f.draft.slots=[a,b,recon,-1,-1];f.worn();
  for(const id of [a,b,recon])f.store.info.equips[id].api_level=0;
  f.store.info.equips[a].api_level=4;f.store.info.equips[b].api_level=9;
  f.store.info.ships[1].api_karyoku=[100,100];
  const before=JSON.stringify([f.store,f.draft]);let badge=f.read('spotting');
  assert.deepEqual(badge.doubleAttack,{power:134,hits:2});assert.match(badge.detail,/\n\n昼战连击\n攻击力：134 × 2击\n/);
  assert.equal(JSON.stringify([f.store,f.draft]),before);
  f.store.info.ships[1].api_karyoku=[250,250];assert.equal(f.read('spotting').doubleAttack.power,271);
  f.store.info.ships[1].api_onslot.fill(0);assert.equal(f.read('spotting').doubleAttack.power,271);
  f.store.info.ships[1].api_nowhp=7;assert.equal(f.read('spotting').state,'blocked');assert.equal(f.read('spotting').doubleAttack.power,271);
  f.store.info.ships[1].api_nowhp=30;const ap=f.equip('彻甲弹',19);f.draft.slots[3]=ap;f.store.info.equips[ap].api_level=0;f.worn();
  badge=f.read('spotting');assert.equal(badge.label,'昼战连击·CI');assert.match(badge.detail,/昼战连击\n攻击力：271 × 2击/);
  f.draft.slots[1]=f.equip('副炮',4);f.worn();badge=f.read('spotting');
  assert.equal(badge.label,'弹着 CI');assert.equal(badge.doubleAttack,undefined);assert.match(badge.detail,/攻击力：[\d.]+ × 1击/);
});

test('day double attack rebuilds draft blue bonuses, permanent stats, improvements and fit including expansion guns',()=>{
  const f=setup('矢矧改二乙',3),sm=f.store.const.$ships[1],ship=f.store.info.ships[1];
  Object.assign(sm,{api_id:663,api_houg:[28,81],api_ctype:41,api_aftershipid:'0'});
  f.store.const.$ships[663]=sm;ship.api_ship_id=663;ship.api_kyouka=[15,0,0,0,0];ship.api_sp_effect_items=[{api_houg:2}];
  const a=f.equip('15.2cm連装砲改',2,{api_houg:5}),b=f.equip('15.2cm連装砲改',2,{api_houg:5}),plane=f.equip('水侦',10);
  f.store.const.$equips[139]=f.store.const.$equips[a];
  for(const id of [a,b])f.store.info.equips[id].api_slotitem_id=139;
  for(const [id,star]of [[a,4],[b,9],[plane,0]])f.store.info.equips[id].api_level=star;
  f.draft.slots=[a,-1,plane,-1,-1];f.draft.ex=b;
  assert.equal(f.read('spotting').doubleAttack.power,87,'floor(cap(28+15+10+6 blue including scout+2 permanent+5 stars+5+2sqrt(2))*1.2)');
  const lower=f.equip('普通主炮',2,{api_houg:0});f.store.info.equips[lower].api_level=0;f.draft.ex=lower;
  assert(f.read('spotting').doubleAttack.power<87,'manual replacement cannot retain the old gun bonus');
});

test('day double attack keeps missing firepower or improvement data unknown',()=>{
  const f=setup('测试重巡',5);f.draft.slots=[f.equip('主炮',2),f.equip('主炮',2),f.equip('水侦',10),-1,-1];f.worn();
  delete f.store.info.equips[f.draft.slots[0]].api_level;
  let badge=f.read('spotting');assert.equal(badge.doubleAttack.power,null);assert.match(badge.detail,/攻击力：待确认 × 2击/);
  for(const id of f.draft.slots.filter(id=>id>0))f.store.info.equips[id].api_level=0;
  delete f.store.info.ships[1].api_karyoku;assert.equal(f.read('spotting').doubleAttack.power,null);
  f.store.info.ships[1].api_karyoku=[100,100];assert.equal(f.read('spotting').doubleAttack.power,126);
});

test('night attack classification respects gun/torpedo priority and ignores midget submarines',()=>{
  const examples=[
    [[2,2], '夜战连击'],[[2,4], '夜战连击'],[[4,4,4], '夜战连击'],[[4,4,5], '夜战连击'],
    [[2,2,22], '夜战连击'],[[2,2,2,5,5], '夜战炮击 CI'],[[2,2,4,5,5], '夜战炮击 CI'],
    [[2,5,5], '夜战雷击 CI'],[[2,5], '夜战雷击 CI'],[[5,32], '夜战雷击 CI'],[[4,5], undefined],[[22,22],undefined]
  ];
  for(const [types,label] of examples){
    const f=setup('测试巡洋舰',3);f.draft.slots=types.map(type=>f.equip('武器',type));
    assert.equal(f.read('night')?.label,label,types.join(','));
    if(label)assert.equal(f.read('night').effect,label==='夜战雷击 CI'?'torpedo':'shelling');
  }
});

test('expansion guns change night double attack to CI and heavy damage blocks but moderate damage does not',()=>{
  const f=setup('筑摩改二',6);f.draft.slots=[f.equip('主炮',2),f.equip('主炮',2),-1,-1,-1];
  assert.equal(f.read('night').label,'夜战连击');f.draft.ex=f.equip('副炮',4);
  assert.equal(f.read('night').label,'夜战炮击 CI');f.store.info.ships[1].api_nowhp=15;
  assert.equal(f.read('night').state,'ready');f.store.info.ships[1].api_nowhp=7;
  assert.equal(f.read('night').state,'blocked');f.draft.ex=-1;
  assert.equal(f.read('night').label,'夜战连击');
});

test('DD cut-ins use raw radar LOS, actual lookout equipment and type-specific combinations',()=>{
  const f=setup();f.draft.slots=[f.equip('主炮',1),f.equip('鱼雷',5),-1,-1,-1];
  const radar=f.equip('电探',12,{api_saku:4});f.draft.ex=radar;
  assert.equal(f.read('night').label,'夜战雷击 CI');f.store.const.$equips[radar].api_saku=5;
  assert.equal(f.read('night').label,'夜战雷击 CI');assert(f.read('night').ci.rows.some(r=>r.label==='主鱼电'));
  f.draft.slots[2]=f.equip('熟練見張員',39);assert(f.read('night').ci.rows.some(r=>r.label==='鱼见电'));
  f.draft.slots[0]=-1;f.draft.ex=-1;assert(!f.read('night'));
  f.draft.slots[2]=f.equip('水雷戦隊 熟練見張員',39);f.draft.slots[3]=f.equip('ドラム缶(輸送用)',30);
  assert.match(f.read('night').ci.rows[0].label,/鱼桶水/);assert.match(f.read('night').detail,/× 1击/);
  f.draft.slots[3]=f.equip('鱼雷',5);assert(f.read('night').ci.rows.some(r=>r.label==='鱼水鱼'));
  f.store.const.$ships[1].api_stype=3;assert.equal(f.read('night').label,'夜战雷击 CI');
});

test('submarine special CI recognizes late torpedoes and expansion submarine radar',()=>{
  const f=setup('伊58改',14);f.draft.slots=[f.equip('後期型艦首魚雷(6門)',32),-1,-1,-1,-1];
  assert(!f.read('night'));f.draft.ex=f.equip('潜水艦搭載電探&水防式望遠鏡',51);
  assert.equal(f.read('night').label,'夜战雷击 CI');assert.match(f.read('night').ci.rows[0].label,/后期鱼雷＋潜水电探/);
  f.draft.ex=-1;f.draft.slots[1]=f.equip('潜水艦後部魚雷発射管4門(後期型)',32);
  assert.match(f.read('night').ci.rows[0].label,/后期鱼雷×2/);
  f.draft.slots[1]=f.equip('潜水艦53cm艦首魚雷(8門)',32);assert.equal(f.read('night').label,'夜战雷击 CI');
});

test('night gun tags do not claim night aviation or an attack for noncombat auxiliaries',()=>{
  const f=setup('赤城改二',11);f.draft.slots=[f.equip('副炮',4),f.equip('副炮',4),-1,-1,-1];
  assert(!f.read('night'));
  f.store.const.$ships[1].api_stype=22;
  f.store.const.$ships[1].api_houg=[0,10];f.store.const.$ships[1].api_raig=[0,0];assert(!f.read('night'));
});

function carrierSetup(){
  const f=setup('赤城改二',11);
  f.store.const.$ships[1].api_maxeq=[20,20,32,4,4];f.store.info.ships[1].api_onslot=[20,20,32,4,4];
  f.draft.slots=[f.equip('舰战',6),f.equip('爆战',7),f.equip('舰攻',8),f.equip('舰爆',7),-1];f.worn();
  return f;
}

test('night aviation requires night operations crew on ordinary carriers and recognizes all three aircraft icons',()=>{
  for(const [type,icon] of [[6,45],[8,46],[7,58]]){
    const f=carrierSetup();f.draft.slots.fill(-1);
    f.draft.slots[0]=f.equip('夜间飞机',type,{api_type:[3,5,type,icon,0]});
    assert(!f.read('night-air'));
    f.draft.slots[1]=f.equip('熟練艦載機整備員',35);assert(!f.read('night-air'));
    for(const crew of ['夜間作戦航空要員','夜間作戦航空要員+熟練甲板員','夜間作戦航空要員＋熟練甲板員']){
      f.draft.slots[1]=f.equip(crew,35);
      assert.equal(f.read('night-air').label,'夜间航空攻击');assert.equal(f.read('night-air').state,'ready');
    }
  }
});

test('night contact identifies night scouts by game category rather than name, and excludes other night aircraft',()=>{
  const f=setup('最上改二特',6);
  for(const name of ['九八式水上偵察機(夜偵)','零式水上偵察機11型乙改(夜偵)','Loire 130M','Walrus','Sea Otter','Loire 130M改(熟練)','零式水上偵察機11型甲改二']){
    f.draft.slots[2]=f.equip(name,10,{api_type:[0,0,10,50]});
    const badge=f.read('night-contact');assert.equal(badge.label,'夜间接触');assert.equal(badge.state,'conditional');
    assert.match(badge.detail,/全队夜战攻击力与命中/);assert.match(badge.detail,/昼转夜需空优／空确／空劣/);
    assert.match(badge.detail,/均衡与空丧不可/);assert.match(badge.detail,/开幕夜战不限/);
  }
  for(const [name,type,icon] of [['零式水上観測機',10,10],['夜偵という名前だけの水偵',10,10],['試製 夜間瑞雲(攻撃装備)',11,51],['夜间舰战',6,45],['陆上侦察机',49,50]]){
    f.draft.slots[2]=f.equip(name,type,{api_type:[0,0,type,icon]});assert(!f.read('night-contact'),name);
  }
});

test('night contact uses full normal-slot capacity, combines scouts per ship and does not depend on gun attack or health',()=>{
  const f=setup('测试舰',6),recon=f.equip('Walrus',10,{api_type:[0,0,10,50]});
  f.draft.slots[2]=recon;f.store.info.ships[1].api_onslot.fill(0);
  f.store.info.ships[1].api_nowhp=1;
  const before=JSON.stringify([f.store,f.draft]);assert.equal(f.read('night-contact').state,'conditional');
  assert.equal(JSON.stringify([f.store,f.draft]),before);
  f.draft.slots[0]=recon;f.draft.slots[2]=-1;
  assert.equal(f.read('night-contact').state,'blocked');assert.match(f.read('night-contact').detail,/容量：0 架/);
  delete f.store.const.$ships[1].api_maxeq;
  assert.equal(f.read('night-contact').state,'unknown');assert.match(f.read('night-contact').detail,/容量：待确认/);
  f.store.const.$ships[1].api_maxeq=[null,0,4,4,4];
  f.draft.slots[2]=f.equip('Loire 130M',10,{api_type:[0,0,10,50]});
  assert.equal(f.read('night-contact').state,'conditional');
  assert.equal(fleetMechanisms(f.store,[f.draft]).get(1).filter(b=>b.key==='night-contact').length,1);
  f.draft.ex=recon;f.draft.slots.fill(-1);assert(!f.read('night-contact'),'expansion aircraft cannot launch');
  f.draft.ex=-1;assert(!f.read('night-contact'));
});

test('native night carriers and Shimane Kai do not require crew, but other remodels and supply ships do not inherit it',()=>{
  const f=carrierSetup();f.draft.slots=[f.equip('夜爆',7,{api_type:[3,5,7,58,0]}),-1,-1,-1,-1];
  for(const [name,type] of [['Saratoga Mk.II',11],['赤城改二戊',11],['加賀改二戊',11],['龍鳳改二戊',7],['Independence Flight II',7],['しまね丸改',22]]){
    Object.assign(f.store.const.$ships[1],{api_name:name,api_stype:type});assert.equal(f.read('night-air').state,'ready',name);
  }
  for(const [name,type] of [['Saratoga Mk.II Mod.2',18],['龍鳳改二',7],['加賀改二護',11],['鳳翔改二戦',7],['しまね丸',22],['山汐丸改',22]]){
    Object.assign(f.store.const.$ships[1],{api_name:name,api_stype:type});assert(!f.read('night-air'),name);
  }
  f.draft.slots[1]=f.equip('夜間作戦航空要員',35);assert(!f.read('night-air'),'ordinary supply ships remain excluded even with crew');
});

test('night aviation assumes full resupply but checks actual slot capacity, expansion slots and unknown capacity',()=>{
  const f=carrierSetup();f.store.const.$ships[1].api_name='赤城改二戊';
  const plane=f.equip('夜战机',6,{api_type:[3,5,6,45,0]});f.draft.slots=[plane,-1,-1,-1,-1];
  f.store.info.ships[1].api_onslot.fill(0);assert.equal(f.read('night-air').state,'ready');
  f.store.const.$ships[1].api_maxeq[0]=0;assert.equal(f.read('night-air').state,'blocked');
  f.store.const.$ships[1].api_maxeq=undefined;assert.equal(f.read('night-air').state,'unknown');
  f.draft.slots[0]=-1;f.draft.ex=plane;assert(!f.read('night-air'));
});

test('ordinary night aviation supplies a named per-hit power row and preserves unknown capacity',()=>{
 const f=setup('Saratoga Mk.II',11);Object.assign(f.store.const.$ships[1],{api_houg:[50,100],api_ctype:0,api_aftershipid:'0'});f.store.info.ships[1].api_kyouka=[10,0,0,0,0];
 f.draft.slots[2]=f.equip('夜攻',8,{api_type:[3,5,8,46],api_houg:2,api_raig:5,api_baku:3});
 const before=JSON.stringify([f.store,f.draft]),badge=f.read('night-air');
 assert.deepEqual(badge.attacks,[{label:'夜间航空攻击',power:91,hits:1}]);assert.match(badge.detail,/夜间航空攻击\n攻击力：91 × 1击/);assert.equal(JSON.stringify([f.store,f.draft]),before);
 delete f.store.const.$ships[1].api_maxeq;assert.equal(f.read('night-air').attacks[0].power,null);
});

test('night aviation handles normal versus armored carrier damage and does not mutate the draft or store',()=>{
  const f=carrierSetup();f.draft.slots=[f.equip('夜攻',8,{api_type:[3,5,8,46,0]}),f.equip('夜間作戦航空要員',35),-1,-1,-1];
  f.store.info.ships[1].api_nowhp=15;assert.equal(f.read('night-air').state,'blocked');
  f.store.const.$ships[1].api_stype=18;assert.equal(f.read('night-air').state,'ready');
  f.store.info.ships[1].api_nowhp=7;assert.equal(f.read('night-air').state,'blocked');
  delete f.store.info.ships[1].api_nowhp;assert.equal(f.read('night-air').state,'unknown');
  const before=JSON.stringify([f.store,f.draft]);f.read('night-air');assert.equal(JSON.stringify([f.store,f.draft]),before);
});

test('ordinary carrier night combat and auxiliary night aircraft alone do not claim night aviation',()=>{
  for(const name of ['Graf Zeppelin改','Ark Royal改','赤城改二戊']){
    const f=carrierSetup();f.store.const.$ships[1].api_name=name;
    const crew=f.equip('夜間作戦航空要員',35);
    for(const [plane,type,icon] of [['Swordfish',8,8],['零戦62型(爆戦/岩井隊)',7,7],['彗星一二型(三一号光電管爆弾搭載機)',7,7],['試製 夜間瑞雲(攻撃装備)',11,51],['夜偵',10,10]]){
      f.draft.slots=[f.equip(plane,type,{api_type:[0,0,type,icon,0]}),crew,-1,-1,-1];assert(!f.read('night-air'),name+plane);
    }
  }
});

test('night Zuiun CI requires eligible hulls and two main guns, preserving ordinary night fallback',()=>{
  const f=setup('最上改二特',6);
  f.draft.slots=[f.equip('主炮',2),f.equip('主炮',2),f.equip('試製 夜間瑞雲(攻撃装備)',11),-1,-1];
  for(const type of [3,4,6,10,16]){
    f.store.const.$ships[1].api_stype=type;
    assert.equal(f.read('night-zuiun').label,'夜战瑞云 CI');assert.equal(f.read('night-zuiun').state,'conditional');
    assert.equal(f.read('night').label,'夜战连击');
  }
  for(const type of [2,5,8,9,11,22]){
    f.store.const.$ships[1].api_stype=type;assert(!f.read('night-zuiun'));
  }
  f.store.const.$ships[1].api_stype=6;
  f.draft.slots[1]=f.equip('副炮',4);assert(!f.read('night-zuiun'));
  f.draft.ex=f.equip('主炮',2);assert(f.read('night-zuiun'),'secondary gun does not inhibit the special attack');
  f.draft.slots[2]=f.equip('瑞雲',11);assert(!f.read('night-zuiun'));
});

test('night Zuiun uses full normal slot capacity and distinguishes missing capacity and damage',()=>{
  const f=setup('最上改二特',6),plane=f.equip('試製 夜間瑞雲(攻撃装備)',11);
  f.draft.slots=[f.equip('主炮',2),f.equip('主炮',2),plane,-1,-1];
  f.store.info.ships[1].api_onslot.fill(0);assert.equal(f.read('night-zuiun').state,'conditional');
  f.store.const.$ships[1].api_maxeq[2]=0;assert.equal(f.read('night-zuiun').state,'blocked');
  delete f.store.const.$ships[1].api_maxeq;assert.equal(f.read('night-zuiun').state,'unknown');
  f.store.const.$ships[1].api_maxeq=[0,0,4,4,4];
  f.store.info.ships[1].api_nowhp=15;assert.equal(f.read('night-zuiun').state,'blocked');
  assert.equal(f.read('night').state,'ready','ordinary night attacks can still occur at medium damage');
  f.store.info.ships[1].api_nowhp=16;assert.equal(f.read('night-zuiun').state,'conditional');
  delete f.store.info.ships[1].api_nowhp;assert.equal(f.read('night-zuiun').state,'unknown');
  f.draft.slots[2]=-1;f.draft.ex=plane;assert(!f.read('night-zuiun'),'expansion cannot provide aircraft');
});

test('night Zuiun warns about illumination from other ships without changing the draft',()=>{
  const f=setup('最上改二特',6);
  f.draft.slots=[f.equip('主炮',2),f.equip('主炮',2),f.equip('試製 夜間瑞雲(攻撃装備)',11),-1,-1];
  assert(!f.read('night-zuiun').detail.includes('降低'));
  for(const type of [29,33,42]){
    const other={id:2,slots:[f.equip('照明装备',type),-1,-1],ex:-1},entries=[f.draft,other];
    const before=JSON.stringify([f.store,entries]);assert.match(f.read('night-zuiun',entries).detail,/降低该 CI 的发动率/);
    assert.equal(JSON.stringify([f.store,entries]),before);
  }
});

test('illumination combines flare and both searchlight sizes into one tag with equipment-specific tooltips',()=>{
  const f=setup();f.draft.slots[0]=f.equip('照明弾',33);
  assert.equal(f.read('illumination').label,'照明');assert.match(f.read('illumination').detail,/照明弹/);
  for(const type of [29,42]){
    f.draft.ex=f.equip('探照灯',type);
    const tags=fleetMechanisms(f.store,[f.draft]).get(1).filter(b=>b.key==='illumination');
    assert.equal(tags.length,1);assert.match(tags[0].detail,/携带舰更易被集火/);
  }
  f.draft.slots[0]=-1;assert(!f.read('illumination').detail.includes('照明弹'));
  f.draft.ex=-1;assert(!f.read('illumination'));
});

test('illumination thresholds use remaining HP rather than the ordinary attack damage category',()=>{
  const f=setup();f.draft.slots[0]=f.equip('照明弾',33);
  f.store.info.ships[1].api_nowhp=5;assert.equal(f.read('illumination').state,'conditional');
  f.store.info.ships[1].api_nowhp=4;assert.equal(f.read('illumination').state,'blocked');
  f.draft.ex=f.equip('探照灯',29);assert.equal(f.read('illumination').state,'conditional');
  assert.match(f.read('illumination').detail,/照明弹耐久门槛：>4/);
  f.store.info.ships[1].api_nowhp=1;assert.equal(f.read('illumination').state,'blocked');
  delete f.store.info.ships[1].api_nowhp;assert.equal(f.read('illumination').state,'unknown');
});

test('carrier CI assumes resupply and only excludes zero-capacity or expansion slots',()=>{
  const f=carrierSetup();assert.equal(f.read('carrier-ci').label,'战爆联合·FBA');
  assert.equal(f.read('carrier-ci').hint,'需空优');assert.deepEqual(f.read('carrier-ci').attacks.map(r=>r.label),['FBA','BBA','BA']);
  f.store.info.ships[1].api_onslot.fill(0);assert.equal(f.read('carrier-ci').label,'战爆联合·FBA');
  assert.equal(f.read('carrier-ci').state,'conditional');
  f.store.const.$ships[1].api_maxeq[0]=0;assert.equal(f.read('carrier-ci').label,'战爆联合·BBA');
  f.store.const.$ships[1].api_maxeq[3]=0;assert.equal(f.read('carrier-ci').label,'战爆联合·BA');
  f.store.const.$ships[1].api_maxeq[2]=0;assert.equal(f.read('carrier-ci').state,'blocked');
  f.draft.ex=f.draft.slots[2];f.draft.slots[2]=-1;assert(!f.read('carrier-ci'));
  f.store.const.$ships[1].api_stype=10;assert(!f.read('carrier-ci'));
});

test('carrier CI distinguishes normal and armored carrier damage and unknown aircraft data',()=>{
  const f=carrierSetup();f.store.info.ships[1].api_nowhp=15;
  assert.equal(f.read('carrier-ci').state,'blocked');f.store.const.$ships[1].api_stype=18;
  assert.equal(f.read('carrier-ci').state,'conditional');f.store.info.ships[1].api_nowhp=7;
  assert.equal(f.read('carrier-ci').state,'blocked');f.store.info.ships[1].api_nowhp=30;
  f.store.info.ships[1].api_onslot=undefined;assert.equal(f.read('carrier-ci').state,'conditional');
  f.store.const.$ships[1].api_maxeq=undefined;assert.equal(f.read('carrier-ci').state,'unknown');
  f.store.const.$ships[1].api_maxeq=[0,20,32,0,0];
  f.draft.slots[1]=f.equip('新舰爆',7);f.draft.slots[2]=f.equip('新舰攻',8);
  assert.equal(f.read('carrier-ci').state,'conditional');assert.equal(f.read('carrier-ci').label,'战爆联合·BA');
});

test('jets form their own cut-ins and jet bombers cannot substitute for normal dive bombers',()=>{
  const f=carrierSetup();f.draft.slots[1]=f.equip('橘花改',57);f.draft.slots[3]=-1;
  assert(!f.read('carrier-ci'));f.draft.slots[0]=f.equip('震電改三(試製 噴式震電)',56);
  assert.equal(f.read('carrier-ci').label,'战爆联合·jFjB');
  f.draft.slots[3]=f.equip('噴式景雲改',57);assert.equal(f.read('carrier-ci').label,'战爆联合·jFjBjB');
  f.draft.slots[1]=f.equip('舰爆',7);f.draft.slots[3]=-1;
  assert.equal(f.read('carrier-ci').label,'战爆联合·jFBA');
});

test('barrage requires rocket kai ni on eligible ship types, including expansion; is distinct from AACI',()=>{
  const f=setup('千歳航改二',7);f.draft.ex=f.equip('12cm30連装噴進砲',21);assert(!f.read('barrage'));
  f.draft.ex=f.equip('12cm30連装噴進砲改二',21);assert.equal(f.read('barrage').state,'ready');assert(!f.read('aaci'));
  for(const type of [6,7,10,11,16,18]){f.store.const.$ships[1].api_stype=type;assert(f.read('barrage'));}
  for(const type of [1,2,3,4,5,8,9,13,14,22]){f.store.const.$ships[1].api_stype=type;assert(!f.read('barrage'));}
});

test('ASW synergy distinguishes depth charges, projectors and mortars sharing the same API category',()=>{
  const pairs=[
    ['九五式爆雷','Hedgehog(初期型)',false],['三式爆雷投射機','RUR-4A Weapon Alpha改',false],
    ['二式12cm迫撃砲改','二式爆雷',false],['三式爆雷投射機','二式爆雷',true],
    ['RUR-4A Weapon Alpha改','Hedgehog(初期型)',true],['Mk.32 対潜魚雷(Mk.2落射機)','対潜短魚雷(試作初期型)',true]
  ];
  for(const [first,second,expected] of pairs){
    const f=setup();f.draft.slots=[f.equip(first,15),-1,-1,-1,-1];f.draft.ex=f.equip(second,15);
    assert.equal(!!f.read('asw-synergy'),expected,first+' + '+second);
    f.draft.slots[1]=f.equip('声呐',14);assert.equal(f.read('asw-synergy').state,'ready');
  }
});

test('ASW synergy is separate from opening ASW; missing subtypes remain unknown and supplies are not depth charges',()=>{
  const f=setup();f.store.info.ships[1].api_taisen=[20,20];
  f.draft.slots=[f.equip('声呐',14),f.equip('三式爆雷投射機',15),-1,-1,-1];
  assert.equal(f.read('asw-synergy').state,'ready');assert(!f.read('asw'));
  f.draft.slots[1]=f.equip('未来对潜兵装',15);assert.equal(f.read('asw-synergy').state,'unknown');
  f.draft.slots[1]=f.equip('洋上補給',44);assert(!f.read('asw-synergy'));
  f.store.const.$ships[1].api_name='扶桑改二';f.store.const.$ships[1].api_stype=10;
  f.store.info.ships[1].api_taisen=[100,100];assert(!f.read('asw'),'supplies must not enable ASW');
});

test('spotting label distinguishes double attacks and cut-ins, including both at once',()=>{
  const f=setup('战舰',9);f.draft.slots=[f.equip('主炮',38),f.equip('主炮',3),f.equip('水侦',10),-1,-1];
  assert.equal(f.read('spotting').label,'昼战连击');f.draft.slots[3]=f.equip('彻甲弹',19);
  assert.equal(f.read('spotting').label,'昼战连击·CI');f.draft.slots[1]=f.equip('副炮',4);
  assert.equal(f.read('spotting').label,'弹着 CI');f.worn();f.store.info.ships[1].api_onslot=undefined;
  assert.equal(f.read('spotting').state,'conditional');f.store.const.$ships[1].api_maxeq=undefined;
  assert.equal(f.read('spotting').state,'unknown');
});

test('aircraft capacities follow destination slots and distinguish zero, unknown and non-aircraft',()=>{
  const master={api_maxeq:[18,0,4]},equipment=type=>({api_type:[0,0,type,0]});
  for(const type of [6,7,8,9,10,11,25,26,41,45,56,57,58,59]){
    assert.equal(aircraftCapacity(master,equipment(type),0),18);
    assert.equal(aircraftCapacity(master,equipment(type),1),0);
    assert.equal(aircraftCapacity(master,equipment(type),2),4);
    assert.equal(aircraftCapacity(master,equipment(type),3),null);
    assert.equal(aircraftCapacity(master,equipment(type),'ex'),undefined);
  }
  for(const type of [1,2,3,4,5,14,15,19,21,22,30,44])assert.equal(aircraftCapacity(master,equipment(type),0),undefined);
  assert.equal(aircraftCapacity(master,undefined,0),undefined);
});


function nightCarrierSample(kinds){
  const f=carrierSetup();f.store.const.$ships[1].api_name='赤城改二戊';
  const planes={F:['夜战机',6,45],A:['夜攻',8,46],B:['夜爆',7,58],P:['彗星一二型(三一号光電管爆弾搭載機)',7,7],
    S:['Swordfish Mk.II(熟練)',8,8],I:['零戦62型(爆戦／岩井隊)',7,7],N:['普通舰攻',8,8]};
  f.draft.slots=kinds.map(kind=>{const [name,type,icon]=planes[kind];return f.equip(name,type,{api_type:[3,5,type,icon,0]});});
  return f;
}

function ciStats(f,luck=30,level=99){
  Object.assign(f.store.info.ships[1],{api_lucky:[luck,99],api_lv:level,api_kyouka:[10,20,0,0,0]});
  Object.assign(f.store.const.$ships[1],{api_houg:[50,100],api_raig:[60,100]});
  return f;
}
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('night CI baseline follows luck breakpoints, floor placement and true flagship position',()=>{
  const f=ciStats(setup());f.draft.slots=[f.equip('鱼雷',5),f.equip('鱼雷',5),-1,-1,-1];
  close(f.read('night').ci.total,67/122); // Lv99 luck30 + flagship15
  close(f.read('night',[null,f.draft]).ci.total,52/122);
  close(f.read('night',[{id:99999},f.draft]).ci.total,52/122);
  for(const [luck,level,term]of [[0,1,30],[49,99,86],[50,99,87],[51,99,88],[58,128,91],[59,128,92]]){
    ciStats(f,luck,level);assert.equal(f.read('night').ci.fixed.term,term);
  }
  ciStats(f,20000,99999);assert.equal(f.read('night').ci.total,1);
  delete f.store.info.ships[1].api_lucky;assert.equal(f.read('night').ci.total,null);
  assert.match(f.read('night').detail,/发动率：待确认/);
});

test('CI counts fixed lookout bonuses once each, ignores transient lights and damage, and stays immutable',()=>{
  const f=ciStats(setup('测试轻巡',3));
  f.draft.slots=[f.equip('鱼雷',5),f.equip('鱼雷',5),f.equip('熟練見張員',39),f.equip('水雷戦隊 熟練見張員',39),-1];
  const baseline=f.read('night').ci;assert.equal(baseline.fixed.term,80);close(baseline.total,80/122);
  f.draft.ex=f.equip('熟練見張員',39);assert.equal(f.read('night').ci.fixed.term,80);
  for(const type of [5,6,10,11]){f.store.const.$ships[1].api_stype=type;if(type!==11)assert.equal(f.read('night').ci.fixed.term,72);}
  f.store.const.$ships[1].api_stype=3;
  const light=f.equip('照明弾',33);f.draft.slots[4]=light;f.store.info.ships[1].api_nowhp=15;
  f.store.info.ships[1].api_cond=1;
  const before=JSON.stringify([f.store,f.draft]);close(f.read('night').ci.total,baseline.total);
  assert.equal(JSON.stringify([f.store,f.draft]),before);assert(!/完好基准|未计临时|未扣敌甲|Lv\.|运 /.test(f.read('night').detail));
});

test('night damage uses hull modernization and draft raw stats, improvement and the 360 soft cap',()=>{
  const f=ciStats(setup('测试重巡',5));
  f.draft.slots=[f.equip('鱼雷',5,{api_raig:10}),f.equip('鱼雷',5,{api_raig:10}),-1,-1,-1];
  f.store.info.equips[f.draft.slots[0]].api_level=9;
  let ci=f.read('night').ci;assert.equal(ci.basePower,163);assert.equal(ci.rows[0].power,244);
  assert.match(f.read('night').detail,/^发动率：[\d.]+%\n\n鱼雷×2\n攻击力：244 × 2击$/);
  f.store.info.ships[1].api_karyoku=[9999,9999];f.store.info.ships[1].api_raisou=[9999,9999];
  assert.equal(f.read('night').ci.basePower,163,'old loadout blue stats must not leak into draft power');
  f.store.const.$ships[1].api_houg=[250,300];ci=f.read('night').ci;
  assert.equal(ci.rows[0].power,373); // floor(360 + sqrt(544.5-360))
  delete f.store.info.ships[1].api_kyouka;assert.equal(f.read('night').ci.basePower,null);
  assert.notEqual(f.read('night').ci.total,null,'missing power is independent of known activation rate');
});

test('gun and submarine CIs use distinct multipliers, hit counts, coefficients and submarine improvement',()=>{
  for(const [type,names,types,mult,hits,coef]of [
    [5,['主','主','主'],[2,2,2],2,1,140],[5,['主','主','副'],[2,2,4],1.75,1,130],
    [5,['主','鱼'],[2,5],1.3,2,115],
    [13,['後期型艦首魚雷(6門)','潜水电探'],[32,51],1.75,2,105],
    [14,['後期型艦首魚雷(6門)','後期型艦首魚雷(6門)'],[32,32],1.6,2,110]]){
    const f=ciStats(setup('测试舰',type));f.draft.slots=names.map((n,i)=>f.equip(n,types[i]));
    const row=f.read('night').ci.rows[0];assert.equal(row.multiplier,mult);assert.equal(row.hits,hits);close(row.rate,67/coef);
    if(type===13){f.store.info.equips[f.draft.slots[0]].api_level=9;assert.equal(f.read('night').ci.basePower,141.8);}
  }
});

test('destroyer CI total uses ordered fallback probabilities and D2/D3 bonuses without pretending two hits are certain',()=>{
  const f=ciStats(setup());
  f.draft.slots=[f.equip('12.7cm連装砲D型改三',1),f.equip('鱼雷',5),f.equip('电探',12,{api_saku:5}),-1,-1];
  f.draft.ex=f.equip('水雷戦隊 熟練見張員',39);
  let ci=f.read('night').ci;assert.deepEqual(ci.rows.map(m=>m.label),['主鱼电','鱼水电','主炮＋鱼雷']);
  close(ci.total,1-(1-75/115)*(1-75/140)*(1-75/115));
  close(ci.rows[0].multiplier,1.3*1.25*1.05);assert.equal(ci.rows[0].hits,'1–2');
  close(ci.rows[1].occurrence,(1-75/115)*75/140);
  close(ci.rows.reduce((n,r)=>n+r.occurrence,0),ci.total);
  ciStats(f,30,79);assert.equal(f.read('night').ci.rows[0].hits,1);
  f.draft.slots[3]=f.equip('12.7cm連装砲D型改二',1);
  close(f.read('night').ci.rows[0].multiplier,1.3*1.4*1.05);
  f.draft.slots[3]=f.equip('12.7cm連装砲D型改三',1);
  close(f.read('night').ci.rows[0].multiplier,2.002);
});

test('night Zuiun has four ordered rolls with two planes and radar but no skilled torpedo lookout bonus',()=>{
  const f=ciStats(setup('最上改二特',6));
  f.draft.slots=[f.equip('主',2),f.equip('主',2),f.equip('試製 夜間瑞雲(攻撃装備)',11),f.equip('試製 夜間瑞雲(攻撃装備)',11),f.equip('电探',12,{api_saku:5})];
  f.draft.ex=f.equip('水雷戦隊 熟練見張員',39);
  let ci=f.read('night-zuiun').ci;assert.deepEqual(ci.rows.map(m=>m.multiplier),[1.36,1.32,1.28,1.24]);
  assert.equal(ci.fixed.term,67);close(ci.total,1-Math.pow(1-67/135,4));
  f.draft.ex=f.equip('熟練見張員',39);assert.equal(f.read('night-zuiun').ci.fixed.term,72);
  f.draft.slots[3]=-1;f.draft.slots[4]=-1;ci=f.read('night-zuiun').ci;
  assert.equal(ci.rows.length,1);close(ci.total,72/135);assert.equal(ci.rows[0].hits,2);
  delete f.store.const.$ships[1].api_maxeq[2];assert.equal(f.read('night-zuiun').ci.total,null);
});

test('carrier night CI probabilities use ordered groups and reference power uses full slot capacity',()=>{
  const f=ciStats(nightCarrierSample(['F','F','A','P','F']));
  let ci=f.read('night-carrier-ci').ci;
  assert.deepEqual(ci.rows.map(m=>m.coefficient),[105,120,120,130]);
  close(ci.total,1-(1-67/105)*(1-67/120)*(1-67/120)*(1-67/130));
  assert(ci.rows.every(m=>m.hits===1));
  const simple=ciStats(nightCarrierSample(['F','A']));
  const [fighter,attacker]=simple.draft.slots;
  Object.assign(simple.store.const.$equips[fighter],{api_houg:3,api_raig:0,api_baku:0,api_tais:0});
  Object.assign(simple.store.const.$equips[attacker],{api_houg:2,api_raig:9,api_baku:0,api_tais:8});
  const expected=60+3+3*20+.45*3*Math.sqrt(20)+11+3*20+.45*19*Math.sqrt(20);
  close(simple.read('night-carrier-ci').ci.basePower,expected);
  simple.store.info.ships[1].api_onslot.fill(0);close(simple.read('night-carrier-ci').ci.basePower,expected);
  delete simple.store.const.$ships[1].api_maxeq[0];assert.equal(simple.read('night-carrier-ci').ci.total,null);
});

test('carrier night cut-ins cover ordered night aircraft combinations without duplicate aviation badges',()=>{
  for(const [kinds,expected] of [[['F','F','A'],'夜战×2＋夜攻 ×1.25'],[['F','A'],'夜战＋夜攻 ×1.2'],
    [['F','P'],'夜战＋光电管彗星 ×1.2'],[['A','P'],'夜攻＋光电管彗星 ×1.2'],[['F','B'],'夜战＋夜爆 ×1.2'],
    [['A','B'],'夜攻＋夜爆 ×1.2'],[['B','P'],'夜爆＋光电管彗星 ×1.2'],[['F','F','F'],'另外两槽夜间机 ×1.18'],
    [['F','S','I'],'另外两槽夜间机 ×1.18']]){
    const f=nightCarrierSample(kinds),before=JSON.stringify([f.store,f.draft]),badge=f.read('night-carrier-ci');
    assert(badge,kinds.join(','));assert.equal(badge.label,'空母夜袭 CI');assert.equal(badge.effect,'aviation');assert.equal(badge.state,'conditional');
    assert(badge.ci.rows.some(m=>(m.label+' ×'+m.multiplier).includes(expected)),JSON.stringify(badge.ci.rows));assert(!f.read('night-air'),'same aviation effect must not create a duplicate basic tag');
    assert.equal(JSON.stringify([f.store,f.draft]),before);
  }
  const f=nightCarrierSample(['F','F','A','P','F']),detail=f.read('night-carrier-ci').ci.rows.map(r=>r.label).join('|');
  const order=['夜战×2＋夜攻','夜战＋夜攻','夜战＋光电管彗星','另外两槽夜间机'].map(text=>detail.indexOf(text));
  assert(order.every((n,i)=>n>=0&&(!i||n>order[i-1])));
});

test('carrier night CI excludes missing crews, ordinary planes, unavailable slots and unsupported night combat',()=>{
  for(const kinds of [['F'],['F','F'],['A','S','S'],['F','N','N']]){
    const f=nightCarrierSample(kinds);assert(!f.read('night-carrier-ci'));assert(f.read('night-air'));
  }
  for(const kinds of [['P','S','I'],['S','S','I']])assert(!nightCarrierSample(kinds).read('night-carrier-ci'));
  const f=nightCarrierSample(['F','A']);f.store.const.$ships[1].api_name='赤城改二';assert(!f.read('night-carrier-ci'));
  f.draft.slots.push(f.equip('夜間作戦航空要員',35));assert(f.read('night-carrier-ci'));
  f.draft.ex=f.draft.slots[1];f.draft.slots[1]=-1;assert(!f.read('night-carrier-ci'),'expansion cannot supply a second aircraft slot');
  f.draft.slots[1]=f.draft.ex;f.draft.ex=-1;f.store.const.$equips[f.draft.slots[0]].api_type[0]=21;
  assert(!f.read('night-carrier-ci'),'base-only aircraft cannot supply night fighter role');
});

test('carrier night CI follows full slot capacities and hull damage while preserving lower available patterns',()=>{
  const f=nightCarrierSample(['F','F','A']);f.store.info.ships[1].api_onslot.fill(0);
  assert(f.read('night-carrier-ci').ci.rows.some(r=>r.multiplier===1.25));
  f.store.const.$ships[1].api_maxeq[0]=0;
  assert.equal(f.read('night-carrier-ci').state,'conditional');assert(!f.read('night-carrier-ci').ci.rows.some(r=>r.multiplier===1.25));
  delete f.store.const.$ships[1].api_maxeq[2];assert.equal(f.read('night-carrier-ci').state,'unknown');
  f.store.const.$ships[1].api_maxeq[2]=0;assert.equal(f.read('night-carrier-ci').state,'blocked');
  f.store.const.$ships[1].api_maxeq=[20,20,20];f.store.info.ships[1].api_nowhp=15;
  assert.equal(f.read('night-carrier-ci').state,'blocked');f.store.const.$ships[1].api_stype=18;
  assert.equal(f.read('night-carrier-ci').state,'conditional');f.store.info.ships[1].api_nowhp=7;
  assert.equal(f.read('night-carrier-ci').state,'blocked');delete f.store.info.ships[1].api_nowhp;
  assert.equal(f.read('night-carrier-ci').state,'unknown');
});
