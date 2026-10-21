'use strict';
const {createEquipmentPlanner}=require('../domain/fleet/equipment_planner');
const {enterScreen}=require('./navigation');
const SLOT_Y=[271,321,366,412,457];

async function restoreEquipment(session,scheme) {
  const planner=createEquipmentPlanner(()=>session.host.getStore()), plan=planner.resolvePlan(scheme);
  const completed=plan.fleetShips.filter(id=>!plan.ships.some(s=>s.shipId===id));
  session.onProgress({phase:'equipment-start',fleet:plan.fleet,completed});
  if(plan.done)return {ok:true,done:true,changed:0};
  const data=()=>session.host.getStore();
  const fleetSnapshot=JSON.stringify(data().info.fleets);
  const inventoryRevision=()=>JSON.stringify(Object.entries(data().info.equips).map(([id,e])=>[id,e.api_slotitem_id,e.api_level||0,e.api_alv||0]));
  const inventorySnapshot=inventoryRevision();
  const expected=new Map(Object.keys(data().info.ships).map(id=>[Number(id),planner.currentState(id)]));
  let changing=new Set(),changes=0;
  session.validate=()=>{
    if(inventoryRevision()!==inventorySnapshot)throw new Error('Equipment inventory or improvement changed during run');
    if(JSON.stringify(data().info.fleets)!==fleetSnapshot)throw new Error('Fleet changed during equipment run');
    if(Object.keys(data().info.ships).length!==expected.size)throw new Error('Roster changed during equipment run');
    for(const [id,state] of expected)if(!changing.has(id)&&!planner.sameState(planner.currentState(id),state))throw new Error('Equipment changed outside this run');
  };
  await enterScreen(session,'equipment');
  const tab=[Math.round(222+(plan.fleet-1)*45.7),175];
  await session.until('equipTabs',{});
  await session.input(...tab);
  await session.until('equipTabs',{fleet:plan.fleet});
  const batches=[];
  for(const step of plan.steps) {
    let batch=batches[batches.length-1];
    if(!batch||batch.shipId!==step.shipId){batch={shipId:step.shipId,ops:[]};batches.push(batch);}
    batch.ops.push(step.op);
  }
  for(const ship of batches) {
    const index=plan.fleetShips.indexOf(ship.shipId);
    session.onProgress({phase:'equipment-ship',fleet:plan.fleet,ship:ship.shipId,total:ship.ops.length});
    await session.input(310,255+index*75);
    // Confirm the tab before opening the slot. The passive request monitor
    // and complete store checks stop later actions on an unexpected change.
    await session.until('equipTabs',{fleet:plan.fleet});
    await session.until('equipship',{fleet:plan.fleet,expectedLevel:Number(data().info.ships[ship.shipId].api_lv)});
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
        await session.input(485,245+50*slots,undefined,'hover');
        const button=await session.until('equipclear',{fleet:plan.fleet,slots});
        if(!button.tab?.valid||!button.commit)throw new Error('All-equipment removal button or fleet tab not confirmed');
        changing=new Set([ship.shipId,...(op.source?[op.source.shipId]:[])]);
        await session.input(button.commit.x,button.commit.y,mutation);
      } else if(op.id<0) {
        if(op.kind!=='ex')throw new Error('Unsupported equipment removal');
        changing=new Set([ship.shipId,...(op.source?[op.source.shipId]:[])]);
        await session.input(1167,480,mutation);
      } else {
        const checkSource=()=>{
          const source=planner.sourceMap()[op.id];
          if(op.source) {
            if(!source||source.shipId!==op.source.shipId||source.j!==op.source.j||!planner.availableShip(source.shipId)
              ||!planner.sameState(planner.currentState(source.shipId),op.source.before))throw new Error('Borrow source changed');
          } else if(planner.occupiedMap()[op.id])throw new Error('Equipment is occupied');
        };
        checkSource();
        await session.input(op.kind==='ex'?1133:750,op.kind==='ex'?481:SLOT_Y[op.j]);
        const arg={layout:'equip',total:Math.max(1,Math.ceil(Object.keys(data().info.equips).length/10))};
        const desiredMode=op.source?'others':'stock';
        let mode;
        try {mode=await session.until('equipmode',{});}
        catch(error) {
          if(!/timed out/.test(error.message))throw error;
          // A leftover category filter swaps the header icon (plane instead
          // of the bar) and shifts the whole label strip, so every header
          // template misses and the mode read times out. Probe-reset once:
          // open the category menu and pick row 0 (全装備). Rows the ship
          // cannot equip render dark and fail their templates, so judge the
          // menu by row 0 alone — cells.valid is too strict here. Two
          // attempts cover the menu's open/closed toggle.
          session.onProgress({phase:'equipment',detail:'装备列表模式不可读，尝试自动复位分类筛选'});
          let cleared=false;
          for(let attempt=0;attempt<2&&!cleared;attempt++) {
            try {
              await session.input(824,168);
              const cells=await session.until('cells',{},r=>r.categories&&r.categories[0]===0,2500);
              await session.wait(450);
              await session.input(Math.round(cells.centers[0].x),Math.round(cells.centers[0].y));
              cleared=true;
            } catch(menuError) {
              if(!/timed out/.test(menuError.message))throw menuError;
            }
          }
          if(!cleared)throw new Error('装备列表模式无法识别且分类菜单不可操作：可能残留分类筛选、其他显示状态或未关闭的弹窗；请在游戏中恢复标准列表（全装備）后重试');
          try {mode=await session.until('equipmode',{});}
          catch(retry) {
            if(!/timed out/.test(retry.message))throw retry;
            throw new Error('分类复位后装备列表模式仍不可读：可能开启了其他列表显示模式（如道具详细）；请恢复标准显示后重试');
          }
        }
        if(mode.mode!==desiredMode) {
          await session.input(1135,168);
          mode=await session.until('equipmode',{},r=>r.valid&&r.mode===desiredMode);
        }
        const pickerList=op.source?planner.otherPickerList:planner.freePickerList;
        let list,selected;
        const readPicker=async predicate=>{
          const result=await session.until(op.kind==='ex'?'pageread':'equippicker',arg,r=>
            r.valid&&(op.kind==='ex'||r.page.valid&&(!selected||r.category===selected.id))&&(!predicate||predicate(op.kind==='ex'?r:r.page)));
          return op.kind==='ex'?result:result.page;
        };
        let read;
        if(op.kind==='ex') {list=pickerList(0,ship.shipId,'ex');read=await readPicker();}
        else {
          // The game retains the category between slots. Read it alongside
          // the page, rather than reopening the menu or trusting a cache.
          const picker=await session.until('equippicker',arg);
          selected=planner.groupDefs.find(d=>d.id===picker.category&&planner.categoryAccepts(d.id,op.id));
          read=picker.page;
          if(!selected) {
            const preferred=planner.categoryFor(op.id);
            const allEquipment=planner.groupDefs.find(d=>d.id===0);
            const hasUsableRow=r=>Array.isArray(r.categories)
              &&(r.categories.includes(preferred.id)||r.categories[0]===allEquipment.id);
            await session.input(824,168);
            let cells;
            // A leftover dialog (or a rare filtered state) can swallow the
            // menu click. Dark rows the ship cannot use must not invalidate
            // the whole menu; require a readable target row or 全装備 instead.
            try {cells=await session.until('cells',{},hasUsableRow);}
            catch(error) {
              if(!/timed out/.test(error.message))throw error;
              throw new Error('分类菜单未能打开（可能残留分类筛选或未关闭的弹窗）；若刚手动筛选过装备，请先在游戏中恢复为全装備后重试');
            }
            // Read again after the opening animation before preferring the
            // category-specific row over the always available 全装備 row.
            await session.wait(450);
            cells=await session.until('cells',{},hasUsableRow);
            let index;
            for(const def of [preferred,allEquipment]) {
              const found=cells.categories.indexOf(def.id);
              if(found>=0){selected=def;index=found;break;}
            }
            if(!selected)throw new Error('Equipment category unavailable');
            await session.input(cells.centers[index].x,cells.centers[index].y);
            read=await readPicker();
          }
          list=pickerList(selected.id,ship.shipId,op.j);
        }
        const rank=list.findIndex(e=>e.id===op.id);
        if(rank<0)throw new Error('Equipment missing from picker');
        const page=Math.floor(rank/10)+1,row=rank%10;
        for(let count=0;read.activePage!==page;count++) {
          if(count>=60)throw new Error('Equipment page navigation limit');
          const index=read.labels.indexOf(page),before=read.activePage;
          if(index>=0)await session.input(read.centers[index],677);
          // (1003,678) jumps to the last page and (621,678) to the first;
          // either way the next read exposes a window containing the target
          // label, which the following iteration clicks directly.
          else await session.input(page<before?621:1003,678);
          read=await readPicker(r=>r.activePage!==before);
        }
        const cy=Math.round(218+44.75*row);
        await session.until('equipmode',{},r=>r.valid&&r.mode===desiredMode);
        await session.until('rowicon',{box:[546,cy-22,599,cy+22],t3:planner.t3of(op.id)});
        await session.input(750,cy);
        await session.until('pix',{pts:[[1075,655],[1040,655]],exp:[[19,113,114],[18,124,124]],tol:45});
        session.check();
        checkSource();
        if(op.source) {
          // First button opens the native transfer confirmation without a
          // mutation. Only its verified '了解' button sends slot_deprive.
          await session.input(1075,659);
          const confirm=await session.until('borrowconfirm',{});
          session.check();checkSource();
          changing=new Set([ship.shipId,op.source.shipId]);
          await session.input(confirm.commit.x,confirm.commit.y,mutation);
        } else {
          changing=new Set([ship.shipId]);
          await session.input(1075,659,mutation);
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
