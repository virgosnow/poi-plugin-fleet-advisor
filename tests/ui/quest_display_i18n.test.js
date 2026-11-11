'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../../src/ui/shared_catalog');
const {setLocale}=require('../../src/shared/i18n');
const display=require('../../src/ui/i18n/quest_display');
test('known task goals and fleet constraints use locale-aware templates without translating raw game text',()=>{
  try{
    setLocale('ja-JP');
    assert.equal(display.goal('1-5 Boss S胜 1次',true),'1-5 ボス S勝利 1回');
    assert.equal(display.goal('本周演习A胜以上 4次',true),'今週演習A勝以上 4回');
    assert.equal(display.goal('B4号远征大成功 1次',true),'遠征 B4大成功 1回');
    assert.equal(display.goal('1-5 Boss S胜 1次',false),'1-5 Boss S胜 1次');
    assert.equal(display.check('旗舰：驱逐 ≥2艘'),'旗艦：駆逐艦 ≥2隻');
    assert.equal(display.check('旗舰：雪風 ≥1艘'),'旗艦：雪風 ≥1隻');
    assert.equal(display.destination({kind:'expedition',missionId:113,label:'B4号远征'}),'遠征 B4');
    assert.equal(display.destination({kind:'normal',label:'雪風'}),'雪風');
    assert.equal(display.goal('击沉运输舰 3艘',true),'輸送艦を3隻撃沈');
    assert.equal(display.goal('2-1／2-2 Boss合计B胜以上 5次',true),'2-1／2-2のボスでB勝以上合計 5回');
    assert.match(display.check('任选：重巡／航巡 ≥1艘，驱逐 ≥2艘，舰数＝5 或 驱逐 ≥4艘，舰数＝6'),/いずれか：.*または/);
    assert.equal(display.check('陽炎型／夕雲型且驱逐且等级≥75 ≥2艘'),'陽炎型／夕雲型かつ駆逐艦かつレベル≥75 ≥2隻');
    assert.equal(display.check('美国舰／英国舰／澳大利亚舰／荷兰舰 ≥2艘'),'米国艦／英国艦／豪州艦／オランダ艦 ≥2隻');
    assert.match(display.check('高速战舰／战舰／舰种12 ≥2艘'),/艦種12/);
    assert.equal(display.reward({name:'开发资材'}),'開発資材');
    setLocale('zh-TW');
    assert.equal(display.goal('2-3 抵达Boss 1次',true),'2-3 抵达Boss 1次'); // Unknown exact format is preserved.
    assert.equal(display.goal('2-3抵达Boss 1次',true),'2-3抵達Boss 1次');
    assert.equal(display.check('舰数≥6'),'艦數≥6');
    assert.equal(display.check('弹药≥300（领取消耗）'),'彈藥≥300（領取時消耗）');
    assert.equal(display.check('阳炎型／夕云型且等级≥70 ≥4艘'),'陽炎型／夕雲型且等級≥70 ≥4艘');
    assert.equal(display.reward({name:'开发资材'}),'開發資材');
    setLocale('zh-CN');
    assert.equal(display.goal('1-5 Boss S胜 1次',true),'1-5 Boss S胜 1次');
  }finally{setLocale('zh-CN');}
});
test('running operation card localizes visible and accessible progress without changing state',()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useState:()=>[null,()=>{}],useEffect:()=>{}};
  const card=require('../../src/ui/components/execution_card')(React,{getStore:()=>({info:{fleets:[]}})});
  try{
    setLocale('ja-JP');
    const tree=card({running:true,fleet:1,index:0,ship:1});
    assert.equal(tree.props['data-state'],'waiting');
    assert.equal(tree.props['aria-label'],'編成の進行状況');
    assert.equal(tree.props['aria-valuetext'],'編成待ち');
    assert.equal(tree.children[0].children[1],'編成待ち');
  }finally{setLocale('zh-CN');}
});

test('structured task fleet rules localize from stable IDs instead of parsing Chinese labels',()=>{
  const destroyers={kind:'count',positions:[1],selector:{kind:'shipType',stypeIds:[2]},min:2};
  const alternatives={anyOf:[{kind:'count',selector:{kind:'country',code:'US'},min:1},{kind:'count',selector:{kind:'ship',name:'雪風'},min:1}]};
  try{
    setLocale('zh-CN');assert.equal(display.fleetRule(destroyers),'旗舰：驱逐 ≥2艘');assert.match(display.fleetRule(alternatives),/美国舰/);
    setLocale('ja-JP');assert.equal(display.fleetRule(destroyers),'旗艦：駆逐艦 ≥2隻');assert.match(display.fleetRule(alternatives),/米国艦/);
    setLocale('zh-TW');assert.equal(display.fleetRule(destroyers),'旗艦：驅逐艦 ≥2艘');assert.match(display.fleetRule(alternatives),/美國艦/);
    assert.match(display.fleetRule(alternatives),/雪風/);
  }finally{setLocale('zh-CN');}
});
test('multi-class quest conditions use class IDs even when source names are simplified Chinese',()=>{
  const rule=ids=>({kind:'count',selector:{kind:'shipClass',ctypeIds:ids,name:'未翻译的来源文字'},min:1});
  try{
    setLocale('ja-JP');assert.equal(display.fleetRule(rule([38,30])),'陽炎型／夕雲型 ≥1隻');
    assert.equal(display.fleetRule(rule([91,87])),'Fletcher級／John C.Butler級 ≥1隻');
    assert.equal(display.fleetRule(rule([128,70,129,79])),'フランス艦 ≥1隻');
    setLocale('zh-TW');assert.equal(display.fleetRule(rule([30,38])),'陽炎型／夕雲型 ≥1艘');
    assert.equal(display.fleetRule(rule([70,79,128,129])),'法國艦 ≥1艘');
  }finally{setLocale('zh-CN');}
});
test('all catalog goals format from structured fields and match reviewed translations',()=>{
  const {goalLabel}=require('../../src/domain/quests/quest_requirements');
  const quests=[...require('../../data/quests/requirements.json').quests,...require('../../data/quests/limited').flatMap(event=>event.quests.filter(quest=>['B','C','D'].includes(quest.category)))];
  try{
    for(const locale of ['ja-JP','zh-TW']){
      setLocale(locale);
      for(const quest of quests)for(const goal of quest.goals||[]){
        const original=goalLabel(goal,{period:quest.period});
        assert.equal(display.structuredGoal({...goal,label:'different source wording'},quest.period),display.goal(original,true),`${locale} ${quest.code} ${goal.kind}`);
      }
    }
  }finally{setLocale('zh-CN');}
});
