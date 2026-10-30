'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aswAttack,aswDamage,roles,assessAsw,requiresAswPackages,submarineEncounters,mapBonus,isAswWeapon}=require('../../../src/domain/combat/asw_combat');
const {fitAswLoadouts}=require('../../../src/recommendation/loadout/asw_fitting');
const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
function fixture({name='测试舰',stype=3}={}){
  const master={api_id:1,api_name:name,api_ctype:0,api_aftershipid:'0',api_stype:stype,api_slot_num:3,api_maxeq:[0,0,0]};
  const ship={api_ship_id:1,api_taisen:[100,100],api_slot:[-1,-1,-1],api_slot_ex:0};
  const store={const:{$ships:{1:master},$equips:{},$shipTypes:{[stype]:{api_equip_type:{1:1,12:1,14:1,15:1,40:1}}},
    $equipShip:{},$exslotEquips:[],$exslotEquipShips:{},$exslotEquipLimits:{}},info:{ships:{1:ship},equips:{}}};
  const target={id:1,ship,master,before:{slots:ship.api_slot,ex:0},after:{id:1,slots:[],ex:0}};
  const gear=(id,type,raw,name,stars=0)=>{
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],api_tais:raw};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:stars};return id;
  };
  return {store,target,gear,read:()=>aswAttack(store,target)};
}
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('ASW normal-hit power separates hull square root, weapon ASW, improvement and synergy',()=>{
  const f=fixture(),sonar=f.gear(47,14,10,'三式水中探信儀'),projector=f.gear(45,15,8,'三式爆雷投射機'),depth=f.gear(227,15,7,'二式爆雷');
  f.target.after.slots=[sonar];near(f.read().power,48);
  f.target.after.slots=[sonar,projector];near(f.read().power,60*1.15);
  f.target.after.slots=[sonar,projector,depth];near(f.read().power,70.5*1.4375);
  near(f.read().penetration,Math.sqrt(5));
  f.store.info.equips[sonar].api_level=9;f.store.info.equips[projector].api_level=4;
  near(f.read().power,75.5*1.4375);
});

test('native opening ASW with no weapons has very little effective damage against flagship So',()=>{
  const f=fixture({name:'Jervis改',stype:2});
  const bare=f.read();assert.equal(bare.opening,true);near(bare.power,33);
  const enemy={hp:48,armor:42};assert.equal(aswDamage(bare,enemy).mean,0);
  f.target.after.slots=[f.gear(149,14,12,'四式水中聴音機')];
  assert(aswDamage(f.read(),enemy).mean<2);
  f.target.after.slots.push(f.gear(287,15,12,'三式爆雷投射機 集中配備'),f.gear(227,15,7,'二式爆雷'));
  const kit=f.read();assert(kit.power>bare.power*3);
  assert(aswDamage(kit,enemy).mean>25);
  assert(aswDamage(kit,enemy,{formation:'echelon'}).min>=48);
});

test('radar/recon/fighter raw ASW does not increase attack power or become intrinsic ASW',()=>{
  const f=fixture(),bare=f.read();
  f.target.after.slots=[f.gear(100,12,20,'测试电探')];near(f.read().power,bare.power);
  f.target.before={slots:f.target.after.slots.slice(),ex:0};f.target.ship.api_taisen=[120,120];
  f.target.after.slots=[];near(f.read().power,bare.power);
});

test('blue ASW contributes to damage as equipment ASW and is not counted twice',()=>{
  const f=fixture();Object.assign(f.target.master,{api_id:488,api_ctype:20,api_name:'由良改二'});
  f.target.ship.api_ship_id=488;f.store.const.$ships[488]=f.target.master;
  f.target.ship.api_taisen=[87,87];f.target.after.slots=[f.gear(149,14,12,'四式水中聴音機')];
  const reading=f.read();assert.equal(reading.blue,1);near(reading.power,2*Math.sqrt(87)+1.5*13+13);
  f.target.before={slots:f.target.after.slots.slice(),ex:0};f.target.ship.api_taisen=[100,100];
  near(f.read().power,reading.power);
});

test('large sonar, true depth charges and mortars use distinct synergy and armor effects',()=>{
  const f=fixture();const sonar=f.gear(132,40,11,'零式水中聴音機'),projector=f.gear(45,15,8,'三式爆雷投射機'),depth=f.gear(227,15,7,'二式爆雷');
  f.target.after.slots=[sonar,projector,depth];near(f.read().synergy,1.265);
  assert(roles({master:f.store.const.$equips[227]}).depth);
  const mortar=f.gear(346,15,3,'二式12cm迫撃砲改');f.target.after.slots=[sonar,mortar];
  near(f.read().synergy,1.15);near(f.read().penetration,0);
  const supply=f.gear(146,44,0,'洋上補給');assert.equal(isAswWeapon(f.store.const.$equips[supply]),false);
});

test('aircraft slot positions and attack capability are checked separately from the panel stat',()=>{
  const f=fixture({name:'大鷹改',stype:7}),plane=f.gear(97,8,6,'天山');
  f.target.master.api_maxeq=[0,18,0];f.target.after.slots=[-1,plane,-1];
  near(f.read().power,20+9+8);assert(f.read().normal&&f.read().opening);
  f.target.master.api_maxeq=[0,0,0];assert.equal(f.read().power,0);
  f.target.master.api_stype=18;f.target.master.api_name='大鳳改';assert.equal(f.read().power,0);
});

test('missing blue-bonus coverage cannot turn a native opening attack into confirmed damage',()=>{
  const f=fixture({name:'Jervis改',stype:2});
  f.target.after.slots=[f.gear(99999,14,20,'未收录声呐')];
  assert.equal(f.read().status,'unknown');assert.equal(f.read().power,null);
  const p=previewForMap('7-4',{paths:[['A','B','E','J','L','P']]});
  const assessment=assessAsw(f.store,{fleet:1,ships:[f.target.after]},p,{limit:1});
  assert.equal(assessment.status,'partial');assert.equal(assessment.readiness,0);
});

test('unknown opening ASW eligibility is not silently converted to false',()=>{
  const f=fixture({name:'鈴谷航改二',stype:7});
  f.target.master.api_maxeq=[18,0,0];
  f.target.after.slots=[f.gear(97,8,7,'测试舰攻'),f.gear(47,14,10,'三式水中探信儀')];
  const reading=f.read();
  assert.equal(reading.status,'unknown');assert.equal(reading.opening,null);
  assert.equal(reading.power,null);assert.match(reading.reason,/尚未确认/);
  const p=previewForMap('1-5',{paths:[['A','D','E','J']]});
  const assessment=assessAsw(f.store,{fleet:1,ships:[f.target.after]},p,{limit:1});
  assert.equal(assessment.status,'partial');
});

test('pure ASW filling never substitutes underway replenishment for missing depth charges',()=>{
  const f=fixture({stype:2}),id=f.gear(146,44,0,'洋上補給');
  f.store.const.$shipTypes[2].api_equip_type[44]=1;
  const scheme={fleet:1,ships:[{id:1,slots:[-1,-1,-1],ex:0}]};
  const filled=require('../../../src/recommendation/loadout/loadout_policy').completeCombatLoadout(f.store,scheme,[{id,master:f.store.const.$equips[id]}],{area:'1-5',asw:true});
  assert(filled.ships[0].slots.every(id=>id<0));
});

test('damage references use formation, engagement, ASW cap and defender armor independently',()=>{
  const attack={power:100,penetration:0},enemy={hp:45,armor:30};
  const ahead=aswDamage(attack,enemy),abreast=aswDamage(attack,enemy,{formation:'lineAbreast'});
  assert.deepEqual([ahead.min,ahead.max],[21,39]);near(ahead.mean,29.9);near(ahead.killOnHit,0);
  near(abreast.killOnHit,1);assert.equal(abreast.power,130);
  assert.equal(aswDamage(attack,enemy,{engagement:.8}).power,48);
  assert.equal(aswDamage({power:270,penetration:0},enemy,{formation:'lineAbreast'}).power,183);
  assert.equal(aswDamage(attack,{hp:null,armor:null}).status,'unknown');
});

test('7-4 checks each real enemy formation, excludes air raids and retains the J flagship threat',()=>{
  const p=previewForMap('7-4',{paths:[['A','B','E','J','L','P']]}),nodes=submarineEncounters(p);
  assert.deepEqual(nodes.map(n=>n.id),['B','J','L','P']);assert(requiresAswPackages(p));
  const triple=nodes.find(n=>n.id==='J').formations.find(subs=>subs.length===3&&subs.every(s=>s.id===1572));
  assert(triple&&triple.every(s=>s.hp===48&&s.armor===42));
  near(mapBonus('7-4','J',1),1.25);near(mapBonus('7-4','P',1),1.33);near(mapBonus('7-4','P',21),1.23);
  assert.equal(requiresAswPackages(previewForMap('4-2',{paths:[['A','C','L'],['B','D','C','L']]})),true);
  assert.equal(requiresAswPackages(previewForMap('1-5')),true);
  assert.equal(requiresAswPackages(previewForMap('4-2',{paths:[['A','E','G','L']]})),false,'off-route submarines do not request packages');
});

test('ASW package fitting preserves manual slots, real stock, the snapshot and another ship weapons',()=>{
  const f=fixture({name:'Jervis改',stype:2});
  const sonar=f.gear(149,14,12,'四式水中聴音機'),projector=f.gear(287,15,12,'三式爆雷投射機 集中配備'),depth=f.gear(227,15,7,'二式爆雷');
  const gun=f.gear(500,1,0,'主炮'),otherGun=f.gear(501,1,0,'另一艘的主炮'),radar=f.gear(582,12,0,'电探');
  f.store.const.$equips[500].api_houg=5;
  f.store.const.$ships[2]={...f.target.master,api_id:2};
  f.store.info.ships[2]={...f.target.ship,api_ship_id:2};
  const scheme={fleet:1,ships:[{id:1,slots:[gun,sonar,radar],ex:0},{id:2,slots:[otherGun,-1,-1],ex:0}]};
  const inventory=Object.values(f.store.info.equips).map(e=>({id:e.api_id,master:f.store.const.$equips[e.api_slotitem_id]}));
  const p=previewForMap('7-4',{paths:[['A','B','E','J','L','P']]}),before=JSON.stringify(f.store);
  const variants=fitAswLoadouts(f.store,scheme,inventory,{profile:p,escorts:new Set([1])});
  assert(variants.some(r=>r.ships[0].slots.includes(projector)&&r.ships[0].slots.includes(depth)));
  for(const r of variants){const ids=r.ships.flatMap(e=>e.slots).filter(id=>id>0);assert.equal(new Set(ids).size,ids.length);assert.deepEqual(r.ships[1],scheme.ships[1]);}
  const locked=fitAswLoadouts(f.store,scheme,inventory,{profile:p,escorts:new Set([1]),heldSlots:[{...scheme.ships[0],keep:{0:true}}]});
  assert(locked.every(r=>r.ships[0].slots[0]===gun));
  assert(assessAsw(f.store,variants.at(-1),p,{limit:1}).readiness>assessAsw(f.store,scheme,p,{limit:1}).readiness);
  assert.equal(JSON.stringify(f.store),before);
});

test('light road escorts keep two guns once one sonar supplies effective damage',()=>{
  const f=fixture({name:'Jervis改',stype:2});
  const sonar=f.gear(149,14,12,'四式水中聴音機'),projector=f.gear(287,15,12,'三式爆雷投射機 集中配備'),depth=f.gear(227,15,7,'二式爆雷');
  const guns=[f.gear(500,1,0,'主炮甲'),f.gear(501,1,0,'主炮乙')];
  for(const id of guns)f.store.const.$equips[id].api_houg=5;
  const scheme={fleet:1,ships:[{id:1,slots:[...guns,sonar],ex:0}]};
  const p=previewForMap('4-2',{paths:[['B','D','C','L']]}),base=assessAsw(f.store,scheme,p,{limit:1});
  assert.equal(base.readiness,1);
  const heavy={fleet:1,ships:[{id:1,slots:[sonar,projector,depth],ex:0}]};
  assert.equal(assessAsw(f.store,heavy,p,{limit:1}).score,base.score,'overkill has no extra escort credit');
  const inventory=Object.values(f.store.info.equips).map(e=>({id:e.api_id,master:f.store.const.$equips[e.api_slotitem_id]}));
  for(const r of fitAswLoadouts(f.store,scheme,inventory,{profile:p,escorts:new Set([1])})){
    assert.equal(r.ships[0].slots.filter(id=>guns.includes(id)).length,2);
    assert.equal(r.ships[0].slots.filter(id=>isAswWeapon(f.store.const.$equips[id])).length,1);
  }
});

test('armored enemy cannot be hidden by weak escorts; mixed battle formation changes effective damage',()=>{
  const f=fixture({name:'Jervis改',stype:2});
  const sonar=f.gear(149,14,12,'四式水中聴音機');
  const scheme={fleet:1,ships:[{id:1,slots:[sonar,-1,-1],ex:0}]};
  const p=previewForMap('7-4',{paths:[['A','B','E','J','L','P']]});
  const line=assessAsw(f.store,scheme,p,{limit:1,formation:'lineAhead',details:true});
  const abreast=assessAsw(f.store,scheme,p,{limit:1,formation:'lineAbreast'});
  assert(line.readiness<.1);assert(abreast.readiness>line.readiness);
  const triple=line.nodes.find(n=>n.id==='J');
  assert.equal(triple.enemyCount,3);assert(triple.hardTargetCapacity<.1);
});

test('4-4 pure submarine node and surface boss use different own formations',()=>{
  const f=fixture({name:'Jervis改',stype:2});
  const p=previewForMap('4-4',{paths:[['A','E','I','K']]}),scheme={fleet:1,ships:[{id:1,slots:[],ex:0}]};
  const report=assessAsw(f.store,scheme,p,{limit:2});
  assert.deepEqual(report.nodes.map(n=>[n.id,n.formation]),[['E','lineAbreast'],['K','lineAhead']]);
  assert.equal(submarineEncounters(p)[0].kind,'asw');
  const early=report.nodes.find(n=>n.id==='E');
  assert(early.readiness<1,'bare native OASW may clear weak subs but cannot hide the armored flagship');
});

test('multi-stage submarine objectives and bypasses are isolated by the selected path',()=>{
  for(const [area,phase,paths,expected] of [
    ['7-2','gauge1',[['C','E','G']],['C','E','G']],
    ['7-2','gauge2',[['B','C','D','I','M']],['C']],
    ['7-3','gauge1',[['A','C','E']],[]],
    ['7-3','gauge2',[['A','C','D','G','J','P']],['J']],
    ['5-6','gauge1',[['A','C2','D','E','G']],['A']],
    ['5-6','gauge3',[['I','O','Q','U','X','Z']],['Q']],
  ])assert.deepEqual(submarineEncounters(previewForMap(area,{phase,paths})).map(n=>n.id),expected,area+' '+phase);
});

test('entry ammo is assessed before each encounter, not from the target or another branch',()=>{
  const profile=previewForMap('5-5',{paths:[['B','K','P','S']]});
  // Deliberately long diagnostic path: the same final node loses damage
  // after five surface battles, while the early B node remains fully supplied.
  const long={...profile,routePaths:[{nodes:['B','K','P','K','P','K','S']}]};
  const nodes=submarineEncounters(long);
  assert.equal(nodes.find(n=>n.id==='B').ammo,1);
  assert.equal(nodes.find(n=>n.id==='S').ammo,0);
});

test('aviation ASW requires an attack aircraft, not sonar, recon, fighter or a zero-capacity slot',()=>{
  const {aswPower}=require('../../../src/domain/combat/opening_attack_power');
  for(const stype of [6,10,16]){
    const f=fixture({name:stype===10?'伊勢改二':'测试航空舰',stype});f.target.master.api_maxeq=[0,8,18];
    const sonar=f.gear(132,40,11,'零式水中聴音機'),recon=f.gear(9,10,2,'零式水上偵察機'),fighter=f.gear(163,45,1,'Ro.44水上戦闘機');
    const bomber=f.gear(26,11,4,'瑞雲');
    f.target.after.slots=[sonar,recon,fighter];assert.equal(f.read().normal,false);
    f.target.after.slots=[bomber,sonar,-1];assert.equal(f.read().normal,false);
    f.target.after.slots=[sonar,bomber,-1];assert.equal(f.read().normal,true);assert.equal(f.read().opening,false);
    const ui=()=>aswPower({...f.target,items:f.target.after.slots.filter(id=>id>0).map(id=>({id,
      instance:f.store.info.equips[id],master:f.store.const.$equips[id],type:f.store.const.$equips[id].api_type[2]}))},f.store);
    near(ui().base,f.read().power);
    f.target.after.slots=[sonar,recon,fighter];assert.equal(ui().status,'unavailable');
    f.target.after.slots=[sonar,bomber,-1];delete f.target.master.api_maxeq;
    assert.equal(ui().status,'unknown','missing aircraft capacity cannot produce confirmed ASW power');
  }
});

test('light carriers separate rotor-only opening ASW from normal ASW; patrol alone does not enable ordinary BBV ASW',()=>{
  const f=fixture({name:'龍驤改二',stype:7});f.target.master.api_maxeq=[18,12,6];
  const rotor=f.gear(69,25,9,'カ号観測機'),patrol=f.gear(70,26,7,'三式指揮連絡機(対潜)'),plane=f.gear(97,8,6,'天山');
  f.target.after.slots=[rotor];assert.equal(f.read().normal,false);assert.equal(f.read().opening,true);
  f.target.after.slots=[rotor,plane];assert.equal(f.read().normal,true);assert.equal(f.read().opening,true);
  f.target.master.api_stype=10;f.target.master.api_name='伊勢改二';f.target.after.slots=[patrol];
  assert.equal(f.read().normal,false);assert.equal(f.read().power,0);
  f.target.after.slots=[rotor];assert.equal(f.read().normal,true);assert.equal(f.read().opening,false);
});

test('Fusou and Yamashiro retain their real depth-charge exception, but sonar alone cannot enable it',()=>{
  const f=fixture({name:'扶桑改二',stype:10});f.target.ship.api_taisen=[100,100];
  const sonar=f.gear(132,40,11,'零式水中聴音機'),depth=f.gear(227,15,7,'二式爆雷');
  f.target.after.slots=[sonar];assert.equal(f.read().normal,false);assert.equal(f.read().opening,false);
  f.target.after.slots=[sonar,depth];assert(f.read().normal&&f.read().opening);near(f.read().power,(20+27+13)*1.15);
});

function aviationFittingFixture(stype=10,name='日向改二'){
  const f=fixture({stype,name});f.target.master.api_slot_num=5;f.target.master.api_maxeq=[2,8,24,12,11];
  f.target.ship.api_taisen=[80,80];f.target.ship.api_slot=[-1,-1,-1,-1,-1];
  Object.assign(f.store.const.$shipTypes[stype].api_equip_type,{7:1,8:1,11:1,25:1,26:1});
  // Distinct physical copies, with real catalog IDs for blue-bonus coverage.
  const add=(mid,t,raw,name,copies)=>Array.from({length:copies},(_,n)=>{
    f.gear(mid,t,raw,name);const id=mid*100+n;f.store.info.equips[id]={api_id:id,api_slotitem_id:mid,api_level:0};return id;
  });
  const sonars=add(149,14,12,'四式水中聴音機',5),rotors=add(69,25,9,'カ号観測機',2),bombers=add(26,11,4,'瑞雲',2),torpedo=add(82,8,8,'九七式艦攻(九三一空)',2);
  for(const mid of [149,69,26,82])delete f.store.info.equips[mid];
  const inventory=()=>Object.values(f.store.info.equips).map(e=>({id:e.api_id,master:f.store.const.$equips[e.api_slotitem_id]}));
  const scheme={fleet:1,ships:[{id:1,slots:sonars,ex:0}]},profile=previewForMap('1-5',{paths:[['A','D','F','G','J']]});
  return {...f,sonars,rotors,bombers,torpedo,inventory,scheme,profile};
}

test('1-5 Hyuga replaces an all-sonar outfit with a usable opening-ASW package and compares whole power',()=>{
  const f=aviationFittingFixture(),before=JSON.stringify(f.store);
  const {completeCombatLoadout,emptyLoadout,aswEscortIds}=require('../../../src/recommendation/loadout/loadout_policy');
  const seed=completeCombatLoadout(f.store,emptyLoadout(f.store,f.scheme),f.inventory(),{area:'1-5',asw:true,profile:f.profile});
  const read=scheme=>{f.target.after=scheme.ships[0];return f.read();};
  assert(read(seed).normal&&read(seed).opening);assert.equal(seed.ships[0].slots.filter(id=>f.rotors.includes(id)).length,2);
  const variants=fitAswLoadouts(f.store,f.scheme,f.inventory(),{profile:f.profile,escorts:aswEscortIds(f.store,f.scheme.ships,Infinity)});
  assert(variants.length);
  for(const v of variants){const a=read(v);assert(a.normal&&a.opening);assert(a.power>=read(seed).power);
    assert.equal(new Set(v.ships[0].slots).size,5);}
  assert.equal(JSON.stringify(f.store),before);
});

test('pure-ASW CAV, AV and CVL fits keep an actual normal attack; unavailable and held slots stay respected',()=>{
  for(const [stype,name] of [[6,'最上改二'],[16,'千歳甲'],[7,'龍驤改二']]){
    const f=aviationFittingFixture(stype,name);
    const variants=fitAswLoadouts(f.store,f.scheme,f.inventory(),{profile:f.profile,escorts:new Set([1]),
      heldSlots:[{...f.scheme.ships[0],keep:{0:true}}]});
    assert(variants.length,name);
    for(const v of variants){f.target.after=v.ships[0];assert(f.read().normal,name);assert.equal(v.ships[0].slots[0],f.sonars[0]);}
  }
  const f=aviationFittingFixture();
  const {completeCombatLoadout,emptyLoadout}=require('../../../src/recommendation/loadout/loadout_policy');
  const inventory=f.inventory().filter(e=>f.sonars.includes(e.id));
  const fitted=completeCombatLoadout(f.store,emptyLoadout(f.store,f.scheme),inventory,{area:'1-5',asw:true,profile:f.profile});
  f.target.after=fitted.ships[0];assert.equal(f.read().normal,false);assert(fitted.ships[0].slots.every(id=>id<=0),'do not fill five useless sonars without an attack');
});

test('submarine objectives credit normal aviation ASW and preserve it even after fleet coverage saturates',()=>{
  const f=aviationFittingFixture(10,'伊勢改二'),base={fleet:1,ships:[{id:1,slots:f.sonars,ex:0}]};
  const fit={fleet:1,ships:[{id:1,slots:[f.bombers[0],...f.sonars.slice(0,4)],ex:0}]};
  assert(assessAsw(f.store,fit,f.profile,{limit:1}).readiness>assessAsw(f.store,base,f.profile,{limit:1}).readiness);
  assert.equal(require('../../../src/domain/combat/asw_combat').maintainsAsw(f.store,fit,base,f.profile,1),false);
});

test('filling gaps cannot compact a required ASW aircraft into a zero-capacity slot',()=>{
  const f=aviationFittingFixture(16,'测试水母');f.target.master.api_maxeq=[0,8,0,0,0];
  const {completeCombatLoadout,emptyLoadout}=require('../../../src/recommendation/loadout/loadout_policy');
  const fitted=completeCombatLoadout(f.store,emptyLoadout(f.store,f.scheme),f.inventory().filter(e=>f.rotors.includes(e.id)),
    {area:'1-5',asw:true,profile:f.profile});
  f.target.after=fitted.ships[0];assert.equal(f.read().normal,true);assert.equal(f.target.after.slots[0],-1);
  assert(f.rotors.includes(f.target.after.slots[1]));
});
