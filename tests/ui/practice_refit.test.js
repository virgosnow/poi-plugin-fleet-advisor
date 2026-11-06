'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
function setup(){
 const store=fixture(),states=[],refs=[];let si=0,ri=0,resolve,reject,request;
 store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',ships:[{masterId:1,level:50}]}],revision:1};store.questState={known:true,tasks:[]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
  useRef:value=>refs[ri++]||(refs[ri-1]={current:value}),useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];}};
 const service={preview:()=>({}),createSnapshot:()=>({snapshotId:'x'}),recommendPracticeFleet:(args,onProgress)=>{request=args;return new Promise((yes,no)=>{resolve=yes;reject=no;});}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const render=()=>{si=0;ri=0;return Page({kind:'practice',automaticOperations:false});};
 const clickReplacement=()=>{let tree=render();walk(tree).filter(n=>n.props.className==='paa-wb-replace')[1].props.onClick();tree=render();
  const popup=walk(tree).find(n=>n.props['aria-label']==='替换舰娘'),row=walk(popup).find(n=>n.type==='button'&&n.props.key===3);assert(row,'replacement ship is available');return row.props.onClick();};
 return {store,states,render,walk,clickReplacement,get request(){return request;},get resolve(){return resolve;},get reject(){return reject;}};
}
test('replacing a practice ship refits only the selected fleet and preserves held slots',async()=>{
 const h=setup(),held={...W.entry(h.store,1),slots:[10,-1],keep:{0:true},pin:false};h.states[0]=[held,W.entry(h.store,2),null,null,null,null];
 const pending=h.clickReplacement();assert.equal(h.states[0][1].id,3);assert.equal(h.states[0][1].pin,true);
 assert(h.walk(h.render()).some(n=>n.props.className==='paa-wb-calculating paa-wb-fleet-overlay'));
 await new Promise(r=>setTimeout(r,35));assert.equal(h.request.equipmentOnly,true);assert.equal(h.request.capacity,2);
 assert.deepEqual(h.request.slots.map(s=>s.id),[1,3]);assert(h.request.slots.every(s=>s.pin));assert.deepEqual(h.request.slots[0].keep,{0:true});
 h.resolve({scheme:{fleet:1,ships:[{id:1,slots:[10,11],ex:-1},{id:3,slots:[12,13],ex:-1}]}});await pending;
 assert.deepEqual(h.states[0].filter(Boolean).map(s=>s.id),[1,3]);assert.deepEqual(h.states[0][0].slots,[10,11]);
 assert.deepEqual(h.states[0][0].keep,{0:true});assert.equal(h.states[0][0].pin,false);assert.deepEqual(h.states[0][1].slots,[12,13]);
 assert(!h.walk(h.render()).some(n=>n.props.className==='paa-wb-calculating paa-wb-fleet-overlay'));
});
test('a failed practice refit keeps the replacement and reports the error',async()=>{
 const h=setup();h.states[0]=[W.entry(h.store,1),W.entry(h.store,2),null,null,null,null];const pending=h.clickReplacement();
 await new Promise(r=>setTimeout(r,35));h.reject(new Error('库存不足'));await pending;
 assert.deepEqual(h.states[0].filter(Boolean).map(s=>s.id),[1,3]);assert(h.walk(h.render()).some(n=>n.children?.includes('自动配装未完成：库存不足')));
});
test('adding a practice ship retains worn equipment without starting a refit',async()=>{
 const h=setup();h.store.info.ships[3].api_slot=[103,-1];h.states[0]=[W.entry(h.store,1),null,null,null,null,null];
 let tree=h.render();h.walk(tree).find(n=>n.props.className==='paa-wb-empty').props.onClick();tree=h.render();
 const popup=h.walk(tree).find(n=>n.props['aria-label']==='替换舰娘');
 await h.walk(popup).find(n=>n.type==='button'&&n.props.key===3).props.onClick();
 assert.equal(h.states[0][1].id,3);assert.deepEqual(h.states[0][1].slots,[103,-1]);assert.equal(h.request,undefined);
 assert(!h.walk(h.render()).some(n=>n.props.className==='paa-wb-calculating paa-wb-fleet-overlay'));
});
