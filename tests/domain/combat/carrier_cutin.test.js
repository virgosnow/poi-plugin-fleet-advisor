'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture'),W=require('../../../src/ui/workbench/workbench_model');
const {projectFleet}=require('../../../src/domain/fleet/fleet_metrics'),{fleetMechanisms}=require('../../../src/domain/combat/ship_mechanisms');
const {createContext,read}=require('../../../src/domain/combat/carrier_cutin');
function setup(){
  const store=fixture();store.info.fleets[0].api_ship=[1,2];
  Object.assign(store.const.$ships[1],{api_name:'测试空母',api_stype:11,api_ctype:0,api_slot_num:4,api_maxeq:[18,18,18,18]});
  Object.assign(store.info.ships[1],{api_slot:[101,102,103,-1],api_slot_ex:0,api_onslot:[18,18,18,0],api_lucky:[25,99],api_sakuteki:[60,90],api_nowhp:30,api_maxhp:30});
  Object.assign(store.const.$ships[2],{api_ctype:0});store.info.ships[2].api_sakuteki=[40,60];
  for(const [id,master,type,saku] of [[101,6,6,2],[102,7,7,3],[103,8,8,5]]){
    store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:0,api_alv:0};
    store.const.$equips[master]={api_id:master,api_name:'测试飞机'+type,api_type:[0,0,type,type],api_saku:saku,api_tyku:5};
  }
  let entries=[W.entry(store,1),W.entry(store,2)];
  const targets=()=>projectFleet(store,{organization:{targets:entries.map(e=>e.id)},equipment:{expected:entries.map(e=>({shipId:e.id,state:e}))}});
  const badge=(profile)=>fleetMechanisms(store,entries,undefined,profile).get(1).find(b=>b.key==='carrier-ci');
  return {store,targets,badge,get entries(){return entries;},set entries(value){entries=value;}};
}
const close=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('carrier observation uses floored terms and exclusive fallback rolls for superiority and supremacy',()=>{
  const f=setup(),before=JSON.stringify([f.store,f.entries]),ci=f.badge().ci;
  assert.equal(ci.rates.superiority.term,48);assert.equal(ci.rates.supremacy.term,60);
  assert.deepEqual(ci.rates.superiority.rows.map(r=>r.label),['FBA','BA']);
  close(ci.rates.superiority.rows[0].chance,.384);
  close(ci.rates.superiority.rows[1].rate,.19076129032258066);
  close(ci.rates.superiority.total,.5747612903225807);
  close(ci.rates.supremacy.total,.6812903225806451);
  assert.match(f.badge().detail,/参考发动率（空优）：57\.5%\n参考发动率（空确）：68\.1%/);
  assert.equal(JSON.stringify([f.store,f.entries]),before);
  f.entries.reverse();assert.equal(f.badge().ci.rates.superiority.term,33);assert.equal(f.badge().ci.rates.supremacy.term,45);
});

test('all six normal and jet modes use their own constants; high terms cap the first roll and zero later occurrences',()=>{
  const f=setup(),targets=f.targets(),context=createContext(f.store,targets),modes=['jFjBjB','jFjB','jFBA','FBA','BBA','BA'];
  let ci=read(context,targets[0],true,modes);
  assert.deepEqual(ci.rates.superiority.rows.map(r=>r.coefficient),[135,125,115,125,140,155]);
  close(ci.rates.superiority.rows.reduce((sum,r)=>sum+r.rate,0),ci.rates.superiority.total);
  f.store.info.ships[1].api_lucky=[1000000,1000000];
  ci=read(context,f.targets()[0],true,modes);assert.equal(ci.rates.superiority.total,1);
  assert.deepEqual(ci.rates.superiority.rows.map(r=>r.rate),[1,0,0,0,0,0]);
});

test('worn radar raw and blue scouting are removed from intrinsic fleet LoS, including after removing the radar',()=>{
  const f=setup(),base=f.badge().ci.rates;
  f.store.const.$ships[73]={...f.store.const.$ships[2],api_id:73};f.store.info.ships[2].api_ship_id=73;
  f.store.const.$equips[30]={api_id:30,api_name:'22号対水上電探',api_type:[0,0,12,11],api_saku:5};
  f.store.info.equips[104]={api_id:104,api_slotitem_id:30,api_level:0};
  f.store.info.ships[2].api_slot=[104,-1];f.store.info.ships[2].api_sakuteki=[47,67];f.entries=[W.entry(f.store,1),W.entry(f.store,2)];
  assert.deepEqual(f.badge().ci.rates,base,'the +2 blue scouting must not inflate the hull LoS');
  f.entries[1].slots=[-1,-1];assert.deepEqual(f.badge().ci.rates,base,'draft removal cannot leave the old blue bonus');
  f.store.const.$equips[10]={api_id:10,api_name:'水上侦察机',api_type:[0,0,10,10],api_saku:8};
  f.store.info.equips[105]={api_id:105,api_slotitem_id:10,api_level:0};
  f.entries[1].slots=[105,-1];f.store.const.$ships[73].api_maxeq=[9,0];
  assert(f.badge().ci.rates.superiority.total>base.superiority.total,'draft water scouts increase fleet spotting');
});

test('raw carrier gear LoS includes expansion radar but ignores level, fatigue and visible plane losses',()=>{
  const f=setup(),baseline=f.badge().ci.rates;f.store.info.ships[1].api_lv=1;f.store.info.ships[1].api_cond=0;f.store.info.ships[1].api_onslot.fill(0);
  assert.deepEqual(f.badge().ci.rates,baseline);
  f.store.const.$equips[12]={api_id:12,api_name:'电探',api_type:[0,0,12,11],api_saku:10};
  f.store.info.equips[104]={api_id:104,api_slotitem_id:12,api_level:0};f.entries[0].ex=104;
  assert(f.badge().ci.rates.superiority.total>baseline.superiority.total);
});

test('damage and impossible slots report zero; missing luck, hull LoS or relevant capacity remains unknown',()=>{
  const f=setup();f.store.info.ships[1].api_nowhp=15;
  assert.equal(f.badge().ci.rates.superiority.total,0);assert.match(f.badge().detail,/参考发动率：0\.0%/);
  f.store.const.$ships[1].api_stype=18;assert(f.badge().ci.rates.superiority.total>0);
  f.store.info.ships[1].api_nowhp=7;assert.equal(f.badge().ci.rates.supremacy.total,0);
  f.store.info.ships[1].api_nowhp=30;delete f.store.info.ships[1].api_lucky;
  assert.equal(f.badge().ci.rates.superiority.total,null);assert.match(f.badge().detail,/缺少运资料/);
  f.store.info.ships[1].api_lucky=[25,99];f.store.const.$ships[1].api_maxeq[0]=null;
  assert.equal(f.badge().ci.rates.superiority.total,null);assert.match(f.badge().detail,/飞机槽位容量待确认/);
  f.store.const.$ships[1].api_maxeq[0]=0;assert.equal(f.badge().label,'战爆联合·BA');assert(f.badge().ci.rates.superiority.total>0);
  f.store.const.$ships[1].api_maxeq[1]=0;assert.equal(f.badge().ci.rates.superiority.total,0);
  const missing=setup();delete missing.store.info.ships[2].api_sakuteki;
  assert.equal(missing.badge().ci.rates.superiority.total,null);assert.match(missing.badge().detail,/基础索敌资料不足/);
});

test('route presentation uses the actual node air state and never invents a probability when air bounds disagree',()=>{
  const f=setup(),targets=f.targets(),profile={area:'test',examples:[['A','B','C']]};
  const airReference={status:'known',nodes:['A','B','C'].map(id=>({id,kind:'battle'}))};
  const steps=[{node:'A',before:{min:100,max:100}},{node:'B',before:{min:70,max:70}},{node:'C',before:{min:10,max:10}}]
    .map(s=>({...s,required:{superiority:45,supremacy:90}}));
  const airEstimate={status:'estimated',paths:[{steps}]},options={airReference,airEstimate};
  let context=createContext(f.store,targets,profile,options),ci=read(context,targets[0],true,['FBA','BA']);
  assert.match(ci.detail,/A 点，空确）：68\.1%/);assert.match(ci.detail,/B 点，空优）：57\.5%/);assert.match(ci.detail,/C 点，制空不足）：0\.0%/);
  assert.strictEqual(context.route(),context.route(),'route display is reused by the fleet carriers');
  steps[1].before={min:30,max:70};context=createContext(f.store,targets,profile,options);ci=read(context,targets[0],true,['FBA','BA']);
  assert(ci.route.unknown);assert.match(ci.detail,/参考发动率（空优）：57\.5%/);assert.match(ci.detail,/路线制空待确认/);
  const noDay=createContext(f.store,targets,profile,{airReference:{status:'known',nodes:[{id:'A',kind:'nightBattle'}]}});
  assert.match(read(noDay,targets[0],true,['FBA']).detail,/所选路线没有昼战炮击/);
});

test('current fleet and preset badges expose the same combined rates without mutating observed equipment',()=>{
  const f=setup(),F=require('../../../src/ui/fleet/current_fleet_model');
  f.store.info.presets={api_max_num:1,api_deck:{1:{api_name:'空母预设',api_ship:[1,2]}}};
  const before=JSON.stringify(f.store);
  for(const preset of [null,1]){
    const badge=F.inspect(f.store,1,preset).ships[0].badges.find(b=>b.key==='carrier-ci');
    close(badge.ci.rates.superiority.total,.5747612903225807);assert.match(badge.detail,/参考发动率（空确）：68\.1%/);
  }
  assert.equal(JSON.stringify(f.store),before);
});
