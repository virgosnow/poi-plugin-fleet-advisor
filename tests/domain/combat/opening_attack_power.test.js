'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aswPower,aviationPowers,torpedoPower}=require('../../../src/domain/combat/opening_attack_power');
const {fleetMechanisms}=require('../../../src/domain/combat/ship_mechanisms'),fixture=require('../../helpers/workbench_fixture');
function setup(type=3){
 const store=fixture(),ship=store.info.ships[1],master=store.const.$ships[1];
 Object.assign(master,{api_ctype:0,api_aftershipid:'0',api_stype:type,api_slot_num:5,api_maxeq:[18,12,4,0,0]});
 Object.assign(ship,{api_taisen:[100,100],api_nowhp:30,api_maxhp:30,api_slot:[-1,-1,-1,-1,-1],api_slot_ex:0});
 const target={id:1,ship,master,items:[],before:{slots:ship.api_slot,ex:0},after:{slots:[],ex:0}};
 const gear=(mid,type,name,stats={},stars=0)=>{const id=1000+target.items.length,instance={api_id:id,api_slotitem_id:mid,api_level:stars},m={api_id:mid,api_name:name,api_type:[0,0,type,0],...stats};
  store.info.equips[id]=instance;store.const.$equips[mid]=m;const e={id,type,instance,master:m};target.items.push(e);target.after.slots.push(id);return e;
 };
 const air=()=>target.items.filter(e=>[7,8,11,57,58].includes(e.type)).map(e=>({equipment:e,slot:target.after.slots.indexOf(e.id),planes:master.api_maxeq[target.after.slots.indexOf(e.id)]??null}));
 return {store,ship,master,target,gear,air};
}
test('opening torpedo includes panel, torpedo and machine-gun improvement but no midget improvement',()=>{
 const f=setup();Object.assign(f.master,{api_raig:[50,100]});f.ship.api_kyouka=[0,20,0,0,0];
 f.gear(41,22,'甲標的 甲型',{api_raig:12},10);f.gear(15,5,'61cm四連装魚雷',{api_raig:10},9);f.gear(12,21,'機銃',{},4);
 const before=JSON.stringify(f),r=torpedoPower(f.target,f.store);
 assert.equal(r.power,103);assert.equal(r.hits,1);assert.equal(r.detail,'鱼雷\n攻击力：103 × 1击');assert.equal(JSON.stringify(f),before);
 f.target.before=f.target.after;f.ship.api_raisou=[500,500];assert.equal(torpedoPower(f.target,f.store).power,198);
 delete f.target.items[1].instance.api_level;assert.equal(torpedoPower(f.target,f.store).power,null);
});

test('opening torpedo restores blue bonuses for the draft instead of retaining worn equipment',()=>{
 const f=setup();Object.assign(f.master,{api_id:566,api_raig:[50,100]});f.ship.api_ship_id=566;f.store.const.$ships[566]=f.master;f.ship.api_kyouka=[0,20,0,0,0];
 const torpedo=f.gear(15,5,'61cm四連装魚雷',{api_raig:10});
 assert.equal(torpedoPower(f.target,f.store).power,87);
 f.target.before={slots:[torpedo.id],ex:0};f.ship.api_raisou=[82,100];f.target.after={slots:[],ex:0};f.target.items=[];
 assert.equal(torpedoPower(f.target,f.store).power,75);
 delete f.ship.api_kyouka;assert.equal(torpedoPower(f.target,f.store).power,null);
});

test('ASW references apply synergy, improvements and each formation before the 170 cap',()=>{
 const f=setup();f.gear(149,14,'四式水中聴音機',{api_tais:12},4);f.gear(45,15,'三式爆雷投射機',{api_tais:8},9);f.gear(227,15,'二式爆雷',{api_tais:7});
 const before=JSON.stringify(f),r=aswPower(f.target,f.store,{opening:true});
 const base=(20+1.5*27+2+3+13)*1.4375;assert.equal(r.base,base);
 assert.deepEqual(r.rows.map(r=>r.power),[Math.floor(base*1.3),Math.floor(base*.6)]);assert.equal(JSON.stringify(f),before);
 f.ship.api_taisen=[10000,10000];const high=aswPower(f.target,f.store,{opening:true});assert(high.rows[0].power>170&&high.rows[0].power<200);
});
test('ASW blue bonuses and old equipment are removed from the intrinsic stat exactly once',()=>{
 const f=setup();Object.assign(f.master,{api_id:488,api_name:'由良改二',api_ctype:20});f.ship.api_ship_id=488;f.store.const.$ships[488]=f.master;
 const sonar=f.gear(149,14,'四式水中聴音機',{api_tais:12});f.ship.api_taisen=[87,100];
 const draft=aswPower(f.target,f.store,{opening:true});assert.equal(draft.base,2*Math.sqrt(87)+1.5*13+13);
 f.target.before={slots:[sonar.id],ex:0};f.ship.api_taisen=[100,100];assert.equal(aswPower(f.target,f.store,{opening:true}).base,draft.base);
 f.target.after.slots=[];f.target.items=[];assert.equal(aswPower(f.target,f.store,{opening:true}).base,2*Math.sqrt(87)+13);
});
test('ASW aviation uses the aircraft constant; non-ASW hulls and unknown gear are not given invented power',()=>{
 const f=setup(7);f.gear(97,8,'天山',{api_tais:6,api_raig:10});
 assert.equal(aswPower(f.target,f.store,{opening:true}).base,20+9+8);
 const heavy=setup(9);heavy.gear(149,14,'四式水中聴音機',{api_tais:12});assert.equal(aswPower(heavy.target,heavy.store).status,'unavailable');
 const unknown=setup();unknown.gear(700000,15,'未收录爆雷',{api_tais:30});assert.equal(aswPower(unknown.target,unknown.store,{opening:true}).rows[0].power,null);
 const rotor=setup(10);rotor.gear(69,25,'カ号観測機',{api_tais:9},10);assert.equal(aswPower(rotor.target,rotor.store,{opening:true}).base,20+13.5+3+8);
});
test('aircraft torpedo blue bonus moves to one strongest plane instead of being copied to every slot',()=>{
 const f=setup(7);Object.assign(f.master,{api_id:883,api_name:'龍鳳改二戊',api_ctype:24});f.ship.api_ship_id=883;f.store.const.$ships[883]=f.master;
 f.gear(372,8,'天山夜攻',{api_raig:9});f.gear(23,7,'彗星',{api_baku:15});
 const r=aviationPowers(f.target,f.store,f.air());
 assert.deepEqual(r.rows[0].powers,[Math.floor((9*Math.sqrt(18)+25)*.8),Math.floor((9*Math.sqrt(18)+25)*1.5)]);
 assert.deepEqual(r.rows[1].powers,[Math.floor(17*Math.sqrt(12)+25)]);
 assert.deepEqual(aviationPowers(f.target,f.store,[f.air()[0]],f.air()).rows[0].powers,r.rows[0].powers,'separate badge families share one allocation across all slots');
 f.master.api_maxeq[0]=null;assert(r.rows[1].powers[0]>0);assert(aviationPowers(f.target,f.store,f.air()).rows.every(r=>r.powers[0]===null));
});
test('opening air is per slot, uses two torpedo rolls, seaplane bombing and aircraft improvement',()=>{
 const f=setup(11);f.gear(97,8,'天山',{api_raig:10},5);f.gear(23,7,'彗星',{api_baku:8},10);f.gear(26,11,'瑞雲',{api_baku:4,api_raig:99},5);
 const before=JSON.stringify(f),r=aviationPowers(f.target,f.store,f.air());
 const cap=x=>Math.floor(x>170?170+Math.sqrt(x-170):x);
 assert.deepEqual(r.rows[0].powers,[cap((11*Math.sqrt(18)+25)*.8),cap((11*Math.sqrt(18)+25)*1.5)]);
 assert.deepEqual(r.rows[1].powers,[Math.floor(10*Math.sqrt(12)+25)]);assert.deepEqual(r.rows[2].powers,[35]);
 assert.equal(JSON.stringify(f),before);f.ship.api_karyoku=[99999,99999];f.ship.api_onslot=[0,0,0,0,0];
 assert.deepEqual(aviationPowers(f.target,f.store,f.air()).rows,r.rows,'uses full destination capacity and never carrier FP');
});
test('empty, unknown, expansion and jet slots keep distinct outcomes',()=>{
 const f=setup(11);f.gear(23,7,'彗星',{api_baku:8});f.master.api_maxeq[0]=0;
 assert.deepEqual(aviationPowers(f.target,f.store,f.air()).rows[0].powers,[]);
 delete f.master.api_maxeq[0];assert.deepEqual(aviationPowers(f.target,f.store,f.air()).rows[0].powers,[null]);
 const jet=setup(11);jet.gear(200,57,'噴式景雲改',{api_baku:15});const b=aviationPowers(jet.target,jet.store,jet.air()).rows[0];
 assert.equal(b.jetAssault,Math.floor(15*Math.sqrt(18)+25));assert.equal(b.powers[0],Math.floor((15*Math.sqrt(18)+25)*.7+.5));
});
test('both ASW badges share final power and aviation tooltips stay three paragraphs after equipment edits',()=>{
 const f=setup();f.gear(149,14,'四式水中聴音機',{api_tais:12});f.gear(45,15,'三式爆雷投射機',{api_tais:8});
 const read=()=>fleetMechanisms(f.store,[{id:1,...f.target.after}]).get(1),badges=read();
 const asw=badges.find(b=>b.key==='asw'),synergy=badges.find(b=>b.key==='asw-synergy');
 assert.deepEqual(asw.attacks,synergy.attacks);for(const b of [asw,synergy]){assert.equal(b.detail.split('\n\n').length,3);assert.match(b.detail,/单横攻击力：\d+ × 1击/);}
 const old=asw.attacks[0].power;f.target.after.slots.pop();f.target.items.pop();assert(read().find(b=>b.key==='asw').attacks[0].power<old);
 const a=setup(11);a.gear(97,8,'天山',{api_raig:10});const b=fleetMechanisms(a.store,[{id:1,...a.target.after}]).get(1).find(b=>b.key==='opening-air');
 const parts=b.detail.split('\n\n');assert.equal(parts.length,3);assert.match(parts[1],/第 1 槽 天山（18 架）\n攻击力：\d+ 或 \d+ × 1击/);
 assert.doesNotMatch(parts[1],/[／/]|50%/);assert.match(parts[2],/舰攻两档威力各约50%/);
});
