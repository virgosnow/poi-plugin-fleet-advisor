'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const workbenches=tree=>{
  const found=[];const visit=node=>{if(!node||typeof node!=='object')return;if(['Workbench','CurrentFleet'].includes(node.type?.name))found.push(node);for(const child of node.children||[])visit(child);};
  visit(tree);return found;
};

test('experimental automation is opt-in, autosaves near its switch and preserves workbench instances',()=>{
  const E=require('../../src/config/experimental_settings');let saved=E.normalize(),cursor=0;const states=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
      return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef:value=>({current:value}),useEffect:()=>{}};
  const service={getExperimentalSettings:()=>saved,setExperimentalSettings:value=>(saved=E.normalize(value))};
  const Panel=require('../../src/ui/shell/panel')(React,{getController:()=>service,getStore:()=>({}),subscribe:()=>()=>{}});
  const render=()=>{cursor=0;return Panel();};
  const find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children?.map(c=>find(c,p)).find(Boolean));
  const toggle=tree=>find(tree,n=>n.props['aria-label']==='自动操作开关');
  let tree=render();const instances=workbenches(tree).map(n=>[n.type,n.props.key]);
  assert.equal(toggle(tree).props['aria-checked'],'false');
  assert(workbenches(tree).every(n=>n.props.automaticOperations===false));
  toggle(tree).props.onClick();tree=render();assert.equal(saved.automaticOperations,true);
  assert(workbenches(tree).every(n=>n.props.automaticOperations===true));
  assert.deepEqual(workbenches(tree).map(n=>[n.type,n.props.key]),instances);
  service.setExperimentalSettings=()=>{throw Error('无法写入');};
  toggle(tree).props.onClick();tree=render();assert.equal(toggle(tree).props['aria-checked'],'true');
  const section=find(tree,n=>n.props['aria-label']==='实验功能');
  assert(find(section,n=>n.props.role==='alert'&&n.props['data-tooltip']==='无法写入'));
  states[1]=true;tree=render();assert.equal(toggle(tree).props.disabled,true);
  toggle(tree).props.onClick();assert.equal(saved.automaticOperations,true);
});
test('sortie and expedition exclusion controls autosave separately and propagate without unmounting drafts',()=>{
  const F=require('../../src/config/recommendation_filters');
  let saved=F.normalize(),cursor=0;const state=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},
    useRef:v=>({current:v}),useEffect:()=>{}};
  const service={getRecommendationFilters:()=>saved,setRecommendationFilters:v=>(saved=F.normalize(v))};
  const Panel=require('../../src/ui/shell/panel')(React,{getController:()=>service,getStore:()=>({}),subscribe:()=>()=>{}});
  const render=()=>{cursor=0;return Panel();};
  const find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children?.map(c=>find(c,p)).find(Boolean));
  let tree=render();const original=workbenches(tree).map(n=>n.type);
  const control=label=>find(tree,n=>n.props['aria-label']===label);
  assert.equal(control('出击设置最低等级').props.value,30);assert.equal(control('远征设置等级限制').props.checked,false);
  assert.equal(control('出击设置：排除未改造舰').props.checked,true);assert.equal(control('远征设置：排除未改造舰').props.checked,false);
  control('出击设置最低等级').props.onChange({target:{value:'60'}});tree=render();
  assert.equal(saved.normal.minLevel,60);assert.equal(saved.expedition.minLevel,0);
  control('远征设置：排除未改造舰').props.onChange({target:{checked:true}});tree=render();
  assert(saved.expedition.excludeUnremodeled);
  const goalButton=label=>find(control('远征默认目标'),n=>n.type==='button'&&n.children.includes(label));
  assert.equal(goalButton('优先大成功').props['aria-pressed'],true);
  goalButton('成功即可').props.onClick();tree=render();
  assert.equal(saved.expedition.defaultGoal,'success');
  assert.equal(goalButton('成功即可').props['aria-pressed'],true);
  assert.equal(goalButton('优先大成功').props['aria-pressed'],false);
  assert.equal(workbenches(tree).find(n=>n.props.kind==='expedition').props.automaticFilters.defaultGoal,'success');
  assert.equal(workbenches(tree)[0].props.automaticFilters.minLevel,60);
  assert(workbenches(tree).every((n,i)=>n.type===original[i]));
  service.setRecommendationFilters=()=>{throw Error('磁盘不可写');};
  control('出击设置最低等级').props.onChange({target:{value:'99'}});tree=render();
  assert.equal(control('出击设置最低等级').props.value,60,'failed save must not update controls');
  const level=find(tree,n=>n.props.className==='paa-selection-level'&&find(n,c=>c.props['aria-label']==='出击设置最低等级'));
  assert(find(level,n=>n.props.role==='alert'&&n.props['data-tooltip']==='磁盘不可写'));
  assert(!find(tree,n=>n.props.className==='paa-settings-notice'));
  control('回到主页').props.onClick();tree=render();
  assert.equal(saved.normal.minLevel,60);assert(saved.expedition.excludeUnremodeled,'home retains persisted preferences');
  assert.equal(saved.expedition.defaultGoal,'success');
  assert(!find(tree,n=>n.props.role==='alert'),'home clears transient failures');
});
test('settings navigation preserves drafts and MCP controls keep their actions after layout changes',async()=>{
  const state=[],ports=[],toggles=[];let index=0,changes=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;
      return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef:value=>({current:value}),useEffect:()=>{}};
  let resetCalls=0;
  const service={resetRecommendationSettings:async()=>{resetCalls++;return {filters:require('../../src/config/recommendation_filters').normalize(),computation:{maintenance:{failed:0}}};}};
  const Panel=require('../../src/ui/shell/panel')(React,{getController:()=>service,getStore:()=>({}),subscribe:()=>()=>{},
    getMcpStatus:()=>({mcpEnabled:true,mcpHttp:{wanted:47615,active:true,address:'http://127.0.0.1:47615/mcp'}}),
    setMcpEnabled:value=>{changes++;toggles.push(value);},setMcpHttpPort:value=>{changes++;ports.push(value);return {active:true};}});
  const render=()=>{index=0;return Panel();};
  const find=(node,predicate)=>{if(!node||typeof node!=='object')return;return predicate(node)?node:node.children?.map(n=>find(n,predicate)).find(Boolean);};
  let tree=render();const original=workbenches(tree);
  assert.equal(original.length,3);
  assert.equal(find(tree,n=>n.props['aria-label']==='设置面板').props.hidden,true);
  assert(!find(tree,n=>n.props['aria-label']==='恢复默认设置'),'global reset only appears while viewing settings');
  assert(!find(tree,n=>n.props['aria-label']==='设置').children.includes('设置'),'the collapsed control stays icon-only');
  find(tree,n=>n.props['aria-label']==='设置').props.onClick();tree=render();
  assert.equal(find(tree,n=>n.props['aria-label']==='设置面板').props.hidden,false);
  assert(workbenches(tree).every((n,i)=>n.props.hidden&&n.type===original[i].type&&n.props.key===original[i].props.key));
  assert(find(tree,n=>n.props['aria-label']==='AI 工具接入（MCP）'));
  const settings=find(tree,n=>n.props['aria-label']==='设置面板');
  const experiments=find(settings,n=>n.props['aria-label']==='实验功能');
  const agent=find(experiments,n=>n.props['aria-label']==='AI 工具接入（MCP）');
  assert(agent,'MCP is grouped with automatic operations under experimental features');
  assert(!agent.props.className.includes('paa-settings-card'),'peer switches share one card');
  assert(find(experiments,n=>n.props['aria-label']==='自动操作开关'));
  assert(find(find(agent,n=>n.props.className==='paa-settings-row paa-experimental-mcp-head'),n=>n.props['aria-label']==='AI 工具接入（MCP）说明'));
  for(const label of ['HTTP 端口说明','连接地址说明'])assert(!find(settings,n=>n.props['aria-label']===label),'MCP details share section help');
  assert(!JSON.stringify(tree).includes('方案填写与操作说明'));
  assert(!find(tree,n=>n.props['aria-label']==='MCP 访问令牌'));
  find(tree,n=>n.type==='button'&&n.children.includes('当前舰队')).props.onClick();tree=render();
  assert.equal(workbenches(tree).find(n=>n?.props?.kind==='manual').props.hidden,false);
  assert.equal(find(tree,n=>n.props['aria-label']==='设置面板').props.hidden,true);
  assert.equal(changes,0);
  find(tree,n=>n.props['aria-label']==='MCP HTTP 端口').props.onChange({target:{value:'47616'}});tree=render();
  find(tree,n=>n.type==='button'&&n.children.includes('应用端口')).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));tree=render();
  assert.deepEqual(ports,[47616]);const portRow=find(tree,n=>n.props.className==='paa-agent-control');
  assert(find(portRow,n=>n.props.role==='status'&&n.props['data-tooltip']==='端口已保存并生效。'));
  find(tree,n=>n.props['aria-label']==='MCP 接入开关').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(toggles,[false]);
  tree=render();const keys=workbenches(tree).map(n=>n.props.key);
  assert(!find(tree,n=>n.props['aria-label']==='恢复默认设置'),'leaving settings removes its reset action');
  find(tree,n=>n.props['aria-label']==='设置').props.onClick();tree=render();
  const nav=find(tree,n=>n.props.className==='paa-tabs');
  const actions=find(nav,n=>n.props.className==='paa-settings-reset-actions');
  const reset=find(actions,n=>n.props['aria-label']==='恢复默认设置');assert(reset);
  const tools=find(nav,n=>n.props['aria-label']==='设置操作');
  assert.equal(tools.props['data-expanded'],true);
  assert.equal(tools.children[1],actions,'reset and settings share one frame');
  assert(find(tools,n=>n.props['aria-label']==='设置').children.includes('设置'));
  assert(reset.children.includes('恢复默认'),'reset uses a visible text label');
  assert(!find(tree,n=>n.props.className==='paa-settings-heading'),'settings body has no standalone action row');
  assert.match(reset.props['data-tooltip'],/出击、远征、计算和缓存/,'the top action clearly applies to all recommendation settings');
  await reset.props.onClick();tree=render();
  assert.equal(resetCalls,1);assert.equal(changes,2,'global reset never invokes Agent switch or port setters');
  assert.deepEqual(workbenches(tree).map(n=>n.props.key),keys,'reset preferences preserves fleet drafts');
  assert(find(find(tree,n=>n.props.className==='paa-settings-reset-actions'),n=>n.props['data-tooltip']==='已恢复出击、远征、计算和缓存默认设置'));
});

test('real recommendation work runs off the UI thread and preserves calculation results',async()=>{
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
  const store=require('../helpers/workbench_fixture')(),before=JSON.stringify(store);
  const runner=new RecommendationWorker();let ticks=0;
  const timer=setInterval(()=>ticks++,1);
  try{
    for(const [method,args] of [
      ['recommendNormalFleet',{area:'1-3',byRoute:true,fleet:1,limit:1}],
      ['recommendExpeditionFleet',{missionId:1,fleet:2,limit:1}],
      ['recommendNormalEquipment',{area:'1-1',scheme:{fleet:1,ships:[{id:2,slots:[-1,-1]}]}}],
      ['recommendExpeditionEquipment',{missionId:1,scheme:{fleet:2,ships:[{id:2,slots:[-1,-1]}]}}]
    ]){
      const pending=runner.run(method,store,args);
      await Promise.resolve();assert(runner.active.worker.threadId>0);
      const result=await pending;
      if(method==='recommendExpeditionFleet'){const pair=require('../../src/recommendation/index').recommendExpeditionGoals(store,args);assert.deepEqual(result,{...pair.success,goals:pair});}
      else assert.deepEqual(result,require('../../src/recommendation/index')[method](store,args));
    }
    assert(ticks>2,'UI timers keep running while real recommendations are pending');
    assert.equal(JSON.stringify(store),before);
  }finally{clearInterval(timer);await runner.dispose();}
});

test('recommendation worker failures release the queue and disposal cancels running and queued work',async()=>{
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
  const store=require('../helpers/workbench_fixture')(),runner=new RecommendationWorker();
  try{
    await assert.rejects(runner.run('recommendNormalFleet',store,{area:'99-99'}));
    assert((await runner.run('recommendNormalFleet',store,{area:'1-1'})).recommendations.length);
    const active=runner.run('recommendNormalFleet',store,{area:'1-3',byRoute:true});
    const queued=runner.run('recommendNormalFleet',store,{area:'1-1'});
    const assertions=Promise.all([active,queued].map(p=>assert.rejects(p,e=>e.code==='RECOMMENDATION_CANCELLED')));
    await Promise.resolve();await runner.dispose();await assertions;
    await assert.rejects(runner.run('recommendNormalFleet',store,{area:'1-1'}),e=>e.code==='RECOMMENDATION_CANCELLED');
    assert.equal(runner.active,null);
  }finally{await runner.dispose();}
});

test('home resets all draft instances and inline execution feedback preserves stop and errors',async()=>{
  const state=[],refs=[];let index=0,refIndex=0,finish,stops=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;
      return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef:value=>{const i=refIndex++;return refs[i]||(refs[i]={current:value});},useEffect:()=>{}};
  const controller={getExperimentalSettings:()=>({automaticOperations:true}),preview:()=>({done:false}),run:()=>new Promise(resolve=>{finish=resolve;}),stop:()=>{stops++;}};
  const Panel=require('../../src/ui/shell/panel')(React,{getController:()=>controller,getStore:()=>({}),subscribe:()=>()=>{}});
  const find=(node,predicate)=>{if(!node||typeof node!=='object')return;return predicate(node)?node:node.children?.map(n=>find(n,predicate)).find(Boolean);};
  const render=()=>{index=0;refIndex=0;return Panel();};
  const home=tree=>find(tree,n=>n.props['aria-label']==='回到主页');
  const normal=tree=>workbenches(tree).find(n=>n.props.kind==='normal');
  const feedback=tree=>{const node=normal(tree).props.operationFeedback;return node?node.type(node.props):null;};
  let tree=render();assert.equal(feedback(tree),null);
  assert.equal(workbenches(tree).find(n=>!n.props.hidden).props.kind,'manual');
  const tabs=find(tree,n=>n.props.className==='paa-tabs');
  assert.deepEqual(tabs.children.slice(1,-1).map(n=>n.children[0]),['当前舰队','常规海域','远征']);
  find(tree,n=>n.type==='button'&&n.children.includes('常规海域')).props.onClick();tree=render();
  assert.equal(find(tree,n=>n.props.className==='paa-activity'),undefined);
  assert.equal(find(tree,n=>n.props.className==='paa-card paa-execution'),undefined);
  const nav=find(tree,n=>n.props.className==='paa-tabs');
  assert.equal(nav.children[0],home(tree));assert.equal(nav.children.at(-1).props['aria-label'],'设置操作');
  assert(find(nav.children.at(-1),n=>n.props['aria-label']==='设置'));
  const original=workbenches(tree).map(n=>n.props.key);
  const running=normal(tree).props.onApply({fleet:1,ships:[1]});
  tree=render();assert.equal(feedback(tree).props['data-state'],'running');
  assert(find(tree,n=>n.props.className==='paa-run-mask'));
  assert(workbenches(tree).every(n=>n.props.busy&&typeof n.props.onStop==='function'));
  assert(home(tree).props.disabled);home(tree).props.onClick();tree=render();
  assert.deepEqual(workbenches(tree).map(n=>n.props.key),original,'home cannot reset an executing operation');
  finish({ok:false,done:false});await running;tree=render();
  assert.equal(feedback(tree).props['data-state'],'error');assert(find(feedback(tree),n=>n.props.role==='alert'));
  assert(find(feedback(tree),n=>n.type==='details'));
  assert.equal(find(tree,n=>n.props.className==='paa-run-mask'),undefined);
  const success=normal(tree).props.onApply({fleet:1,ships:[1]});
  finish({ok:true,done:true,changed:2});await success;tree=render();
  assert.equal(feedback(tree).props['data-state'],'success');
  const stopping=normal(tree).props.onApply({fleet:1,ships:[1]});
  tree=render();normal(tree).props.onStop();tree=render();
  assert.equal(stops,1);assert.equal(feedback(tree).props['data-state'],'stopping');
  assert(workbenches(tree).every(n=>n.props.stopping));
  finish({ok:false,done:false});await stopping;tree=render();
  assert.equal(feedback(tree).props['data-state'],'stopped');
  find(tree,n=>n.props['aria-label']==='设置').props.onClick();tree=render();
  home(tree).props.onClick();tree=render();
  assert.equal(workbenches(tree).find(n=>!n.props.hidden).props.kind,'manual');assert.equal(feedback(tree),null);
  assert(workbenches(tree).every((n,i)=>n.props.key!==original[i]),'all three drafts remount from their initial state');
  assert(find(tree,n=>n.props['aria-label']==='设置面板').props.hidden);
});

test('home remounts every workbench while preserving all global settings and the computation settings instance',()=>{
  const filters=require('../../src/config/recommendation_filters').normalize({normal:{minLevel:77,maxRoutes:3},expedition:{minLevel:22,excludeUnremodeled:true}});
  const computation={threads:8,resultCache:false,calculationCache:true,cacheLimitMiB:256},cache={results:{bytes:1234,files:2},calculations:{bytes:5678,files:3}};
  const savedSchemes=[{name:'保留的编成',scheme:{fleet:3,ships:[{id:2}]}}],mutations=[];
  const forbid=name=>()=>{mutations.push(name);throw Error('Home must not modify '+name);};
  const service={getRecommendationFilters:()=>filters,getComputationStatus:()=>({settings:computation,cache}),
    resetRecommendationSettings:forbid('defaults'),setRecommendationFilters:forbid('filters'),setComputationSettings:forbid('computation'),
    clearRecommendationCache:forbid('cache'),querySchemes:()=>({total:1,items:savedSchemes})};
  let cursor=0;const states=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
      return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef:value=>({current:value}),useEffect:()=>{}};
  const Panel=require('../../src/ui/shell/panel')(React,{getController:()=>service,getStore:()=>({}),subscribe:()=>()=>{},
    getMcpStatus:()=>({mcpEnabled:true,mcpHttp:{wanted:47619,active:true,address:'http://127.0.0.1:47619/mcp'}}),
    setMcpEnabled:forbid('MCP switch'),setMcpHttpPort:forbid('MCP port')});
  const find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children?.map(c=>find(c,p)).find(Boolean));
  const render=()=>{cursor=0;return Panel();};
  let tree=render();
  const initialWorkbenches=workbenches(tree),settings=find(tree,n=>n.type?.name==='ComputationSettings');
  const before=JSON.stringify({filters,computation,cache,savedSchemes});
  for(const page of ['常规海域','远征','当前舰队','设置']){
    const previousKeys=workbenches(tree).map(n=>n.props.key);
    find(tree,n=>n.type==='button'&&(n.children.includes(page)||n.props['aria-label']===page)).props.onClick();tree=render();
    find(tree,n=>n.props['aria-label']==='回到主页').props.onClick();tree=render();
    assert(workbenches(tree).every((n,i)=>n.props.key!==previousKeys[i]&&n.type===initialWorkbenches[i].type));
    assert.equal(workbenches(tree).find(n=>n.props.kind==='manual').props.hidden,false);
    assert(workbenches(tree).filter(n=>n.props.kind!=='manual').every(n=>n.props.hidden));
    const currentSettings=find(tree,n=>n.type?.name==='ComputationSettings');
    assert.equal(currentSettings.type,settings.type);assert.equal(currentSettings.props.key,settings.props.key);
    assert.equal(find(tree,n=>n.props['aria-label']==='出击设置最低等级').props.value,77);
    assert.equal(find(tree,n=>n.props['aria-label']==='远征设置最低等级').props.value,22);
    assert.equal(find(tree,n=>n.props['aria-label']==='MCP HTTP 端口').props.value,'47619');
    assert.equal(find(tree,n=>n.props['aria-label']==='MCP 接入开关').props['aria-checked'],'true');
    assert.equal(JSON.stringify({filters,computation,cache,savedSchemes}),before);
  }
  assert.deepEqual(mutations,[]);
});
