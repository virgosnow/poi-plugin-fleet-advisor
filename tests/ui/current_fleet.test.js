'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),F=require('../../src/ui/fleet/current_fleet_model');
function store(){
  const s=fixture();s.info.fleets[0]={api_name:'主力',api_ship:[1],api_mission:[0,0,0]};
  s.info.ships[1]={...s.info.ships[1],api_nowhp:12,api_maxhp:40,api_cond:55,api_slot:[101,102],api_slot_ex:103,api_onslot:[0,0]};
  for(const [id,master,type] of [[101,75,30],[102,68,20],[103,68,20]]){s.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:0};s.const.$equips[master]={api_name:master===75?'ドラム缶(輸送用)':'大発動艇',api_type:[0,0,master===75?30:24,type]};}
  s.info.presets={api_max_num:3,api_deck:{2:{api_preset_no:2,api_name:'远征预设',api_ship:[2,1,-1,-1,-1,-1,-1]},1:{api_preset_no:1,api_name:'单舰预设',api_ship:[1,-1,-1,-1,-1,-1,-1]}}};
  return s;
}
test('current fleet observes real equipment and combines combat and expedition badges without applying availability filters',()=>{
  const s=store();s.info.fleets[0].api_mission=[1,5,20000];s.info.repairs=[{api_ship_id:1,api_complete_time:30000}];
  const before=JSON.stringify(s),r=F.inspect(s,1),ship=r.ships[0];
  assert.equal(r.heading.state,'away');assert.equal(ship.repair.api_ship_id,1);
  assert.equal(ship.health,'中破');assert.deepEqual(ship.hp,{current:12,max:40});
  assert.equal(r.expedition.sparkled,1);assert.equal(r.expedition.drums,1);assert.equal(r.expedition.carriers,1);assert.equal(r.bonusPercent,10);
  for(const key of ['speed','expedition-morale','expedition-drums','expedition-income'])assert(ship.badges.some(b=>b.key===key),key);
  assert(ship.badges.find(b=>b.key==='expedition-income').detail.includes('舰队收益加成'));
  assert(!ship.badges.find(b=>b.key==='expedition-income').detail.includes('左侧'));
  assert.deepEqual(ship.equipment.map(e=>e.id),[101,102,103]);assert.equal(JSON.stringify(s),before);
  s.info.ships[1]={...s.info.ships[1],api_nowhp:40,api_cond:20,api_slot:[-1,-1],api_slot_ex:0};
  const next=F.inspect(s,1);assert.equal(next.ships[0].health,'完好');assert.equal(next.expedition.sparkled,0);assert.equal(next.expedition.drums,0);assert.equal(next.bonusPercent,0);
  assert(!next.ships[0].badges.some(b=>b.key==='expedition-income'));assert.equal(next.ships[0].equipment.length,2);
});
test('status keeps missing fields unknown and empty fleets empty; expedition countdown never invents completion',()=>{
  const s=store();delete s.info.ships[1].api_fuel;delete s.info.ships[1].api_lucky;
  const r=F.inspect(s,1);assert.equal(r.ships[0].fuel.current,null);assert.equal(r.ships[0].stats.find(x=>x.label==='运').value,null);
  s.info.fleets[1].api_ship=[];assert.equal(F.inspect(s,2).ships.length,0);
  s.info.fleets[2].api_ship=[999];assert(F.inspect(s,3).ships[0].unknown);assert(F.inspect(s,3).warnings.length);
  delete s.info.fleets[3];assert.equal(F.fleetHeading(s,4).status,'数据待同步');
  assert.equal(F.countdown(4000,1000),'00:00:03');assert.equal(F.countdown(1000,2000),'等待归航');assert.equal(F.countdown(0,2000),'时间待同步');
});
test('current aircraft counts and airpower use observed planes, including a depleted slot',()=>{
  const s=store();s.const.$ships[1].api_maxeq=[12,0];
  s.info.equips[101]={api_id:101,api_slotitem_id:500,api_alv:0};s.const.$equips[500]={api_name:'舰战',api_type:[0,0,6,6],api_tyku:10};
  s.info.ships[1].api_onslot=[3,0];let r=F.inspect(s,1);assert.equal(r.ships[0].equipment[0].planes,3);assert.equal(r.ships[0].equipment[0].capacity,12);
  assert.deepEqual(r.metrics.airPower.slots[0].planes,[3,3]);
  s.info.ships[1].api_onslot=[0,0];r=F.inspect(s,1);assert.equal(r.metrics.airPower.min,0);assert.equal(r.metrics.airPower.max,0);
});

test('current fleets and presets show conditional ground double-attack power from actual equipment',()=>{
  const s=fixture();s.info.fleets[0].api_ship=[1];
  s.info.presets={api_max_num:1,api_deck:{1:{api_name:'对地预设',api_ship:[1]}}};
  Object.assign(s.const.$ships[1],{api_name:'测试重巡',api_stype:5,api_slot_num:4,api_maxeq:[0,0,4,0]});
  Object.assign(s.info.ships[1],{api_slot:[101,102,103,104],api_slot_ex:0,api_onslot:[0,0,4,0],api_nowhp:40,api_maxhp:40,api_karyoku:[100,100]});
  for(const [id,name,type] of [[101,'主炮',2],[102,'主炮',2],[103,'水上侦察机',10],[104,'三式弾',18]]){
    s.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};
    s.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],api_houg:0,api_saku:0};
  }
  const before=JSON.stringify(s),badge=(store,preset=null)=>F.inspect(store,1,preset).ships[0].badges.find(b=>b.key==='ground');
  for(const preset of [null,1]){
    const spotting=F.inspect(s,1,preset).ships[0].badges.find(b=>b.key==='spotting');
    assert.equal(spotting.doubleAttack.power,126);assert.match(spotting.detail,/\n\n昼战连击\n攻击力：126 × 2击/);
    const ground=badge(s,preset);assert.equal(ground.attacks[0].day,271);assert.equal(ground.attacks[0].dayHits,2);
    assert(ground.attacks.every(r=>r.dayConditional===true));
    assert.match(ground.detail,/昼战连击攻击力：271 × 2击/);assert.match(ground.detail,/需空优／空确，概率发动/);
    assert(!ground.detail.includes('按路线制空估算'));
  }
  assert.equal(JSON.stringify(s),before);
  for(const change of [
    store=>store.info.ships[1].api_slot[2]=-1,
    store=>store.const.$ships[1].api_maxeq[2]=0,
    store=>{store.const.$equips[103].api_type=[0,0,11,10];store.const.$ships[1].api_maxeq[2]=0;},
    store=>store.const.$equips[103].api_type=[0,0,45,45],
    store=>store.const.$equips[102].api_type=[0,0,4,4],
    store=>store.info.ships[1].api_nowhp=10,
    store=>store.const.$ships[1].api_stype=2
  ]){
    const changed=structuredClone(s);change(changed);const ground=badge(changed);
    assert(ground.attacks.every(r=>r.dayHits===1&&!r.dayConditional));assert(!ground.detail.includes('昼战连击攻击力'));
  }
  const empty=structuredClone(s);empty.info.ships[1].api_onslot[2]=0;
  assert.equal(badge(empty).attacks[0].dayHits,2,'capability follows full capacity before resupply');
  const seaplane=structuredClone(s);seaplane.const.$equips[103].api_type=[0,0,11,10];
  assert.equal(badge(seaplane).attacks[0].dayHits,2,'seaplane bombers can enable spotting too');
  const entry={id:1,slots:s.info.ships[1].api_slot,ex:-1};
  const ordinary=require('../../src/domain/combat/ship_mechanisms').fleetMechanisms(s,[entry]).get(1).find(b=>b.key==='ground');
  assert.equal(ordinary.attacks[0].dayHits,1,'other callers must explicitly opt into conditional status references');
});

test('game presets preserve recorded order and inspect current equipment without changing real fleets or applying filters',()=>{
  const s=store();
  assert.deepEqual(F.presetList(s).items.map(p=>p.id),[1,2]);
  assert.deepEqual(F.presetList(s).items[1].ids,[2,1]);
  s.info.fleets[1].api_ship=[2];s.info.fleets[1].api_mission=[1,5,20000];
  const observed=JSON.stringify(s),r=F.inspect(s,1,2);assert.equal(r.heading.name,'远征预设');assert.equal(r.heading.status,'当前装备');
  assert.deepEqual(r.ships.map(s=>s.id),[2,1]);assert.deepEqual(r.ships[1].equipment.map(e=>e.id),[101,102,103]);assert.equal(JSON.stringify(s),observed);
  s.info.ships[1]={...s.info.ships[1],api_slot:[-1,-1],api_slot_ex:0};assert(!F.inspect(s,1,2).ships[1].equipment.some(e=>e.id>0));
  s.info.presets.api_deck[2].api_ship=[999,1];assert(F.inspect(s,1,2).ships[0].unknown);
  delete s.info.presets.api_deck[2];assert.equal(F.inspect(s,1,2).heading.status,'预设已移除');assert.equal(F.inspect(s,1,2).ships.length,0);
  s.info.presets={api_max_num:3,api_deck:{}};assert(F.presetList(s).synced);assert.deepEqual(F.presetList(s).items,[]);
  delete s.info.presets;assert(!F.presetList(s).synced);assert.equal(F.inspect(s,1,2).heading.status,'预设待同步');
});

test('fleet overview aggregates observed supplies and composition and identifies the actual ships needing attention',()=>{
  const s=store();s.info.fleets[0].api_ship=[1,2];
  s.info.ships[1].api_fuel=3;s.info.ships[1].api_nowhp=10;s.info.ships[1].api_cond=39;
  s.info.ships[2]={...s.info.ships[2],api_nowhp:30,api_maxhp:30};
  s.info.repairs=[{api_ship_id:1,api_complete_time:30000}];
  s.const.$ships[1].api_maxeq=[12,0];s.info.equips[101]={api_id:101,api_slotitem_id:500};
  s.const.$equips[500]={api_name:'舰战',api_type:[0,0,6,6]};s.info.ships[1].api_onslot=[3,0];
  const before=JSON.stringify(s),r=F.summarize(s,1);
  assert.deepEqual(r.composition,[{type:'轻巡',count:1},{type:'驱逐',count:1}]);
  assert.deepEqual(r.totals.fuel,{current:14,max:21});assert.deepEqual(r.totals.ammo,{current:21,max:21});
  assert.deepEqual(r.totals.aircraft,{current:3,max:12,slots:1});
  assert.deepEqual(r.signals.map(x=>[x.key,x.ships.map(s=>s.id)]),['supply','aircraft','fatigue','damage','repair'].map(k=>[k,[1]]));
  assert(r.signals.find(x=>x.key==='damage').danger);assert.equal(r.issues.length,1);assert(r.issues[0].reasons.includes('大破'));assert.equal(r.supplied,false);
  assert.equal(JSON.stringify(s),before);
  s.info.ships[1]={...s.info.ships[1],api_fuel:10,api_nowhp:40,api_cond:40,api_onslot:[12,0]};s.info.repairs=[];
  const full=F.summarize(s,1);assert.equal(full.supplied,true);assert.deepEqual(full.signals,[]);assert.deepEqual(full.issues,[]);
});

test('fleet overview never treats missing observations as fully supplied or missing aircraft as zero',()=>{
  const s=store();delete s.info.ships[1].api_fuel;delete s.info.ships[1].api_cond;delete s.info.equips[101];
  const r=F.summarize(s,1);assert.equal(r.supplied,false);assert.equal(r.totals.fuel.current,null);assert.equal(r.totals.aircraft.max,null);assert.equal(r.totals.aircraft.current,null);
  assert(r.unknown[0].reason.includes('补给'));assert(r.unknown[0].reason.includes('士气'));assert(r.unknown[0].reason.includes('舰载机'));
  s.info.fleets[1].api_ship=[];const empty=F.summarize(s,2);assert(!empty.supplied);assert.deepEqual(empty.composition,[]);assert.deepEqual(empty.issues,[]);
  s.info.fleets[2].api_ship=[999];const missing=F.summarize(s,3);assert(!missing.supplied);assert.equal(missing.unknown[0].id,999);assert.equal(missing.totals.fuel.max,null);
  delete s.info.fleets[3];assert.equal(F.summarize(s,4).totals.fuel.current,null);
});
test('read-only status UI switches live fleets, refreshes data and offers no scheme or game edit actions',t=>{
  let s=store(),index=0,tree,interval;const states=[],effects=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(v){const n=index++;if(!(n in states))states[n]=typeof v==='function'?v():v;return [states[n],v=>{states[n]=typeof v==='function'?v(states[n]):v;}];},
    useRef(v){const n=index++;return states[n]||(states[n]={current:v});},useEffect:fn=>effects.push(fn)};
  const Component=require('../../src/ui/fleet/current_fleet')(React,{getStore:()=>s});
  const render=(props={})=>{index=0;effects.length=0;tree=Component(props);return tree;};
  const find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children.map(c=>find(c,p)).find(Boolean));
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  render();assert(find(tree,n=>n.type==='h3'&&n.children.includes('舰队总览')));assert(!find(tree,n=>n.props['aria-label']==='全舰队动态'));for(const label of ['保存方案','已保存方案','JSON','编入','应用编成','换船','移除','新建'])assert(!text(tree).includes(label),label);
  assert(!find(tree,n=>n.type==='textarea'));assert(find(tree,n=>n.props['data-source-fleet']===4));
  assert(!text(tree).includes('舰种构成'));assert(!text(tree).includes('整备情况'));assert(!text(tree).includes('需要留意'));
  assert(!find(tree,n=>n.props['data-source-preset']===2));
  const presetToggle=find(tree,n=>n.props['aria-controls']==='paa-fleet-preset-list');assert.equal(presetToggle.props['aria-expanded'],false);
  assert.equal(presetToggle.type,'button');assert(presetToggle.props.className.includes('paa-preset-toggle'));
  assert(find(tree,n=>n.type==='h3'&&n.children.includes(presetToggle)),'preset fold remains a section heading at the same level as fleets');
  presetToggle.props.onClick();render();assert(find(tree,n=>n.props['aria-controls']==='paa-fleet-preset-list').props['aria-expanded']);
  assert(find(tree,n=>n.props['data-source-preset']===2));assert(!find(tree,n=>n.props.className==='paa-fleet-overview'));
  assert(!text(tree).includes('总耐久'));assert(!text(tree).includes('总等级'));
  assert(find(tree,n=>n.props['data-mechanism']==='expedition-morale'));
  const mechanisms=find(tree,n=>n.props['aria-label']==='战斗与远征机制');
  assert.deepEqual(mechanisms.children.slice(0,2).map(n=>n.props['data-mechanism']),['speed','expedition-morale']);
  assert(!find(tree,n=>n.props.className==='paa-fleet-mechanism-row'));
  assert.deepEqual(mechanisms.children.filter(n=>n.props['data-mechanism'].startsWith('expedition-')).map(n=>n.props['data-mechanism']),['expedition-morale','expedition-drums','expedition-income']);
  const metrics=find(tree,n=>n.props['aria-label']==='舰队状态指标');assert.equal(metrics.children.length,2);
  assert.deepEqual(metrics.children.map(n=>n.props.className),['paa-fleet-metric combat','paa-fleet-metric expedition']);
  const parts=find(metrics.children[0],n=>n.props.className==='paa-fleet-metric-parts');
  assert.deepEqual(parts.children.map(n=>n.props.className),['paa-fleet-metric-part speed','paa-fleet-metric-part los','paa-fleet-metric-part air']);
  const los=parts.children[1],scores=F.inspect(s,1).metrics.lineOfSight.scoresByCoefficient;
  assert(!find(tree,n=>n.type==='select'));assert.equal(los.children[1].children[0],scores[4].toFixed(1));assert.equal(los.props.tabIndex,0);
  for(const c of [1,2,3,4])assert(los.props['data-tooltip'].includes(`系数 ${c}${c===4?'（主显示）':''}：${scores[c].toFixed(1)}`));
  assert(!text(tree).includes('系数 4'));
  assert(!find(tree,n=>n.props.className==='paa-fleet-ship-stats'));assert(!find(tree,n=>n.props.id==='paa-fleet-supply-details'));
  const attrLabel='测试舰1：属性';find(tree,n=>n.props['aria-label']===attrLabel).props.onClick();render();
  const stats=find(tree,n=>n.props['aria-label']==='当前面板属性');assert.equal(stats.type,'dl');assert.equal(stats.children.length,8);
  assert.equal(stats.children[0].children[0].type,'dt');assert.equal(stats.children[0].children[1].type,'dd');
  assert(find(tree,n=>n.props['aria-label']===attrLabel).props['aria-expanded']);
  const fleetsBefore=JSON.stringify(s.info.fleets);
  find(tree,n=>n.props['data-source-preset']===2).props.onClick();render();assert(find(tree,n=>n.props['data-source-preset']===2).props['aria-pressed']);
  assert(!find(tree,n=>n.props['data-source-fleet']===1).props['aria-pressed']);assert(text(tree).includes('当前装备'));
  assert.equal(find(tree,n=>n.props.className==='paa-wb-ships').children.length,2);assert.equal(JSON.stringify(s.info.fleets),fleetsBefore);
  find(tree,n=>n.props['data-source-fleet']===2).props.onClick();render();assert(find(tree,n=>n.props.className==='paa-fleet-empty'));assert(find(tree,n=>n.props['data-source-fleet']===2).props['aria-pressed']);
  find(tree,n=>n.props['data-source-fleet']===1).props.onClick();render();assert(find(tree,n=>n.props['aria-label']===attrLabel).props['aria-expanded']);
  find(tree,n=>n.props['data-source-fleet']===2).props.onClick();render();
  t.mock.method(global,'setInterval',fn=>{interval=fn;return 123;});t.mock.method(global,'clearInterval',()=>{});
  const off=effects[0]();s={...s,info:{...s.info,fleets:s.info.fleets.map((f,i)=>i===1?{...f,api_ship:[1]}:f)}};interval();render();assert(!find(tree,n=>n.props.className==='paa-fleet-empty'));assert.equal(states[1],1);
  assert(find(tree,n=>n.props['aria-label']===attrLabel).props['aria-expanded']);
  find(tree,n=>n.props['data-source-preset']===2).props.onClick();render();
  s={...s,info:{...s.info,presets:{...s.info.presets,api_deck:{...s.info.presets.api_deck,2:{...s.info.presets.api_deck[2],api_name:'更新后的预设',api_ship:[1]}}}}};interval();render();
  assert(text(tree).includes('更新后的预设'));assert.equal(find(tree,n=>n.props.className==='paa-wb-ships').children.length,1);assert.equal(states[1],2);
  s={...s,info:{...s.info,presets:{...s.info.presets,api_deck:{1:s.info.presets.api_deck[1]}}}};interval();render();assert(text(tree).includes('预设已移除'));
  off();let stopped=0;render({busy:true,onStop:()=>stopped++});assert(find(tree,n=>n.props['data-source-fleet']===1).props.disabled);
  assert(find(tree,n=>n.props['data-source-preset']===1).props.disabled);
  find(tree,n=>n.type==='button'&&n.children.includes('停止操作')).props.onClick();assert.equal(stopped,1);
});

test('switching fleet sources preserves scrolled viewports when the next fleet is shorter',()=>{
  const s=store(),states=[],effects=[];let index=0,tree;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(v){const n=index++;if(!(n in states))states[n]=typeof v==='function'?v():v;return [states[n],v=>{states[n]=typeof v==='function'?v(states[n]):v;}];},
    useRef(v){const n=index++;return states[n]||(states[n]={current:v});},useEffect:()=>{},useLayoutEffect:fn=>effects.push(fn)};
  const Component=require('../../src/ui/fleet/current_fleet')(React,{getStore:()=>s});
  const render=(props={})=>{index=0;effects.length=0;tree=Component(props);};
  const find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children.map(c=>find(c,p)).find(Boolean));
  render();
  const viewport={scrollTop:150,scrollLeft:7,scrollHeight:1000,clientHeight:800,parentElement:null};
  const node={parentElement:viewport,style:{},ownerDocument:{defaultView:{getComputedStyle:()=>({overflowY:'auto'})}},getBoundingClientRect:()=>({height:920})};
  tree.props.ref.current=node;
  find(tree,n=>n.props['aria-controls']==='paa-fleet-preset-list').props.onClick();render();
  find(tree,n=>n.props['data-source-preset']===2).props.onClick();
  assert.equal(node.style.minHeight,'870px','retain enough extent for the current 150px scroll, without reserving the entire old fleet');
  viewport.scrollHeight=900;viewport.scrollTop=80;viewport.scrollLeft=0;render();effects.forEach(fn=>fn());
  assert.equal(node.style.minHeight,'971px','correct a remaining scroll-range deficit before paint, including collapsed margins');
  assert.equal(viewport.scrollTop,150);assert.equal(viewport.scrollLeft,7);
  assert(find(tree,n=>n.props['data-source-preset']===2).props['aria-pressed']);
  viewport.scrollTop=0;find(tree,n=>n.props['data-source-fleet']===2).props.onClick();render();effects.forEach(fn=>fn());
  assert.equal(node.style.minHeight,'');assert(find(tree,n=>n.props.className==='paa-fleet-empty'));
  node.style.minHeight='870px';render({hidden:true});effects.forEach(fn=>fn());assert.equal(node.style.minHeight,'');
  render({busy:true});find(tree,n=>n.props['data-source-preset']===1).props.onClick();render();
  assert(find(tree,n=>n.props['data-source-fleet']===2).props['aria-pressed'],'busy view cannot change its selection');
});
