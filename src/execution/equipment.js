'use strict';
const {createEquipmentPlanner}=require('../domain/fleet/equipment_planner');
const {enterScreen}=require('./navigation');
const {createEquipmentGuard}=require('./equipment_guard');
const {navigatePages,chooseEquipmentCategory}=require('./picker_navigation');
const {equipmentSelectionFailure}=require('./observation_diagnostics');
const SLOT_Y=[271,321,366,412,457];
const together=(session,checks,predicate=()=>true,stableFrames=2,reuseLastFrame=false)=>session.until('batch',{checks},r=>r.valid&&predicate(r.results),6000,{stableFrames,reuseLastFrame}).then(r=>r.results);

async function restoreEquipment(session,scheme) {
  const planner=createEquipmentPlanner(()=>session.host.getStore()), plan=planner.resolvePlan(scheme);
  const completed=plan.fleetShips.filter(id=>!plan.ships.some(s=>s.shipId===id));
  session.onProgress({phase:'equipment-start',fleet:plan.fleet,completed});
  if(plan.done)return {ok:true,done:true,changed:0};
  const data=()=>session.host.getStore();
  const guard=createEquipmentGuard(data),{expected}=guard;
  let changing=new Set(),changes=0;
  session.validate=()=>guard.validate(changing);
  const screen=await enterScreen(session,'equipment');
  const tab=[Math.round(222+(plan.fleet-1)*45.7),175];
  // Navigation already read this tab on its two confirmed base-screen frames.
  // Custom/older observers without fleet metadata still require a fresh read.
  const currentTab=Number.isInteger(screen?.fleet)&&screen.fleet>=1&&screen.fleet<=4
    ?{selected:[screen.fleet]}:await session.until('equipTabs',{});
  if(currentTab.selected?.[0]!==plan.fleet){
    await session.input(...tab,undefined,'click',{settleMs:0,controlId:'equipment.tab.'+plan.fleet});
    await session.until('equipTabs',{fleet:plan.fleet});
  }
  const batches=[];
  for(const step of plan.steps) {
    let batch=batches[batches.length-1];
    if(!batch||batch.shipId!==step.shipId){batch={shipId:step.shipId,ops:[]};batches.push(batch);}
    batch.ops.push(step.op);
  }
  for(const ship of batches) {
    const index=plan.fleetShips.indexOf(ship.shipId);
    session.onProgress({phase:'equipment-ship',fleet:plan.fleet,ship:ship.shipId,total:ship.ops.length});
    await session.input(310,255+index*75,undefined,'click',{settleMs:0,controlId:'equipment.ship.'+index});
    // Confirm the tab before opening the slot. The passive request monitor
    // and complete store checks stop later actions on an unexpected change.
    // equipship already checks this fleet tab on the same image.
    await session.until('equipship',{fleet:plan.fleet,shipId:ship.shipId,expectedLevel:Number(data().info.ships[ship.shipId].api_lv)});
    for(const [step,op] of ship.ops.entries()) {
      session.check();
      if(!planner.sameState(planner.currentState(ship.shipId),op.before))throw new Error('Equipment precondition changed');
      const mutation=op.source?{path:'api_req_kaisou/slot_deprive',ship:ship.shipId,j:op.kind==='ex'?-1:op.j,slotKind:op.kind==='ex'?1:0,
        sourceShip:op.source.shipId,sourceJ:op.source.j==='ex'?0:op.source.j,sourceKind:op.source.j==='ex'?1:0}
        :op.kind==='clear'?{path:'api_req_kaisou/unsetslot_all',ship:ship.shipId}
        :op.kind==='ex'?{path:'api_req_kaisou/slotset_ex',ship:ship.shipId,item:op.id}
        :{path:'api_req_kaisou/slotset',ship:ship.shipId,j:op.j,item:op.id};
      session.onProgress({phase:'equipment',fleet:plan.fleet,ship:ship.shipId,slot:op.kind==='clear'?'all':op.kind==='ex'?'ex':op.j+1,
        operation:op.kind,completed:step,total:ship.ops.length});
      if(op.kind==='clear') {
        const slots=op.before.slots.length;
        await session.input(485,245+50*slots,undefined,'hover',{settleMs:0,controlId:'equipment.clear'});
        const button=await session.until('equipclear',{fleet:plan.fleet,slots});
        if(!button.tab?.valid||!button.commit)throw new Error('All-equipment removal button or fleet tab not confirmed');
        changing=new Set([ship.shipId,...(op.source?[op.source.shipId]:[])]);
        await session.input(button.commit.x,button.commit.y,mutation,'click',{settleMs:0});
      } else if(op.id<0) {
        let commit={x:1167,y:480};
        if(op.kind==='remove'){
          const button=await session.until('equipremove',{fleet:plan.fleet,slot:op.j,slots:op.before.slots.length});
          if(!button.commit)throw new Error('Normal-slot removal button not confirmed');
          commit=button.commit;
        }else if(op.kind!=='ex')throw new Error('Unsupported equipment removal');
        changing=new Set([ship.shipId,...(op.source?[op.source.shipId]:[])]);
        await session.input(commit.x,commit.y,mutation,'click',{settleMs:0});
      } else {
        const checkSource=()=>{
          const source=planner.sourceMap()[op.id];
          if(op.source) {
            if(!source||source.shipId!==op.source.shipId||source.j!==op.source.j||!planner.availableShip(source.shipId)
              ||!planner.sameState(planner.currentState(source.shipId),op.source.before))throw new Error('Borrow source changed');
          } else if(planner.occupiedMap()[op.id])throw new Error('Equipment is occupied');
        };
        checkSource();
        await session.input(op.kind==='ex'?1133:750,op.kind==='ex'?481:SLOT_Y[op.j],undefined,'click',{settleMs:0,controlId:'equipment.slot.'+(op.kind==='ex'?'ex':op.j)});
        const context={shipId:ship.shipId,slot:op.kind==='ex'?-1:op.j,itemId:op.id,sourceShipId:op.source?.shipId??null};
        const arg={layout:'equip',shipId:context.shipId,slot:context.slot,total:Math.max(1,Math.ceil(Object.keys(data().info.equips).length/10))};
        const desiredMode=op.source?'others':'stock';
        const pickerKind=op.kind==='ex'?'pageread':'equippicker';
        const readView=async()=>{
          const result=await session.until('batch',{checks:[{kind:'equipmode'},{kind:pickerKind,arg}]},r=>{
            const [mode,picker]=r.results||[];
            return r.valid||(op.kind!=='ex'&&!mode?.valid&&picker?.valid&&Number.isInteger(picker.category));
          });
          if(!result.valid){const error=new Error('Equipment picker mode unreadable');error.code='PICKER_MODE_UNREADABLE';throw error;}
          return result.results;
        };
        let mode,pickerView;
        const resetForImages=session.resetImagePicker&&op.kind!=='ex';
        try {
          [mode,pickerView]=await readView();
          if(resetForImages)throw Object.assign(new Error('Reset retained native equipment subfilters'),{code:'PICKER_FILTER_RESET_REQUIRED'});
        }
        catch(error) {
          if(session.controlMode&&['OBSERVATION_TIMEOUT','PICKER_MODE_UNREADABLE'].includes(error.code))throw error;
          if(!['PICKER_MODE_UNREADABLE','PICKER_FILTER_RESET_REQUIRED'].includes(error.code)&&!/timed out/.test(error.message))throw error;
          // A leftover category filter swaps the header icon (plane instead
          // of the bar) and shifts the whole label strip, so every header
          // template misses and the mode read times out. Probe-reset once:
          // open the category menu and pick row 0 (全装備). Rows the ship
          // cannot equip render dark and fail their templates, so judge the
          // menu by row 0 alone — cells.valid is too strict here. Reset only
          // once; an unreadable menu must not start blind open/close attempts.
          session.onProgress({phase:'equipment',detail:resetForImages?'正在复位图像识别的装备筛选':'装备列表模式不可读，尝试自动复位分类筛选'});
          let cleared=false;
          try {
            await session.input(824,168,undefined,'click',{settleMs:0,controlId:'equipment.category'});
            const cells=await session.until('cells',{},r=>r.categories&&r.categories[0]===0,2500);
            await session.input(Math.round(cells.centers[0].x),Math.round(cells.centers[0].y),undefined,'click',{settleMs:0,controlId:'equipment.category.0'});
            cleared=true;
          } catch(menuError) {
            if(!/timed out/.test(menuError.message))throw menuError;
          }
          if(!cleared)throw new Error('装备列表模式无法识别且分类菜单不可操作：可能残留分类筛选、其他显示状态或未关闭的弹窗；请在游戏中恢复标准列表（全装備）后重试');
          try {[mode,pickerView]=await readView();}
          catch(retry) {
            if(!/timed out/.test(retry.message))throw retry;
            throw new Error('分类复位后装备列表模式仍不可读：可能开启了其他列表显示模式（如道具详细）；请恢复标准显示后重试');
          }
          if(resetForImages)session.resetImagePicker=false;
        }
        if(mode.mode!==desiredMode) {
          await session.input(1135,168,undefined,'click',{settleMs:0,controlId:'equipment.mode'});
          [mode,pickerView]=await together(session,[{kind:'equipmode'},{kind:pickerKind,arg}],r=>r[0].mode===desiredMode);
        }
        const pickerList=op.source?planner.otherPickerList:planner.freePickerList;
        let list,selected;
        const readPicker=async predicate=>{
          const result=await session.until(op.kind==='ex'?'pageread':'equippicker',arg,r=>
            r.valid&&(op.kind==='ex'||r.page.valid&&(!selected||r.category===selected.id))&&(!predicate||predicate(op.kind==='ex'?r:r.page)));
          return op.kind==='ex'?result:result.page;
        };
        let read;
        if(op.kind==='ex') {list=pickerList(0,ship.shipId,'ex');read=pickerView;}
        else {
          // The game retains the category between slots. Read it alongside
          // the page, rather than reopening the menu or trusting a cache.
          const picker=pickerView;
          const choice=chooseEquipmentCategory(planner,{category:picker.category,read:picker.page,
            item:op.id,ship:ship.shipId,slot:op.j,borrow:!!op.source});
          selected=choice.retained?planner.groupDefs.find(d=>d.id===choice.id):null;
          read=picker.page;
          if(!selected) {
            const preferred=planner.groupDefs.find(d=>d.id===choice.id);
            const allEquipment=planner.groupDefs.find(d=>d.id===0);
            const hasUsableRow=r=>Array.isArray(r.categories)
              &&(r.categories.includes(preferred.id)||r.categories[0]===allEquipment.id);
            await session.input(824,168,undefined,'click',{settleMs:0,controlId:'equipment.category'});
            let cells;
            // A leftover dialog (or a rare filtered state) can swallow the
            // menu click. Dark rows the ship cannot use must not invalidate
            // the whole menu; require a readable target row or 全装備 instead.
            // Recognize the menu as soon as its rows become readable and
            // stable, rather than always paying a fixed animation delay.
            try {cells=await session.until('cells',{categoryId:preferred.id},hasUsableRow);}
            catch(error) {
              if(session.controlMode&&error.code==='OBSERVATION_TIMEOUT')throw error;
              if(!/timed out/.test(error.message))throw error;
              throw new Error('分类菜单未能打开（可能残留分类筛选或未关闭的弹窗）；若刚手动筛选过装备，请先在游戏中恢复为全装備后重试');
            }
            let index;
            for(const def of [preferred,allEquipment]) {
              const found=cells.categories.indexOf(def.id);
              if(found>=0){selected=def;index=found;break;}
            }
            if(!selected)throw new Error('Equipment category unavailable');
            await session.input(cells.centers[index].x,cells.centers[index].y,undefined,'click',{settleMs:0,controlId:'equipment.category.'+selected.id});
            read=await readPicker();
          }
          list=choice.retained?choice.list:pickerList(selected.id,ship.shipId,op.j);
        }
        // Control recognition reads the game's exact current filtered order,
        // including retained subcategories. Image mode keeps its existing
        // inventory projection; both still verify the exact row and instance.
        if(Array.isArray(read.itemIds))list=read.itemIds.map(id=>({id}));
        const rank=list.findIndex(e=>e.id===op.id);
        if(rank<0)throw new Error('Equipment missing from picker');
        const page=Math.floor(rank/10)+1,row=rank%10;
        const total=Math.max(1,Math.ceil(list.length/10));arg.total=total;
        read=await navigatePages(session,read,page,{total,first:[621,678],forward:[1003,678],read:readPicker});
        const cy=Math.round(218+44.75*row);
        // Recheck every selection precondition on the last stable list frame
        // when it is <=500ms old and no input intervened. Expiry or any input
        // requires a fresh capture; a failed reused frame is polled afresh.
        try {await together(session,[{kind:'equipmode'},{kind:pickerKind,arg},
          {kind:'rowicon',arg:{box:[546,cy-22,599,cy+22],t3:planner.t3of(op.id),...context,page,row}}],r=>{
          const view=r[1],p=op.kind==='ex'?view:view.page;
          return r[0].mode===desiredMode&&p?.valid&&p.activePage===page&&(op.kind==='ex'||view.category===selected.id);
        },1,true);}catch(error){
          throw equipmentSelectionFailure(error,{fleet:plan.fleet,shipId:ship.shipId,slot:op.kind==='ex'?'ex':op.j+1,
            itemId:op.id,type:planner.t3of(op.id),mode:desiredMode,category:selected?.id??null,
            page,row:row+1,listCount:list.length,totalPages:total,sourceShip:op.source?.shipId??null});
        }
        await session.input(750,cy,undefined,'click',{settleMs:0,controlId:'equipment.row.'+row});
        await session.until('pix',{pts:[[1075,655],[1040,655]],exp:[[19,113,114],[18,124,124]],tol:45,purpose:'equipment-confirm',...context},undefined,6000,{stableFrames:1});
        session.check();
        checkSource();
        if(op.source) {
          // First button opens the native transfer confirmation without a
          // mutation. Only its verified '了解' button sends slot_deprive.
          // Start checking the known modal immediately. One fresh frame
          // verifies both buttons and the full border; no second identical
          // capture or fixed post-opening wait is needed before clicking 了解.
          await session.input(1075,659,undefined,'click',{settleMs:0});
          const confirm=await session.until('borrowconfirm',context,undefined,6000,{stableFrames:1});
          session.check();checkSource();
          changing=new Set([ship.shipId,op.source.shipId]);
          await session.input(confirm.commit.x,confirm.commit.y,mutation,'click',{settleMs:0});
        } else {
          changing=new Set([ship.shipId]);
          await session.input(1075,659,mutation,'click',{settleMs:0});
        }
      }
      const deadline=session.now()+30000;
      while(!planner.sameState(planner.currentState(ship.shipId),op.after)
        ||op.source&&!planner.sameState(planner.currentState(op.source.shipId),op.source.after)) {
        if(session.now()>=deadline)throw new Error('Equipment store confirmation timed out; no repeat submission');
        await session.wait(50);
      }
      expected.set(ship.shipId,op.after);
      if(op.source)expected.set(op.source.shipId,op.source.after);
      changing.clear();changes++;
      session.confirmMutation?.();
      await session.until('equipTabs',{fleet:plan.fleet});
      session.onProgress({phase:'equipment-step',fleet:plan.fleet,ship:ship.shipId,completed:step+1,total:ship.ops.length});
    }
    session.check();
    session.onProgress({phase:'equipment-done',fleet:plan.fleet,ship:ship.shipId});
  }
  session.check();
  if(plan.expected.some(e=>!planner.sameState(planner.currentState(e.shipId),e.state)))throw new Error('Final equipment mismatch');
  return {ok:true,done:true,changed:changes};
}
module.exports={restoreEquipment};
