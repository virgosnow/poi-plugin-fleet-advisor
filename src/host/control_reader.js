'use strict';

// Runs in the game frame. Read only own data fields of the rendered PIXI tree;
// never invoke game handlers, getters, model methods, or network APIs.
function readControlSnapshot(){
  const own=(o,k)=>Object.getOwnPropertyDescriptor(o||{},k)?.value;
  const children=o=>own(o,'children')||[];
  const result={version:1,documentId:performance.timeOrigin,valid:false,blocked:true,scene:'unknown',controls:[]};
  const fail=reason=>({...result,valid:false,reason});
  if(typeof PIXI==='undefined')return fail('Game renderer unavailable');
  const canvas=document.querySelector('canvas'),rect=canvas?.getBoundingClientRect(),style=canvas&&getComputedStyle(canvas);
  if(!rect||!canvas.isConnected||Math.abs(rect.width-1200)>2||Math.abs(rect.height-720)>2||Math.abs(rect.left)>2||Math.abs(rect.top)>2||style.display==='none'||style.visibility==='hidden')return fail('Game canvas unavailable or resized');
  const renderers=[];let listener=own(PIXI.ticker?.shared,'_head');
  for(let i=0;listener&&i<40;i++,listener=own(listener,'next')){
    const renderer=own(own(listener,'context'),'renderer');
    if(renderer&&own(renderer,'view')===canvas&&!renderers.includes(renderer))renderers.push(renderer);
  }
  if(renderers.length!==1)return fail('Unique game renderer unavailable');
  const stage=own(renderers[0],'_lastObjectRendered');
  const roots=children(stage).filter(o=>Object.hasOwn(o,'_portMain')&&Object.hasOwn(o,'_mapLayer')&&Object.hasOwn(o,'_clickGuard'));
  if(roots.length!==1)return fail('Unique game root unavailable');
  const root=roots[0],port=own(root,'_portMain');
  const connected=o=>{
    let current=o,visible=true,rendered=true,allowed=true,alpha=1;const seen=new Set();
    for(let i=0;current&&i<60;i++){
      if(seen.has(current))break;seen.add(current);
      visible=visible&&own(current,'visible')!==false&&own(current,'_destroyed')!==true;
      rendered=rendered&&own(current,'renderable')!==false;alpha*=own(current,'alpha')??1;
      if(current===stage)return {attached:true,visible,rendered:visible&&rendered&&alpha>0,enabled:visible&&alpha>0&&allowed&&own(o,'interactive')===true};
      const parent=own(current,'parent');if(!parent||!children(parent).includes(current))break;
      allowed=allowed&&own(parent,'interactiveChildren')!==false;current=parent;
    }
    return {attached:false,visible:false,rendered:false,enabled:false};
  };
  const active=o=>connected(o).visible;
  const geometry=o=>{
    if(own(o,'slotIconDelete'))return geometry(own(o,'slotIconDelete'));
    if(own(o,'_state_sprite'))return geometry(own(o,'_state_sprite'));
    if(own(o,'_rid_out'))return geometry(own(o,'_rid_out'));
    const m=own(own(o,'transform'),'worldTransform');let box=own(o,'hitArea');
    if(!box){const data=own(o,'graphicsData');if(Array.isArray(data)&&data.length===1)box=own(data[0],'shape');}
    if(box&&Number.isFinite(own(box,'radius'))){const radius=own(box,'radius');box={x:own(box,'x')-radius,y:own(box,'y')-radius,width:2*radius,height:2*radius};}
    if(!box){const texture=own(own(o,'_texture'),'orig'),anchor=own(o,'_anchor');if(texture)box={x:-(own(anchor,'_x')||0)*own(texture,'width'),y:-(own(anchor,'_y')||0)*own(texture,'height'),width:own(texture,'width'),height:own(texture,'height')};}
    const nums=[...['x','y','width','height'].map(k=>own(box,k)),...['a','b','c','d','tx','ty'].map(k=>own(m,k))];
    if(!nums.every(Number.isFinite))return null;
    const [x,y,w,h,a,b,c,d,tx,ty]=nums;if(w<=0||h<=0)return null;
    const corners=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([px,py])=>({x:a*px+c*py+tx,y:b*px+d*py+ty}));
    const bounds={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
    return {bounds,point:{x:a*(x+w/2)+c*(y+h/2)+tx,y:b*(x+w/2)+d*(y+h/2)+ty}};
  };
  const inputNode=(o,depth=0)=>{
    if(!o||depth>3)return null;
    if(own(o,'interactive')===true&&Object.hasOwn(own(o,'_events')||{},'pointerup')&&geometry(o))return o;
    const found=children(o).map(c=>inputNode(c,depth+1)).filter(c=>c&&connected(c).enabled);
    return found.length===1?found[0]:null;
  };
  const unclipped=(node,point)=>{
    if(!point)return false;
    for(let n=node,i=0;n&&i<60;n=own(n,'parent'),i++){
      const mask=own(n,'_mask');if(!mask)continue;
      if(!connected(mask).visible)return false;
      const data=own(mask,'graphicsData'),shape=data?.length===1?own(data[0],'shape'):null;
      const m=own(own(mask,'transform'),'worldTransform'),a=own(m,'a'),b=own(m,'b'),c=own(m,'c'),d=own(m,'d'),tx=own(m,'tx'),ty=own(m,'ty');
      const x=own(shape,'x'),y=own(shape,'y'),w=own(shape,'width'),h=own(shape,'height'),det=a*d-b*c;
      // The game's menu reveal uses a transformed rectangular Graphics mask.
      // Unknown masks cannot authorize input; renderable=false is normal for masks.
      if(![a,b,c,d,tx,ty,x,y,w,h,det].every(Number.isFinite)||!det||w<=0||h<=0)return false;
      const dx=point.x-tx,dy=point.y-ty,px=(d*dx-c*dy)/det,py=(-b*dx+a*dy)/det;
      if(px<x+1||px>x+w-1||py<y+1||py>y+h-1)return false;
    }
    return true;
  };
  const control=(id,node,meta={},register=true)=>{
    const target=inputNode(node),g=geometry(target),state=connected(target);
    const exposed=!id.startsWith('equipment.category.')||unclipped(target,g?.point);
    const value={id,...state,...(g||{}),unclipped:exposed,enabled:!!g&&state.enabled&&exposed,...meta};
    if(register&&state.attached)result.controls.push(value);return value;
  };
  const knownOverlays=[];
  const complete=()=>{
    const contains=(parent,child)=>{
      for(let n=child,i=0;n&&i<60;n=own(n,'parent'),i++)if(n===parent)return true;
      return false;
    };
    const unknown=[own(root,'_overLayer'),own(port,'_overLayer')].some(layer=>children(layer).some(c=>active(c)&&!knownOverlays.some(known=>contains(c,known))));
    if(unknown||active(own(port,'_option'))&&own(own(port,'_option'),'_opened')===true)return fail('Unrecognized modal covers the game controls');
    return result;
  };
  const guards=[own(root,'_clickGuard'),own(root,'_loading'),own(root,'_fadeLayer'),own(port,'_fadeLayer')];
  result.blocked=guards.some(o=>active(o)&&(own(o,'interactive')===true||connected(o).rendered));
  if(result.blocked)return fail('Game transition or input guard active');
  if(!active(port))return fail('Port scene unavailable');
  const content=children(own(port,'_contentLayer')).filter(active);
  const equipment=content.find(o=>Object.hasOwn(o,'_shipDetail')&&Object.hasOwn(o,'_selectShipView'));
  const organization=content.find(o=>Object.hasOwn(o,'deckLayer')&&Object.hasOwn(o,'_onClickShipChange'));
  const circle=own(own(port,'_circle'),'_content'),side=own(port,'_sideMenu');
  const home=content.length===0&&active(own(port,'_ringMenu'))&&own(port,'_only_furniture')!==true;
  if(content.length===0&&!home)return fail('Home controls hidden or transitioning');
  result.scene=equipment?'equipment':organization?'organization':home?'home':'other';
  result.valid=true;result.blocked=false;
  const addNavigation=()=>{
    if(!home)control('navigate.home',own(circle,'_hit_area'));
    if(home){
      // The ring's children carry their native destination type. Unknown
      // destinations are never added to the executor's input allowlist.
      for(const c of children(own(port,'_ringMenu')))if(own(c,'_type')===11||own(c,'_type')===13)
        control(own(c,'_type')===11?'navigate.organization':'navigate.equipment',c);
    }
    if(!result.controls.some(c=>c.id==='navigate.organization'&&c.enabled))control('navigate.organization',own(side,'_btn_organize'));
    if(!result.controls.some(c=>c.id==='navigate.equipment'&&c.enabled))control('navigate.equipment',own(side,'_btn_remodel'));
  };
  const page=(pager,modelPage,sourceCount,prefix)=>{
    const focus=own(pager,'focusIndex'),count=own(pager,'pageCount'),texts=own(pager,'textChanges')||[],buttons=own(pager,'buttonChanges')||[];
    const labels=[],centers=[];
    for(let i=0;i<buttons.length;i++){
      const text=own(texts[i],'_text')??own(texts[i],'text');const label=Number(text);
      if(!active(texts[i])||!Number.isInteger(label)||label<1||label>count)continue;
      const button=control(prefix+'.page.'+label,buttons[i],{page:label});
      if(button.point){labels.push(label);centers.push(button.point.x);}
    }
    const first=control(prefix+'.first',own(pager,'buttonPrev_First'));
    const forward=control(prefix+'.forward',own(pager,'buttonNext_5'));
    const valid=active(pager)&&focus===modelPage&&Number.isInteger(focus)&&focus>=0&&focus<count&&count===Math.ceil(sourceCount/10)
      &&labels.includes(focus+1)&&labels.every((n,i)=>!i||n===labels[i-1]+1);
    return {valid,labels,centers,activePage:focus+1,totalPages:count,y:buttons.length?geometry(inputNode(buttons[0]))?.point.y:undefined,first,forward};
  };
  if(organization){
    knownOverlays.push(own(organization,'presetButtonLayer'));
    const fleet=own(own(organization,'deckLayer'),'_deckID'),change=own(organization,'taskChangeShip'),choice=own(change,'taskChoiceShip'),confirm=own(change,'taskConfirmChangeShip');
    const panel=own(confirm,'shipChangeConfirm'),view=own(choice,'shipChoiceView');
    result.fleet=fleet;result.organization={phase:active(panel)?'confirm':active(view)?'picker':'base'};
    const o=result.organization;o.slot=own(change,'slotIndex');o.targetFleet=own(change,'deckId');
    if(o.phase==='confirm'){
      o.selectedShip=own(confirm,'memShipId');o.confirmFleet=own(confirm,'toDeckId');o.confirmSlot=own(confirm,'toIndex');
      o.commit=control('organization.confirm',own(panel,'changeButton'),{fleet:o.confirmFleet,slot:o.confirmSlot,shipId:o.selectedShip});
      return complete();
    }
    if(o.phase==='picker'){
      const source=own(choice,'ships')||[],rows=own(view,'listItems')||[],index=own(choice,'_pageIndex');
      o.sort=own(choice,'_shipSortKeyType');o.japanese=own(view,'_japanese');
      o.filters=(own(view,'filterBtns')||[]).map((b,i)=>{const c=control('organization.filter.'+i,b);return {state:own(b,'isFilter')??own(b,'_isFilter'),control:c};});
      o.sortControl=control('organization.sort',own(choice,'shipSortButton'));
      o.detach=control('organization.detach',own(view,'detach'),{fleet,slot:o.slot,shipId:-1});
      o.page=page(own(choice,'pagerView'),index,source.length,'organization');
      o.rows=rows.slice(0,10).map((r,i)=>{
        const shipId=own(r,'memShipId'),expectedId=own(own(source[index*10+i],'_o'),'api_id');
        return {shipId,expectedId,control:control('organization.row.'+i,own(r,'itemHitArea'),{shipId,row:i})};
      });
      o.sourceCount=source.length;
      return complete();
    }
    addNavigation();
    const deck=own(organization,'deckLayer');
    o.clear=control('organization.clear',own(own(deck,'breakDeckView'),'iconText'),{fleet,slot:0,shipId:-2});
    o.tabs=[];o.slots=[];
    // The bounded semantic field map is verified against the live tree;
    // unsupported game layouts fail closed rather than guessing a button.
    for(let i=0;i<4;i++)o.tabs.push(control('organization.tab.'+(i+1),own(own(deck,'deckSelector'),'interactiveDeckFlag_'+(i+1)),{fleet:i+1}));
    for(const [i,node] of (own(own(deck,'shipSlotLayer'),'shipSlots')||[]).entries())o.slots.push(control('organization.slot.'+i,own(node,'changeButton'),{fleet,slot:i}));
    return complete();
  }
  if(equipment){
    const select=own(equipment,'_selectShipView'),detail=own(equipment,'_shipDetail'),task=own(equipment,'_taskChoiceSlotItem');
    const list=own(task,'_slotitemlist'),confirm=own(task,'_change_confirm'),borrow=own(task,'_changeConfirmFromOtherShip');
    const filterView=own(list,'_slotItemFilterView');
    const menuOpen=active(own(filterView,'_list_area_guard'));
    const e=result.equipment={phase:active(borrow)?'borrow':active(confirm)?'confirm':active(list)?(menuOpen?'category':'picker'):'base'};
    result.fleet=own(select,'_deck_id');result.shipId=own(select,'_mem_ship_id');
    if(e.phase!=='base'){
      const memory=own(task,'_memory'),source=own(task,'_sourceSlotItems')||[],pager=own(list,'_pagerView'),index=own(pager,'focusIndex');
      e.shipId=own(task,'_mem_ship_id');e.slot=own(task,'_slot_index');e.itemId=own(task,'_mem_slot_id');
      e.sourceShip=own(own(own(task,'_setList'),'equipped_ship'),String(e.itemId))??null;
      e.mode=own(memory,'mode');e.filter=own(memory,'filter');e.filterDetail=own(memory,'filter_detail');
      e.sourceCount=source.length;
      e.sourceIds=source.map(row=>own(own(own(row,'item'),'_o'),'api_id'));
      e.page=page(pager,own(memory,'slotItemPage'),source.length,'equipment');
      e.rows=(own(list,'_listItems')||[]).slice(0,10).map((r,i)=>{
        const entry=source[index*10+i];return {itemId:own(r,'memSlotItemId'),expectedId:own(own(own(entry,'item'),'_o'),'api_id'),type:own(r,'itemType'),
          sourceShip:own(own(own(entry,'attached'),'_o'),'api_id')??null,isSortie:own(entry,'isSortie'),isExpedition:own(entry,'isExpedition'),unset:own(entry,'isUnset'),
          control:control('equipment.row.'+i,own(r,'clickArea'),{row:i},false)};
      });
      // Only the topmost native panel authorizes input; behind-dialog buttons
      // often retain interactive=true and must never become click targets.
      result.controls=[];
      if(e.phase==='borrow'){
        knownOverlays.push(borrow);
        e.commit=control('equipment.borrow',own(borrow,'buttonYes'),{shipId:e.shipId,slot:e.slot,itemId:e.itemId,sourceShip:e.sourceShip});
        control('equipment.cancel-borrow',own(borrow,'buttonNo'));
      }else if(e.phase==='confirm'){
        e.commit=control('equipment.confirm',own(confirm,'changeButton'),{shipId:e.shipId,slot:e.slot,itemId:e.itemId,sourceShip:e.sourceShip,mode:e.mode});
      }else if(e.phase==='category'){
        e.categories=(own(own(filterView,'_slotItemFilterList'),'_slotItemFilterListItems')||[]).map(row=>({id:own(row,'_filter'),
          control:control('equipment.category.'+own(row,'_filter'),row)}));
      }else{
        // Re-register list controls after excluding controls behind details.
        e.page=page(pager,own(memory,'slotItemPage'),source.length,'equipment');
        for(const row of e.rows)if(row.control.attached)result.controls.push(row.control);
        e.modeControl=control('equipment.mode',own(list,'_changeListSwitch'));
        e.categoryControl=control('equipment.category',own(filterView,'_slotItemFilterButton'));
      }
      e.page.itemIds=e.sourceIds;
      return complete();
    }
    addNavigation();
    e.level=Number(own(own(detail,'_textLevel'),'_text'));
    e.slots=(own(own(detail,'_slotItemSlotBox'),'_slotItemSlots')||[]).map((s,i)=>({index:own(s,'_index'),visible:active(s),
      click:control('equipment.slot.'+i,own(s,'_clickAreaSlot'),{shipId:result.shipId,slot:own(s,'_index')}),
      detach:control('equipment.detach.'+i,own(s,'_detachButton'),{shipId:result.shipId,slot:own(s,'_index'),itemId:-1})}));
    e.clear=control('equipment.clear',own(detail,'_detachAllButton'),{shipId:result.shipId});
    e.extra=control('equipment.slot.ex',own(own(detail,'_extraSlotItemSlot'),'clickArea'),{shipId:result.shipId,slot:-1});
    e.extraDetach=control('equipment.detach.ex',own(own(detail,'_extraSlotItemSlot'),'detachButton'),{shipId:result.shipId,slot:-1,itemId:-1});
    e.ships=(own(select,'_shipSlots')||[]).map((s,i)=>control('equipment.ship.'+i,s,{slot:i}));
    e.tabs=Array.from({length:4},(_,i)=>control('equipment.tab.'+(i+1),own(own(select,'_deckSelectView'),'deck'+(i+1)),{fleet:i+1}));
    return complete();
  }
  addNavigation();return complete();
}
module.exports={readControlSnapshot};
