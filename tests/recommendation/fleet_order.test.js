'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fleetOrderChoices,combatReadings,fragileEscort}=require('../../src/recommendation/fleet_order');
const {previewForMap}=require('../../src/domain/routes/sortie_profile');
function fixture(){
  const store=require('../helpers/workbench_fixture')(),types=[2,2,9,5,3,7];
  const fire=[60,65,160,85,55,50],torpedo=[80,75,0,60,70,0];
  const scheme={fleet:1,ships:[]},rows=[];
  for(let i=0;i<6;i++){
    const id=i+1,ship=store.info.ships[id],master=store.const.$ships[id];
    Object.assign(master,{api_stype:types[i],api_ctype:1,api_aftershipid:0,api_slot_num:4,api_maxeq:[1,1,5,0],
      api_houg:[fire[i],fire[i]],api_raig:[torpedo[i],torpedo[i]],api_yomi:String(id)});
    Object.assign(ship,{api_maxhp:60,api_nowhp:60,api_lv:90,api_lucky:[30,99],api_kyouka:[0,0,0,0,0],
      api_slot:[-1,-1,-1,-1],api_onslot:[1,1,5,0],api_karyoku:[fire[i],fire[i]],api_raisou:[torpedo[i],torpedo[i]],
      api_soukou:[60,60],api_kaihi:[70,70],api_sakuteki:[80,80]});
    const slots=[1,1,10,19].map((type,k)=>{
      const iid=id*100+k,mid=type;
      store.const.$equips[mid]={api_id:mid,api_name:'测试装备'+mid,api_type:[0,0,type,type],api_houg:type===1?10:0,api_saku:type===10?9:0};
      store.info.equips[iid]={api_id:iid,api_slotitem_id:mid,api_level:0,api_alv:7};return iid;
    });
    scheme.ships.push({id,slots,ex:-1});rows.push({id,ship,master,stype:types[i]});
  }
  const profile=previewForMap('4-5',{paths:[['C','D','H','T']]});
  return {store,scheme,rows,profile};
}
test('final order brings the powerful third-position battleship forward with its exact equipment',()=>{
  const {store,scheme,rows,profile}=fixture(),before=JSON.stringify({store,scheme});
  const choices=fleetOrderChoices(store,scheme,profile,rows);
  assert(choices.length>0&&choices.length<=8);
  assert.equal(choices[0].scheme.ships[0].id,3);
  for(const entry of choices[0].scheme.ships)assert.deepEqual(entry,scheme.ships.find(e=>e.id===entry.id));
  assert.equal(JSON.stringify({store,scheme}),before);
});

test('manually selected hulls can be reordered through fitting and final order without losing held gear',()=>{
  const {store,scheme,rows,profile}=fixture();
  const {holdDraftEquipment}=require('../../src/recommendation/context');
  const {specialPositionLocks}=require('../../src/recommendation/strategies');
  const {recommendationArgs,verifyConstraints}=require('../../src/application/page_queries');
  store.const.$shipTypes[2]={api_equip_type:{1:1}};
  const heldSlots=scheme.ships.map(e=>({...e,pin:true,holdPosition:false,keep:{0:true}}));
  // All guns must be legal on their owner when the application validates holds.
  for(const type of [2,9,5,3,7])store.const.$shipTypes[type]={api_equip_type:{1:1}};
  const args=recommendationArgs(store,{heldSlots}),before=JSON.stringify({scheme,heldSlots});
  const locks=specialPositionLocks({fixed:args.fixedShipIds},heldSlots);
  assert.equal(locks.size,0,'required hulls must not become implicit fixed positions');
  const choice=fleetOrderChoices(store,scheme,profile,rows,{locked:locks})[0];
  assert.equal(choice.scheme.ships[0].id,3);
  const fitted=holdDraftEquipment(store,choice.scheme,heldSlots);
  assert.deepEqual(fitted.ships.map(s=>s.id),choice.scheme.ships.map(s=>s.id));
  assert.doesNotThrow(()=>verifyConstraints({scheme:fitted},args));
  for(const entry of fitted.ships)assert.equal(entry.slots[0],heldSlots.find(h=>h.id===entry.id).slots[0]);
  const badGear={...fitted,ships:fitted.ships.map(s=>s.id===3?{...s,slots:[-1,...s.slots.slice(1)]}:s)};
  assert.throws(()=>verifyConstraints({scheme:badGear},args),/equipment slot/);
  assert.throws(()=>verifyConstraints({scheme:fitted},{heldSlots:heldSlots.map(h=>({...h,holdPosition:true}))}),/hull positions/);
  assert.throws(()=>recommendationArgs(store,{heldSlots:[{...heldSlots[0],holdPosition:'false'}]}),/boolean/);
  assert.equal(JSON.stringify({scheme,heldSlots}),before);
});

test('full normal-map search sorts an entirely manual fleet and keeps each ship with its reserved gear',()=>{
  const {store,scheme}=fixture(),W=require('../../src/ui/workbench/workbench_model');
  const {recommendNormalFleet}=require('../../src/recommendation');
  const {recommendationArgs,verifyConstraints}=require('../../src/application/page_queries');
  for(const type of [2,3])store.const.$shipTypes[type]={api_equip_type:{1:1,10:1,19:1}};
  for(const entry of scheme.ships){
    store.const.$ships[entry.id].api_stype=entry.id===1?3:2;
    store.info.ships[entry.id].api_slot=entry.slots.slice();
  }
  const draft=scheme.ships.map(s=>({...s,pin:true,keep:{0:true}}));
  const args=recommendationArgs(store,{area:'3-5',airGoal:'ignore',
    heldSlots:W.recommendationHolds(draft,{preservePositions:false})});
  const result=recommendNormalFleet(store,args);
  assert(result.recommendations.length,JSON.stringify({reason:result.reason,routes:result.routeResults?.map(r=>({key:r.key,status:r.status,message:r.message}))}));assert.doesNotThrow(()=>verifyConstraints(result,args));
  const row=result.recommendations.find(r=>r.scheme.ships[0].id===3);
  assert(row,'the powerful manually added ship can move from third position to flagship');
  const final=W.merge(store,draft,row.scheme,{preservePositions:false});
  assert.deepEqual(final.map(s=>s.id),row.scheme.ships.map(s=>s.id));
  for(const entry of final)assert.equal(entry.slots[0],draft.find(s=>s.id===entry.id).slots[0]);
});
test('night CI reads the fixed flagship bonus instead of treating all positions equally',()=>{
  const {store,scheme,rows,profile}=fixture();
  store.const.$equips[5]={api_id:5,api_name:'测试鱼雷',api_type:[0,0,5,5],api_raig:10};
  for(const id of scheme.ships[0].slots.slice(0,2))store.info.equips[id].api_slotitem_id=5;
  const p={...profile,counts:{surface:{maximum:0},night:{maximum:2}},mapPreview:{nodes:[]},routePaths:[],examples:[]};
  const values=combatReadings(store,scheme,p,rows).readings.get(1);
  assert(values[1].night>values[0].night);
});
test('a lone fragile escort gets a protection option without treating an ordinary light fleet as an outlier',()=>{
  const {store,scheme,rows,profile}=fixture();
  assert.equal(fragileEscort(rows,profile),null);
  Object.assign(rows[1].ship,{api_maxhp:20,api_nowhp:20,api_soukou:[10,10],api_kaihi:[30,30]});
  assert.equal(fragileEscort(rows,profile),2);
  const first=fleetOrderChoices(store,scheme,profile,rows)[0];
  assert.equal(first.scheme.ships[0].id,2);assert.equal(first.reason,'flagshipProtection');
  const fixedFlag=fleetOrderChoices(store,scheme,profile,rows,{locked:new Map([[0,1]])});
  assert(fixedFlag.every(c=>c.scheme.ships[0].id===1&&c.reason!=='flagshipProtection'));
  Object.assign(rows[0].ship,{api_maxhp:22,api_nowhp:22,api_soukou:[10,10]});
  assert.equal(fragileEscort(rows,profile),null);
});

test('high-evasion light ships do not win flagship protection from low armor alone',()=>{
  const {store,scheme,rows,profile}=fixture();
  for(const row of rows)Object.assign(row.ship,{api_maxhp:90,api_nowhp:90,api_soukou:[100,100],api_kaihi:[65,65]});
  rows[1].master.api_name='夕立改二';
  Object.assign(rows[1].ship,{api_maxhp:31,api_nowhp:31,api_soukou:[52,52],api_kaihi:[94,94]});
  assert.equal(fragileEscort(rows,profile,{store,scheme}),null);
  const choices=fleetOrderChoices(store,scheme,profile,rows);
  assert(choices.length>0);assert(choices.every(c=>c.reason!=='flagshipProtection'));
  assert.equal(choices[0].scheme.ships[0].id,3,'powerful battleship can take the first attack instead');
  rows[1].ship.api_kaihi=[40,40];
  assert.equal(fragileEscort(rows,profile,{store,scheme}),2,'both low evasion and low armor qualify');
  rows[1].ship.api_soukou=[100,100];
  assert.equal(fragileEscort(rows,profile,{store,scheme}),null,'small HP with low evasion alone is insufficient');
});

test('protection uses planned equipment evasion and does not treat absent stats as zero',()=>{
  const {store,scheme,rows,profile}=fixture();
  Object.assign(rows[1].ship,{api_maxhp:20,api_nowhp:20,api_soukou:[10,10],api_kaihi:[30,30]});
  assert.equal(fragileEscort(rows,profile,{store,scheme}),2);
  store.const.$equips[900]={api_id:900,api_type:[0,0,13,13],api_name:'回避电探',api_houk:40};
  store.info.equips[900]={api_id:900,api_slotitem_id:900};
  scheme.ships[1].slots[3]=900;
  assert.equal(fragileEscort(rows,profile,{store,scheme}),null,'new equipment removes the low-evasion condition');
  store.info.ships[2].api_slot[3]=900;store.info.ships[2].api_kaihi=[70,70];
  scheme.ships[1].slots[3]=-1;
  assert.equal(fragileEscort(rows,profile,{store,scheme}),2,'removing observed evasion equipment changes the decision');
  delete rows[1].ship.api_kaihi;assert.equal(fragileEscort(rows,profile,{store,scheme}),null);
  rows[1].ship.api_kaihi=[30,30];delete rows[2].ship.api_kaihi;
  assert.equal(fragileEscort(rows,profile,{store,scheme}),null,'missing peer data cannot establish a relative outlier');
});
test('manual positions, active Nelson participants and ASW-only fleets remain protected',()=>{
  const {store,scheme,rows,profile}=fixture();
  const held=fleetOrderChoices(store,scheme,profile,rows,{locked:new Map([[2,3]])});
  assert(held.every(c=>c.scheme.ships[2].id===3));
  rows[2].master.api_name='Nelson改';
  const ordered={...scheme,ships:[3,6,4,1,5,2].map(id=>scheme.ships.find(e=>e.id===id))};
  const touch=fleetOrderChoices(store,ordered,profile,rows);
  for(const c of touch)for(const i of [0,2,4])assert.equal(c.scheme.ships[i].id,ordered.ships[i].id);
  assert.deepEqual(fleetOrderChoices(store,scheme,{...profile,counts:{asw:{maximum:4}}},rows),[]);
});

function damagedCarrierFixture(stype=11,hp=40){
  const store=require('../helpers/workbench_fixture')(),scheme={fleet:1,ships:[]},rows=[];
  for(const [id,type,fire,health]of [[1,9,80,100],[2,stype,100,hp]]){
    const ship=store.info.ships[id],master=store.const.$ships[id];
    Object.assign(master,{api_stype:type,api_ctype:1,api_slot_num:3,api_maxeq:[24,18,6],api_houg:[fire,fire],api_raig:[0,0]});
    Object.assign(ship,{api_maxhp:100,api_nowhp:health,api_lv:90,api_lucky:[30,99],api_kyouka:[0,0,0,0,0],
      api_karyoku:[fire,fire],api_raisou:[0,0],api_sakuteki:[60,60],api_onslot:[24,18,6],api_slot:[-1,-1,-1]});
    rows.push({id,ship,master,stype:type});scheme.ships.push({id,slots:ship.api_slot.slice(),ex:-1});
  }
  for(const [id,type,name,stats]of [[501,8,'艦攻',{api_raig:10}],[502,7,'F4U-1D',{api_baku:7}],[503,6,'艦戦',{api_tyku:10}]]){
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],...stats};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_alv:7,api_level:0};
  }
  scheme.ships[1].slots=[501,502,503];store.info.ships[2].api_slot=scheme.ships[1].slots.slice();
  const profile={counts:{surface:{maximum:1},night:{maximum:0}},examples:[],mapPreview:{nodes:[]}};
  return {store,scheme,rows,profile};
}

test('day ordering shares carrier damage limits with badges, including armored carriers and exact HP thresholds',()=>{
  const {fleetMechanisms}=require('../../src/domain/combat/ship_mechanisms');
  for(const [stype,hp,blocked]of [[7,50,true],[11,40,true],[11,50,true],[11,51,false],[18,25,true],[18,26,false],[18,40,false]]){
    const {store,scheme,rows,profile}=damagedCarrierFixture(stype,hp),before=JSON.stringify([store,scheme]);
    const badge=fleetMechanisms(store,scheme.ships).get(2).find(b=>b.key==='carrier-ci');
    assert.equal(badge.state==='blocked',blocked);
    const reading=combatReadings(store,scheme,profile,rows).readings.get(2);
    for(const value of reading)assert.equal(value.day===0,blocked,`${stype} HP ${hp} daytime shelling`);
    // A torpedo-only carrier has no CI badge but still obeys the same rule.
    scheme.ships[1].slots=[501,-1,-1];
    assert.equal(combatReadings(store,scheme,profile,rows).readings.get(2)[0].day===0,blocked);
    scheme.ships[1].slots=[501,502,503];assert.equal(JSON.stringify([store,scheme]),before);
  }
});

test('a damaged ordinary carrier cannot win flagship order using unavailable shelling power',()=>{
  const {store,scheme,rows,profile}=damagedCarrierFixture();
  assert(fleetOrderChoices(store,scheme,profile,rows).every(c=>c.scheme.ships[0].id===1));
  const armored=damagedCarrierFixture(18,40);
  assert.equal(fleetOrderChoices(armored.store,armored.scheme,armored.profile,armored.rows)[0].scheme.ships[0].id,2);
});

test('damaged carriers do not regain daytime power through the land-target sorting fallback',()=>{
  for(const [stype,blocked]of [[11,true],[18,false]]){
    const {store,scheme,rows}=damagedCarrierFixture(stype,40);
    const profile={counts:{surface:{maximum:1}},examples:[['Z']],mapPreview:{nodes:[{id:'Z',kind:'battle',enemies:[{name:'港湾棲姫'}]}]}};
    const value=combatReadings(store,scheme,profile,rows).readings.get(2)[0];
    assert.equal(value.landDay===0,blocked);
  }
});
