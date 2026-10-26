'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const jet=require('../../../src/domain/combat/jet_aviation');
const {airPower,projectFleet}=require('../../../src/domain/fleet/fleet_metrics');
const {fleetMechanisms}=require('../../../src/domain/combat/ship_mechanisms');
const {simulateAirPath,estimateRouteAir,estimateRouteAirMargins,stageOneLoss}=require('../../../src/domain/routes/route_air');
function fixture({type=57,id=199,capacity=34,steel=1000,legal=true}={}){
  const store=require('../../helpers/workbench_fixture')();
  store.info.resources=[1000,1000,steel,1000];
  store.const.$ships[1]={...store.const.$ships[1],api_name:'测试喷气空母',api_stype:18,api_maxeq:[capacity],api_slot_num:1};
  store.const.$shipTypes[18]={api_equip_type:{6:1,7:1,8:1,56:1,57:legal?1:0,58:1}};
  store.const.$equips[id]={api_id:id,api_name:id===199?'噴式景雲改':id===200?'橘花改':id===548?'震電改三(試製 噴式震電)':'未知喷气机',
    api_type:[0,0,type,type],api_baku:type===57?(id===200?11:15):0,api_tyku:type===56?17:id===200?12:6};
  store.info.equips[101]={api_id:101,api_slotitem_id:id,api_level:0,api_alv:7};
  Object.assign(store.info.ships[1],{api_slot:[101],api_slot_ex:0,api_onslot:[capacity],api_karyoku:[50,50]});
  return store;
}
const entries=store=>[{id:1,slots:store.info.ships[1].api_slot.slice(),ex:0}];
const projected=store=>projectFleet(store,{organization:{targets:[1]},equipment:{expected:[{shipId:1,state:entries(store)[0]}]}});
const badges=store=>fleetMechanisms(store,entries(store)).get(1);
const aa={status:'known',proportion:0.2,fixed:11,profiles:[{weighted:80,defense:40,combinedFactor:1}]};
const node=(id='Z',kind='battle')=>({id,kind,boss:id==='Z',enemyAirPower:22,antiAir:aa,enemyJets:false});
function air({id=199,type=57,steel=1000,planes=34,bomb=15,antiAir=6}={}){
  const n=Math.floor(antiAir*Math.sqrt(planes));
  return {status:'range',min:n,max:n,slots:[{shipId:1,slot:0,masterId:id,jetSteel:steel,bomb,
    aircraftType:type,planes:[planes,planes],effectiveAntiAir:[antiAir,antiAir],proficiencyBonus:[0,0]}]};
}

test('jet reference power uses the pre-cap 1/sqrt(2) species modifier and rounds only after the soft cap',()=>{
  assert.equal(jet.jetPower(15,34),112);assert.equal(jet.jetPower(15,34,{phase:'ordinary'}),79);
  const n=(100*Math.sqrt(100)+25)/Math.SQRT2;
  assert.equal(jet.jetPower(100,100,{phase:'ordinary'}),Math.floor(170+Math.sqrt(n-170)));
  assert.equal(jet.steelCost(199,57,34),95);assert.equal(jet.steelCost(200,57,34),88);
  assert.equal(jet.steelCost(548,56,34),75);
  assert.equal(jet.jetPower(15,0),null);assert.equal(jet.jetPower(15,null),null);
});

test('legal, fully supplied jet bombers expose a separate per-slot assault badge without an invented CI rate',()=>{
  for(const id of [199,200]){
    const store=fixture({id}),before=JSON.stringify(store),all=badges(store),badge=all.find(b=>b.key==='jet-assault');
    assert.equal(badge.state,'ready');assert.equal(badge.attacks.length,1);
    assert.equal(badge.attacks[0].power,jet.jetPower(id===199?15:11,34));
    assert.match(badge.detail,/钢材消耗：(?:95|88)／次/);assert(!badge.detail.includes('发动率'));
    const ordinary=all.find(b=>b.key==='opening-air');assert(ordinary);
    const parts=badge.detail.split('\n\n'),airParts=ordinary.detail.split('\n\n');
    assert.equal(parts.length,3);
    assert.equal(parts[0],'有可用喷气攻击机时固定发动');
    assert.equal(parts[1].split('\n')[0],airParts[1].split('\n')[0]);
    assert.equal(parts[1].split('\n')[1],`攻击力：${badge.attacks[0].power} × 1击`);
    assert.match(parts[2],/^本舰钢材消耗：(?:95|88)／次\n普通航空战前攻击敌舰。\n按出击前满载；未计损耗与暴击。$/);
    assert(!ordinary.detail.includes('强袭攻击力'),'ordinary and jet phases have distinct tooltips');
    assert.equal(JSON.stringify(store),before);
  }
});

test('zero, unknown capacity and illegal jets have distinct blocked or unknown states',()=>{
  const zero=badges(fixture({capacity:0})).find(b=>b.key==='jet-assault');
  assert.equal(zero.state,'blocked');assert.equal(zero.attacks[0].power,null);
  assert.match(zero.detail,/第 1 槽 噴式景雲改（0 架）\n攻击力：不可用/);
  const unknown=badges(fixture({capacity:null})).find(b=>b.key==='jet-assault');
  assert.equal(unknown.state,'unknown');assert.match(unknown.detail,/容量资料缺失/);
  assert.match(unknown.detail,/第 1 槽 噴式景雲改（待确认 架）\n攻击力：待确认 × 1击/);
  assert.match(unknown.detail,/本舰钢材消耗：待确认／次/);
  const illegal=badges(fixture({legal:false})).find(b=>b.key==='jet-assault');
  assert.equal(illegal.state,'blocked');assert.match(illegal.detail,/资格不符/);assert.equal(illegal.attacks[0].power,null);
  assert.match(illegal.detail,/攻击力：不可用/);
});

test('multiple jet slots show compact attack rows and one rounded per-slot steel total',()=>{
  const store=fixture();
  store.const.$ships[1].api_maxeq=[34,12];store.const.$ships[1].api_slot_num=2;
  store.info.equips[102]={...store.info.equips[101],api_id:102};
  store.info.ships[1].api_slot=[101,102];
  const badge=badges(store).find(b=>b.key==='jet-assault');
  assert.equal(badge.detail.split('\n\n')[1],[
    '第 1 槽 噴式景雲改（34 架）','攻击力：112 × 1击',
    '第 2 槽 噴式景雲改（12 架）','攻击力：76 × 1击'
  ].join('\n'));
  assert.match(badge.detail,/本舰钢材消耗：129／次/);
  assert.equal(badge.detail.match(/钢材消耗/g).length,1);
  store.const.$ships[1].api_maxeq[1]=null;
  assert.match(badges(store).find(b=>b.key==='jet-assault').detail,/本舰钢材消耗：待确认／次/,'do not present a known partial sum as the total');
});

test('jet fighters have fighter proficiency and no fictitious anti-ship jet assault',()=>{
  const store=fixture({type:56,id:548}),all=badges(store);
  assert(!all.some(b=>b.key==='jet-assault'||b.key==='opening-air'));
  const metrics=airPower(store,projected(store));
  assert.equal(metrics.status,'range');assert(metrics.slots[0].proficiencyBonus[0]>25);
  assert.equal(metrics.slots[0].aircraftType,56);
  const bomber=fixture(),b=airPower(bomber,projected(bomber));
  assert(b.slots[0].proficiencyBonus[0]<4,'jet bombers do not get the pure-fighter proficiency bonus');
});

test('steel zero disables assault only; any positive budget permits the first assault even below its full fee',()=>{
  const zero=fixture({steel:0}),all=badges(zero);
  assert.equal(all.find(b=>b.key==='jet-assault').state,'blocked');
  assert.equal(all.find(b=>b.key==='opening-air').state,'ready');
  const none=simulateAirPath(air({steel:0}),[node('A'),node()]);
  assert(none.jetStages.every(s=>s.active.every(v=>!v)));assert.equal(none.steelConsumed.max,0);
  const one=simulateAirPath(air({steel:1}),[node('A'),node()]);
  assert(one.jetStages[0].active.every(Boolean));assert.equal(one.jetStages[0].requiredSteel[0],95);
  assert(one.jetStages[1].active.every(v=>!v));assert.equal(one.steelConsumed.max,1);
});

test('pure submarine, air raid and opening-night nodes add no jet assault or steel cost',()=>{
  for(const kind of ['asw','aerialRaid','nightBattle']){
    const n={...node('A',kind),...(kind==='nightBattle'?{noAirBattle:true}:{})};
    const result=simulateAirPath(air(),[n]);assert.equal(result.status,'estimated');
    assert.equal(result.jetStages.length,0);assert.equal(result.steelConsumed.max,0);
    const store=fixture(),profile={examples:[['A']],mapPreview:{nodes:[{id:'A',kind}]}};
    const badge=fleetMechanisms(store,entries(store),undefined,profile).get(1).find(b=>b.key==='jet-assault');
    assert.match(badge.detail,/没有喷式强袭适用节点/);
  }
  assert.equal(simulateAirPath(air(),[{...node(),pureSubmarines:true}]).jetStages.length,0);
});

test('jet loss happens before the same Boss ordinary air check and both anti-air interceptions are applied',()=>{
  const source=air(),before=JSON.stringify(source),result=simulateAirPath(source,[node()]);
  assert.equal(result.status,'estimated');
  assert.equal(result.jetStages[0].attacks[0].planes[0],24);
  assert.equal(result.boss.before.min,29,'jet-stage loss, not departure power, enters the Boss ordinary air check');
  assert.equal(result.margins.superiority.min,-4);
  assert(result.boss.aircraft[0].planes[0]<24,'ordinary interception is a second, separate loss');
  assert.equal(JSON.stringify(source),before);
  assert.equal(stageOneLoss(30,'supremacy',true,0.6),1,'multiply before the final floor');
});

test('Kikka uses its own interception evasion rather than being modeled as a pure fighter',()=>{
  const a=simulateAirPath(air(),[node()]),b=simulateAirPath(air({id:200,bomb:11,antiAir:12}),[node()]);
  assert(b.jetStages[0].attacks[0].planes[0]>a.jetStages[0].attacks[0].planes[0]);
  assert(b.boss.aircraft[0].planes[0]<b.jetStages[0].attacks[0].planes[0]);
  assert.equal(jet.antiAirLoss(33,{antiAir:aa},jet.RULES[199]),9);
  assert.equal(jet.antiAirLoss(33,{antiAir:aa},jet.RULES[200]),8);
});

test('multiple jet slots are charged and attacked individually on every eligible node using remaining aircraft',()=>{
  const source=air();source.slots.push({...source.slots[0],slot:1,masterId:200,bomb:11});
  source.min*=2;source.max*=2;
  const result=simulateAirPath(source,[node('A'),node()]);
  assert.equal(result.jetStages.length,2);assert.equal(result.jetStages[0].attacks.length,2);
  assert.equal(result.jetStages[0].requiredSteel[0],95+88);
  const remaining=result.jetStages[1].attacks;
  assert.equal(result.jetStages[1].requiredSteel[0],jet.steelCost(199,57,remaining[0].before[0])+jet.steelCost(200,57,remaining[1].before[0]));
  const twice=simulateAirPath(air(),[node('A','aerialCombat')]);
  assert.equal(twice.steps.length,2);assert.equal(twice.jetStages.length,1,'one jet phase per battle, not per aerial round');
});

test('missing resources, enemy jets, unknown special AA and type 58 retain explicit unknown reasons',()=>{
  assert.match(simulateAirPath(air({steel:null}),[node()]).reason,/钢材资料缺失/);
  assert.match(simulateAirPath(air(),[{...node(),enemyJets:true}]).reason,/敌方喷气机/);
  const special=simulateAirPath(air(),[{...node(),antiAir:{status:'unknown',reason:'敌方特殊对空迎击尚未定量'}}]);
  assert.equal(special.status,'unknown');assert.match(special.reason,/特殊对空/);assert.equal(special.margins,null);
  assert.match(simulateAirPath(air({type:58}),[node()]).reason,/喷式舰攻/);
  const store=fixture({type:58,id:9100});
  assert.equal(airPower(store,projected(store)).status,'unknown');
  assert.equal(badges(store).find(b=>b.key==='jet-assault').state,'unknown');
});

test('cached jet traces distinguish steel, per-item evasion and slot attack power',()=>{
  const ref={status:'known',paths:[['Z']],nodes:[node()]},source=air();
  const first=estimateRouteAir(source,ref),margin=estimateRouteAirMargins(source,ref);
  assert.deepEqual(margin,first.margins);
  source.slots[0].jetSteel=0;const none=estimateRouteAir(source,ref);
  assert.notEqual(first,none);assert(none.boss.before.min>first.boss.before.min);
  source.slots[0].jetSteel=1000;source.slots[0].masterId=200;
  assert.notEqual(estimateRouteAir(source,ref),first);
  source.slots[0].bomb=8;
  assert.notEqual(estimateRouteAir(source,ref).paths[0].jetStages[0].attacks[0].power[0],first.paths[0].jetStages[0].attacks[0].power[0]);
  source.slots[0].shipId=2;source.slots[0].slot=3;
  const moved=estimateRouteAir(source,ref).paths[0].jetStages[0].attacks[0];
  assert.equal(moved.shipId,2);assert.equal(moved.slot,3,'cached per-slot traces follow the new owner and position');
});

test('steel exhaustion at different endpoint battles never turns an uncertain assault into a reversed power interval',()=>{
  let discontinuity=false;
  for(let steel=1;steel<=300;steel++){
    const result=simulateAirPath(air({steel}),[node('A'),node('B'),node('C'),node()]);
    assert.equal(result.status,'estimated');
    for(const phase of result.jetStages){
      discontinuity||=phase.active[0]!==phase.active[1];
      for(const attack of phase.attacks)assert(attack.power[0]<=attack.power[1]);
      if(phase.active[0]!==phase.active[1])assert(phase.attacks.every(a=>a.power[0]===0));
    }
  }
  assert(discontinuity,'exercise a budget where the fuller endpoint exhausts steel earlier');
});

test('ordinary FBA and all three jet CIs use distinct compositions, multipliers and observation constants',()=>{
  assert.deepEqual(jet.carrierModes([6,57,8]),[]);
  assert.deepEqual(jet.carrierModes([6,7,8,57]),['FBA','BA']);
  assert.deepEqual(jet.carrierModes([56,57,57]),['jFjBjB','jFjB']);
  assert.deepEqual(jet.carrierModes([56,57]),['jFjB']);
  assert.deepEqual(jet.carrierModes([56,7,8]),['jFBA','BA']);
  assert.deepEqual(Object.values(jet.CI).map(r=>r.multiplier),[1.35,1.3,1.27]);
  assert.deepEqual(Object.values(jet.CI).map(r=>r.observationConstant),[135,125,115]);
});
