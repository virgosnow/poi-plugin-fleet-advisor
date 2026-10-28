'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Session}=require('../../src/execution/session');
const {enterScreen}=require('../../src/execution/navigation');

function harness(initial,options={}) {
  let now=0,mode=initial,captures=0,cancelled=false;
  const inputs=[];
  const host={check(){if(options.checkError&&inputs.length)throw Error(options.checkError);},cancel(){cancelled=true;},
    async capture(){captures++;if(options.captureError&&(!options.afterInput||inputs.length))throw Error('capture failed');return {valid:mode!=='unknown',mode};},
    async input(input){inputs.push(input);if(options.onInput)mode=options.onInput(input,inputs.length,mode);else mode=({30:'equipment',62:'home',107:'home',292:'organization',477:'equipment'})[input.x];}};
  const observer={async observe(kind,frame){assert.equal(kind,'screen');if(options.workerError)throw Error('worker failed');return options.frame?options.frame({now,captures,inputs,frame}):frame;}};
  const session=new Session(host,observer,{now:()=>now});
  session.wait=async ms=>{session.check();now+=ms;session.check();};
  return {session,inputs,stats:()=>({now,captures,cancelled})};
}

for(const from of ['home','organization','equipment'])for(const to of ['home','organization','equipment'])
test(`navigation ${from} -> ${to} uses only confirmed base screens`,async()=>{
  const f=harness(from);await enterScreen(f.session,to);
  const expected=from===to?[]:from==='organization'&&to==='equipment'?[30]:[...(from==='home'?[]:[107]),...(to==='home'?[]:[to==='organization'?292:477])];
  assert.deepEqual(f.inputs.map(i=>i.x),expected);assert(f.inputs.every(i=>!i.mutation));assert(f.stats().captures>=2);
});
test('organization side shortcut confirms the equipment fleet without visiting home',async()=>{
  const f=harness('organization',{frame:({frame})=>frame.mode==='equipment'?{...frame,fleet:2}:frame});
  const result=await enterScreen(f.session,'equipment');
  assert.deepEqual(f.inputs.map(i=>[i.x,i.y]),[[30,390]]);assert.equal(result.fleet,2);assert.equal(f.stats().captures,4);
});
test('a swallowed side shortcut retries only after confirming the organization base',async()=>{
  const f=harness('organization',{onInput:(_input,n)=>n===1?'organization':'equipment'});
  await enterScreen(f.session,'equipment');assert.deepEqual(f.inputs.map(i=>i.x),[30,30]);
});
test('a side shortcut covered by an unexpected overlay stops before further clicks',async()=>{
  const f=harness('organization',{onInput:()=> 'unknown'});
  await assert.rejects(enterScreen(f.session,'equipment'),/无法识别/);assert.equal(f.inputs.length,1);
});

test('unknown starting screen gets no input',async()=>{
  const f=harness('unknown');await assert.rejects(enterScreen(f.session,'equipment'),/无法识别当前画面/);assert.equal(f.inputs.length,0);
});
test('slow four-second captures still require two matching frames before returning',async()=>{
  let time=0,captures=0,inputs=[];
  const session=new Session({check(){},cancel(){},capture:async()=>{time+=4000;captures++;return {};},input:async input=>inputs.push(input)},
    {observe:async()=>inputs.length?{valid:true,mode:'home'}:{valid:true,mode:'port-return',returnButton:{x:62,y:58}}},{now:()=>time});
  session.wait=async ms=>{time+=ms;};
  await enterScreen(session,'home');assert.equal(captures,4);assert.equal(inputs.length,1);assert.equal(inputs[0].x,62);
});
test('slow invalid captures have a bounded navigation deadline and never authorize input',async()=>{
  let time=0,captures=0,inputs=0;
  const session=new Session({check(){},cancel(){},capture:async()=>{time+=4000;captures++;return {};},input:async()=>inputs++},
    {observe:async()=>({valid:false,mode:'unknown'})},{now:()=>time});
  session.wait=async ms=>{time+=ms;};
  await assert.rejects(enterScreen(session,'home'),/无法识别/);assert.equal(inputs,0);assert.equal(captures,5);
});

const returnFrame=frame=>frame.mode==='unknown'?{valid:true,mode:'port-return',returnButton:{page:'supply',x:62,y:58}}:frame;
for(const target of ['home','organization','equipment'])test('non-home title returns once before entering '+target,async()=>{
  const f=harness('unknown',{frame:({frame})=>returnFrame(frame)});
  await enterScreen(f.session,target);
  assert.deepEqual(f.inputs.map(i=>[i.x,i.y]),[[62,58],...(target==='home'?[]:[[target==='organization'?292:477,target==='organization'?202:339]])]);
  assert(f.inputs.every(i=>!i.mutation));assert(f.stats().captures>=4);
});
test('failed return is never followed by a second click on the hide-UI coordinate',async()=>{
  const f=harness('unknown',{frame:({frame})=>returnFrame(frame),onInput:()=> 'unknown'});
  await assert.rejects(enterScreen(f.session,'equipment'),/未重复点击/);
  assert.equal(f.inputs.length,1);
});
test('a transient return button does not authorize input',async()=>{
  const f=harness('unknown',{frame:({captures,frame})=>captures===1?returnFrame(frame):frame});
  await assert.rejects(enterScreen(f.session,'equipment'),/无法识别/);assert.equal(f.inputs.length,0);
});
test('recognizable home takes precedence and never clicks the return circle',async()=>{
  const f=harness('home',{frame:({frame})=>({...frame,returnButton:{page:'supply',x:62,y:58}})});
  await enterScreen(f.session,'equipment');assert.deepEqual(f.inputs.map(i=>i.x),[477]);
});
test('return button with an unexpected location is rejected',async()=>{
  const f=harness('unknown',{frame:()=>({valid:true,mode:'port-return',returnButton:{page:'supply',x:20,y:20}})});
  await assert.rejects(enterScreen(f.session,'home'),/无法识别/);assert.equal(f.inputs.length,0);
});
test('navigation returns the fleet from the same stable equipment-screen frames',async()=>{
  const f=harness('home',{frame:({frame})=>frame.mode==='equipment'?{...frame,fleet:3}:frame});
  assert.deepEqual(await enterScreen(f.session,'equipment'),{valid:true,mode:'equipment',fleet:3});
  assert.equal(f.stats().captures,4);assert.equal(f.inputs.length,1);
});
test('a changing equipment fleet must stabilize before navigation returns',async()=>{
  const f=harness('equipment',{frame:({frame,captures})=>({...frame,fleet:captures===1?1:2})});
  assert.equal((await enterScreen(f.session,'equipment')).fleet,2);
  assert.equal(f.stats().captures,3);assert.equal(f.inputs.length,0);
});
for(const to of ['organization','equipment']) {
  test(`${to} entry retries a swallowed click only after confirming home`,async()=>{
    const f=harness('home',{onInput:(input,n)=>n===1?'home':to});await enterScreen(f.session,to);assert.equal(f.inputs.length,2);assert(f.inputs.every(i=>i.x!==107));
  });
  test(`${to} entry stops after three swallowed clicks`,async()=>{
    const f=harness('home',{onInput:()=> 'home'});await assert.rejects(enterScreen(f.session,to),/3 次/);assert.equal(f.inputs.length,3);
  });
}
test('late arrival after navigation timeout does not cause another click',async()=>{
  const f=harness('home',{onInput:()=> 'home',frame:({now,inputs,frame})=>inputs.length&&now>=6100?{valid:true,mode:'equipment'}:frame});
  await enterScreen(f.session,'equipment');assert.equal(f.inputs.length,1);
});
test('overlay appearing after entry is not followed by a home or retry click',async()=>{
  const f=harness('home',{onInput:()=> 'unknown'});await assert.rejects(enterScreen(f.session,'equipment'),/无法识别当前画面/);assert.equal(f.inputs.length,1);
});
test('unexpected recognized destination stops instead of attempting recovery',async()=>{
  const f=harness('home',{onInput:()=> 'organization'});await assert.rejects(enterScreen(f.session,'equipment'),/意外变化/);assert.equal(f.inputs.length,1);
});
test('a single recognized frame amid unknown frames cannot authorize a click',async()=>{
  const f=harness('unknown',{frame:({captures,frame})=>captures===2?{valid:true,mode:'home'}:frame});
  await assert.rejects(enterScreen(f.session,'equipment'),/无法识别当前画面/);assert.equal(f.inputs.length,0);
});
for(const options of [{captureError:true},{workerError:true},{captureError:true,afterInput:true},{checkError:'Run stopped'},{checkError:'Store drift'}])
test('navigation does not retry after '+JSON.stringify(options),async()=>{
  const f=harness('home',options);await assert.rejects(enterScreen(f.session,'equipment'),/capture failed|worker failed|Run stopped|Store drift/);
  assert.equal(f.inputs.length,options.afterInput||options.checkError?1:0);assert(f.stats().cancelled);
});
