'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {navigatePages,chooseEquipmentCategory,pageCost}=require('../../src/execution/picker_navigation');
function pageModel(total,initial,{fixedWindow=false,rightToEnd=false,swallow=false,wrongPage=false,skipClicks=[]}={}){
  let active=initial,windowPage=initial,reads=0;
  const inputs=[],visits=[active],states=[],window=p=>{
    const count=Math.min(5,total),first=Math.max(1,Math.min(p-2,total-count+1));
    return Array.from({length:count},(_,i)=>first+i);
  };
  const view=()=>({valid:true,activePage:active,labels:window(windowPage),centers:[740,794,848,902,956],y:677});
  states.push(active+':'+view().labels.join(','));
  return {inputs,visits,states,view,session:{async input(x,y){
    inputs.push([x,y]);if(swallow||skipClicks.includes(inputs.length))return;
    if(x===620){active=1;windowPage=1;}
    else if(x===1004){active=rightToEnd?total:Math.min(total,active+5);windowPage=active;}
    else {const index=view().centers.indexOf(x);assert(index>=0);active=view().labels[index];if(!fixedWindow)windowPage=active;}
    if(wrongPage)active=1;
    visits.push(active);
    states.push(active+':'+view().labels.join(','));
  }},stats:()=>({reads}),options:{total,first:[620,678],forward:[1004,678],read:async predicate=>{
    reads++;
    const value=view();if(!predicate(value))throw Error('Observation timed out: page');return value;
  }}};
}
test('all start/target pairs use unique progress in centered and retained number windows',async()=>{
  for(const fixedWindow of [false,true])for(let total=1;total<=35;total++)for(let start=1;start<=total;start++)for(let target=1;target<=total;target++){
    const f=pageModel(total,start,{fixedWindow});
    let result;try{result=await navigatePages(f.session,f.view(),target,f.options);}
    catch(error){throw Error(JSON.stringify({fixedWindow,total,start,target,visits:f.visits})+': '+error.message);}
    assert.equal(result.activePage,target);
    assert.equal(new Set(f.states).size,f.states.length,'an identical page window must never be revisited');
    assert(f.inputs.length<=Math.ceil(total/5)+5);
  }
});
test('nearby visible pages use a single number click instead of resetting to the beginning',async()=>{
  const f=pageModel(80,42);await navigatePages(f.session,f.view(),40,f.options);
  assert.equal(f.inputs.length,1);assert(f.inputs[0][0]!==620);
});
test('an already selected target produces no navigation input',async()=>{
  const f=pageModel(40,20);await navigatePages(f.session,f.view(),20,f.options);assert.equal(f.inputs.length,0);
});
test('long forward navigation batches four known arrow clicks between page observations',async()=>{
  const f=pageModel(100,1);await navigatePages(f.session,f.view(),46,f.options);
  assert.equal(f.inputs.length,9);assert.equal(f.stats().reads,3,'one calibration plus two four-click batches');
  assert.equal(f.visits.at(-1),46);
});
test('a missed batch click corrects from the observed page without replaying the batch',async()=>{
  const f=pageModel(100,1,{skipClicks:[2]});
  const result=await navigatePages(f.session,f.view(),46,f.options);
  assert.equal(result.activePage,46);assert.equal(f.inputs.length,10);assert.equal(f.stats().reads,7);
  assert(f.inputs.every(p=>p[0]===1004),'never reset to first or replay an entire batch');
});
test('a wholly swallowed batch stops before another input batch',async()=>{
  const f=pageModel(100,1,{skipClicks:[2,3,4,5]});
  await assert.rejects(navigatePages(f.session,f.view(),46,f.options),/timed out/);
  assert.equal(f.inputs.length,5);
});
test('cancellation between batch inputs prevents remaining clicks and later list selection',async()=>{
  const f=pageModel(100,1),input=f.session.input.bind(f.session);
  f.session.input=async(...args)=>{if(f.inputs.length===2)throw Error('Run stopped');await input(...args);};
  await assert.rejects(navigatePages(f.session,f.view(),46,f.options),/Run stopped/);
  assert.equal(f.inputs.length,2);assert.equal(f.stats().reads,1);
});
test('a legacy right-arrow endpoint is accepted only when it exposes the target',async()=>{
  const f=pageModel(40,1,{rightToEnd:true});await navigatePages(f.session,f.view(),39,f.options);
  assert.equal(f.inputs.length,2);assert.deepEqual(f.visits,[1,40,39]);
  const bad=pageModel(40,1,{rightToEnd:true});
  await assert.rejects(navigatePages(bad.session,bad.view(),17,bad.options),/Unexpected picker page movement/);
  assert.equal(bad.inputs.length,1,'never bounce back to the first page and repeat');
});
test('swallowed and wrong-direction page clicks stop without repeated inputs',async()=>{
  for(const option of [{swallow:true},{wrongPage:true}]){
    const f=pageModel(40,11,option);
    await assert.rejects(navigatePages(f.session,f.view(),25,f.options),/timed out|Unexpected|repeated|inconsistent/);
    assert.equal(f.inputs.length,1);
  }
});
test('inconsistent page observations and out-of-range targets fail before any input',async()=>{
  for(const patch of [{labels:[2,4,5]},{activePage:41},{centers:[]},{valid:false}]){
    const f=pageModel(40,5);await assert.rejects(navigatePages(f.session,{...f.view(),...patch},10,f.options),/does not match/);assert.equal(f.inputs.length,0);
  }
  const f=pageModel(4,1);await assert.rejects(navigatePages(f.session,f.view(),5,f.options),/Invalid picker target/);assert.equal(f.inputs.length,0);
});
function categoryFixture(){
  const all=Array.from({length:900},(_,i)=>({id:i+1})),specific=all.slice(830,850);
  return {planner:{categoryFor:()=>({id:4}),categoryAccepts:id=>[0,4].includes(id),
    freePickerList:id=>id===0?all:specific,otherPickerList:id=>id===0?all:specific}};
}
test('a long all-equipment list switches to the exact-instance category when fewer clicks suffice',()=>{
  const {planner}=categoryFixture(),f=pageModel(90,1);
  const choice=chooseEquipmentCategory(planner,{category:0,read:f.view(),item:847,ship:1,slot:0});
  assert.equal(choice.id,4);assert.equal(choice.page,2);assert.equal(choice.list[16].id,847);assert.equal(choice.clicks,3);
});
test('an immediately available target keeps the retained category without menu clicks',()=>{
  const {planner}=categoryFixture(),f=pageModel(90,85);
  const choice=chooseEquipmentCategory(planner,{category:0,read:f.view(),item:847,ship:1,slot:0});
  assert.equal(choice.id,0);assert.equal(choice.clicks,0);assert(choice.retained);
});
test('borrow selection uses its own exact live inventory and never substitutes an equal name',()=>{
  const {planner}=categoryFixture();planner.freePickerList=()=>{throw Error('wrong inventory');};
  const choice=chooseEquipmentCategory(planner,{category:0,read:pageModel(90,1).view(),item:847,ship:1,slot:0,borrow:true});
  assert.equal(choice.id,4);assert(choice.list.some(e=>e.id===847));
  assert.throws(()=>chooseEquipmentCategory(planner,{category:0,read:pageModel(90,1).view(),item:999,ship:1,slot:0,borrow:true}),/missing/);
});
test('the cost estimate treats current and visible target pages as zero and one click',()=>{
  const f=pageModel(40,20);assert.equal(pageCost(f.view(),20,40),0);assert.equal(pageCost(f.view(),18,40),1);
});
