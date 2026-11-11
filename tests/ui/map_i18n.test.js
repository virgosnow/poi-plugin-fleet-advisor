'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const i18n=require('../../src/shared/i18n');
const localized=require('../../src/ui/maps/map_localization');
const picker=require('../../src/ui/components/route_picker');
const preview=require('../../src/ui/maps/route_preview');
const formations=require('../../src/ui/maps/node_formations');
const routes=require('../../src/domain/routes/route_plans');
const {previewForMap}=require('../../src/domain/routes/sortie_profile');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
const text=node=>node==null?'':typeof node==='string'||typeof node==='number'?String(node):
  typeof node==='object'?(node.children||[]).map(text).join(''):'';

test('route names follow stable route keys and do not change grouping, paths, or adaptive names',()=>{
  const options=routes.recommendedOptions('1-4'),original=JSON.stringify(options);
  const option=options.find(row=>row.key==='guide:1-4-01'),order=picker.routeGroups(options).flatMap(row=>row.options.map(x=>x.key));
  assert(option);
  try{
    i18n.setLocale('ja-JP');assert.equal(localized.routeName(option),'中・軽空母編成');
    assert.equal(localized.phaseLabel('第 2 阶段'),'第 2 段階');
    assert.deepEqual(picker.routeGroups(options).flatMap(row=>row.options.map(x=>x.key)),order);
    const renamed={...option,name:'上路直达洗地流'};
    assert.equal(localized.routeName(renamed),'上ルート空襲編成','a changed name must not reuse the old preset translation');
    i18n.setLocale('zh-TW');assert.equal(localized.routeName(option),'中路輕母流');
    assert.equal(localized.phaseLabel('第 2 阶段'),'第 2 階段');
    assert.equal(JSON.stringify(options),original);
  }finally{i18n.setLocale('zh-CN');}
});

test('map translation retains combat values, source paths, and game enemy identities',()=>{
  const profile=previewForMap('1-4'),before=JSON.stringify(profile),source=formations.nodeFormations('1-4','H');
  const air=formations.landBaseAirState({power:{min:100,max:100}},{landBaseAirPower:60});
  try{
    i18n.setLocale('ja-JP');
    const tree=preview(h,{profile,nodeId:'H',showDetails:true,compact:true,nodePopup:true,enemyPortrait:()=>null});
    assert.match(text(tree),/敵編成/);
    assert.equal(localized.airState(air),'推定航空優勢');
    const enemy=source[0].ships.find(row=>row.apiId);
    assert(enemy);assert.notEqual(localized.enemyName(enemy),enemy.name);
    assert.equal(localized.enemyName({apiId:999999,name:'待确认'}),'待确认','unknown game names must not be translated as UI text');
    assert.equal(localized.enemyName({apiId:1587,name:'北方栖姬',familyKey:'北方棲姫'}),'北方棲姫','aggregated families must not become an individual variant');
    assert.equal(localized.airbaseName({id:1,name:'第 1 航空队',nameIsFallback:true}),'第1航空隊');
    assert.equal(localized.airbaseName({id:1,name:'第 1 航空队',nameIsFallback:false}),'第 1 航空队','game-provided names must remain unchanged');
    i18n.setLocale('zh-TW');assert.equal(localized.airState(air),'預計空優');
    assert.equal(formations.landBaseAirState({power:{min:100,max:100}},{landBaseAirPower:60}),air);
    assert.deepEqual(formations.nodeFormations('1-4','H'),source);
    assert.equal(JSON.stringify(profile),before);
  }finally{i18n.setLocale('zh-CN');}
});
