'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {fitForLoadout,fitChange}=require('../../../src/domain/combat/gun_fit');
function setup(name='金剛改二',stype=8,level=90){
 const store=fixture();Object.assign(store.const.$ships[1],{api_name:name,api_stype:stype,api_taik:[90,90]});
 store.info.ships[1].api_lv=level;
 const names=['35.6cm連装砲','35.6cm連装砲改二','46cm三連装砲','46cm三連装砲改','試製51cm連装砲','41cm連装砲'];
 names.forEach((name,i)=>{store.info.equips[100+i]={api_id:100+i,api_slotitem_id:200+i,api_level:0};
   store.const.$equips[200+i]={api_id:200+i,api_name:name,api_type:[0,0,3,3],api_houg:10,api_houm:0};});
 return store;
}
const entry=(...slots)=>({id:1,slots,ex:-1});
test('Kongou mixed main-gun groups and marriage use the documented square-root coefficients',()=>{
 const s=setup();let f=fitForLoadout(s,1,entry(100,101,102,102));
 assert.equal(f.known,true);assert(Math.abs(f.value-(7-10)*Math.sqrt(2))<1e-9);
 s.info.ships[1].api_lv=120;f=fitForLoadout(s,1,entry(100,101,102,102));
 assert(Math.abs(f.value-(7-6)*Math.sqrt(2))<1e-9);
 const delta=fitChange(s,1,entry(100,101),1,101);
 assert(Math.abs(delta.delta-7*(Math.sqrt(2)-1))<1e-9);
});
test('Yamato heavy combines overweight groups before adding individual gun bonuses',()=>{
 const s=setup('大和改二重',10);let f=fitForLoadout(s,1,entry(102,103,104));
 assert.equal(f.known,true);assert(Math.abs(f.value-(-8*Math.sqrt(3)+3+7))<1e-9);
 s.info.ships[1].api_lv=120;f=fitForLoadout(s,1,entry(102,103,104));
 assert(Math.abs(f.value-(-4.8*Math.sqrt(3)+3+7))<1e-9);
});
test('unmapped guns, missing hull data and speed upgrades give a clearly marked estimate',()=>{
 const s=setup();s.const.$equips[200].api_name='未核实主炮';
 assert.equal(fitForLoadout(s,1,entry(100)).estimated,true);
 s.const.$equips[200].api_name='35.6cm連装砲';s.const.$ships[1].api_stype=9;delete s.const.$ships[1].api_taik;
 assert.match(fitForLoadout(s,1,entry(100)).reason,/耐久/);
 s.const.$ships[1].api_stype=8;s.const.$equips[33]={api_type:[0,0,33,0]};s.info.equips[300]={api_slotitem_id:33};
 assert.equal(fitForLoadout(s,1,entry(100,300)).known,true,'a turbine alone does not change speed');
 s.const.$equips[34]={api_type:[0,0,33,0]};s.info.equips[301]={api_slotitem_id:34};
 assert.match(fitForLoadout(s,1,entry(100,300,301)).reason,/提速/);
});
test('known light cruiser, seaplane tender and destroyer fits retain their distinct rules',()=>{
 const s=setup('阿賀野改',3);
 const add=(id,name,type=2)=>{s.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],api_houg:1};s.info.equips[id]={api_id:id,api_slotitem_id:id};};
 add(301,'15.2cm連装砲');add(302,'15.2cm連装砲改');add(303,'20.3cm連装砲');add(304,'14cm連装砲');
 assert.equal(fitForLoadout(s,1,entry(301)).value,5);assert.equal(fitForLoadout(s,1,entry(301,302)).value,6);
 assert.equal(fitChange(s,1,entry(301,302),1,302).delta,1);
 const mixed=fitForLoadout(s,1,entry(301,303));assert.equal(mixed.estimated,true);assert.equal(mixed.value,1);
 s.const.$ships[1].api_stype=16;s.const.$ships[1].api_name='千歳改';
 assert.equal(fitForLoadout(s,1,entry(303)).value,-18);assert.equal(fitForLoadout(s,1,entry(303,304)).value,-16);
 s.info.ships[1].api_lv=120;assert.equal(fitForLoadout(s,1,entry(303)).value,-14.8);
 s.const.$ships[1].api_stype=2;s.const.$ships[1].api_name='Ташкент改';add(305,'130mm B-13連装砲',1);
 assert.equal(fitForLoadout(s,1,entry(305)).value,5);
});
test('recommendation and equipment hover use the same loadout-dependent fit increment',()=>{
 const s=setup(),V=require('../../../src/ui/models/presentation_model'),value=require('../../../src/recommendation/loadout/combat_value');
 s.const.$shipTypes[8]={api_equip_type:{3:1}};
 s.const.$equips[200].api_houg=15;s.const.$equips[202].api_houg=26;
 const e=entry(-1,-1),candidates=[100,102].map(id=>({id,master:s.const.$equips[s.info.equips[id].api_slotitem_id]}));
 assert.equal(value.rankGuns(s,e,candidates,0,0)[0].id,100,'fit offsets the stronger but overweight gun');
 assert.equal(value.rankGuns(s,e,candidates,0,0,false)[0].id,102,'daytime fit is not applied to a night-only route');
 s.const.$equips[202].api_houg=30;
 require('../../../src/domain/fleet/equipment_planner').withEquipmentIndexCache(s,()=>{
   assert.equal(value.rankGuns(s,entry(-1,-1),candidates,1,0)[0].id,100);
   assert.equal(value.rankGuns(s,entry(102,-1),candidates,1,0)[0].id,102,'ranking cache must account for already fitted guns');
 });
 s.const.$equips[202].api_houg=26;
 const fitted=V.withGunFit(s,entry(100,101),V.equipmentItem(s,101,1));
 assert.equal(fitted.gunFit.known,true);assert.deepEqual(fitted.stats.filter(([name])=>name==='命中'),[['命中','+2.9（+2.9）']]);
 assert(!fitted.stats.some(([name])=>name==='适重'));
 const tooltip=JSON.parse(V.equipmentTooltipProps(fitted)['data-tooltip-content']);
 assert.deepEqual(tooltip.notes,['括号内为昼战适重']);
 const proposed=entry(100,101),card=V.fleetRows(s,{ships:[proposed]})[0].gearIcons.find(item=>item.id===101);
 const picker=require('../../../src/ui/workbench/workbench_model').equipmentOptions(s,[proposed],0,1).find(item=>item.id===101);
 assert.deepEqual(card.stats.slice(-2),fitted.stats.slice(-2));assert.deepEqual(picker.stats.slice(-2),fitted.stats.slice(-2));
 assert.equal(require('../../../src/ui/components/equipment_picker').statValue(picker,'accuracy',s),picker.gunFit.delta);
 const unknown=V.withGunFit(s,entry(100,101),V.equipmentItem(s,102,1));
 assert.equal(unknown.gunFit.known,true);assert(unknown.stats.some(([name,v])=>name==='命中'&&v==='-10（-10）'));
});

test('route evaluation values equipment accuracy and the complete daytime fit',()=>{
 const s=setup(),{context}=require('../../../src/recommendation/context'),{scoreRoute}=require('../../../src/recommendation/scoring');
 const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes'),{profileForRoute}=require('../../../src/domain/routes/sortie_profile');
 s.const.$shipTypes[8]={api_equip_type:{3:1}};
 s.const.$equips[200].api_houg=15;s.const.$equips[200].api_houm=2;
 s.const.$equips[202].api_houg=20;s.const.$equips[202].api_houm=0;
 const light={fleet:1,ships:[entry(100,100)]},heavy={fleet:1,ships:[entry(102,102)]};
 // Unique inventory instances are used in real schemes.
 s.info.equips[110]={...s.info.equips[100],api_id:110};s.info.equips[112]={...s.info.equips[102],api_id:112};
 light.ships[0].slots[1]=110;heavy.ships[0].slots[1]=112;
 const row=context(s,{fleet:1},1).byId.get(1);
 const score=scheme=>{const route=evaluateNormalRoute(s,{area:'1-1',fleet:1,scheme}),profile=profileForRoute('1-1',route);
   return scoreRoute(route,profile,[row],'ignore','1-1',s,scheme).strengthProxy;};
 assert(score(light)>score(heavy),'a moderate firepower increase must not erase a severe fit penalty');
 const value=require('../../../src/recommendation/loadout/combat_value');
 assert.equal(value.plannedStats(s,light.ships[0]).accuracy,4);
 assert(value.accuracyScore(4,10)>value.accuracyScore(4,-10));
 assert(value.accuracyScore(4,-25)<value.accuracyScore(4,-15),'negative fit is not cut off at -12');
});

test('class identity includes renamed ships and sisters, with uncertain coefficients identified',()=>{
 const s=setup('Октябрьская революция',8);s.const.$ships[1].api_ctype=73;
 let f=fitForLoadout(s,1,entry(105));
 assert.equal(f.value,-9);assert.equal(f.estimated,true);assert.match(f.reason,/待验证/);
 s.const.$ships[1].api_name='Jean Bart改';s.const.$ships[1].api_ctype=79;
 f=fitForLoadout(s,1,entry(105));assert.equal(f.value,-7);assert.equal(f.estimated,true);
 s.const.$ships[1].api_name='其他同级舰';s.const.$ships[1].api_ctype=6;
 assert.equal(fitForLoadout(s,1,entry(100)).value,7);
 s.const.$ships[1].api_name='Iowa改';s.const.$ships[1].api_ctype=65;
 s.const.$equips[210]={api_name:'16inch三連装砲 Mk.7',api_type:[0,0,3]};s.info.equips[110]={api_slotitem_id:210};
 s.const.$equips[211]={api_name:'16inch三連装砲 Mk.7+GFCS',api_type:[0,0,3]};s.info.equips[111]={api_slotitem_id:211};
 f=fitForLoadout(s,1,entry(110,111));assert(Math.abs(f.value-(18-5*Math.sqrt(2)))<1e-9);assert.equal(f.estimated,true);
 const item=require('../../../src/ui/models/presentation_model').withGunFit(s,entry(110),require('../../../src/ui/models/presentation_model').equipmentItem(s,110,0));
 assert(item.stats.some(([label])=>label==='命中'));assert.equal(item.gunFitNote,'括号内为昼战适重（预估）');
});

test('new measured light cruiser guns distinguish measured values from extrapolated cases',()=>{
 const s=setup('長良改',3);const add=(id,name)=>{s.const.$equips[id]={api_name:name,api_type:[0,0,2]};s.info.equips[id]={api_slotitem_id:id};};
 add(310,'15.2cm三連装主砲');add(311,'15.2cm三連装主砲改');add(312,'15.5cm三連装砲');add(313,'20.3cm(3号)連装砲');
 assert.equal(fitForLoadout(s,1,entry(310,310)).value,-6);
 s.const.$ships[1].api_name='Gloire改';assert.equal(fitForLoadout(s,1,entry(310)).value,-1);
 s.info.ships[1].api_lv=120;assert.equal(fitForLoadout(s,1,entry(310)).estimated,true);
 s.info.ships[1].api_lv=90;assert.equal(fitForLoadout(s,1,entry(311)).estimated,true);
 s.const.$ships[1].api_name='三隈改二';s.const.$ships[1].api_stype=6;s.const.$ships[1].api_ctype=9;
 assert.equal(fitForLoadout(s,1,entry(312)).value,5);
 assert.equal(fitForLoadout(s,1,entry(313)).value,0);
 const V=require('../../../src/ui/models/presentation_model');const zero=V.withGunFit(s,entry(313),V.equipmentItem(s,313,0));
 assert.deepEqual(zero.stats.filter(([name])=>name==='命中'),[['命中','+0']]);assert.equal(zero.gunFitNote,'');
 s.const.$ships[1].api_name='大淀改';s.const.$ships[1].api_stype=3;s.info.ships[1].api_lv=120;
 assert.equal(fitForLoadout(s,1,entry(313,313)).value,-8);
});

test('every gun receives a numeric fit and estimate text, retaining known components',()=>{
 const s=setup('金剛改二',8);const V=require('../../../src/ui/models/presentation_model');
 const add=(id,name,type)=>{s.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],api_houm:2,api_houg:8};s.info.equips[id]={api_id:id,api_slotitem_id:id};};
 add(320,'38cm四連装砲改',3);add(321,'資料不足の中口径砲',2);add(322,'資料不足の小口径砲',1);
 let f=fitForLoadout(s,1,entry(100,320));assert.equal(f.estimated,true);assert(Number.isFinite(f.value));
 assert(f.value>0,'estimated gun must not discard the verified 35.6 cm contribution');
 let item=V.withGunFit(s,entry(100,320),V.equipmentItem(s,320,1));
 assert(item.stats.some(([key,value])=>key==='命中'&&value.includes('（')));assert.match(item.gunFitNote,/预估/);
 s.const.$ships[1].api_name='吹雪改二';s.const.$ships[1].api_stype=2;
 f=fitForLoadout(s,1,entry(322));assert.equal(f.value,0);assert.equal(f.estimated,true);
 item=V.withGunFit(s,entry(322),V.equipmentItem(s,322,0));assert.equal(item.gunFitNote,'适重预估');
 assert.deepEqual(item.stats.filter(([key])=>key==='命中'),[['命中','+2']]);
 s.const.$ships[1].api_name='天龍改';s.const.$ships[1].api_stype=3;
 f=fitForLoadout(s,1,entry(321));assert(Number.isFinite(f.value));assert.equal(f.estimated,true);
 s.const.$ships[1].api_name='伊勢改二';s.const.$ships[1].api_stype=10;
 f=fitForLoadout(s,1,entry(100,999999));assert(Number.isFinite(f.value));assert.equal(f.estimated,true);
});

test('estimated fits work with frozen poi master and inventory maps without mutating them',()=>{
 const s=setup('Richelieu改',8);s.const.$ships[1].api_ctype=79;
 s.const.$equips[210]=Object.freeze({api_name:'38cm四連装砲改',api_type:[0,0,3]});s.info.equips[110]={api_slotitem_id:210};
 Object.freeze(s.const.$equips);Object.freeze(s.const.$ships);Object.freeze(s.info.ships);
 const result=fitForLoadout(s,1,entry(110));assert(Number.isFinite(result.value));assert.equal(result.estimated,true);
 assert.equal(s.const.$equips[210].api_name,'38cm四連装砲改');
});

test('equipment tooltip combines base accuracy and positive or negative fit into one field',()=>{
 const s=setup(),V=require('../../../src/ui/models/presentation_model');
 s.const.$equips[200].api_houm=3;s.const.$equips[202].api_houm=3;
 const positive=V.withGunFit(s,entry(100),V.equipmentItem(s,100,0));
 const negative=V.withGunFit(s,entry(102),V.equipmentItem(s,102,0));
 assert.deepEqual(positive.stats.filter(([name])=>name==='命中'),[['命中','+10（+7）']]);
 assert.deepEqual(negative.stats.filter(([name])=>name==='命中'),[['命中','-7（-10）']]);
 assert(!positive.stats.some(([name])=>/^适重/.test(name)));
 const displayed=JSON.parse(V.equipmentTooltipProps(negative)['data-tooltip-content']);
 assert(displayed.sections[0].rows.some(row=>row.includes('-7（-10）')));
});
