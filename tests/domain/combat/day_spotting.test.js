'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('../../helpers/workbench_fixture');
const {projectFleet}=require('../../../src/domain/fleet/fleet_metrics'),observation=require('../../../src/domain/combat/carrier_cutin'),spotting=require('../../../src/domain/combat/day_spotting');
function setup(types=[3,3,10]){
 const store=fixture();store.info.fleets[0].api_ship=[1,2];
 Object.assign(store.const.$ships[1],{api_stype:9,api_ctype:0,api_aftershipid:'0',api_slot_num:6,api_maxeq:[4,4,4,4,4,4]});
 Object.assign(store.const.$ships[2],{api_ctype:0,api_aftershipid:'0'});
 Object.assign(store.info.ships[1],{api_slot:[-1,-1,-1,-1,-1,-1],api_slot_ex:0,api_lucky:[25,99],api_sakuteki:[65,90],api_karyoku:[100,100],api_kyouka:[0,0,0,0,0]});
 store.info.ships[2].api_sakuteki=[40,60];
 types.forEach((type,i)=>{const id=101+i,mid=300+i;store.info.ships[1].api_slot[i]=id;
  store.info.equips[id]={api_id:id,api_slotitem_id:mid,api_level:0};
  store.const.$equips[mid]={api_id:mid,api_name:'示例装备',api_type:[0,0,type,type],api_saku:type===10?5:0,api_raig:type===8?10:0,api_baku:type===7?8:0};
 });
 const targets=()=>projectFleet(store,{organization:{targets:[1,2]},equipment:{expected:[]}});
 const read=(options={})=>{const rows=targets();return spotting.read(rows[0],store,true,observation.createContext(store,rows),options);};
 return {store,targets,read};
}
const close=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);
test('spotting shares fleet observation terms but uses the correct DA coefficient and three tooltip sections',()=>{
 const f=setup(),before=JSON.stringify(f.store),b=f.read();
 close(b.ci.rates.superiority.total,46/130);close(b.ci.rates.supremacy.total,57/130);
 assert.deepEqual(b.attacks.map(r=>[r.power,r.hits]),[[126,2]]);
 const [rate,power,notes]=b.detail.split('\n\n');assert.match(rate,/^参考发动率（空优）：35.4%/);
 assert.equal(power,'昼战连击\n攻击力：126 × 2击');assert.equal(notes,'需空优／空确及可用水侦／水爆。');
 assert.equal(b.detail.match(/昼战连击/g).length,1);assert.equal(JSON.stringify(f.store),before);
});
test('each surface CI has its own power and exclusive priority rate before double attack',()=>{
 const f=setup([3,3,10,19,4,12]),b=f.read(),rows=b.ci.rates.superiority.rows;
 assert.deepEqual(rows.map(r=>r.label),['主主 CI','主彻 CI','主电 CI','主副 CI','昼战连击']);
 close(rows[0].rate,46/150);close(rows[1].rate,(1-46/150)*46/140);
 close(rows.reduce((n,r)=>n+r.rate,0),b.ci.rates.superiority.total);
 assert.deepEqual(b.attacks.map(r=>[r.power,r.hits]),[[157,1],[136,1],[126,1],[115,1],[126,2]]);
 assert.equal(b.detail.split('\n\n').length,3);
});
test('blocked observations are zero and incomplete rates do not erase known power',()=>{
 const f=setup();assert.equal(f.read({blocked:true}).ci.rates.supremacy.total,0);
 delete f.store.info.ships[1].api_lucky;const b=f.read();assert.equal(b.ci.rates.superiority.total,null);
 assert.match(b.detail,/参考发动率：待确认/);assert.equal(b.attacks[0].power,126);
 const unknown=f.read({uncertain:true});assert.equal(unknown.ci.rates.supremacy.total,null);
});
test('a route without daytime shelling cannot show nonzero per-mode spotting rates',()=>{
 const f=setup([3,3,10,19]),target=f.targets()[0];
 const b=spotting.read(target,f.store,true,{fleetTerm:21,reason:'',route:()=>({noDayBattle:true})});
 const first=b.detail.split('\n\n')[0];assert.match(first,/参考发动率：0.0%/);
 assert(!first.includes('主主 CI'));assert(!first.includes('空优）'));assert(b.attacks.length===2);
});
test('carrier CI powers apply each mode after the daytime cap and preserve missing blue data',()=>{
 const f=setup([6,7,8]),target=f.targets()[0];target.master.api_stype=11;
 const b=observation.attackPowers(target,f.store,['FBA','BBA','BA']);
 // 120 * 1.5 + 55 = 235; soft cap = floor(220 + sqrt(15)) = 223.
 assert.deepEqual(b.rows.map(r=>r.power),[278,267,256]);assert(b.rows.every(r=>r.hits===1));
 target.items[0].instance.api_level=null;assert(observation.attackPowers(target,f.store,['FBA']).rows.every(r=>r.power===null));
});
