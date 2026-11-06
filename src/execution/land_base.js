'use strict';
const {planLandBases,assertExecutable}=require('../domain/fleet/land_base_execution_plan');
const {baseInventory}=require('../domain/fleet/land_base_inventory');
const {enterScreen}=require('./navigation');

async function navigateBase(session,area,stage,controlId){
  const c=await session.until('airbase-navigation',{stage,area},reading=>reading.valid,6000);
  await session.input(c.point.x,c.point.y,undefined,'click',{settleMs:0,controlId});
}

async function selectBase(session,area,base,previousBase){
  if(!session.controlMode||!Number.isSafeInteger(area)||!Number.isSafeInteger(base)||!Number.isSafeInteger(previousBase))
    throw Error('基地控件识别不可用');
  await session.until('airbase-panel',{area,base:previousBase},reading=>reading.valid,6000);
  if(previousBase===base)return;
  const tab=await session.until('airbase-tab',{area,base},reading=>reading.valid,6000);
  await session.input(tab.point.x,tab.point.y,undefined,'click',{settleMs:0,controlId:'airbase.tab.'+base});
  await session.until('airbase-panel',{area,base},reading=>reading.valid,6000);
}

async function openBaseFromArea(session,area,base){
  if(!session.controlMode||!Number.isSafeInteger(area)||!Number.isSafeInteger(base))throw Error('基地控件识别不可用');
  await session.until('airbase-area',{},reading=>reading.valid&&reading.area===area,6000);
  await navigateBase(session,area,'open','airbase.nav.open');
  const panel=await session.until('airbase-panel',{area},reading=>reading.valid,6000);
  if(panel.base!==base)await selectBase(session,area,base,panel.base);
}

async function enterBase(session,area,base){
  if(!session.controlMode||!Number.isSafeInteger(area)||!Number.isSafeInteger(base))throw Error('基地控件识别不可用');
  await enterScreen(session,'home');
  const navigate=(stage,controlId)=>navigateBase(session,area,stage,controlId);
  await navigate('sortie','airbase.nav.sortie');
  await navigate('choose-sortie','airbase.nav.choose-sortie');
  let selected=await session.until('airbase-area',{},reading=>reading.valid,6000);
  if(selected.area!==area){await navigate('area','airbase.nav.area.'+area);
    selected=await session.until('airbase-area',{},reading=>reading.valid&&reading.area===area,6000);}
  await openBaseFromArea(session,area,base);
}

async function closeBase(session,area,base){
  const close=await session.until('airbase-close-clean',{area,base},reading=>reading.valid,6000);
  await session.input(close.point.x,close.point.y,undefined,'click',{settleMs:0,controlId:'airbase.close'});
  await session.until('airbase-area',{},reading=>reading.valid&&reading.area===area,6000);
}

// Move a ready aircraft within its base. A destination aircraft must also be
// ready, and both exact instances are pinned until the final state is read.
async function swapAircraftPositions(session,context){
  const {area,base,from,to,itemId,targetItemId=0}=context||{};
  if(!Number.isSafeInteger(area)||!Number.isSafeInteger(base)||!Number.isSafeInteger(from)||
    !Number.isSafeInteger(to)||from<1||from>4||to<1||to>4||from===to||!Number.isSafeInteger(itemId)||itemId<=0||
    !Number.isSafeInteger(targetItemId)||targetItemId<0||targetItemId===itemId)
    throw Error('基地飞机移动目标无效');
  await session.until('airbase-swap',context,reading=>reading.valid,6000);
  const mutation={path:'api_req_air_corps/set_plane',area,base,slot:to,item:itemId};
  await session.drag(mutation);
  // A matching request alone does not prove success; wait for both the game
  // model and poi store to agree. A timeout never repeats the submission.
  await session.until('airbase-swap-done',context,reading=>reading.valid,10000);
  session.confirmMutation();
  return {ok:true,changed:1};
}
function moveAircraftToEmptySlot(session,context){
  if(context?.targetItemId>0)throw Error('基地飞机目标槽不是空槽');
  return swapAircraftPositions(session,context);
}

// The game cycles the tag locally; the action request is sent only when the
// base panel closes. Other bases' pending edits must be rejected at commit.
async function changeBaseAction(session,{area,base,currentMode,mode}={}){
  if(!Number.isSafeInteger(area)||!Number.isSafeInteger(base)||!Number.isInteger(currentMode)||currentMode<0||currentMode>4||
    !Number.isInteger(mode)||mode<0||mode>4)throw Error('基地行动方式无效');
  if(currentMode===mode)return {ok:true,changed:0};
  await session.until('airbase-action-start',{area,base,mode:currentMode},reading=>reading.valid,6000);
  let current=currentMode;
  while(current!==mode){
    const tag=await session.until('airbase-action',{area,base,mode:current},reading=>reading.valid,6000);
    await session.input(tag.point.x,tag.point.y,undefined,'click',{settleMs:0,controlId:'airbase.action'});
    current=(current+1)%5;
    await session.until('airbase-action',{area,base,mode:current},reading=>reading.valid,6000);
  }
  // The observer rechecks every other base and pending name immediately
  // before it permits the close control to submit the single pinned request.
  await session.input(600,360,{path:'api_req_air_corps/set_action',area,base,mode},'click',{settleMs:0,controlId:'airbase.close'});
  await session.until('airbase-action-done',{area,base,mode},reading=>reading.valid,10000);
  session.confirmMutation();
  return {ok:true,changed:1};
}

// Select an exact warehouse instance through the native picker. Occupied
// slots require the displaced aircraft's relocation to be observed as well.
async function placeStockAircraft(session,context){
  const {area,base,slot,itemId}=context||{};
  if(!Number.isSafeInteger(area)||!Number.isSafeInteger(base)||!Number.isSafeInteger(slot)||slot<1||slot>4||
    !Number.isSafeInteger(itemId)||itemId<=0)throw Error('基地飞机配置目标无效');
  if(context.resumePicker!==true){
    const open=await session.until('airbase-slot',context,reading=>reading.valid,6000);
    await session.input(open.point.x,open.point.y,undefined,'click',{settleMs:0,controlId:'airbase.slot.'+slot});
  }
  let list=await session.until('airbase-catalog',context,reading=>reading.valid,6000);
  const record=stage=>{try{session.onDiagnostic?.({phase:'land-base-picker',stage,category:list.category,page:list.page,
    targetPage:list.targetPage,visiblePages:list.pages.map(row=>row.page),next:!!list.nextPages,previous:!!list.previousPages});}catch(_){}};
  record('opened');
  const visited=new Set([list.category]);
  while(list.targetPage===null){
    const next=list.categories.find(row=>!visited.has(row.category));
    if(!next)throw Error('飞机不在可选择的基地装备列表中');
    visited.add(next.category);
    await session.input(next.point.x,next.point.y,undefined,'click',{settleMs:0,controlId:'airbase.category.'+next.category});
    list=await session.until('airbase-catalog',context,reading=>reading.valid&&reading.category===next.category,6000);
    record('category');
  }
  const groups=new Set();
  while(list.page!==list.targetPage){
    const page=list.pages.find(row=>row.page===list.targetPage);
    if(page){
      await session.input(page.point.x,page.point.y,undefined,'click',{settleMs:0,controlId:'airbase.page.'+page.page});
      list=await session.until('airbase-catalog',context,reading=>reading.valid&&reading.page===page.page,6000);
      record('page');
      continue;
    }
    const labels=list.pages.map(row=>row.page),signature=JSON.stringify([list.page,labels]);
    if(!labels.length||groups.has(signature)||groups.size>=30)throw Error('基地飞机页码无法安全定位');
    groups.add(signature);
    const direction=list.targetPage>Math.max(...labels)?'next':list.targetPage<Math.min(...labels)?'previous':null;
    const point=direction==='next'?list.nextPages:direction==='previous'?list.previousPages:null;
    if(!point)throw Error('基地飞机目标页超出当前可确认的页码范围');
    await session.input(point.x,point.y,undefined,'click',{settleMs:0,controlId:'airbase.'+direction+'-pages'});
    list=await session.until('airbase-catalog',context,reading=>reading.valid&&
      JSON.stringify([reading.page,reading.pages.map(row=>row.page)])!==signature,6000);
    record('page-group');
  }
  const rowContext={...context,category:list.category,page:list.page,row:list.targetRow};
  const row=await session.until('airbase-row',rowContext,reading=>reading.valid,6000);
  await session.input(row.point.x,row.point.y,undefined,'click',{settleMs:0,controlId:'airbase.row.'+list.targetRow});
  const confirmation=await session.until('airbase-selection',context,reading=>reading.valid,6000);
  await session.input(confirmation.point.x,confirmation.point.y,
    {path:'api_req_air_corps/set_plane',area,base,slot,item:itemId},'click',{settleMs:0,controlId:'airbase.confirm'});
  const done=await session.until('airbase-stock-done',context,reading=>reading.valid,10000);
  session.confirmMutation();
  return {ok:true,changed:1,state:done.state};
}

// A single-base transaction for a currently open base panel. Validate every
// requested operation before the first click; unsupported removal must not be
// discovered only after other planes have already been moved.
async function configureOpenBase(session,{area,base:target,resumeSlot=0,verifiedInventory}={}){
  const initial=session.host.getStore(),currentInventory=baseInventory(initial.info);
  const verified=Array.isArray(verifiedInventory)&&currentInventory&&JSON.stringify(verifiedInventory)===JSON.stringify(currentInventory);
  const planning=initial.airbaseSync?.complete===true?initial:verified?
    {...initial,airbaseSync:{...initial.airbaseSync,complete:true}}:initial;
  const plan=planLandBases(planning,{area,bases:[target]}),base=plan.bases[0];
  if(initial.airbaseSync?.relocationsComplete!==true)throw Error('飞机转场状态尚未同步，请先回到母港');
  assertExecutable(plan);
  if(resumeSlot&&!(base.operations[0]?.kind==='set'&&base.operations[0].slotId===resumeSlot))
    throw Error('当前飞机列表与待配置槽位不一致，未开始配置');
  let universe=baseInventory(initial.info);if(!universe)throw Error('基地库存资料不完整，未开始配置');
  let changed=0;
  for(const op of base.operations){
    const live=session.host.getStore(),inventory=baseInventory(live.info);
    if(!inventory||JSON.stringify(inventory)!==JSON.stringify(universe))throw Error('基地库存已变化，停止配置');
    const observed=universe.find(row=>row.area===base.areaId&&row.base===base.rid);
    if(!observed)throw Error('目标基地已变化，停止配置');
    const beforeSlots=observed.slots.map(row=>({slotId:row.slot,itemId:row.item,state:row.state}));
    if(op.kind==='set'){
      const result=await placeStockAircraft(session,{area:base.areaId,base:base.rid,slot:op.slotId,itemId:op.itemId,
        mode:base.currentMode,beforeSlots,verifiedInventory:universe,resumePicker:resumeSlot===op.slotId&&changed===0});
      const dest=observed.slots.find(row=>row.slot===op.slotId);dest.item=op.itemId;dest.state=result.state;
    }else if(op.kind==='swap'){
      const source=observed.slots.find(row=>row.slot===op.sourceSlotId),dest=observed.slots.find(row=>row.slot===op.slotId);
      if(!source||!dest)throw Error('目标基地槽位已变化，停止配置');
      await swapAircraftPositions(session,{area:base.areaId,base:base.rid,from:source.slot,to:dest.slot,
        itemId:op.itemId,targetItemId:dest.item,mode:base.currentMode,beforeSlots});
      [source.item,dest.item]=[dest.item,source.item];[source.state,dest.state]=[dest.state,source.state];
    }else throw Error('不支持的基地操作');
    const after=baseInventory(session.host.getStore().info);
    if(!after||JSON.stringify(after)!==JSON.stringify(universe))throw Error('基地状态未按预期更新，请先核对后再重试');
    changed++;
  }
  if(base.modeChange){
    await changeBaseAction(session,{area:base.areaId,base:base.rid,currentMode:base.currentMode,mode:base.mode});changed++;
  }
  return {ok:true,changed};
}
module.exports={enterBase,openBaseFromArea,selectBase,closeBase,moveAircraftToEmptySlot,swapAircraftPositions,changeBaseAction,placeStockAircraft,configureOpenBase};
