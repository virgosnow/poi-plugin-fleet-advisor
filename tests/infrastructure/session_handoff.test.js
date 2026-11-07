'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {captureHandoff,restoreHandoff,watchGap}=require('../../src/infrastructure/sync/session_handoff');
function fixture(){
  const store={info:{basic:{api_member_id:1}}};
  const item=name=>({revision:1,restored:[],view:()=>({}),hasComplete:()=>false,snapshot:()=>({name}),restore(value){this.restored.push(value);}});
  const quest=item('quest'),practice=item('practice'),basic=item('basic'),reader={sessionKey:'opaque',verifiedSessionKey:'opaque',context:async()=>({ready:true,identityVerified:true,sessionKey:'opaque'})};
  basic.restoreRelocations=function(value){this.restored.push(value);};
  const args={reader,quest,practice,basic,getStore:()=>store};
  return {...args,store,value:captureHandoff({...args,store})};
}
test('matching account and document restore only stale task rows, without attempted ledgers',async()=>{
  const f=fixture();assert.deepEqual(Object.keys(f.value).sort(),['basic','quest','sessionKey','version']);
  assert.equal(await restoreHandoff({...f,value:f.value}),true);
  assert.equal(f.quest.restored.length,1);assert.equal(f.quest.restored[0].complete,false);
  assert.equal(f.practice.restored.length,0);assert.equal(f.basic.restored.length,0);
});
test('only an uninterrupted hot reload may restore the relocation list',async()=>{
  for(const event of [null,'game.request','game.response','game.start','network.error']){
    const f=fixture(),window=new EventTarget();watchGap(window,f.value);
    if(event)window.dispatchEvent(new Event(event));
    f.value.finishGap();assert.equal(await restoreHandoff({...f,value:f.value}),true);
    assert.equal(f.basic.restored.length,event?0:1);
  }
});
test('new basic data during session verification wins over the handoff',async()=>{
  const f=fixture();f.value.gapSafe=true;
  f.reader.context=async()=>{f.basic.revision++;return {ready:true,identityVerified:true,sessionKey:'opaque'};};
  await restoreHandoff({...f,value:f.value});assert.equal(f.basic.restored.length,0);
});
test('a different document, account or closed instance never inherits a cache',async()=>{
  for(const changed of ['session','closed']){
    const f=fixture();if(changed==='session')f.reader.context=async()=>({ready:true,identityVerified:true,sessionKey:'other'});
    assert.equal(await restoreHandoff({...f,value:f.value,isCurrent:()=>changed!=='closed'}),false);
    assert.equal(f.quest.restored.length+f.practice.restored.length+f.basic.restored.length,0);
  }
});
test('new natural data arriving during identity verification wins independently per data type',async()=>{
  const f=fixture();f.reader.context=async()=>{f.quest.revision++;return {ready:true,identityVerified:true,sessionKey:'opaque'};};
  assert.equal(await restoreHandoff({...f,value:f.value}),true);
  assert.equal(f.quest.restored.length,0);assert.equal(f.practice.restored.length,0);assert.equal(f.basic.restored.length,0);
});
test('an account not verified against the active game session is not handed off',()=>{
  const f=fixture();f.reader.verifiedSessionKey=null;assert.equal(captureHandoff({...f,store:f.store}),null);
});
test('an unverified account cannot receive previously observed task rows',async()=>{
  const f=fixture();f.reader.context=async()=>({ready:true,identityVerified:false,sessionKey:'opaque'});
  assert.equal(await restoreHandoff({...f,value:f.value}),false);assert.equal(f.quest.restored.length,0);
});
