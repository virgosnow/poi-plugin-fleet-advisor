'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {routeDifficulty,usefulPower,economicalReplacements}=require('../../src/recommendation/route_economy');
const {previewForMap}=require('../../src/domain/routes/sortie_profile');
const enemy=(name='空母ヲ級',rank=0,priority=5)=>({originalName:name,type:'正規空母',variantRank:rank,priority,identityVerified:true});
function profile(nodes=[{id:'A',kind:'battle',enemies:[enemy()]}],path=['A']){
  return {status:'known',routePaths:[{nodes:path}],mapPreview:{nodes},counts:{surface:{maximum:1}}};
}
const light=()=>routeDifficulty(profile());

test('difficulty uses the chosen nodes and distinguishes ordinary battleships from flagship threats',()=>{
  const nodes=[{id:'A',kind:'battle',enemies:[enemy()]},
    {id:'B',kind:'battle',enemies:[enemy('戦艦ル級',0,6)]},
    {id:'C',kind:'battle',enemies:[enemy('戦艦ル級flagship',2,6)]}];
  assert.equal(routeDifficulty(profile(nodes,['A'])).tier,'routine');
  assert.equal(routeDifficulty(profile(nodes,['A','B'])).tier,'standard');
  assert.equal(routeDifficulty(profile(nodes,['C'])).enabled,false);
});

test('night, submarine, installation and incomplete enemy data retain combat-first scoring',()=>{
  for(const node of [{id:'A',kind:'nightBattle',enemies:[enemy()]},
    {id:'A',kind:'asw',enemies:[enemy('潜水ソ級')]},
    {id:'A',kind:'battle',enemies:[enemy('港湾棲姫')]},
    {id:'A',kind:'battle',enemies:[enemy()],compositionUncertain:true},
    {id:'A',kind:'battle',enemies:[{...enemy(),identityVerified:false}]}])assert.equal(routeDifficulty(profile([node])).enabled,false);
  assert.equal(routeDifficulty({...profile(),incomplete:true}).enabled,false);
});

test('actual easy 1-4 paths allow economy while 5-3, 6-2 and 7-4 keep their existing priorities',()=>{
  assert.equal(routeDifficulty(previewForMap('1-4',{paths:[['B','C','F','H','L']]})).tier,'routine');
  assert.equal(routeDifficulty(previewForMap('1-4',{paths:[['A','D','G','J','L']]})).tier,'standard');
  for(const area of ['5-3','6-2','7-4'])assert.equal(routeDifficulty(previewForMap(area)).enabled,false);
});

test('ordinary combat power stays valuable below the per-ship ceiling and excess power has diminishing returns',()=>{
  const d=light();assert.equal(usefulPower(200,d),200);
  assert(usefulPower(250,d)-usefulPower(180,d)>usefulPower(600,d)-usefulPower(530,d));
  assert(usefulPower(400,d)<400);
  assert.equal(usefulPower(-40,d),-40); // Cost/readiness penalties never saturate.
  assert.equal(usefulPower(400,{enabled:false}),400);
});

const row=(id,stype,power,fuel=50,ammo=50)=>({id,stype,power,fuel,ammo,ship:{api_ship_id:id},master:{}});
test('lightening favors qualified combat carriers and never chooses a cheap weak carrier or downgrades destroyers',()=>{
  const rows=[row(1,18,420,100,100),row(2,2,230,20,25)];
  const roster=[...rows,row(3,7,300,45,50),row(4,7,170,25,25),row(5,2,140,15,15)];
  const changes=economicalReplacements(rows,roster,{lockedIds:new Set(),score:r=>r.power,difficulty:light()});
  assert.equal(changes.length,1);assert.equal(changes[0].row.id,3);
  assert.equal(economicalReplacements(rows,roster,{lockedIds:new Set([1]),score:r=>r.power,difficulty:light()}).length,0);
});

test('the economy policy remains conditional and skips marginal fuel savings',()=>{
  const rows=[row(1,18,400,50,50)],roster=[...rows,row(2,7,380,48,49)];
  assert.equal(economicalReplacements(rows,roster,{lockedIds:new Set(),score:r=>r.power,difficulty:light()}).length,0);
  assert.equal(economicalReplacements(rows,roster,{lockedIds:new Set(),score:r=>r.power,difficulty:{enabled:false}}).length,0);
});

function fleetFixture(){
  const store=require('../helpers/workbench_fixture')();
  const types=[2,2,2,2,7,18,8,3];
  for(let i=0;i<types.length;i++){
    const id=i+1,stype=types[i],caps=[7,18].includes(stype)?[24,18,16,4]:stype===8?[1,1,1,1]:[0,0,0];
    Object.assign(store.const.$ships[id],{api_stype:stype,api_slot_num:caps.length,api_maxeq:caps,api_fuel_max:stype===8?250:40,api_bull_max:stype===8?350:45});
    Object.assign(store.info.ships[id],{api_slot:caps.map(()=>-1),api_onslot:caps.slice(),api_lv:80,
      api_karyoku:[stype===8?150:60,150],api_raisou:[stype===2?90:0,90],api_soukou:[stype===8?120:60,120],api_sakuteki:[100,100]});
    store.const.$shipTypes[stype]={api_equip_type:Object.fromEntries((stype===7||stype===18?[6,7,8]:stype===8?[3,10,19]:[1,10]).map(t=>[t,1]))};
  }
  for(const [type,stats] of [[1,{api_houg:10}],[3,{api_houg:20}],[6,{api_tyku:15}],
    [7,{api_baku:13,api_tyku:4}],[8,{api_raig:13,api_tyku:4}],[10,{api_saku:9}],[19,{api_houg:9}]]){
    store.const.$equips[type]={api_id:type,api_name:'测试装备'+type,api_type:[0,0,type,type],...stats};
    for(let n=0;n<20;n++){const id=type*100+n;store.info.equips[id]={api_id:id,api_slotitem_id:type,api_alv:7};}
  }
  return store;
}

test('an easy map retains a capable carrier and surface escorts instead of spending on a high-cost battleship',()=>{
  const store=fleetFixture(),before=JSON.stringify(store);
  const {recommendNormalFleet}=require('../../src/recommendation/normal');
  const result=recommendNormalFleet(store,{area:'1-4',routeKey:'B>C>F>E>H>L',airGoal:'superiority',fixedShipIds:[1,2,3,4]});
  const best=result.recommendations[0];assert(best);assert(!best.scheme.ships.some(e=>e.id===7));
  assert(best.scheme.ships.some(e=>[5,6].includes(e.id)));assert.equal(best.scores.airGoalTier,3);
  assert.equal(best.route.probability,1);assert(best.scores.routeEconomy.enabled);
  assert(result.search.lightening.tried<=4);
  const held=recommendNormalFleet(store,{area:'1-4',airGoal:'superiority',fixedShipIds:[1,2,3,4,7]});
  assert(held.recommendations.every(r=>r.scheme.ships.some(e=>e.id===7)));
  assert.equal(JSON.stringify(store),before);
});
