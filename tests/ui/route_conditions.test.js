'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setLocale}=require('../../src/shared/i18n');
const {describeCondition}=require('../../src/ui/models/route_conditions');
const {requirementDetails}=require('../../src/domain/routes/route_plans');
const leaf=(expression,text='原始条件')=>({operator:null,expression,text,children:[]});
test('route condition translations preserve nested operators, boundaries and original names',()=>{
 const tree={operator:'all',text:'原始复合条件',children:[
  leaf({count:{stypes:[2],min:2}}),
  {operator:'any',children:[leaf({los:{coefficient:4,gte:63,lt:70}}),
    {operator:'not',children:[leaf({speedAtLeast:'fastPlus'})]}]},
  leaf({shipName:{prefixes:['神風','羽黒']}})
 ]};
 const before=JSON.stringify(tree);
 try{
  setLocale('ja-JP');const ja=describeCondition(tree);
  assert.match(ja,/駆逐艦が2隻以上/);assert.match(ja,/係数 4.*≥ 63.*< 70/);assert.match(ja,/満たさない/);
  assert.match(ja,/高速\+以上/);assert.match(ja,/神風\/羽黒/);
  setLocale('zh-TW');const tw=describeCondition(tree);
  assert.match(tw,/驅逐至少 2 艘/);assert.match(tw,/係數 4.*≥ 63.*< 70/);assert.match(tw,/不滿足/);
  assert.match(tw,/高速\+以上/);assert.match(tw,/神風\/羽黒/);
  setLocale('zh-CN');assert.equal(describeCondition(tree),'原始复合条件');
  assert.equal(JSON.stringify(tree),before);
 }finally{setLocale('zh-CN');}
});
test('unknown conditions and legacy trees remain unknown rather than being invented',()=>{
 try{
  setLocale('ja-JP');assert.equal(describeCondition(leaf({unknown:'尚未确认的条件'})),'未確認の条件');
  assert.equal(describeCondition(leaf({futureKnownRule:{gte:5}},'原有明确条件 ≥ 5')),'原有明确条件 ≥ 5');
  assert.equal(describeCondition({operator:null,text:'外部自由文本',children:[]}),'外部自由文本');
  assert.equal(describeCondition(leaf({speedAtLeast:'unknown-speed'},'未知速力')),'未知速力');
 }finally{setLocale('zh-CN');}
});
test('real route requirements are isolated from rendering and preserve probabilities and evaluation',()=>{
 const paths=['A','D','F','J','N'];
 const original=requirementDetails('2-3',paths,null,null,{structured:true}),before=JSON.stringify(original);
 const rules=original.flatMap(p=>p.rules),leafs=[];
 const visit=n=>{if(!n.operator)leafs.push(n);else n.children.forEach(visit);};
 for(const rule of rules)visit(rule.conditionTree);
 assert(leafs.length>0);assert(rules.some(r=>Number.isFinite(r.chance)),'exercise the real probability rules');
 try{
  setLocale('ja-JP');leafs.forEach(describeCondition);setLocale('zh-TW');leafs.forEach(describeCondition);
  assert.equal(JSON.stringify(original),before,'translations must not mutate any rule or match state');
  const mutable=leafs.find(n=>n.expression&&typeof n.expression==='object');
  if(mutable){mutable.expression.__localizationProbe=true;const fresh=requirementDetails('2-3',paths,null,null,{structured:true});
   assert(!JSON.stringify(fresh).includes('__localizationProbe'),'display data must not expose mutable rule objects');}
 }finally{setLocale('zh-CN');}
});
