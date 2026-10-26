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
      api_soukou:[60,60],api_sakuteki:[80,80]});
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
  Object.assign(rows[1].ship,{api_maxhp:20,api_nowhp:20,api_soukou:[10,10]});
  assert.equal(fragileEscort(rows,profile),2);
  const first=fleetOrderChoices(store,scheme,profile,rows)[0];
  assert.equal(first.scheme.ships[0].id,2);assert.equal(first.reason,'flagshipProtection');
  const fixedFlag=fleetOrderChoices(store,scheme,profile,rows,{locked:new Map([[0,1]])});
  assert(fixedFlag.every(c=>c.scheme.ships[0].id===1&&c.reason!=='flagshipProtection'));
  Object.assign(rows[0].ship,{api_maxhp:22,api_nowhp:22,api_soukou:[10,10]});
  assert.equal(fragileEscort(rows,profile),null);
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
