'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Session}=require('../../src/execution/session');
const {Controller}=require('../../src/application/controller');

test('extra wait is additive for every input, never for recognition polling, and retains full state checks',async()=>{
  for(const operationWaitMs of [0,300,800]){
    let time=0,checks=0,inputs=0,captures=0;const waits=[];
    const s=new Session({check(){checks++;},cancel(){},input:async()=>inputs++,capture:async()=>{time+=100;captures++;return {}; }},
      {observe:async()=>({valid:true})},{now:()=>time,operationWaitMs});
    s.wait=async ms=>{waits.push(ms);time+=ms;};let validations=0;s.validate=()=>validations++;
    await s.input(1,1,undefined,'click',{settleMs:0});await s.input(2,2,undefined,'hover');
    assert.deepEqual(waits,operationWaitMs?[operationWaitMs,operationWaitMs+40]:[40]);
    assert.equal(inputs,2);assert.equal(validations,4);
    const before=waits.length;await s.until('screen',{});
    assert.equal(waits.length,before);assert.equal(captures,2);assert(checks>=8);
    let drift=true;s.validate=()=>{if(drift)throw Error('state drift');};
    await assert.rejects(s.input(3,3),/state drift/);assert.equal(inputs,2);drift=false;
  }
});

test('extra wait is cancellable and cannot permit a second input after stop',async()=>{
  let inputs=0,waiting;
  const s=new Session({check(){},cancel(){},input:async()=>inputs++},{},{operationWaitMs:800});
  const wait=s.wait.bind(s);s.wait=ms=>{waiting=ms;return wait(ms);};
  const pending=s.input(1,1,undefined,'click',{settleMs:0});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(waiting,800);s.stop();
  await assert.rejects(pending,/stopped/);await assert.rejects(s.input(2,2),/stopped/);assert.equal(inputs,1);
  for(const operationWaitMs of [-1,100,500,'300',Infinity])assert.throws(()=>new Session({}, {},{operationWaitMs}),/Invalid extra/);
});

test('controller passes the selected wait to combined and standalone execution sessions before any input',async t=>{
  const data=require('../helpers/workbench_fixture')();let seen=0;
  data.info.fleets[1].api_ship=[1,2];
  data.info.ships[1].api_slot=[101,-1];data.info.ships[2].api_slot=[102,-1];
  for(const id of [101,102])data.info.equips[id]={api_slotitem_id:1,api_level:0,api_alv:0};
  data.const.$equips[1]={api_name:'gun',api_type:[0,0,1,1]};
  for(const type of [2,3])data.const.$shipTypes[type]={api_equip_type:{1:1}};
  t.mock.method(Session.prototype,'until',async function(){assert.equal(this.operationWaitMs,800);seen++;throw Error('offline stop before input');});
  for(const kind of ['fleet','organization','equipment']){
    const c=new Controller({getStore:()=>data,
      createHost:()=>({getStore:()=>data,check(){},cancel(){},start:async()=>{},dispose:async()=>{},input(){assert.fail('No real or simulated input needed');}}),
      createObserver:()=>({start:async()=>{},dispose:async()=>{}})});
    const scheme=kind==='organization'?{fleet:2,ships:[2,1]}:{fleet:2,ships:[{id:1,slots:[102]},{id:2,slots:[101]}]};
    await assert.rejects(c.run(kind,scheme,{operationWaitMs:800}),/offline stop before input/);
  }
  assert.equal(seen,3);
});

test('all wait levels apply equally to controls, images and the image handoff, without adding recognition waits',async()=>{
  for(const operationWaitMs of [0,300,800])for(const mode of ['controls','image','handoff']){
    let time=0,inputs=0,checks=0;const waits=[];
    const host={check(){checks++;},cancel(){},input:async()=>{inputs++;},capture:async()=>{time+=100;return Buffer.from('mock');}};
    const image={observe:async()=>({valid:true})},controls={read:async()=>{time+=100;return {valid:true};},prepareInput:async i=>({x:i.x,y:i.y})};
    const s=new Session(host,mode==='image'?image:controls,{now:()=>time,operationWaitMs});
    s.wait=async ms=>{waits.push(ms);time+=ms;};
    for(let i=0;i<4;i++){
      if(mode==='handoff'&&i===2)s.useImageObserver(image);
      await s.input(1,1,undefined,i%2?'hover':'click',i%2?{}:{settleMs:0});
      const before=waits.length;await s.until('screen',{});assert.equal(waits.length,before,'extra wait must not be added to polling');
    }
    assert.deepEqual(waits,operationWaitMs?[operationWaitMs,operationWaitMs+40,operationWaitMs,operationWaitMs+40]:[40,40]);
    assert.equal(s.operationWaitMs,operationWaitMs);assert.equal(inputs,4);assert(checks>=8);
  }
});
