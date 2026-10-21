'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
const {losWindows,planningPath,createLoSWindowReader,withPlanningCache}=require('../../../src/domain/routes/route_plans');
const {availableEquipment}=require('../../../src/recommendation/loadout/loadout_policy');
const {fitRouteLoS,selectLoSFinalists}=require('../../../src/domain/routes/route_los');
function windowFixture(){
  const store=fixture(),types=[5,11,5,5,2,2];
  for(let i=1;i<=6;i++){
    store.const.$ships[i].api_stype=types[i-1];store.const.$ships[i].api_slot_num=3;
    store.const.$ships[i].api_maxeq=[0,0,0];store.info.ships[i].api_slot=[-1,-1,-1];store.info.ships[i].api_onslot=[0,0,0];
  }
  for(const type of [2,5,11])store.const.$shipTypes[type]={api_equip_type:{1:1,8:1,12:1}};
  for(const [id,type,saku] of [[1,1,0],[12,12,5],[8,8,0]])
    store.const.$equips[id]={api_id:id,api_name:'测试装备'+id,api_type:[0,0,type,0],api_saku:saku};
  for(let id=100;id<110;id++)store.info.equips[id]={api_id:id,api_slotitem_id:12,api_level:0};
  for(let id=200;id<220;id++)store.info.equips[id]={api_id:id,api_slotitem_id:1,api_level:0};
  store.info.equips[300]={api_id:300,api_slotitem_id:8,api_level:0};
  const scheme={fleet:1,ships:[{id:1,slots:[100,101,102],ex:-1},{id:2,slots:[300,103,104],ex:-1},
    {id:3,slots:[105,106,107],ex:-1},{id:4,slots:[108,200,201],ex:-1},
    {id:5,slots:[202,203,204],ex:-1},{id:6,slots:[205,206,207],ex:-1}]};
  return {store,scheme};
}
const nodes=['C','E','I','K'];
test('shortlist window reuse follows routing facts and observes in-place route changes',()=>{
  const {store,scheme}=windowFixture(),route=evaluateNormalRoute(store,{area:'6-2',scheme});
  const read=createLoSWindowReader(nodes),first=read(route);
  route.lineOfSight.rawScoresByCoefficient[3]=999;
  assert.equal(read(route),first,'the swept score cannot change its own admissible windows');
  route.ships[0].instanceId=9999;
  assert.equal(read(route),first,'irrelevant identity does not split identical routing facts');
  route.lineOfSight.thresholdMargin=1;
  assert.deepEqual(read(route),[{coefficient:3,windows:[{lower:41,upper:43}]}]);
  route.ships[0].stype=9;
  assert.deepEqual(read(route),losWindows(route,nodes));assert.notDeepEqual(read(route),first);
  route.targetNodes=[];
  assert.deepEqual(read(route),[]);
});

test('window reuse preserves mixed-coefficient dependencies and per-ship speed/gear facts',()=>{
  const map=require('../../../data/normal_routes/6-2.json'),original=map.machineRules;
  try{
    map.machineRules={start:[{when:true,to:'C'}],C:[{when:{all:[{radarCarriers:{min:1}},{speedAtLeast:'fastPlus'}]},to:'E'},{when:true,to:'F'}],
      E:[{when:{anyShipSpeed:{speedIs:'slow'}},to:'H'},{when:true,to:'I'}],
      I:[{when:{all:[{los:{coefficient:3,gte:40,lt:43}},{los:{coefficient:2,gte:20}}]},to:'K'},{when:true,to:'J'}]};
    const {store,scheme}=windowFixture(),route=evaluateNormalRoute(store,{area:'6-2',scheme});
    route.speed={status:'estimated',fleetSpeed:'fastPlus',ships:route.ships.map(s=>({shipId:s.instanceId,status:'estimated',speed:'fastPlus'}))};
    route.lineOfSight={status:'computed',thresholdMargin:0,rawScoresByCoefficient:{2:21,3:41}};
    const read=createLoSWindowReader(nodes);
    for(const change of [()=>{},()=>{route.lineOfSight.rawScoresByCoefficient[2]=0;},
      ()=>{route.lineOfSight.rawScoresByCoefficient[2]=21;route.speed.ships[0].speed='slow';},
      ()=>{route.speed.ships[0].speed='fastPlus';route.ships.forEach(s=>s.radarEquipped=false);},
      ()=>{route.ships[0].radarEquipped=null;}]){
      change();assert.deepEqual(read(route),losWindows(route,nodes));
    }
    // Exercise the cached single-coefficient branch with the same mutations.
    map.machineRules.I[0].when.all.pop();
    const single=createLoSWindowReader(nodes);
    route.ships[0].radarEquipped=true;
    assert(single(route).length);
    route.speed.ships[0].speed='slow';assert.deepEqual(single(route),[]);
    route.speed.ships[0].speed='fastPlus';route.ships[0].radarEquipped=false;assert.deepEqual(single(route),[]);
    route.ships[0].radarEquipped=null;assert.deepEqual(single(route),[]);
  }finally{map.machineRules=original;}
});

test('prepared point rules preserve every normal-map rule chain across fleet facts',()=>{
  const fs=require('fs'),path=require('path'),{evaluatePoint,preparePoint}=require('../../../src/domain/routes/normal_routes');
  const {store,scheme}=windowFixture(),base=evaluateNormalRoute(store,{area:'6-2',scheme});
  const dir=path.join(__dirname,'../../../data/normal_routes');
  for(const name of fs.readdirSync(dir).filter(n=>/^\d-\d\.json$/.test(n))){
    const map=require(path.join(dir,name));
    for(const rules of Object.values(map.machineRules||{})){
      const prepared=preparePoint(rules);
      for(let i=0;i<12;i++){
        const ships=base.ships.slice(0,i%7).map((s,k)=>({...s,stype:(i+k)%22+1,
          radarEquipped:[false,true,null][i%3],drumEquipped:i%2===0,landingCraftEquipped:i%3===0}));
        const metrics={lineOfSight:{status:i%2?'computed':'estimate',thresholdMargin:i%2,
          rawScoresByCoefficient:{1:i*10,2:i*10,3:i*10,4:i*10}},
          speed:{status:i%2?'observed':'estimated',fleetSpeed:['slow','fast','fastPlus','fastest'][i%4]},visitedNodes:['C','E']};
        assert.deepEqual(prepared(ships,metrics),evaluatePoint(rules,ships,metrics),name);
      }
    }
  }
});

test('planning-rule scopes preserve results and release cached parses on exceptions',()=>{
  const {store,scheme}=windowFixture(),route=evaluateNormalRoute(store,{area:'6-2',scheme});
  const expected=planningPath(route,nodes);
  assert.deepEqual(withPlanningCache(()=>planningPath(route,nodes)),expected);
  assert.throws(()=>withPlanningCache(()=>{planningPath(route,nodes);throw Error('scope test');}),/scope test/);
  assert.deepEqual(planningPath(route,nodes),expected);
});

test('complete-path LoS windows intersect both gates and respect the uncertain margin band',()=>{
  const {store,scheme}=windowFixture(),route=evaluateNormalRoute(store,{area:'6-2',scheme});
  assert.deepEqual(losWindows(route,nodes),[{coefficient:3,windows:[{lower:40,upper:43}]}]);
  route.lineOfSight.thresholdMargin=1;
  assert.deepEqual(losWindows(route,nodes),[{coefficient:3,windows:[{lower:41,upper:43}]}]);
  const virtual=score=>({...route,lineOfSight:{...route.lineOfSight,status:'computed',rawScoresByCoefficient:{3:score}}});
  assert.equal(planningPath(virtual(41),nodes,{allowTentative:false}).chance.probability,1);
  assert.notEqual(planningPath(virtual(43),nodes,{allowTentative:false}).chance.probability,1);
});
test('LoS fitting lowers excess score using unique stock while retaining guns and the last attacking aircraft',()=>{
  const {store,scheme}=windowFixture(),before=JSON.stringify({store,scheme});
  const route=evaluateNormalRoute(store,{area:'6-2',scheme}),fitted=fitRouteLoS(store,scheme,availableEquipment(store),{route,nodes});
  assert(fitted);const actual=evaluateNormalRoute(store,{area:'6-2',scheme:fitted});
  assert.equal(planningPath(actual,nodes,{allowTentative:false}).chance.probability,1);
  const score=actual.lineOfSight.rawScoresByCoefficient[3];assert(score>=40&&score<43);
  assert.equal(fitted.ships[1].slots[0],300);
  for(const [i,k] of [[3,1],[3,2],[4,0],[4,1],[4,2],[5,0],[5,1],[5,2]])assert.equal(fitted.ships[i].slots[k],scheme.ships[i].slots[k]);
  const ids=fitted.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);assert.equal(ids.length,new Set(ids).size);
  assert.equal(JSON.stringify({store,scheme}),before);
});
test('held LoS equipment and unavailable inventory produce no fabricated interval fit',()=>{
  const {store,scheme}=windowFixture(),route=evaluateNormalRoute(store,{area:'6-2',scheme});
  const heldSlots=scheme.ships.map(s=>({...s,keep:{0:true,1:true,2:true}}));
  assert.equal(fitRouteLoS(store,scheme,availableEquipment(store),{route,nodes,heldSlots}),null);
  assert.equal(fitRouteLoS(store,scheme,[],{route,nodes,heldSlots}),null);
  assert.equal(fitRouteLoS(store,scheme,availableEquipment(store),{route,nodes:['C','E','J','K']}),null);
});

test('bounded LoS fitting reserves strong hulls without expanding the eight-fleet budget',()=>{
  const {store,scheme}=windowFixture(),route=evaluateNormalRoute(store,{area:'6-2',scheme});
  const make=(id,strength,rank,score)=>({id,strength,rank,scheme,route:{...route,
    lineOfSight:{...route.lineOfSight,status:'computed',rawScoresByCoefficient:{3:score}}}});
  // Easy low-LoS fleets dominate the old rank, while strong hulls still need
  // reconnaissance removed. Already-valid fleets must not consume fit slots.
  const weak=Array.from({length:12},(_,i)=>make('weak'+i,10+i,100-i,39));
  const strong=Array.from({length:8},(_,i)=>make('strong'+i,100+i,-100-i,100));
  const ready=make('ready',1000,1000,41);
  const input=[ready,...weak,...strong],before=JSON.stringify(input);
  const finalists=selectLoSFinalists(input,{nodes,key:r=>r.id,rank:r=>r.rank,quality:r=>[r.strength]});
  assert.equal(finalists.length,8);
  assert.equal(finalists.filter(r=>r.id.startsWith('strong')).length,4);
  assert.equal(finalists.filter(r=>r.id.startsWith('weak')).length,4);
  assert(!finalists.includes(ready));
  assert(finalists.includes(strong.at(-1)));
  assert(finalists.includes(weak[0]));
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(selectLoSFinalists(input,{nodes:['C','E','J','K'],key:r=>r.id,
    rank:r=>r.rank,quality:r=>[r.strength]}),[],'minimum-only routes need no bounded fitting');
});

test('LoS fit selection deduplicates hulls and uses remaining places when pools overlap',()=>{
  const {store,scheme}=windowFixture(),route=evaluateNormalRoute(store,{area:'6-2',scheme});
  const input=Array.from({length:20},(_,i)=>({id:Math.floor(i/2),rank:20-i,scheme,route}));
  const select=rows=>selectLoSFinalists(rows,{nodes,key:r=>r.id,rank:r=>r.rank,quality:r=>[r.rank]});
  assert.deepEqual(select(input).map(r=>r.id),[0,1,2,3,4,5,6,7]);
  assert.equal(select(input.slice(0,6)).length,3);
});

test('1-6 upper-bound detour shares fitting while the high-LoS shortcut remains untouched',()=>{
  const {store,scheme}=windowFixture();
  [5,5,2,2,2,2].forEach((type,i)=>{store.const.$ships[i+1].api_stype=type;});
  const route=evaluateNormalRoute(store,{area:'1-6',target:'N',scheme});
  const detour=['C','H','K','M','L','I','D','N'],shortcut=['C','H','K','M','J','D','N'];
  assert.deepEqual(losWindows(route,detour),[{coefficient:3,windows:[{lower:-Infinity,upper:28}]}]);
  const row={scheme,route},select=nodes=>selectLoSFinalists([row],{
    nodes,key:()=>1,rank:()=>0,quality:()=>[1]});
  assert.deepEqual(select(detour),[row]);
  assert.deepEqual(select(shortcut),[]);
  const fitted=fitRouteLoS(store,scheme,availableEquipment(store),{route,nodes:detour});
  assert(fitted);
  const actual=evaluateNormalRoute(store,{area:'1-6',target:'N',scheme:fitted});
  assert.equal(planningPath(actual,detour,{allowTentative:false}).chance.probability,1);
  assert(actual.lineOfSight.rawScoresByCoefficient[3]<28);
});
