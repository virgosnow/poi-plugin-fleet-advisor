'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {radarShipCount,whirlpoolParameters,createSupplyTracker}=require('../../../src/domain/combat/route_supply');
function fixture(capacities=[100]){
  const store={info:{ships:{},equips:{}},const:{$ships:{},$equips:{
    1:{api_type:[0,0,12]},2:{api_type:[0,0,13]},3:{api_type:[0,0,93]},4:{api_type:[0,0,51]}}}};
  for(let id=1;id<=4;id++)store.info.equips[id]={api_slotitem_id:id};
  const ships=capacities.map((capacity,index)=>{const id=index+1;store.info.ships[id]={api_ship_id:id};
    store.const.$ships[id]={api_fuel_max:capacity,api_bull_max:capacity};return {id,slots:[],ex:-1};});
  return {store,scheme:{ships}};
}
const node=(area,id)=>require(`../../../data/sortie/encounters/${area}.json`).nodes[id];
test('radar mitigation counts distinct equipped ships including expansion slots',()=>{
  const f=fixture([100,100,100]);f.scheme.ships[0].slots=[1,2];f.scheme.ships[1].ex=3;f.scheme.ships[2].slots=[4];
  assert.equal(radarShipCount(f.store,f.scheme.ships),2);
});
test('a normal whirlpool uses current remaining fuel, truncation and radar mitigation',()=>{
  for(const count of [0,1,2,3,4,5,6]){
    const f=fixture(Array(6).fill(100));for(let i=0;i<count;i++)f.scheme.ships[i].slots=[1];
    const t=createSupplyTracker(f.store,f.scheme);t.advance({kind:'battle'},'3-3');t.advance(node('3-3','C'),'3-3');
    const reduced=[0,.25,.4,.5,.55,.58,.6][count],expected=.8-Math.floor(80*.3*(1-reduced)+1e-9)/100;
    assert(Math.abs(t.snapshot().fuel-expected)<1e-9);assert(Math.abs(t.snapshot().ammo-.8)<1e-9);
    t.advance({kind:'battle'},'3-3');assert(Math.abs(t.snapshot().fuel-(expected-.2))<1e-9);
  }
});
test('per-ship caps apply after radar reduction and fleet display averages remaining ratios',()=>{
  const f=fixture([100,275]),t=createSupplyTracker(f.store,f.scheme);
  t.advance({kind:'asw'},'5-5');t.advance(node('5-5','D'),'5-5');
  assert(Math.abs(t.snapshot().fuel-((.92-.32)+(.92-80/275))/2)<1e-9);
});
test('strong whirlpools average separately capped outcomes and ammunition losses persist',()=>{
  const f=fixture(),t=createSupplyTracker(f.store,f.scheme);t.advance(node('5-5','L'),'5-5');
  assert(Math.abs(t.snapshot().fuel-.54)<1e-9);assert.equal(t.estimates[0].strongChance,.1);
  const ammo=createSupplyTracker(f.store,f.scheme);ammo.advance({kind:'battle'},'6-2');ammo.advance(node('6-2','D'),'6-2');
  assert(Math.abs(ammo.snapshot().ammo-.65)<1e-9);assert.equal(ammo.snapshot().fuel,.8);
  ammo.advance({kind:'battle'},'6-2');assert(Math.abs(ammo.snapshot().ammo-.45)<1e-9);
});
test('unknown node rates use an explicit ordinary reference without turning later values blank',()=>{
  const f=fixture(),t=createSupplyTracker(f.store,f.scheme);t.advance(node('4-4','D'),'4-4');
  assert.equal(t.snapshot().fuel,.7);assert.equal(t.estimates[0].assumedBaseRate,.3);
  assert.deepEqual(whirlpoolParameters(node('2-5','G')).branches.map(b=>b.cap),[null,150]);
  assert.deepEqual(whirlpoolParameters(node('3-4','F')).branches.map(b=>b.cap),[null,70]);
});
test('all recorded regular-map whirlpools produce bounded numeric reference supply',()=>{
  for(const file of fs.readdirSync(require('node:path').join(__dirname,'../../../data/sortie/encounters')).filter(f=>/^\d-\d\.json$/.test(f))){
    const map=require(`../../../data/sortie/encounters/${file}`);
    for(const n of Object.values(map.nodes))if(n.kind==='whirlpool'){
      const f=fixture([15,100,275]),t=createSupplyTracker(f.store,f.scheme);t.advance(n,map.area);
      assert(whirlpoolParameters(n),`${map.area} ${n.node}`);
      for(const v of Object.values(t.snapshot()))assert(Number.isFinite(v)&&v>=0&&v<=1);
    }
  }
});
