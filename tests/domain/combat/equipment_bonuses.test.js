'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {combatBonuses,nightFit}=require('../../../src/domain/combat/equipment_bonuses');
const {surfacePower,aviationPower,reading}=require('../../../src/domain/combat/night_cutin');
function fixture(id=543,ctype=38,type=2,name='長波改二'){
  const master={api_id:id,api_name:name,api_ctype:ctype,api_stype:type,api_aftershipid:'0',api_houg:[30,100],api_raig:[50,100]};
  const ship={api_ship_id:id,api_lv:99,api_lucky:[30,99],api_kyouka:[10,20,0,0,0]};
  const store={const:{$ships:{[id]:master},$equips:{}},info:{ships:{1:ship},equips:{}}};
  const target={id:1,master,ship,items:[],before:{slots:[],ex:-1},after:{slots:[],ex:-1}};
  const gear=(id,type,name='装备',star=0,stats={})=>{
    const e={id:target.items.length+1000,type,master:{api_id:id,api_name:name,api_type:[0,0,type,0],...stats},instance:{api_slotitem_id:id,api_level:star}};
    store.const.$equips[id]=e.master;store.info.equips[e.id]=e.instance;target.items.push(e);target.after.slots.push(e.id);return e;
  };
  return {target,store,gear,read:()=>combatBonuses(store,target)};
}
const close=(a,b)=>assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('D gun and surface radar blue bonuses count repeated guns but synergy once, including expansion radar',()=>{
  const f=fixture();f.gear(267,1,'12.7cm連装砲D型改二');
  assert.equal(f.read().firePower,3);assert.equal(f.read().torpedo,0);
  f.gear(267,1,'12.7cm連装砲D型改二');assert.equal(f.read().firePower,6);
  const radar=f.gear(28,12,'水上电探',0,{api_saku:5});f.target.after.ex=radar.id;f.target.after.slots.pop();
  assert.equal(f.read().firePower,9);assert.equal(f.read().torpedo,6);
  radar.master.api_saku=4;assert.equal(f.read().firePower,6);assert.equal(f.read().torpedo,0);
  assert(f.read().known);assert.equal(surfacePower(f.target,f.store).basePower,116);
});

test('per-item star thresholds and number requirements do not give an unmodified copy the improved bonus',()=>{
  const f=fixture(147,1,2,'睦月改二'),a=f.gear(285,5,'61cm三連装(酸素)魚雷後期型',10);
  let b=f.read();assert.equal(b.firePower,1);assert.equal(b.torpedo,3);
  f.gear(285,5,'61cm三連装(酸素)魚雷後期型',0);b=f.read();assert.equal(b.firePower,1);assert.equal(b.torpedo,5);
  f.target.items[1].instance.api_level=10;b=f.read();assert.equal(b.firePower,2);assert.equal(b.torpedo,5);
  a.instance.api_level=9;b=f.read();assert.equal(b.firePower,1);assert.equal(b.torpedo,5);
});

test('original hull and nationality/class conditions follow actual remodel chains',()=>{
  const f=fixture(545,78,11,'Saratoga Mk.II');
  f.store.const.$ships[89]={api_aftershipid:'440'};f.store.const.$ships[440]={api_aftershipid:'545'};
  f.gear(244,6,'F6F-5N',10);let b=f.read();assert.equal(b.firePower,12);assert.equal(b.nightAviation,0);
  f.target.master.api_ctype=0;b=f.read();assert.equal(b.firePower,5,'base Saratoga bonus remains without class bonus');
});

test('light gun fit is added after CI multiplier and before the soft cap, including CT and Italian cruisers',()=>{
  const f=fixture(100,20,3,'由良');f.gear(4,2,'14cm単装砲');f.gear(65,2,'15.2cm連装砲');f.gear(139,2,'15.2cm連装砲改');
  const fit=1+2*Math.sqrt(2);close(nightFit(f.target),fit);
  const power=surfacePower(f.target,f.store);assert.equal(power.basePower,110);close(power.fit,fit);
  const mode={label:'主炮×3',multiplier:2,hits:1,coefficient:140};
  assert.equal(reading(f.target,false,[mode],power).rows[0].power,223,'fit is not multiplied by CI');
  f.target.master.api_houg=[100,200];assert.equal(reading(f.target,false,[mode],surfacePower(f.target,f.store)).rows[0].power,361);
  for(const type of [3,4,21]){f.target.master.api_stype=type;close(nightFit(f.target),fit);}
  f.target.master.api_stype=5;assert.equal(nightFit(f.target),0);
  f.target.master.api_name='Pola改';f.target.items=[];f.gear(162,2,'203mm／53 連装砲');f.gear(162,2,'203mm／53 連装砲');close(nightFit(f.target),Math.sqrt(2));
  f.target.master.api_name='Prinz Eugen改';assert.equal(nightFit(f.target),0);
});

test('night aviation includes attacker torpedo blue and improved deck crew, excluding panel fire and raw crew stats',()=>{
  const f=fixture(545,78,11,'Saratoga Mk.II');
  const fighter=f.gear(244,6,'F6F-5N',0,{api_houg:0,api_raig:0,api_baku:0});
  const attacker=f.gear(243,8,'TBM-3D',0,{api_houg:2,api_raig:9,api_tais:8});
  f.gear(478,35,'熟練甲板要員＋航空整備員',10,{api_houg:7,api_raig:1,api_baku:1});
  const slots=[{equipment:fighter,planes:10,kind:'fighter'},{equipment:attacker,planes:10,kind:'attacker'}];
  const b=f.read();assert.equal(b.firePower,10);assert.equal(b.torpedo,1);assert.equal(b.bomber,1);assert.equal(b.nightAviation,5);
  const power=aviationPower(f.target,slots,f.store);close(power.basePower,40+11+60+.45*19*Math.sqrt(10)+5);
  assert(!power.blue.matches.filter(r=>r.fromType===6).some(r=>r.torpedo));
  f.target.ship.api_sp_effect_items=[{api_kind:2,api_houg:2}];close(aviationPower(f.target,slots,f.store).basePower,power.basePower+2);
  const other=fixture(508,24,11,'赤城改二戊');other.gear(372,8,'天山夜攻');
  assert.equal(other.read().torpedo,0);assert.equal(other.read().nightAviation,0,'this aircraft has only firepower bonus on Akagi');
  const torp=fixture(883,24,7,'龍鳳改二戊');torp.gear(372,8,'天山夜攻');assert.equal(torp.read().torpedo,2);assert.equal(torp.read().nightAviation,2);
});

test('unknown bonus coverage preserves CI rate while withholding power; unchanged observed panels remain usable',()=>{
  const f=fixture();f.gear(9999,5,'未收录鱼雷');assert(!f.read().known);
  let power=surfacePower(f.target,f.store);assert.equal(power.basePower,null);
  const r=reading(f.target,true,[{label:'鱼雷×2',multiplier:1.5,hits:2,coefficient:122}],power);
  assert(r.total>0);assert.equal(r.rows[0].power,null);assert.match(r.detail,/尚未收录蓝字/);
  f.target.before.slots=f.target.after.slots.slice();f.target.ship.api_karyoku=[100,100];f.target.ship.api_raisou=[120,120];
  power=surfacePower(f.target,f.store);assert.equal(power.basePower,220);assert.equal(power.source,'observed');
  f.target.after.slots=[];f.target.items=[];assert.equal(surfacePower(f.target,f.store).basePower,110,'removing worn gear also removes its blue stats');
});

test('required companion count, modification and high accuracy radar conditions are independent',()=>{
  const data=require('../../../data/combat_bonuses.json');
  for(const field of ['requiresIdNum','requiresIdLevel','requiresAccR','requiresAR']){
    const rule=data.rules.find(r=>r[field]&&r.ids&&!r.shipBase);
    assert(rule,field);
    const f=fixture(rule.shipId?.[0]||100,rule.shipClass?.[0]||rule.shipCountry?.[0]||0,rule.shipType?.[0]||2);f.gear(rule.ids[0],1,'配装基础',10);
    if(rule.requiresId)for(let i=0;i<(rule.requiresIdNum||1);i++)f.gear(rule.requiresId[0],5,'组合装备',rule.requiresIdLevel||0);
    if(rule.requiresAccR)f.gear(31,13,'高命中电探',0,{api_houm:8});
    if(rule.requiresAR)f.gear(27,12,'对空电探',0,{api_tyku:2});
    if(rule.requiresSR)f.gear(28,12,'水上电探',0,{api_saku:5});
    assert(f.read().matches.some(b=>b.fromId===rule.ids[0]),field);
  }
});
