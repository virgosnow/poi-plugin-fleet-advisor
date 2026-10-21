'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {fleetMechanisms}=require('../../../src/domain/combat/ship_mechanisms');
const {specialAttackCores,arrangeSpecialAttack,fleetSpecialAttacks}=require('../../../src/domain/combat/special_attacks');

test('special search cores cover each existing family and arrange actual participants without moving holds',()=>{
  const make=(id,name,stype=9,power=100)=>({id,power,master:{api_name:name,api_stype:stype}});
  const roster=[make(1,'Nelson改'),make(2,'大和改二'),make(3,'武蔵改二'),make(4,'長門改二'),
    make(5,'Colorado改'),make(6,'Warspite改'),make(7,'Valiant改'),make(8,'金剛改二丙',8),
    make(9,'比叡改二丙',8),make(10,'航巡',6,200),make(11,'驱逐',2,30),make(12,'空母',11,400)];
  const cores=specialAttackCores(roster),labels=new Set();
  for(const core of cores){
    const rows=[...core,...roster.filter(r=>!core.includes(r))].slice(0,6);
    const ordered=arrangeSpecialAttack(rows,core);if(!ordered)continue;
    labels.add(fleetSpecialAttacks(ordered,ordered).get(ordered[0].id).label);
  }
  for(const label of ['Nelson Touch','大和型齐射','长门型齐射','Colorado级齐射','Queen Elizabeth级齐射','金刚型夜战突击'])assert(labels.has(label),label);
  assert(!specialAttackCores(roster,{night:false}).some(c=>c[0].id===8));
  const rows=[roster[11],roster[10],roster[0],roster[9],roster[3],roster[5]],before=JSON.stringify(rows);
  const ordered=arrangeSpecialAttack(rows,[roster[0]],{locked:new Map([[1,12]])});
  assert.equal(ordered[0].id,1);assert.equal(ordered[1].id,12);assert.equal(ordered[2].id,10);
  assert(![7,11,18].includes(ordered[4].master.api_stype));assert.equal(JSON.stringify(rows),before);
  assert.equal(arrangeSpecialAttack(rows,[roster[0]],{locked:new Map([[0,11]])}),null);
  assert.equal(arrangeSpecialAttack(rows,[roster[0]],{locked:new Map([[2,12]])}),null);
  assert.equal(arrangeSpecialAttack(rows.slice(1),[roster[0]]),null);
});

function setup(names=[]){
  const store=fixture(),entries=Array.from({length:6},(_,i)=>({id:i+1,slots:[-1,-1],ex:-1}));
  for(const ship of Object.values(store.info.ships))Object.assign(ship,{api_nowhp:100,api_maxhp:100});
  const set=(position,name,type=9)=>Object.assign(store.const.$ships[position+1],{api_name:name,api_stype:type});
  names.forEach((name,i)=>set(i,name));
  const read=()=>fleetMechanisms(store,entries),badge=(id=1)=>read().get(id)?.find(b=>b.key.startsWith('special-'));
  const hp=(position,value)=>{store.info.ships[position+1].api_nowhp=value;};
  return {store,entries,set,read,badge,hp};
}

function referenceStats(f){
  for(const ship of Object.values(f.store.info.ships))Object.assign(ship,{api_karyoku:[100,100],api_raisou:[20,100],api_kyouka:[0,0,0,0,0]});
  for(const master of Object.values(f.store.const.$ships))Object.assign(master,{api_houg:[100,100],api_raig:[20,100],api_ctype:0,api_aftershipid:'0'});
  return f;
}

function rateStats(f,level=99,luck=40){
  for(const ship of Object.values(f.store.info.ships))Object.assign(ship,{api_lv:level,api_lucky:[luck,99]});
  return f;
}
test('special activation references use current family formulas and each actual participant',()=>{
  const n=rateStats(setup(['Nelson改']),175,50);
  assert(Math.abs(n.badge().activation.percent-(3.1*Math.sqrt(175)+1.4*Math.sqrt(50)+25))<1e-10);
  assert.match(n.badge().detail,/^发动率：75.9%/);
  const before=n.badge().activation.percent;
  n.store.info.ships[2].api_lv=1;n.store.info.ships[3].api_lucky=[0,99];
  assert.equal(n.badge().activation.percent,before,'nonparticipants and partner luck do not affect Nelson');
  n.store.info.ships[3].api_lv=1;assert(n.badge().activation.percent<before);
  const nagato=rateStats(setup(['長門改二','陸奥改二']));
  assert.equal(nagato.badge().activation.percent,63);
  nagato.store.info.ships[2].api_lucky=[0,99];assert.equal(nagato.badge().activation.percent,54);
  const qe=rateStats(setup(['Valiant改','Warspite改']));
  qe.store.info.ships[2].api_lv=98;qe.store.info.ships[2].api_lucky=[70,99];
  assert.match(qe.badge().detail,/^发动率：67.5%/);
  assert.equal(qe.badge().activation.percent.toFixed(3),'67.479');
});
test('Rodney shares Nelson rate with her own flagship stats and actual positions 1/3/5',()=>{
  const f=rateStats(setup(['Nelson改']),99,40);
  f.store.info.ships[3].api_lv=85;f.store.info.ships[5].api_lv=120;
  const reference=f.badge().activation.percent;
  for(const flag of ['Rodney','Rodney改','Nelson','Nelson改']){
    f.set(0,flag);assert.equal(f.badge().activation.percent,reference,flag);
    assert.match(f.badge().detail,/^发动率：[0-9]+\.[0-9]%/);
    assert.deepEqual(f.badge().participants.map(p=>p.position),[1,3,5]);
  }
  f.set(0,'Rodney改');f.store.info.ships[1].api_lucky=[70,99];
  assert(f.badge().activation.percent>reference,'use Rodney current luck, not Nelson master defaults');
  const higher=f.badge().activation.percent;f.set(1,'Nelson改');f.store.info.ships[2].api_lucky=[99,99];
  assert.equal(f.badge().activation.percent,higher,'second fleet position does not contribute');
});
test('Yamato pair activation counts projected radars and accuracy, including expansion, without borrowing damage bonuses',()=>{
  const f=rateStats(setup(['大和改二','武蔵改二']));
  const equip=(id,type,accuracy)=>{
    f.store.const.$equips[id]={api_id:id,api_name:'测试电探',api_type:[0,0,type,0],api_houm:accuracy,api_saku:0};
    f.store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};return id;
  };
  const base=f.badge().activation.percent;assert.equal(base,75);
  f.entries[0].ex=equip(90001,12,0);assert.equal(f.badge().activation.percent,base+10);
  f.entries[1].ex=equip(90002,13,7);assert.equal(f.badge().activation.percent,base+10);
  f.store.const.$equips[90002].api_houm=8;assert.equal(f.badge().activation.percent,base+20);
  delete f.store.const.$equips[90002].api_houm;assert.equal(f.badge().activation.percent,null);
  assert.match(f.badge().activation.reason,/第 2 位装备资料/);f.store.const.$equips[90002].api_houm=8;
  f.entries[0].slots=[90001,90001];assert.equal(f.badge().activation.percent,100,'clamp to probability range');
  f.entries[0].slots=[-1,-1];f.entries[0].ex=-1;f.entries[1].ex=-1;
  f.store.info.ships[1].api_slot=[90001,90001];f.store.info.ships[2].api_slot_ex=90002;
  assert.equal(f.badge().activation.percent,base,'old worn gear must not leak into the draft');
  f.set(1,'Iowa改');assert.equal(f.badge().activation.percent,base-7);
  f.set(0,'武蔵改二');f.set(1,'大和改二重');assert.equal(f.badge().activation.percent,base-3);
});
test('activation keeps real zero luck, reports missing inputs and ignores temporary state',()=>{
  const f=rateStats(setup(['長門改二','陸奥改二']),1,0);
  assert.equal(f.badge().activation.percent,27);
  const before=JSON.stringify([f.store,f.entries]);f.badge();assert.equal(JSON.stringify([f.store,f.entries]),before);
  for(const ship of Object.values(f.store.info.ships))Object.assign(ship,{api_nowhp:1,api_cond:1,api_fuel:0,api_bull:0});
  assert.equal(f.badge().activation.percent,27);
  delete f.store.info.ships[2].api_lucky;assert.equal(f.badge().activation.percent,null);
  assert.match(f.badge().detail,/发动率：待确认\n要求阵型：[^\n]+\n缺少第 2 位运/);
  f.store.info.ships[2].api_lucky=[40,99];f.store.info.ships[1].api_lv=null;
  assert.equal(f.badge().activation.percent,null);assert.match(f.badge().activation.reason,/第 1 位等级/);
  f.set(1,'驱逐',2);assert.equal(f.badge().activation.percent,0);assert.match(f.badge().detail,/第 2 位需战舰／航战/);
});
test('rate equipment effects do not reuse power bonuses and follow draft positions',()=>{
  for(const names of [['Nelson改'],['長門改二','陸奥改二'],['Warspite改','Valiant改']]){
    const f=rateStats(setup(names)),before=f.badge().activation.percent;
    f.store.const.$equips[90001]={api_id:90001,api_name:'15m二重測距儀＋21号電探改二',api_type:[0,0,13,0],api_houm:9,api_saku:7};
    f.store.info.equips[90001]={api_id:90001,api_slotitem_id:90001,api_level:10};
    f.entries[0].ex=90001;assert.equal(f.badge().activation.percent,before,names.join('/'));
  }
  const f=rateStats(setup(['長門改二','陸奥改二']));f.store.info.ships[3].api_lv=1;f.store.info.ships[3].api_lucky=[0,99];
  const before=f.badge().activation.percent;[f.entries[1],f.entries[2]]=[f.entries[2],f.entries[1]];
  f.set(2,'测试战舰',9);assert(f.badge().activation.percent<before);
  delete f.store.const.$ships[6].api_stype;
  assert.equal(f.badge().activation.percent,null);assert.match(f.badge().activation.reason,/编成资料不完整/);
});
function rateEquip(f,id,type,los=0){
  f.store.const.$equips[id]={api_id:id,api_name:'测试装备',api_type:[0,0,type,0],api_saku:los};
  f.store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};return id;
}
test('French touch requires the remodeled sisters in positions 1/2 and six surface ships',()=>{
  for(const pair of [['Richelieu改','Jean Bart改'],['Richelieu Deux','Jean Bart改'],['Jean Bart改','Richelieu改'],['Jean Bart改','Richelieu Deux']]){
    const f=referenceStats(setup(pair)),b=f.badge();
    assert.equal(b.label,'Richelieu级齐射');assert.equal(b.state,'conditional');assert.equal(b.activation.percent,null);
    assert.deepEqual(b.participants.map(p=>p.position),[1,2]);assert(!f.badge(2));
    assert.match(b.detail,/复纵阵/);assert.match(b.detail,/每次出击 1 次/);
    assert.match(b.detail,/第 1 位需未中破；第 2 位需未大破/);
    f.hp(0,1);f.hp(1,1);assert.equal(f.badge().state,'conditional','damage stays guidance');
    f.set(5,'潜艇',13);assert.equal(f.badge().state,'blocked');assert.match(f.badge().detail,/6 艘水上舰/);
  }
  for(const partner of ['Jean Bart','Richelieu改','任意战舰'])assert.equal(setup(['Richelieu改',partner]).badge().state,'blocked');
  assert(!setup(['Richelieu','Jean Bart改']).badge());assert(!setup(['Jean Bart','Richelieu改']).badge());
  const f=setup(['Richelieu改','Jean Bart改']);[f.entries[1],f.entries[2]]=[f.entries[2],f.entries[1]];
  assert.equal(f.badge().state,'blocked','a third-position sister cannot become the second ship');
});
test('French power uses per-ship equipment, double-line formation and 2/1 shots; Deux uses Kai reference',()=>{
  const f=referenceStats(setup(['Richelieu改','Jean Bart改']));
  assert.deepEqual(f.badge().attacks.map(r=>[r.day,r.night,r.hits]),[[109,156,2],[104,148,1]]);
  const ap=rateEquip(f,142,19),r=rateEquip(f,456,13,5);
  f.entries[0].ex=ap;f.entries[1].ex=r;
  let b=f.badge();assert(Math.abs(b.attacks[0].multiplier-1.302*1.35)<1e-10);
  assert(Math.abs(b.attacks[1].multiplier-1.24*1.15)<1e-10);
  f.entries[1].slots=[r,ap];b=f.badge();assert(Math.abs(b.attacks[1].multiplier-1.24*1.15*1.35)<1e-10);
  const kai=f.badge().attacks[0];f.set(0,'Richelieu Deux');b=f.badge();
  assert.equal(b.attacks[0].day,kai.day);assert.equal(b.attacks[0].night,kai.night);assert.equal(b.attacks[0].reference,true);
  assert.match(b.detail,/昼战参考攻击力：[0-9]+ × 2击/);assert(!b.detail.includes('炮击倍率待确认'));assert.notEqual(b.attacks[1].day,null);
  assert.equal(b.attacks[1].reference,undefined,'Jean Bart remains a known coefficient');
  f.set(0,'Jean Bart改');f.set(1,'Richelieu改');assert.equal(f.badge().attacks[0].multiplier,1.24*1.35);
});
test('Deux reference preserves her own stats and the flagship-only bonus rather than copying Jean Bart',()=>{
  const f=referenceStats(setup(['Richelieu Deux','Jean Bart改']));let b=f.badge();
  assert.deepEqual(b.attacks.map(r=>[r.day,r.night,r.hits]),[[109,156,2],[104,148,1]]);
  assert.match(b.detail,/第 1 位 Richelieu Deux\n昼战参考攻击力：109 × 2击\n夜战参考攻击力：156 × 2击/);
  f.store.info.ships[1].api_karyoku=[200,200];f.store.info.ships[1].api_raisou=[40,40];b=f.badge();
  assert(b.attacks[0].day>109);assert.equal(b.attacks[1].day,104);
  f.set(0,'Jean Bart改');f.set(1,'Richelieu Deux');b=f.badge();
  assert.equal(b.attacks[0].multiplier,1.24);assert.equal(b.attacks[0].reference,undefined);
  assert.equal(b.attacks[1].multiplier,1.24);assert.equal(b.attacks[1].reference,true);
  assert.match(b.detail,/第 2 位 Richelieu Deux\n昼战参考攻击力：104 × 1击/);
  assert.equal(b.activation.percent,null,'reference power does not invent an activation rate');
});
test('Mutsu with Nelson uses Nagato reference multipliers while retaining each ship gear and shot count',()=>{
  for(const helper of ['Nelson','Nelson改']){
    const f=rateStats(referenceStats(setup(['陸奥改二',helper])));let b=f.badge();
    assert.deepEqual(b.attacks.map(r=>[r.day,r.night,r.hits]),[[120,184,2],[117,180,1]]);
    assert(b.attacks.every(r=>r.reference===true));assert.equal(b.activation.percent,63);
    assert.match(b.detail,/第 1 位 陸奥改二\n昼战参考攻击力：120 × 2击/);
    assert.match(b.detail,/第 2 位 Nelson(?:改)?\n昼战参考攻击力：117 × 1击/);
    f.entries[0].ex=rateEquip(f,142,19);f.entries[1].ex=rateEquip(f,456,13,7);b=f.badge();
    assert(Math.abs(b.attacks[0].multiplier-1.54*1.35)<1e-10);
    assert(Math.abs(b.attacks[1].multiplier-1.5*1.15)<1e-10);
    const before=JSON.stringify([f.store,f.entries]);f.badge();assert.equal(JSON.stringify([f.store,f.entries]),before);
    f.set(0,'長門改二');f.set(1,'Nelson改');const n=f.badge();
    assert.deepEqual(n.attacks.map(r=>[r.day,r.night,r.hits]),b.attacks.map(r=>[r.day,r.night,r.hits]));
    assert(n.attacks.every(r=>r.reference===undefined),'verified Nagato wording is unchanged');
  }
});
test('French search cores arrange the sisters without replacing manual positions',()=>{
  const rows=Array.from({length:6},(_,i)=>({id:i+1,power:100,master:{api_name:i===0?'Richelieu改':i===1?'Jean Bart改':'驱逐',api_stype:i<2?8:2}}));
  const cores=specialAttackCores(rows);assert.deepEqual(cores.map(c=>c.map(r=>r.id)),[[1,2],[2,1]]);
  for(const core of cores){const ordered=arrangeSpecialAttack(rows,core);assert.equal(fleetSpecialAttacks(ordered,ordered).get(core[0].id).label,'Richelieu级齐射');}
  const ordered=arrangeSpecialAttack(rows,cores[0]);assert.deepEqual(ordered.slice(0,2).map(r=>r.id),[1,2]);
  assert.equal(arrangeSpecialAttack(rows,cores[0],{locked:new Map([[1,3]])}),null);
});
test('French reference rate uses both participants current stats, floors once and shares the night reference',()=>{
  for(const pair of [['Richelieu改','Jean Bart改'],['Richelieu Deux','Jean Bart改'],['Jean Bart改','Richelieu改'],['Jean Bart改','Richelieu Deux']]){
    const f=rateStats(referenceStats(setup(pair))),originalPower=f.badge().attacks;
    Object.assign(f.store.info.ships[1],{api_lv:64,api_lucky:[25,99]});
    Object.assign(f.store.info.ships[2],{api_lv:100,api_lucky:[49,99]});
    let b=f.badge();assert.equal(b.activation.percent,62,'floor only the complete formula');
    assert.equal(b.activation.reference,true);assert.equal(b.activation.model,'french-enwiki-reference');
    assert.equal(b.activation.phase,'day-night');assert.equal(b.activation.nightAssumedSameAsDay,true);
    assert.match(b.detail,/^参考发动率：62.0%/);
    const power=b.attacks;assert.deepEqual(power,originalPower,'rate data does not change attack power');
    for(const id of [3,4,5,6]){delete f.store.info.ships[id].api_lv;delete f.store.info.ships[id].api_lucky;}
    const gun=rateEquip(f,576,3),radar=rateEquip(f,456,13,9),ap=rateEquip(f,142,19);
    f.store.const.$equips[576].api_name='38cm四連装砲改 deux';f.store.info.equips[576].api_level=10;
    f.entries[0].slots=[gun,gun];f.entries[0].ex=radar;f.entries[1].ex=ap;
    assert.equal(f.badge().activation.percent,62,'no gun, radar, AP, improvement or nonparticipant rate bonus');
    f.store.info.ships[1].api_lucky=[81,99];assert.equal(f.badge().activation.percent,67);
    f.store.info.ships[2].api_lucky=[0,99];assert.equal(f.badge().activation.percent,58,'real zero luck is valid');
    const before=JSON.stringify([f.store,f.entries]);f.badge();assert.equal(JSON.stringify([f.store,f.entries]),before);
    f.entries[0].slots=[-1,-1];f.entries[0].ex=-1;f.entries[1].ex=-1;
    f.store.info.ships[1].api_slot=[gun,gun];assert.equal(f.badge().activation.percent,58,'old worn gear cannot affect rate');
    delete f.store.info.ships[2].api_lucky;b=f.badge();assert.equal(b.activation.percent,null);
    assert.match(b.detail,/^参考发动率：待确认\n要求阵型：[^\n]+\n缺少第 2 位运/);assert.equal(b.activation.formulaUnknown,undefined);
    f.store.info.ships[2].api_lucky=[0,99];f.store.info.ships[1].api_lv=null;
    assert.match(f.badge().activation.reason,/第 1 位等级/);
    for(const id of [1,2])Object.assign(f.store.info.ships[id],{api_lv:1,api_lucky:[0,99]});
    assert.equal(f.badge().activation.percent,32);
    for(const id of [1,2])Object.assign(f.store.info.ships[id],{api_lv:180,api_lucky:[1000,1000]});
    assert.equal(f.badge().activation.percent,100);
    f.set(1,'任意战舰');assert.equal(f.badge().activation.percent,0);assert.match(f.badge().detail,/^参考发动率：0.0%/);
  }
});
test('submarine reference rate reads current submarine radar presence without changing attack power',()=>{
  const f=rateStats(subSetup());let b=f.badge();const base=b.activation.percent,power=b.attacks;
  assert.equal(base,66);assert.equal(b.activation.reference,true);assert.equal(b.activation.tentative,true);
  assert.equal(b.activation.model,'submarine-sheet-20261019-tentative');
  assert.equal(b.activation.phase,'day-night');assert.equal(b.activation.nightAssumedSameAsDay,true);
  assert.match(b.detail,/^参考发动率：66.0%（待验证）/);
  f.entries[0].ex=rateEquip(f,214,51);assert.equal(f.badge().activation.percent,base,'AS equipment is not a submarine radar bonus');
  f.entries[1].ex=rateEquip(f,215,51);assert.equal(f.badge().activation.percent,base+10);
  assert.deepEqual(f.badge().attacks.map(r=>[r.day,r.night]),power.map(r=>[r.day,r.night]));
  assert.equal(f.badge().attacks[0].hits,2,'separate known two-strike rule is retained');
  f.entries[1].slots=[rateEquip(f,216,51),rateEquip(f,217,51)];assert.equal(f.badge().activation.percent,base+10);
  f.store.info.equips[215].api_level=10;assert.equal(f.badge().activation.percent,base+10);
  f.entries[2].ex=rateEquip(f,218,51);assert.equal(f.badge().activation.percent,base+20);
  f.entries[1].ex=-1;f.entries[1].slots=[-1,-1];f.entries[2].ex=-1;
  f.store.info.ships[2].api_slot_ex=215;f.store.info.ships[3].api_slot=[218,-1];
  const before=JSON.stringify([f.store,f.entries]);assert.equal(f.badge().activation.percent,base);
  assert.equal(JSON.stringify([f.store,f.entries]),before,'reads neither old worn gear nor mutates the snapshot');
  f.set(1,'驱逐',2);assert.equal(f.badge().activation.percent,0);assert.match(f.badge().detail,/^参考发动率：0.0%\n/);
  assert(!f.badge().detail.includes('（待验证）'),'a known blocked state is not an estimated probability');
});

test('submarine reference is compatible with all eight source records, keeping aggregated data approximate',()=>{
  const fs=require('fs'),path=require('path');
  const rows=fs.readFileSync(path.join(__dirname,'../../fixtures/submarine-rates.csv'),'utf8').split(/[\r\n]+/)
    .map(line=>line.split(',')).filter(r=>r[0]&&(/^\d+$/.test(r[5])||r[0].startsWith('AS／')));
  assert.equal(rows.length,8);
  const predictions=[];
  for(const r of rows){
    const aggregate=r[0].startsWith('AS／'),names=r[0].split('／'),f=rateStats(subSetup());
    if(aggregate)f.set(3,'伊400改',14);
    names.forEach((name,p)=>{
      const [level,luck]=r[p+2].split('／').map(Number);
      Object.assign(f.store.info.ships[p+1],{api_lv:level,api_lucky:[luck,99]});
      if(name.includes('潜電'))f.entries[p].ex=rateEquip(f,90000+p,51);
    });
    const b=f.badge(),ciOffset=aggregate?9:8;
    assert(b.activation.percent>=parseFloat(r[ciOffset])&&b.activation.percent<=parseFloat(r[ciOffset+1]),r[0]);
    predictions.push(b.activation.percent);
    assert.deepEqual(b.participants.map(p=>p.position),aggregate?[2,4]:[2,3]);
  }
  assert.deepEqual(predictions,[63,66,67,87,64,84,74,84]);
});

test('third submarine contributes to the tentative rate through an average without replacing firing positions',()=>{
  const f=rateStats(subSetup()),base=f.badge().activation.percent;
  f.set(3,'伊400改',14);let b=f.badge();assert.equal(b.activation.percent,base,'same stats do not add an arbitrary third-ship bonus');
  assert.deepEqual(b.participants.map(p=>p.position),[2,4]);
  f.store.info.ships[4].api_lv=180;f.store.info.ships[4].api_lucky=[100,100];
  assert(f.badge().activation.percent>base,'fourth-position stats contribute');
  f.entries[3].ex=rateEquip(f,214,51);const one=f.badge().activation.percent;
  f.entries[2].ex=rateEquip(f,215,51);assert.equal(f.badge().activation.percent,one+10,'third position remains a potential participant');
  f.entries[1].ex=rateEquip(f,216,51);assert.equal(f.badge().activation.percent,one+10,'tentative radar bonus is capped at twenty points');
  for(const id of [5,6]){delete f.store.info.ships[id].api_lv;delete f.store.info.ships[id].api_lucky;}
  f.set(4,'伊47改',14);f.entries[4].ex=rateEquip(f,217,51);
  assert.equal(f.badge().activation.percent,one+10,'fifth and sixth positions do not enter the model');
});

test('submarine reference preserves missing data, supplies, zero luck, probability bounds and fixed-condition scope',()=>{
  const f=rateStats(subSetup());delete f.store.info.ships[3].api_lucky;
  assert.equal(f.badge().activation.percent,null);assert.match(f.badge().detail,/^参考发动率：待确认\n要求阵型：[^\n]+\n缺少第 3 位运/);
  f.store.info.ships[3].api_lucky=[0,99];assert.notEqual(f.badge().activation.percent,null);
  f.entries[1].ex=rateEquip(f,90001,0);assert.match(f.badge().activation.reason,/第 2 位装备资料/);
  f.entries[1].slots=[rateEquip(f,214,51),-1];assert.notEqual(f.badge().activation.percent,null,'known presence resolves one unknown item');
  f.entries[1].slots=[-1,-1];f.entries[1].ex=-1;
  f.set(3,'伊400改',14);delete f.store.info.ships[4].api_lv;
  assert.match(f.badge().activation.reason,/第 4 位等级/);
  f.store.info.ships[4].api_lv=99;f.entries[3].ex=rateEquip(f,215,0);
  f.entries[1].ex=214;f.entries[2].ex=rateEquip(f,216,51);
  assert.notEqual(f.badge().activation.percent,null,'two known radars resolve the capped bonus');
  f.entries[3].ex=-1;
  let base=f.badge().activation.percent;
  for(const ship of Object.values(f.store.info.ships))Object.assign(ship,{api_nowhp:1,api_cond:1});
  f.entries[0].ex=rateEquip(f,217,33);assert.equal(f.badge().activation.percent,base,'damage, morale and starshell do not enter the reference');
  delete f.store.info.useitems;assert.equal(f.badge().activation.percent,base);assert.match(f.badge().detail,/持有物资：待确认/);
  f.store.info.useitems={95:{api_count:0}};assert.equal(f.badge().activation.percent,0);assert.match(f.badge().activation.reason,/物资/);
  f.store.info.useitems[95].api_count=1;
  for(const id of [1,2,3,4])Object.assign(f.store.info.ships[id],{api_lv:1000000,api_lucky:[1000000,1000000]});
  assert.equal(f.badge().activation.percent,100);
  f.store.info.ships[1].api_lv=29;assert.equal(f.badge().activation.percent,0);
  delete f.store.info.ships[1].api_lv;assert.equal(f.badge().activation.percent,null);
});
function subSetup(){
  const f=referenceStats(setup());f.set(0,'迅鯨改',20);f.set(1,'伊58改',14);f.set(2,'伊168改',13);
  f.store.info.useitems={95:{api_id:95,api_count:3}};return f;
}
test('AS special attack uses two required submarines, optional fourth participant, and supply requirements',()=>{
  const f=subSetup(),b=f.badge();assert.equal(b.key,'special-submarine');assert.equal(b.state,'conditional');
  assert.equal(b.activation.percent,null);assert.deepEqual(b.participants.map(p=>p.position),[2,3]);assert(!f.badge(2));
  assert.match(b.detail,/梯形阵／单横阵/);assert.match(b.detail,/持有物资：3 件/);assert.match(b.detail,/每节点消耗 1 件/);
  assert.match(b.detail,/同一战斗昼／夜各 1 次/);assert(!/同航战|出击内次数：1 次/.test(b.detail));
  f.set(3,'伊400改',14);assert.deepEqual(f.badge().participants.map(p=>p.position),[2,4]);
  assert.match(f.badge().detail,/第 3 位替补/);
  f.hp(0,1);f.hp(1,1);f.hp(3,1);assert.equal(f.badge().state,'conditional');assert.deepEqual(f.badge().participants.map(p=>p.position),[2,4]);
  f.entries.splice(3);assert.equal(f.badge().state,'conditional','three ships suffice');
  f.store.info.ships[1].api_lv=29;assert.equal(f.badge().state,'blocked');assert.match(f.badge().detail,/旗舰等级需 ≥ 30/);
  f.store.info.ships[1].api_lv=30;assert.equal(f.badge().state,'conditional');
  delete f.store.info.ships[1].api_lv;assert.equal(f.badge().state,'unknown');
});
test('AS special never promotes holes or the fifth submarine, and preserves missing supply and type data',()=>{
  const f=subSetup();f.set(2,'驱逐',2);f.set(4,'伊47改',14);assert.equal(f.badge().state,'blocked');
  assert.match(f.badge().detail,/第 3 位需潜水舰/);
  f.set(2,'伊168改',13);f.entries[1]=null;assert.equal(f.badge().state,'blocked');
  f.entries[1]={id:2,slots:[-1,-1],ex:-1};
  delete f.store.const.$ships[3].api_stype;assert.equal(f.badge().state,'unknown');
  f.set(2,'伊168改',13);f.store.info.useitems[95].api_count=0;assert.equal(f.badge().state,'blocked');assert.match(f.badge().detail,/缺少潜水舰补给物资/);
  delete f.store.info.useitems;assert.match(f.badge().detail,/持有物资：待确认/);assert.equal(f.badge().activation.percent,null);
  delete f.store.const.$ships[4].api_stype;assert.equal(f.badge().state,'unknown');assert.equal(f.badge().attacks.length,0);
  assert.equal(f.badge().participants.length,0);assert.match(f.badge().detail,/参与舰：待确认/);
  f.set(0,'龍鳳改',7);assert(!f.badge());
});
test('submarine special power and 75-level radar threshold do not borrow shelling or night-CI formulas',()=>{
  const f=subSetup();for(const id of [2,3])f.store.info.ships[id].api_lv=100;
  let b=f.badge();assert.deepEqual(b.attacks.map(r=>[r.day,r.night,r.hits]),[[32,192,'1–2'],[32,192,'1–2']]);
  const radar=rateEquip(f,214,51);f.entries[1].ex=radar;
  b=f.badge();assert.equal(b.attacks[0].hits,2);assert.equal(b.attacks[1].hits,'1–2');assert.match(b.detail,/32 × 2击/);
  f.store.info.ships[2].api_lv=74;assert.equal(f.badge().attacks[0].hits,1);
  f.store.info.ships[2].api_lv=75;assert.equal(f.badge().attacks[0].hits,2);
  delete f.store.info.ships[2].api_lv;b=f.badge();assert.equal(b.attacks[0].day,null);assert.equal(b.attacks[0].hits,'待确认');
  f.store.info.ships[2].api_lv=100;f.store.info.ships[2].api_raisou=[1000,1000];f.store.info.ships[2].api_karyoku=[1000,1000];
  // Clear draft radar so the observed panel describes exactly the draft loadout.
  f.entries[1].ex=-1;b=f.badge();assert.equal(b.attacks[0].day,1600);assert.equal(b.attacks[0].night,3200);
});
test('submarine special reads projected blue bonuses and discards the old loadout without mutating inputs',()=>{
  const f=subSetup();f.store.info.ships[2].api_lv=100;
  const torpedo=rateEquip(f,458,32);f.store.const.$equips[458].api_raig=5;f.store.info.equips[458].api_level=5;
  f.entries[1].slots=[torpedo,-1];let b=f.badge();assert.equal(b.attacks[0].day,41,'20 hull + 5 gear + 1 blue');
  assert.equal(b.attacks[0].night,201);
  f.store.info.ships[2].api_slot=[torpedo,-1];f.store.info.ships[2].api_raisou=[26,26];f.entries[1].slots=[-1,-1];
  const before=JSON.stringify([f.store,f.entries]);b=f.badge();assert.equal(b.attacks[0].day,32);assert.equal(JSON.stringify([f.store,f.entries]),before);
  delete f.store.info.ships[2].api_kyouka;assert.equal(f.badge().attacks[0].day,null);
  f.set(3,'伊400改',14);f.store.info.ships[4].api_lv=100;f.store.info.ships[4].api_raisou=[50,50];
  assert.equal(f.badge().attacks[1].position,4);assert.equal(f.badge().attacks[1].day,80);
});
test('Kongou reference rate uses the accepted formula, correcting the old level-99 example',()=>{
  const f=rateStats(setup(['金剛改二丙','榛名改二乙']),99,18);
  f.store.info.ships[2].api_lucky=[48,99];
  const badge=f.badge();assert.equal(badge.activation.percent,48);assert.equal(badge.activation.phase,'night');
  assert.equal(badge.activation.reference,true);assert.match(badge.detail,/^参考发动率：48.0%/);
  assert(!badge.detail.includes('夜战发动率待确认'));assert(!badge.detail.includes('公式依据'));
  f.entries[0].ex=rateEquip(f,90001,12,8);assert.equal(f.badge().activation.percent,78);
  f.entries[0].slots=[rateEquip(f,90002,42),-1];assert.equal(f.badge().activation.percent,88);
  f.hp(0,1);f.hp(1,1);f.store.info.ships[1].api_cond=1;assert.equal(f.badge().activation.percent,88);
  f.store.info.ships[1].api_lv=120;assert(f.badge().activation.percent>88);
});
test('each Kongou flagship gets her own radar and large-searchlight bonuses, Haruna per NGA post 26',()=>{
  const cases=[['金剛改二丙','比叡改二丙',30,10],['比叡改二丙','金剛改二丙',10,30],
    ['榛名改二乙','金剛改二丙',15,0],['榛名改二丙','金剛改二丙',20,0],['霧島改二丙','金剛改二丙',20,20]];
  for(const [flag,partner,radar,light]of cases){
    const f=rateStats(setup([flag,partner]),99,0),base=f.badge().activation.percent;assert.equal(base,36);
    const r=rateEquip(f,90001,13,8),l=rateEquip(f,90002,42);
    f.entries[0].ex=r;assert.equal(f.badge().activation.percent,base+radar,flag+' radar');
    f.entries[0].ex=l;assert.equal(f.badge().activation.percent,base+light,flag+' searchlight');
    f.entries[0].ex=r;f.entries[0].slots=[l,-1];assert.equal(f.badge().activation.percent,base+radar+light);
    f.entries[0].slots=[l,r];assert.equal(f.badge().activation.percent,base+radar+light,'duplicate radar is not additive');
    f.entries[0].ex=l;f.entries[0].slots=[l,r];assert.equal(f.badge().activation.percent,base+radar+light,'duplicate light is not additive');
  }
});
test('Kongou rate reads flagship draft equipment black stats, never partner gear, improvement or old loadout',()=>{
  const f=rateStats(setup(['金剛改二丙','霧島改二丙']),99,0),base=f.badge().activation.percent;
  const r=rateEquip(f,90001,12,7),small=rateEquip(f,90002,29),large=rateEquip(f,90003,42);
  f.entries[0].ex=r;f.store.info.equips[r].api_level=10;assert.equal(f.badge().activation.percent,base);
  f.store.const.$equips[r].api_saku=8;assert.equal(f.badge().activation.percent,base+30);
  f.entries[0].ex=small;assert.equal(f.badge().activation.percent,base,'ordinary searchlight does not qualify');
  f.store.const.$equips[small].api_saku=12;assert.equal(f.badge().activation.percent,base,'LOS equipment is not necessarily radar');
  f.entries[0].ex=-1;f.entries[1].ex=r;f.entries[1].slots=[large,-1];
  f.entries[0].slots=[rateEquip(f,90004,33),-1];assert.equal(f.badge().activation.percent,base,'starshell is excluded from fixed conditions');
  f.store.info.ships[1].api_slot_ex=r;f.store.info.ships[1].api_slot=[large,-1];
  const before=JSON.stringify([f.store,f.entries]);assert.equal(f.badge().activation.percent,base);assert.equal(JSON.stringify([f.store,f.entries]),before);
  f.entries[0].ex=r;delete f.store.const.$equips[r].api_saku;assert.equal(f.badge().activation.percent,null);
  assert.match(f.badge().activation.reason,/第 1 位装备资料/);
  f.entries[0].slots[1]=rateEquip(f,90005,12,8);assert.equal(f.badge().activation.percent,base+30,'known qualifying radar resolves the presence bonus');
});
test('Kongou reference preserves uncertainty, true zero luck, bounded probability and ignores temporary effects',()=>{
  const f=rateStats(setup(['比叡改二丙','金剛改二丙']),1,0);
  assert.equal(f.badge().activation.percent,0);
  for(const ship of Object.values(f.store.info.ships))Object.assign(ship,{api_lv:180,api_lucky:[100,100],api_nowhp:1,api_cond:1});
  f.entries[0].ex=rateEquip(f,90001,13,8);f.entries[0].slots=[rateEquip(f,90002,42),rateEquip(f,90003,33)];
  assert.equal(f.badge().activation.percent,100);
  f.entries[0].slots[1]=-1;assert.equal(f.badge().activation.percent,100,'starshell does not enter fixed-rate calculation');
  delete f.store.info.ships[2].api_lucky;assert.equal(f.badge().activation.percent,null);
  assert.match(f.badge().detail,/^参考发动率：待确认\n要求阵型：[^\n]+\n缺少第 2 位运/);
  f.set(0,'霧島改二丙');assert.equal(f.badge().activation.percent,null);assert.equal(f.badge().activation.reference,true);
  assert.match(f.badge().activation.reason,/缺少第 2 位运/);
  f.store.info.ships[2].api_lucky=[100,100];assert.equal(f.badge().activation.percent,100);
  f.set(1,'不符合条件的舰',2);assert.equal(f.badge().activation.percent,0);assert.match(f.badge().detail,/^参考发动率：0.0%/);
});
test('Yamato triple reference uses the first two ships while the third still has her own attack power',()=>{
  for(const names of [['大和改二','武蔵改二','長門改二'],['大和改二','長門改二','陸奥改二']]){
    const f=rateStats(referenceStats(setup(names))),b=f.badge(),base=b.activation.percent;
    assert.equal(b.label,'大和三舰齐射');assert.equal(b.activation.reference,true);assert.equal(b.activation.phase,'day-night');
    assert.equal(b.activation.model,'yamato-triple-front-two-reference');assert.match(b.detail,/^参考发动率：[0-9]+\.[0-9]%/);
    assert.equal(base,names[1]==='武蔵改二'?75:68);assert(!b.detail.includes('单次判定；夜战按昼战参考'));
    const originalPower=b.attacks[2].night;
    f.store.info.ships[3].api_lv=180;f.store.info.ships[3].api_lucky=[100,100];
    const radar=rateEquip(f,456,13,7);f.store.const.$equips[456].api_houm=8;f.entries[2].ex=radar;
    assert.equal(f.badge().activation.percent,base,'third ship level, luck and radar never enter the reference rate');
    assert.notEqual(f.badge().attacks[2].night,originalPower,'third ship retains her own gear power bonus');
    delete f.store.info.ships[3].api_lv;delete f.store.info.ships[3].api_lucky;delete f.store.const.$equips[456].api_houm;
    assert.equal(f.badge().activation.percent,base,'missing third-ship rate inputs are irrelevant');
    f.store.info.ships[1].api_lv=120;assert(f.badge().activation.percent>base);
    delete f.store.info.ships[2].api_lucky;assert.equal(f.badge().activation.percent,null);
    assert.match(f.badge().detail,/^参考发动率：待确认\n要求阵型：[^\n]+\n缺少第 2 位运/);
  }
});
test('Yamato triple reference retains front-two radar bonuses and all three composition requirements',()=>{
  const f=rateStats(setup(['大和改二','武蔵改二','長門改二'])),base=f.badge().activation.percent;
  const radar=rateEquip(f,456,13,7);f.store.const.$equips[456].api_houm=8;
  f.entries[0].ex=radar;assert.equal(f.badge().activation.percent,base+10);
  f.entries[1].ex=radar;assert.equal(f.badge().activation.percent,base+20);
  const before=JSON.stringify([f.store,f.entries]);f.badge();assert.equal(JSON.stringify([f.store,f.entries]),before);
  f.set(2,'陸奥改二');assert.equal(f.badge().label,'大和三舰齐射');assert.equal(f.badge().activation.percent,base+20);
  f.set(2,'任意战舰');assert.equal(f.badge().label,'大和型齐射','invalid third ship cannot claim a triple');
  f.set(1,'長門改二');assert.equal(f.badge().state,'blocked','Nagato needs the designated third ship');
});
test('special attack ranking never computes reference rates',()=>{
  const targets=[{id:1,master:{api_name:'Nelson改',api_stype:9}},...Array.from({length:5},(_,i)=>({id:i+2,master:{api_name:'水上舰',api_stype:2}}))];
  const b=fleetSpecialAttacks(targets,targets).get(1);assert(!('activation'in b),'ranking does not compute reference rates');
});
test('known daytime special rates share one night reference without adding turns or inventing unknown rates',()=>{
  for(const names of [['Nelson改'],['Rodney改'],['長門改二','陸奥改二'],['大和改二','武蔵改二'],
    ['大和改二','長門改二','陸奥改二'],['Warspite改','Valiant改'],['Richelieu改','Jean Bart改'],['Colorado改','战舰','战舰']]){
    const b=rateStats(setup(names)).badge();assert.equal(b.activation.phase,'day-night');
    assert.equal(b.activation.nightAssumedSameAsDay,true);assert.notEqual(b.activation.percent,null);
    assert(!b.detail.includes('单次判定；夜战按昼战参考'));assert(!b.detail.includes('夜战发动率待确认'));
  }
  const night=rateStats(setup(['金剛改二丙','比叡改二丙'])).badge();
  assert.equal(night.activation.phase,'night');assert.equal(night.activation.nightAssumedSameAsDay,undefined);
  assert(!night.detail.includes('夜战按昼战参考'));
});
test('Colorado tentative reference stays inside all six user-supplied baseline confidence intervals',()=>{
  const fs=require('fs'),path=require('path');
  const rows=fs.readFileSync(path.join(__dirname,'../../fixtures/colorado-rates.csv'),'utf8').trim().split(/\r?\n/).slice(2).map(line=>line.split(',')).filter(r=>r[7]);
  assert.equal(rows.length,6);assert.equal(rows.reduce((sum,r)=>sum+Number(r[7]),0),2635);
  for(const row of rows){
    const f=rateStats(setup(['Colorado改','战舰','战舰']));
    const ranges=[1,3,5].map(i=>row[i].split('~').map(Number));
    const luck=[2,4,6].map(i=>Number(row[i]));
    for(const bound of [r=>Math.min(...r),r=>r.reduce((a,b)=>a+b)/r.length,r=>Math.max(...r)]){
      for(let p=0;p<3;p++)Object.assign(f.store.info.ships[p+1],{api_lv:bound(ranges[p]),api_lucky:[luck[p],110]});
      const b=f.badge(),rate=b.activation.percent;
      assert(rate>=parseFloat(row[9])&&rate<=parseFloat(row[10]),`sample ${row[0]}: ${rate}`);
      assert.equal(b.activation.tentative,true);assert.equal(b.activation.reference,true);
      assert.match(b.detail,/^参考发动率：[0-9]+\.0%（待验证）/);
    }
  }
});
test('Colorado tentative rate reads all three ships, only counts projected SG Late once per participant and keeps power independent',()=>{
  for(const flagship of ['Colorado','Colorado改','Maryland','Maryland改']){
    const f=rateStats(referenceStats(setup([flagship,'战舰','战舰'])),99,0);
    f.store.info.ships[1].api_lucky=[40,110];f.store.info.ships[2].api_lucky=[8,110];f.store.info.ships[3].api_lucky=[13,110];
    let b=f.badge();assert.equal(b.activation.percent,57);assert.equal(b.activation.model,'colorado-csv-20261019-tentative');
    assert.equal(b.activation.phase,'day-night');assert.equal(b.activation.nightAssumedSameAsDay,true);
    const sg=rateEquip(f,456,13,9),other=rateEquip(f,10001,13,9),ap=rateEquip(f,142,19);
    f.entries[0].slots=[sg,sg];assert.equal(f.badge().activation.percent,62);
    f.entries[1].ex=sg;assert.equal(f.badge().activation.percent,67);
    f.entries[2].ex=sg;assert.equal(f.badge().activation.percent,72);
    f.entries[3].ex=sg;f.store.info.equips[sg].api_level=10;assert.equal(f.badge().activation.percent,72);
    f.entries[0].slots=[other,ap];assert.equal(f.badge().activation.percent,67,'ordinary radar/AP never adds activation chance');
    f.entries[1].ex=-1;f.entries[2].ex=-1;f.store.info.ships[1].api_slot=[sg,sg];assert.equal(f.badge().activation.percent,57,'discard old worn SG');
    const power=f.badge().attacks;f.store.info.ships[3].api_lucky=[49,110];assert.equal(f.badge().activation.percent,61);
    assert.deepEqual(f.badge().attacks,power,'luck changes only rate');
    f.store.info.ships[3].api_lv=180;assert(f.badge().activation.percent>61);
    const before=JSON.stringify([f.store,f.entries]);f.badge();assert.equal(JSON.stringify([f.store,f.entries]),before);
    delete f.store.info.ships[3].api_lucky;b=f.badge();assert.equal(b.activation.percent,null);assert.match(b.detail,/^参考发动率：待确认\n要求阵型：[^\n]+\n缺少第 3 位运/);
    assert(!b.detail.includes('待确认（待验证）'));
    f.store.info.ships[3].api_lucky=[1000,1000];for(const id of [1,2])f.store.info.ships[id].api_lucky=[1000,1000];
    assert.equal(f.badge().activation.percent,100);
    f.set(2,'驱逐',2);b=f.badge();assert.equal(b.activation.percent,0);assert.match(b.detail,/^参考发动率：0.0%/);
    assert(!b.detail.includes('0.0%（待验证）'));
  }
});
test('Kirishima uses her own 20/20 reference bonuses and Kai Ni is not a triggering remodel',()=>{
  const f=rateStats(setup(['霧島改二丙','金剛改二丙']),99,0);
  assert.equal(f.badge().activation.percent,36);assert.match(f.badge().detail,/^参考发动率：36.0%/);
  f.entries[0].ex=rateEquip(f,456,13,8);assert.equal(f.badge().activation.percent,56);
  f.entries[0].slots=[rateEquip(f,140,42),-1];assert.equal(f.badge().activation.percent,76);
  f.entries[1].ex=456;assert.equal(f.badge().activation.percent,76,'partner gear never adds to flagship bonus');
  f.entries[0].slots=[140,456];assert.equal(f.badge().activation.percent,76,'each equipment category adds once');
  const before=JSON.stringify([f.store,f.entries]);f.badge();assert.equal(JSON.stringify([f.store,f.entries]),before);
  f.set(0,'霧島改二');assert(!f.badge(),'Kirishima Kai Ni cannot command Kongou-class night assault');
});
test('touch reference power uses each actual firing ship and night caps, preserving nonparticipants',()=>{
  const f=referenceStats(setup(['Nelson改']));f.set(2,'测试重巡',5);f.set(4,'测试航巡',6);
  f.store.info.ships[3].api_karyoku=[80,80];f.store.info.ships[3].api_raisou=[60,60];
  f.store.info.ships[5].api_karyoku=[200,200];f.store.info.ships[5].api_raisou=[0,0];
  const before=JSON.stringify(f.store),badge=f.badge();
  assert.deepEqual(badge.attacks.map(r=>[r.position,r.day,r.night,r.hits]),[[1,168,240,1],[3,136,280,1],[5,328,366,1]]);
  assert.match(badge.detail,/第 3 位 测试重巡\n昼战攻击力：136 × 1击\n夜战攻击力：280 × 1击/);
  assert(!/公式依据|基礎倍率|发动后带动/.test(badge.detail));assert(!f.badge(3));assert.equal(JSON.stringify(f.store),before);
  f.set(2,'Rodney改');assert.deepEqual(f.badge().attacks.map(r=>r.multiplier),[2.3,2.4,2]);
});
test('pair and triple special attacks retain correct shot counts, order and family multipliers',()=>{
  const cases=[
    [['大和改二','武蔵改二'],[1.54,1.86],[2,1]],
    [['武蔵改二','大和改二重'],[1.54,1.9375],[2,1]],
    [['大和改二','Iowa改'],[1.4,1.55],[2,1]],
    [['大和改二','武蔵改二','長門改二'],[1.65,1.8,1.65],[1,1,1]],
    [['大和改二','長門改二','陸奥改二'],[1.65,1.65,1.65],[1,1,1]],
    [['大和改二','伊勢改二','日向改二'],[1.65,1.575,1.65],[1,1,1]],
    [['大和改二','Italia','Roma改'],[1.5,1.5,1.65],[1,1,1]],
    [['長門改二','陸奥改二'],[1.68,1.68],[2,1]],
    [['Warspite改','Valiant改'],[1.24,1.24],[2,1]],
    [['Valiant改','Warspite改'],[1.2,1.24],[2,1]]
  ];
  for(const [names,multipliers,hits]of cases){
    const rows=referenceStats(setup(names)).badge().attacks;
    assert.deepEqual(rows.map(r=>r.multiplier),multipliers,names.join('/'));assert.deepEqual(rows.map(r=>r.hits),hits);
    assert.equal(rows.reduce((sum,r)=>sum+r.hits,0),3);assert(rows.every(r=>r.day!==null&&r.night!==null));
  }
});
test('special equipment bonuses belong to the firing ship, including expansion, not the flagship',()=>{
  const f=referenceStats(setup(['大和改二','武蔵改二','長門改二']));
  const equip=(id,name,type,los=0)=>{f.store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0],api_saku:los};f.store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};return id;};
  f.entries[0].ex=equip(142,'九一式徹甲弾',19);
  f.entries[1].ex=equip(456,'15m二重測距儀＋21号電探改二',13,7);
  f.entries[2].ex=456;
  const rows=f.badge().attacks;
  assert(Math.abs(rows[0].multiplier-1.65*1.35)<1e-10);
  assert(Math.abs(rows[1].multiplier-1.8*1.15*1.1)<1e-10);
  assert(Math.abs(rows[2].multiplier-1.65*1.15)<1e-10,'third ship gets no double rangefinder bonus');
  const c=referenceStats(setup(['Colorado改','Maryland改','長門改二']));
  assert.deepEqual(c.badge().attacks.map(r=>r.multiplier),[1.5,1.3*1.15,1.3*1.17]);
});
test('Kongou reference power is two single night hits; missing power never becomes zero',()=>{
  const f=referenceStats(setup(['金剛改二丙','比叡改二丙']));let badge=f.badge();
  assert.deepEqual(badge.attacks.map(r=>[r.day,r.night,r.hits]),[[null,312,1],[null,324,1]]);
  assert(!badge.detail.includes('昼战攻击力'));
  delete f.store.info.ships[1].api_kyouka;delete f.store.info.ships[1].api_karyoku;
  badge=f.badge();assert.equal(badge.attacks[0].night,null);assert.match(badge.detail,/夜战攻击力：待确认 × 1击/);
});

test('Yamato and Musashi both lead the pair, with exact remodel requirements and damage guidance only',()=>{
  for(const pair of [['大和改二','武蔵改二'],['大和改二重','武蔵改二'],['武蔵改二','大和改二'],['武蔵改二','大和改二重']]){
    const f=setup(pair),b=f.badge();assert.equal(b.label,'大和型齐射');assert.equal(b.state,'conditional');
    assert.deepEqual(b.participants.map(p=>p.position),[1,2]);assert(!f.badge(2));
    assert.match(b.detail,/梯形阵/);assert.match(b.detail,/第 2 位 [^\n]+\n昼战攻击力：/);
    f.hp(1,50);assert.equal(f.badge().state,'conditional');assert.match(f.badge().detail,/第 1、2 位需未中破/);
    f.hp(1,51);assert.equal(f.badge().state,'conditional');f.hp(0,50);assert.equal(f.badge().state,'conditional');
  }
  const f=setup(['武蔵改二','Iowa改']);assert.equal(f.badge().state,'blocked');assert.match(f.badge().detail,/需大和改二/);
  f.set(0,'武蔵改');assert(!f.badge());f.set(0,'大和改');assert(!f.badge());
});

test('Yamato single partners are exact remodels and cannot be reversed',()=>{
  for(const partner of ['Iowa改','Bismarck drei','Richelieu改','Richelieu Deux','Jean Bart改']){
    const f=setup(['大和改二',partner]);assert.equal(f.badge().label,'大和双舰齐射');assert.equal(f.badge().state,'conditional',partner);
  }
  for(const partner of ['Iowa','Bismarck zwei','Richelieu','Jean Bart','長門改二']){
    const f=setup(['大和改二',partner]);assert.equal(f.badge().state,'blocked',partner);assert(!f.badge(2));
  }
  assert(!setup(['Iowa改','大和改二']).badge());
});

test('Yamato three-ship pairs respect permitted pairs and remodels in either order',()=>{
  const pairs=[['長門改二','陸奥改二'],['伊勢改二','日向改二'],['扶桑改二','山城改二'],
    ['金剛改二丙','比叡改二丙'],['金剛改二丙','榛名改二乙'],['金剛改二丙','榛名改二丙'],
    ['金剛改二丙','霧島改二丙'],['比叡改二丙','霧島改二丙'],['Italia','Roma改'],
    ['Warspite改','Nelson改'],['Warspite改','Valiant改'],['Nelson改','Rodney改'],
    ['Washington改','South Dakota改'],['Colorado改','Maryland改'],['Richelieu改','Jean Bart改'],['Richelieu Deux','Jean Bart改']];
  for(const pair of pairs)for(const order of [pair,pair.slice().reverse()]){
    const f=setup(['大和改二重',...order]);assert.equal(f.badge().label,'大和三舰齐射',order.join(','));
    assert.equal(f.badge().state,'conditional');assert.deepEqual(f.badge().participants.map(p=>p.position),[1,2,3]);
  }
  for(const pair of [['伊勢改','日向改二'],['榛名改二乙','比叡改二丙'],['Warspite改','Rodney改'],['Colorado','Maryland改']]){
    assert.equal(setup(['大和改二',...pair]).badge().state,'blocked',pair.join(','));
  }
});

test('Yamato three-ship selection is stable even when the third ship is damaged or HP is unknown',()=>{
  for(const third of ['長門改二','陸奥改二']){
    const f=setup(['大和改二','武蔵改二',third]);assert.equal(f.badge().label,'大和三舰齐射');
    f.hp(2,50);assert.equal(f.badge().label,'大和三舰齐射');assert.equal(f.badge().state,'conditional');assert(!f.badge(3));
    delete f.store.info.ships[3].api_nowhp;assert.equal(f.badge().label,'大和三舰齐射');assert.equal(f.badge().state,'conditional');
    f.set(1,third);f.set(2,'武蔵改二');assert.equal(f.badge().state,'blocked','Musashi must be second');
  }
  const f=setup(['大和改二','長門改二','陸奥改二']);f.hp(2,50);assert.equal(f.badge().state,'conditional');
});

test('Nagato-class accepts any battleship subtype in second position and explains the different damage limits',()=>{
  for(const flag of ['長門改二','陸奥改二'])for(const type of [8,9,10]){
    const f=setup([flag]);f.set(1,'任意战舰',type);f.hp(1,26);assert.equal(f.badge().state,'conditional');
    f.hp(1,25);assert.equal(f.badge().state,'conditional');f.hp(1,100);f.hp(0,50);assert.equal(f.badge().state,'conditional');
  }
  const f=setup(['長門改二']);f.set(1,'重巡',5);assert.equal(f.badge().state,'blocked');
  f.set(0,'長門改');assert(!f.badge());
});

test('Nelson and Rodney use positions 1/3/5, allow damaged partners and exclude carriers at those positions',()=>{
  for(const flag of ['Nelson','Nelson改','Rodney','Rodney改']){
    const f=setup([flag]);f.set(1,'空母',11);f.hp(2,1);f.hp(4,1);
    assert.equal(f.badge().state,'conditional');assert.match(f.badge().detail,/复纵阵/);
    assert.deepEqual(f.badge().participants.map(p=>p.position),[1,3,5]);assert(!f.badge(3));assert(!f.badge(5));assert(!f.badge(2));
    for(const type of [7,11,18,13,14]){f.set(2,'不适用舰',type);assert.equal(f.badge().state,'blocked');}
    f.set(2,'驱逐',2);f.hp(0,50);assert.equal(f.badge().state,'conditional');
  }
});

test('Colorado and Maryland require second and third battleships, allowing both to be medium damaged',()=>{
  for(const flag of ['Colorado','Colorado改','Maryland','Maryland改']){
    const f=setup([flag,'战舰','战舰']);f.hp(1,50);f.hp(2,26);assert.equal(f.badge().state,'conditional');
    assert(!f.badge(3));assert.match(f.badge().detail,/第 2 位 战舰[\s\S]*第 3 位 战舰/);f.hp(2,25);assert.equal(f.badge().state,'conditional');
    f.hp(2,100);f.set(1,'重巡',5);assert.equal(f.badge().state,'blocked');assert(!f.badge(2));
  }
});

test('British sister attack needs both remodels and does not use current supply as a departure blocker',()=>{
  for(const pair of [['Warspite改','Valiant改'],['Valiant改','Warspite改']]){
    const f=setup(pair);f.hp(1,30);f.store.info.ships[2].api_bull=0;
    assert.equal(f.badge().label,'Queen Elizabeth级齐射');assert.equal(f.badge().state,'conditional');
    assert(!f.badge().detail.includes('姐妹舰联合炮击'));
    f.set(1,pair[1].replace('改',''));assert.equal(f.badge().state,'blocked');
  }
  assert(!setup(['Warspite','Valiant改']).badge());
});

test('Kongou night assault allows five surface ships, medium damage and the current directional partner table',()=>{
  const pairs=[['金剛改二丙','榛名改二'],['金剛改二丙','Warspite'],['金剛改二丙','Valiant改'],
    ['比叡改二丙','霧島改二'],['榛名改二乙','比叡改二丙'],['榛名改二丙','霧島改二丙'],['霧島改二丙','South Dakota改']];
  for(const pair of pairs){
    const f=setup(pair);f.entries[5]=null;f.hp(0,26);f.hp(1,26);
    assert.equal(f.badge().state,'conditional',pair.join(','));assert.equal(f.badge().key,'special-night');assert.equal(f.badge().label,'金刚型夜战突击');
    assert.match(f.badge().detail,/单纵阵／梯形阵/);assert.match(f.badge().detail,/最多 3 次/);
    f.entries[5]={id:6,slots:[-1,-1],ex:-1};f.set(5,'潜水舰',13);assert.equal(f.badge().state,'conditional');
    f.entries[4]=null;assert.equal(f.badge().state,'blocked');
  }
  for(const pair of [['比叡改二丙','榛名改二'],['榛名改二乙','Warspite改'],['霧島改二丙','South Dakota']]){
    assert.equal(setup(pair).badge().state,'blocked');
  }
  const f=setup(['金剛改二丙','比叡改二丙']);f.hp(1,25);assert.equal(f.badge().state,'conditional');
});

test('special attacks retain card positions, reject missing/duplicate ships and ignore unknown damage',()=>{
  const f=setup(['大和改二','武蔵改二']);f.entries[2]=f.entries[1];f.entries[1]=null;
  assert.equal(f.badge().state,'blocked');assert(!f.badge(2),'third card must not become second');
  f.entries[1]=f.entries[2];f.entries[2]={id:3,slots:[-1,-1],ex:-1};
  delete f.store.info.ships[1].api_nowhp;assert.equal(f.badge().state,'conditional');
  f.hp(0,100);delete f.store.const.$ships[6].api_stype;assert.equal(f.badge().state,'unknown');
  f.set(5,'驱逐',2);f.entries[5]=f.entries[4];assert.equal(f.badge().state,'blocked');
  f.entries[5]={id:6,slots:[-1,-1],ex:-1};f.entries.push({id:7,slots:[-1,-1],ex:-1});assert(!f.badge(),'seven-ship fleet is not implemented');
});

test('special capability checks are equipment-independent, immutable and react immediately to flagship swaps',()=>{
  const f=setup(['大和改二','武蔵改二']),before=JSON.stringify([f.store,f.entries]);
  assert.equal(f.badge().state,'conditional');assert.equal(JSON.stringify([f.store,f.entries]),before);
  [f.entries[0],f.entries[1]]=[f.entries[1],f.entries[0]];
  assert.match(f.badge(2).detail,/第 2 位 大和改二\n昼战攻击力：/);assert(!f.badge(1));
  [f.entries[0],f.entries[3]]=[f.entries[3],f.entries[0]];assert(!f.badge(1));assert(!f.badge(2));
});


test('special tooltip uses rate then required formation on two lines, preserving key limits',()=>{
  const cases=[
    [['大和改二','武蔵改二'],'梯形阵'],[['長門改二','陸奥改二'],'梯形阵'],
    [['Nelson改'],'复纵阵'],[['Colorado改','战舰','战舰'],'梯形阵'],
    [['Warspite改','Valiant改'],'梯形阵'],[['Richelieu改','Jean Bart改'],'复纵阵'],
    [['金剛改二丙','比叡改二丙'],'单纵阵／梯形阵']
  ];
  for(const [names,formation]of cases){
    const f=rateStats(referenceStats(setup(names))),before=JSON.stringify([f.store,f.entries]),b=f.badge();
    assert(b.detail.startsWith((b.activation.reference?'参考发动率':'发动率')+'：'));
    assert.equal(b.detail.split('\n')[1],'要求阵型：'+formation);
    assert.equal(b.detail.split(formation).length-1,1);assert.match(b.detail,/每次出击/);assert.match(b.detail,/需未[中大]破/);
    assert(!/单次判定|夜战按昼战参考|概率联合攻击|水面目标／同航战|姐妹舰联合炮击/.test(b.detail));
    assert.match(b.detail,/攻击力：/);assert.equal(JSON.stringify([f.store,f.entries]),before);
  }
  const sub=rateStats(subSetup()).badge();assert(sub.detail.startsWith('参考发动率：'));assert.equal(sub.detail.split('\n')[1],'要求阵型：梯形阵／单横阵');
  assert.match(sub.detail,/每节点消耗 1 件/);assert.match(sub.detail,/至少两艘潜艇需未中破/);
  assert(!/潜艇等级 ≥ 75|旗舰等级：|第 2、3 位攻击/.test(sub.detail));
});
