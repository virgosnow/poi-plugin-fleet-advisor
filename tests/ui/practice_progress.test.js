'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
const {createCalculationProgress}=require('../../src/ui/components/calculation_progress');
test('shared calculation progress identifies practice stages and remains an estimate',()=>{
 const progress=createCalculationProgress();
 assert.match(progress.update({stage:'prepare'}),/准备舰队资料与计算环境 · 预计总进度 1%/);
 assert.match(progress.update({stage:'practice'}),/筛选演习编成与配装 · 预计总进度 5%/);
 assert.match(progress.tick(),/筛选演习编成与配装 · 预计总进度 [0-9]+%/);
 assert.match(progress.update({stage:'finalize'}),/核对结果 · 预计总进度 95%/);
});
test('practice recommendation blocks the retained cards with shared progress until it completes',async()=>{
 const store=fixture(),states=[],refs=[];let si=0,ri=0,resolve,reject,report;
 store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',ships:[{masterId:1,level:10}]}],revision:1};store.questState={known:true,tasks:[]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
  useRef:value=>refs[ri++]||(refs[ri-1]={current:value}),
  useState(initial){const at=si++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const service={preview:()=>({}),createSnapshot:()=>({snapshotId:'test'}),recommendPracticeFleet:(args,onProgress)=>{report=onProgress;return new Promise((yes,no)=>{resolve=yes;reject=no;});}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const render=()=>{si=0;ri=0;return Page({kind:'practice',automaticOperations:false});};
 let tree=render();assert.equal(walk(tree).find(n=>n.props.className==='paa-wb-complete').props.disabled,true);
 await walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();assert.equal(report,undefined);
 walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
 assert.equal(walk(tree).find(n=>n.props.className==='paa-wb-complete').props.disabled,false);
 const run=walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();
 tree=render();let result=walk(tree).find(n=>n.props.className==='paa-wb-fleet-results');
 assert.equal(tree.props['data-calculating'],true);const left=walk(tree).find(n=>n.props.className==='paa-wb-left');
 assert.equal(left.props['aria-busy'],true);assert.equal(left.props.inert,'');
 assert.equal(result.props['aria-busy'],true);assert.equal(walk(result).find(n=>n.props.className==='paa-wb-fleet-results-content').props.inert,'');
 assert(walk(result).some(n=>n.props.className==='paa-wb-calculating paa-wb-fleet-overlay'));
 assert.equal(walk(result).filter(n=>n.props.className==='paa-wb-empty').length,6);
 await new Promise(done=>setTimeout(done,35));assert.equal(typeof report,'function');
 report({stage:'practice'});tree=render();let progress=walk(tree).find(n=>n.type?.name==='CalculationProgress');
 assert.match(progress.props.channel.value,/筛选演习编成与配装 · 预计总进度 5%/);
 report({stage:'finalize'});assert.match(progress.props.channel.value,/核对结果 · 预计总进度 95%/);
 resolve({scheme:{ships:[W.entry(store,1)]},enemyKnown:true});await run;tree=render();
 assert(!walk(tree).some(n=>n.props.className==='paa-wb-calculating paa-wb-fleet-overlay'));
 assert.equal(tree.props['data-calculating'],false);assert.equal(walk(tree).find(n=>n.props.className==='paa-wb-left').props.inert,undefined);
 assert(walk(tree).some(n=>n.props['data-ship-id']===1));
 const second=walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();await new Promise(done=>setTimeout(done,35));reject(new Error('测试异常'));await second;
 tree=render();assert(!walk(tree).some(n=>n.props.className==='paa-wb-calculating paa-wb-fleet-overlay'));
 assert(walk(tree).some(n=>n.children?.includes('测试异常')));
});
