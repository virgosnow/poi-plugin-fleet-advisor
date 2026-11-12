'use strict';
const categories=require('../../data/equip_categories.json').templates;
const {controlUnavailable}=require('./recognition_fallback');
const {eligiblePlane}=require('../domain/fleet/airbase_relocation');
const {baseInventory}=require('../domain/fleet/land_base_inventory');
const ready=c=>c?.attached===true&&c.visible===true&&c.enabled===true&&c.point&&Number.isFinite(c.point.x)&&Number.isFinite(c.point.y);
const homeReady=c=>ready(c)&&c.rendered===true;
const invalid=reason=>({valid:false,reason});
function checkInterruption(snapshot){
  if(snapshot?.interruption==='expedition-return'){
    const error=new Error('检测到远征归港，已停止编成。请先在游戏中处理归港，并核对可能已生效的部分编成后再重试。');
    error.code='EXPEDITION_RETURN_REQUIRED';
    throw error;
  }
}
const sortModes={1:'level',2:'type',3:'new',4:'damage',5:'repair',6:'morale'};
const pageResult=p=>p?{valid:p.valid,labels:p.labels,centers:p.centers,activePage:p.activePage,y:p.y,...(p.itemIds?{itemIds:p.itemIds}:{})}:invalid('Picker page unavailable');
function baseSlotsMatch(a,store,arg,after=false){
  const bases=(store?.info?.airbase||[]).filter(row=>row.api_area_id===arg.area&&row.api_rid===arg.base),observed=bases[0]?.api_plane_info||[];
  return bases.length===1&&Array.isArray(arg.beforeSlots)&&arg.beforeSlots.length===4&&
    new Set(arg.beforeSlots.map(row=>row.slotId)).size===4&&a?.slots?.length===4&&observed.length===4&&arg.beforeSlots.every(row=>{
      const visible=a.slots.find(slot=>slot.slotId===row.slotId),current=observed.find(slot=>slot.api_squadron_id===row.slotId);
      const changed=after&&row.slotId===arg.slot,itemId=changed?arg.itemId:row.itemId;
      return visible?.itemId===itemId&&current?.api_slotid===itemId&&visible?.state===current?.api_state&&
        (changed?[1,2].includes(current?.api_state):current?.api_state===row.state);
    });
}
function baseStockAvailable(store,id,verifiedInventory){
  if(!Number.isSafeInteger(id)||id<=0||store?.airbaseSync?.relocationsComplete!==true)return false;
  if(store.airbaseSync.complete!==true){
    const live=baseInventory(store.info);
    if(!live||!Array.isArray(verifiedInventory)||JSON.stringify(live)!==JSON.stringify(verifiedInventory))return false;
  }
  const info=store.info,item=info?.equips?.[id],master=store.const?.$equips?.[item?.api_slotitem_id];
  if(!info?.ships||!info.equips||!Array.isArray(info.airbase)||!Array.isArray(info.airbaseRelocations))return false;
  if(!item||!eligiblePlane(master)||(info.airbaseRelocations||[]).some(row=>row.itemId===id))return false;
  if(Object.values(info.ships||{}).some(ship=>[...(ship.api_slot||[]),ship.api_slot_ex].includes(id)))return false;
  return !(info.airbase||[]).some(base=>(base.api_plane_info||[]).some(slot=>slot.api_slotid===id));
}
function observeControls(snapshot,kind,arg={},store){
  checkInterruption(snapshot);
  if(!snapshot?.valid||snapshot.blocked||snapshot.version!==1)return invalid(snapshot?.reason||'Game controls unavailable');
  const s=snapshot,e=s.equipment,o=s.organization;
  const orgTab={valid:s.scene==='organization'&&s.fleet===arg.fleet,selected:[s.fleet]};
  const equipBase=s.scene==='equipment'&&e?.phase==='base';
  const equipContext=()=>s.scene==='equipment'&&e&&e.shipId===s.shipId&&(!arg.shipId||e.shipId===arg.shipId)
    &&(arg.slot===undefined||e.slot===arg.slot);
  const equipList=()=>equipContext()&&e.phase==='picker'&&(e.slot===-1||Number.isInteger(e.filterDetail)&&e.filterDetail>=0)&&e.page?.valid
    &&Array.isArray(e.sourceIds)&&e.sourceIds.length===e.sourceCount&&new Set(e.sourceIds).size===e.sourceIds.length
    &&e.sourceIds.every(id=>Number.isSafeInteger(id)&&id>0&&store?.info.equips[id])
    &&e.rows.filter(r=>r.visible===true).length===Math.min(10,e.sourceCount-(e.page.activePage-1)*10)
    &&e.rows.filter(r=>r.visible===true).every(r=>Number.isSafeInteger(r.itemId)&&r.itemId>0&&r.itemId===r.expectedId);
  if(kind==='equipview'){
    const context=!!equipContext(),fleetMatched=s.fleet===arg.fleet,rows=Array.isArray(e?.rows)?e.rows.filter(row=>row.visible===true):null;
    const sourceCount=Number.isInteger(e?.sourceCount)?e.sourceCount:null;
    const sourceIdsValid=Array.isArray(e?.sourceIds)&&e.sourceIds.length===sourceCount&&new Set(e.sourceIds).size===e.sourceIds.length&&
      e.sourceIds.every(id=>Number.isSafeInteger(id)&&id>0&&store?.info.equips[id]);
    const controls=(s.controls||[]).filter(c=>c.id==='equipment.mode'&&ready(c)&&c.rendered===true&&c.unclipped!==false);
    const modeReady=e?.modeControl?.id==='equipment.mode'&&ready(e.modeControl)&&e.modeControl.rendered===true&&e.modeControl.unclipped!==false&&controls.length===1&&
      controls[0].point.x===e.modeControl.point.x&&controls[0].point.y===e.modeControl.point.y;
    const picker={scene:s.scene,phase:e?.phase??null,contextMatched:context,fleetMatched,sourceCount,
      visibleRows:rows?.length??null,pageValid:e?.page?.valid===true,activePage:e?.page?.activePage??null,
      mode:e?.mode===0?'stock':e?.mode===1?'others':null,category:e?.filter??null,
      filterDetail:e?.filterDetail??null,sourceIdsValid,modeReady};
    const normal=observeControls(s,'equipmode',arg,store),view=observeControls(s,arg.slot===-1?'pageread':'equippicker',
      arg.slot===-1?{...arg,layout:'equip'}:arg,store);
    if(fleetMatched&&normal.valid&&view.valid)return {valid:true,empty:false,mode:normal.mode,view,picker};
    const empty=context&&fleetMatched&&e.phase==='picker'&&[0,1].includes(e.mode)&&Number.isInteger(e.filter)&&
      (e.slot===-1||Number.isInteger(e.filterDetail)&&e.filterDetail>=0)&&sourceCount===0&&sourceIdsValid&&rows?.length===0&&
      e.page?.activePage===1&&modeReady;
    if(empty)return {valid:true,empty:true,mode:e.mode===0?'stock':'others',picker};
    return {valid:false,reason:'Equipment picker state not verified',picker};
  }
  const selection=()=>equipContext()&&e.itemId===arg.itemId&&(e.sourceShip??null)===(arg.sourceShipId??null)&&e.mode===(arg.sourceShipId?1:0)&&ready(e.commit);
  if(kind==='batch'){
    if(!Array.isArray(arg.checks)||!arg.checks.length||arg.checks.length>8||arg.checks.some(c=>!c||c.kind==='batch'||typeof c.kind!=='string'))throw Error('Invalid observation batch');
    const results=arg.checks.map(c=>observeControls(s,c.kind,c.arg,store));return {valid:results.every(r=>r.valid),results};
  }
  if(kind==='airbase-navigation'){
    const allowed={'sortie':'home','choose-sortie':'airbase-sortie-choice','open':'airbase-area'};
    const areaStage=Number.isInteger(arg.area)&&arg.area>=1&&arg.area<=9&&arg.stage==='area';
    const scene=areaStage?'airbase-area':allowed[arg.stage],id=areaStage?'airbase.nav.area.'+arg.area:'airbase.nav.'+arg.stage;
    const controls=(s.controls||[]).filter(c=>c.id===id&&ready(c));
    const valid=!!scene&&s.scene===scene&&controls.length===1&&
      (arg.stage!=='open'||s.area===arg.area);
    return valid?{valid:true,point:controls[0].point}:invalid('Base navigation control unavailable');
  }
  if(kind==='airbase-tab'){
    const a=s.airbase,rows=a?.models,tabs=a?.tabs?.filter(c=>c.base===arg.base&&ready(c))||[];
    const clean=Array.isArray(rows)&&rows.length>0&&new Set(rows.map(r=>r.base)).size===rows.length&&rows.every(row=>
      row.nameChanged===false&&Number.isInteger(row.pendingMode)&&Number.isInteger(row.mode)&&
      (row.pendingMode===-1||row.pendingMode===row.mode))&&rows.some(row=>row.base===a.base&&row.mode===a.mode);
    return s.scene==='airbase'&&a?.phase==='base'&&a.area===arg.area&&a.base!==arg.base&&tabs.length===1&&clean?
      {valid:true,point:tabs[0].point}:invalid('Base tab or pending edits not confirmed');
  }
  if(kind==='airbase-panel'){
    const a=s.airbase,valid=s.scene==='airbase'&&a?.phase==='base'&&a.area===arg.area&&(!arg.base||a.base===arg.base);
    return valid?{valid:true,area:a.area,base:a.base,mode:a.mode}:invalid('Base panel unavailable');
  }
  if(kind==='airbase-close-clean'){
    const a=s.airbase,rows=a?.models;
    const clean=Array.isArray(rows)&&rows.length>0&&new Set(rows.map(row=>row.base)).size===rows.length&&
      rows.every(row=>row.nameChanged===false&&Number.isInteger(row.mode)&&Number.isInteger(row.pendingMode)&&
        (row.pendingMode===-1||row.pendingMode===row.mode));
    return s.scene==='airbase'&&a?.phase==='base'&&a.area===arg.area&&a.base===arg.base&&clean&&ready(a.close)?
      {valid:true,point:a.close.point}:invalid('Base panel has unconfirmed pending changes');
  }
  if(kind==='airbase-area')return s.scene==='airbase-area'&&Number.isInteger(s.area)?{valid:true,area:s.area}:invalid('Area selection unavailable');
  if(kind==='airbase-action'||kind==='airbase-action-start'){
    const a=s.airbase,rows=a?.models;
    const safe=Array.isArray(rows)&&rows.length>0&&new Set(rows.map(row=>row.base)).size===rows.length&&rows.some(row=>row.base===a.base)&&
      rows.every(row=>Number.isInteger(row.base)&&Number.isInteger(row.mode)&&Number.isInteger(row.pendingMode)&&row.nameChanged===false&&
      (row.pendingMode===-1||row.pendingMode===row.mode||row.base===a.base&&row.pendingMode===a.mode));
    const valid=s.scene==='airbase'&&a?.phase==='base'&&a.area===arg.area&&a.base===arg.base&&a.mode===arg.mode&&
      Number.isInteger(a.mode)&&a.mode>=0&&a.mode<=4&&safe&&ready(a.action)&&
      (kind!=='airbase-action-start'||rows.find(row=>row.base===a.base)?.mode===a.mode);
    return valid?{valid:true,mode:a.mode,point:a.action.point}:invalid('Base action control or pending changes are not confirmed');
  }
  if(kind==='airbase-action-done'){
    const rows=(store?.info?.airbase||[]).filter(row=>row.api_area_id===arg.area&&row.api_rid===arg.base);
    return s.scene==='airbase-area'&&s.area===arg.area&&!s.airbase&&rows.length===1&&rows[0].api_action_kind===arg.mode?
      {valid:true}:invalid('Base action update is not confirmed');
  }
  if(['airbase-slot','airbase-catalog','airbase-row','airbase-selection','airbase-stock-done'].includes(kind)){
    const a=s.airbase,phase=kind==='airbase-slot'||kind==='airbase-stock-done'?'base':kind==='airbase-selection'?'confirm':'picker';
    const base=s.scene==='airbase'&&a?.phase===phase&&a.area===arg.area&&a.base===arg.base&&a.mode===arg.mode&&
      Number.isInteger(arg.mode)&&arg.mode>=0&&arg.mode<=4&&Number.isInteger(arg.slot)&&arg.slot>=1&&arg.slot<=4&&
      baseSlotsMatch(a,store,arg,kind==='airbase-stock-done');
    if(!base)return invalid('Base, mode or squadron state is not confirmed');
    const original=arg.beforeSlots.find(row=>row.slotId===arg.slot);
    if(!original||!(original.itemId===0&&original.state===0||original.itemId>0&&original.state===1))
      return invalid('The original squadron is not confirmed ready');
    if(kind==='airbase-stock-done'){
      const state=a.slots.find(row=>row.slotId===arg.slot)?.state;
      if(original?.itemId>0&&!(store.info.airbaseRelocations||[]).some(row=>row.itemId===original.itemId))
        return invalid('Replaced aircraft relocation has not been confirmed');
      return {valid:true,state};
    }
    if(!baseStockAvailable(store,arg.itemId,arg.verifiedInventory))
      return invalid('Aircraft is not confirmed free or the destination is not ready');
    if(kind==='airbase-slot'){
      const slot=a.slots.find(row=>row.slotId===arg.slot);
      return ready(slot?.control)?{valid:true,point:slot.control.point}:invalid('Squadron control unavailable');
    }
    if(kind==='airbase-selection')return a.slot===arg.slot&&a.itemId===arg.itemId&&ready(a.commit)?
      {valid:true,point:a.commit.point}:invalid('Exact base aircraft confirmation unavailable');
    const ids=a.sourceIds,all=Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.every(id=>Number.isSafeInteger(id)&&id>0);
    if(a.slot!==arg.slot||!all||!Number.isInteger(a.page)||a.page<1||!Number.isInteger(a.category))return invalid('Base aircraft list unavailable');
    const pageCount=Math.ceil(ids.length/9),visiblePages=(a.pages||[]).filter(ready),categories=(a.categories||[]).filter(ready);
    if(pageCount&&a.page>pageCount||pageCount>1&&!visiblePages.length||!ids.includes(arg.itemId)&&!categories.length)
      return invalid('Base aircraft picker controls are still transitioning');
    const index=ids.indexOf(arg.itemId),page=index<0?null:Math.floor(index/9)+1,row=index<0?null:index%9;
    if(kind==='airbase-catalog')return {valid:true,category:a.category,page:a.page,targetPage:page,targetRow:row,
      pages:visiblePages.map(c=>({page:c.page,point:c.point})),
      categories:categories.map(c=>({category:c.category,point:c.point})),
      previousPages:ready(a.previousPages)?a.previousPages.point:null,nextPages:ready(a.nextPages)?a.nextPages.point:null};
    const selected=index>=0&&a.category===arg.category&&a.page===page&&page===arg.page&&row===arg.row?a.rows?.[row]:null;
    return selected?.itemId===arg.itemId&&selected.expectedId===arg.itemId&&ready(selected.control)?
      {valid:true,point:selected.control.point}:invalid('Exact base aircraft row unavailable');
  }
  if(kind==='airbase-swap'){
    const a=s.airbase,src=a?.slots?.find(row=>row.slotId===arg.from),dst=a?.slots?.find(row=>row.slotId===arg.to);
    const targetId=arg.targetItemId??0,targetState=targetId>0?1:0;
    const bases=(store?.info?.airbase||[]).filter(row=>row.api_area_id===arg.area&&row.api_rid===arg.base);
    const observed=bases[0]?.api_plane_info||[],source=observed.filter(row=>row.api_squadron_id===arg.from),target=observed.filter(row=>row.api_squadron_id===arg.to);
    const all=Array.isArray(arg.beforeSlots)&&arg.beforeSlots.length===4&&new Set(arg.beforeSlots.map(row=>row.slotId)).size===4&&
      a?.slots?.length===4&&observed.length===4&&arg.beforeSlots.every(row=>{
        const visible=a.slots.find(slot=>slot.slotId===row.slotId),current=observed.find(slot=>slot.api_squadron_id===row.slotId);
        return visible?.itemId===row.itemId&&visible?.state===row.state&&current?.api_slotid===row.itemId&&current?.api_state===row.state;
      });
    const valid=s.scene==='airbase'&&a?.phase==='base'&&a.area===arg.area&&a.base===arg.base&&a.mode===arg.mode&&
      Number.isInteger(arg.mode)&&arg.mode>=0&&arg.mode<=4&&Number.isSafeInteger(arg.itemId)&&arg.itemId>0&&
      Number.isSafeInteger(targetId)&&targetId>=0&&targetId!==arg.itemId&&
      arg.from!==arg.to&&all&&bases.length===1&&source.length===1&&target.length===1&&
      src?.itemId===arg.itemId&&src.state===1&&dst?.itemId===targetId&&dst.state===targetState&&ready(src.control)&&ready(dst.control)&&
      source[0].api_slotid===arg.itemId&&source[0].api_state===1&&target[0].api_slotid===targetId&&target[0].api_state===targetState;
    return valid?{valid:true,source:src.control.point,destination:dst.control.point}:invalid('Base aircraft or destination is not confirmed');
  }
  if(kind==='airbase-swap-done'){
    const a=s.airbase,bases=(store?.info?.airbase||[]).filter(row=>row.api_area_id===arg.area&&row.api_rid===arg.base),observed=bases[0]?.api_plane_info||[];
    const valid=s.scene==='airbase'&&a?.phase==='base'&&a.area===arg.area&&a.base===arg.base&&a.mode===arg.mode&&
      Number.isInteger(arg.mode)&&arg.mode>=0&&arg.mode<=4&&bases.length===1&&
      Array.isArray(arg.beforeSlots)&&arg.beforeSlots.length===4&&new Set(arg.beforeSlots.map(row=>row.slotId)).size===4&&
      a.slots?.length===4&&observed.length===4&&arg.beforeSlots.every(row=>{
        const visible=a.slots.find(slot=>slot.slotId===row.slotId),current=observed.find(slot=>slot.api_squadron_id===row.slotId);
        const targetId=arg.targetItemId??0,itemId=row.slotId===arg.from?targetId:row.slotId===arg.to?arg.itemId:row.itemId;
        const state=row.slotId===arg.from?(targetId>0?1:0):row.slotId===arg.to?1:row.state;
        return visible?.itemId===itemId&&visible?.state===state&&current?.api_slotid===itemId&&current?.api_state===state;
      });
    return valid?{valid:true}:invalid('Base aircraft move has not been confirmed');
  }
  if(kind==='navigation'){
    if(!['home','organization','equipment','quest-welcome-dismiss'].includes(arg.destination))return invalid('Unsupported navigation destination');
    if(arg.destination==='quest-welcome-dismiss'&&s.scene!=='quest-welcome')return invalid('Quest welcome is no longer open');
    const id=arg.destination==='quest-welcome-dismiss'?'quest.welcome.dismiss':'navigate.'+arg.destination;
    const controls=s.controls.filter(c=>c.id===id&&(id==='navigate.home'?homeReady(c):ready(c)));
    return {valid:controls.length===1,point:controls.length===1?controls[0].point:null};
  }
  if(kind==='screen'){
    if(arg.allowPortReturn&&s.scene==='quest-welcome'&&s.controls.some(c=>c.id==='quest.welcome.dismiss'&&ready(c)))return {valid:true,mode:'quest-welcome'};
    if(s.scene==='home')return {valid:true,mode:'home'};
    if(s.scene==='organization'&&o?.phase==='base')return {valid:true,mode:'organization'};
    if(equipBase)return {valid:true,mode:'equipment',...(arg.includeFleet?{fleet:s.fleet}:{})};
    if(arg.allowPortReturn&&s.scene!=='home'&&s.controls.filter(c=>c.id==='navigate.home'&&homeReady(c)).length===1)return {valid:true,mode:'port-return',returnButton:{x:62,y:58}};
    return invalid('A native panel or unsupported scene is open');
  }
  if(kind==='orgtab')return orgTab;
  if(kind==='equipTabs')return {valid:equipBase&&(!arg.fleet||s.fleet===arg.fleet),selected:[s.fleet]};
  if(kind==='equipship')return {valid:equipBase&&s.fleet===arg.fleet&&(!arg.shipId||s.shipId===arg.shipId)&&e.level===arg.expectedLevel,level:e?.level};
  if(kind==='equipremove'||kind==='equipclear'){
    const count=e?.slots?.filter(slot=>slot.visible).length;
    const c=kind==='equipclear'?e?.clear:e?.slots?.[arg.slot]?.detach;
    if(!equipBase||s.fleet!==arg.fleet||!Number.isInteger(arg.slots)||arg.slots!==count||!ready(c)||kind==='equipremove'&&e.slots[arg.slot]?.index!==arg.slot)return invalid('Equipment base or detach control unavailable');
    return {valid:true,tab:{valid:true,selected:[s.fleet]},commit:c.point};
  }
  if(kind==='equipmode')return equipList()&&[0,1].includes(e.mode)?{valid:true,mode:e.mode===0?'stock':'others'}:invalid('Equipment source controls unavailable');
  if(kind==='equippicker'){
    const page=pageResult(e?.page),valid=equipList()&&Number.isInteger(e.filter);
    return {valid,category:valid?e.filter:null,primary:valid?categories.find(c=>c.id===e.filter)?.primary??null:null,page};
  }
  if(kind==='pageread')return (arg.layout==='equip'?equipList():o?.phase==='picker')?pageResult(arg.layout==='equip'?e.page:o.page):invalid('Picker page unavailable');
  if(kind==='cells'){
    if(!equipContext()||e.phase!=='category')return invalid('Category menu unavailable');
    const cells=e.categories||[],target=cells.find(c=>c.id===arg.categoryId);
    if(target?.control.unclipped===false)return invalid('Target category still clipped by menu animation');
    return {valid:cells.some(c=>c.id===0&&ready(c.control)),
      categories:cells.map(c=>ready(c.control)?c.id:null),primaries:cells.map(c=>categories.find(t=>t.id===c.id)?.primary??null),centers:cells.map(c=>c.control.point)};
  }
  if(kind==='rowicon'){
    const row=e?.rows?.[arg.row],item=store?.info.equips[row?.itemId],type=store?.const.$equips[item?.api_slotitem_id]?.api_type?.[3];
    const valid=equipList()&&e.page.activePage===arg.page&&row?.visible===true&&row.itemId===arg.itemId&&row.itemId===row.expectedId&&ready(row.control)
      &&row.unset===false&&row.isSortie===false&&row.isExpedition===false&&(row.sourceShip??null)===(arg.sourceShipId??null)&&type===arg.t3;
    return {valid:!!valid,expectedType:arg.t3,actualType:type??null};
  }
  if(kind==='pix')return arg.purpose==='equipment-confirm'&&e?.phase==='confirm'&&selection()?{valid:true}:invalid('Exact equipment confirmation unavailable');
  if(kind==='borrowconfirm')return e?.phase==='borrow'&&e.mode===1&&selection()?{valid:true,commit:e.commit.point}:invalid('Exact borrowed-equipment confirmation unavailable');
  if(kind==='filterstate')return o?.phase==='picker'?{valid:o.filters.length===8&&o.filters.every(f=>typeof f.state==='boolean'),states:o.filters.map(f=>Number(f.state))}:invalid('Ship filters unavailable');
  if(kind==='sortread')return o?.phase==='picker'?{valid:!!sortModes[o.sort],mode:sortModes[o.sort]||'unknown',direction:'desc'}:invalid('Ship sort unavailable');
  if(kind==='picker'){
    const filter=observeControls(s,'filterstate',arg,store),sort=observeControls(s,'sortread',arg,store),page=pageResult(o?.page);
    const rows=o?.rows?.filter(r=>r.control.visible)||[];
    const identities=rows.length===Math.min(10,o?.sourceCount-((page.activePage||1)-1)*10)&&rows.every(r=>Number.isSafeInteger(r.shipId)&&r.shipId>0&&r.shipId===r.expectedId);
    return {valid:!!(orgTab.valid&&o?.phase==='picker'&&sort.valid&&filter.valid&&identities),tab:orgTab,sort,filter,page};
  }
  if(kind==='cardidentity'){
    if(!orgTab.valid||o?.phase!=='confirm'||o.selectedShip!==arg.shipId||o.confirmFleet!==arg.fleet||o.confirmSlot!==arg.slot||!ready(o.commit))return invalid('Exact ship confirmation unavailable or disabled');
    return {valid:true,commit:o.commit.point};
  }
  if(kind==='orgclear'||kind==='orgdetach'){
    const c=kind==='orgclear'?o?.clear:o?.detach;
    if(!orgTab.valid||o?.phase!==(kind==='orgclear'?'base':'picker')||!ready(c)||kind==='orgdetach'&&o.slot!==arg.slot)return invalid('Exact fleet removal control unavailable');
    return {valid:true,tab:orgTab,commit:c.point};
  }
  return invalid('Unsupported control observation: '+kind);
}
function matchesMutation(c,m,s){
  const base=s.airbase;
  const pendingSafe=()=>Array.isArray(base?.models)&&base.models.length>0&&new Set(base.models.map(row=>row.base)).size===base.models.length&&base.models.some(row=>row.base===base.base)&&base.models.every(row=>{
    if(row.nameChanged!==false||!Number.isInteger(row.base)||!Number.isInteger(row.mode)||!Number.isInteger(row.pendingMode))return false;
    return row.pendingMode===-1||row.pendingMode===row.mode||row.base===base.base&&row.pendingMode===base.mode;
  });
  if(!m)return !['organization.confirm','organization.detach','organization.clear','equipment.borrow','equipment.clear','airbase.confirm'].includes(c.id)
    &&!(c.id==='airbase.close'&&(!pendingSafe()||base.mode!==base.models.find(row=>row.base===base.base)?.mode))
    &&!(s.scene==='airbase'&&c.id.startsWith('navigate.')&&(!pendingSafe()||base.mode!==base.models.find(row=>row.base===base.base)?.mode))
    &&!c.id.startsWith('equipment.detach.')&&!(c.id==='equipment.confirm'&&s.equipment?.mode===0);
  if(m.path==='api_req_hensei/change')return c.fleet===m.fleet&&c.slot===m.j&&c.shipId===m.ship&&
    c.id===(m.ship===-2?'organization.clear':m.ship===-1?'organization.detach':'organization.confirm');
  if(m.path==='api_req_kaisou/unsetslot_all')return c.id==='equipment.clear'&&c.shipId===m.ship;
  if(m.path==='api_req_air_corps/set_plane')return c.id==='airbase.confirm'&&c.area===m.area&&c.base===m.base&&
    c.slot===m.slot&&c.itemId===m.item&&s.airbase?.itemId===m.item;
  if(m.path==='api_req_air_corps/set_action')return c.id==='airbase.close'&&s.scene==='airbase'&&base?.phase==='base'&&
    c.area===m.area&&c.base===m.base&&c.mode===m.mode&&base.area===m.area&&base.base===m.base&&base.mode===m.mode&&
    Number.isInteger(m.mode)&&m.mode>=0&&m.mode<=4&&pendingSafe()&&
    base.models.some(row=>row.base===m.base&&row.mode!==m.mode);
  if(m.path==='api_req_kaisou/slot_deprive')return c.id==='equipment.borrow'&&c.shipId===m.ship&&c.slot===m.j&&c.itemId===s.equipment?.itemId&&c.sourceShip===m.sourceShip
    &&m.slotKind===(c.slot===-1?1:0)&&[0,1].includes(m.sourceKind);
  if(m.path==='api_req_kaisou/slotset'||m.path==='api_req_kaisou/slotset_ex'){
    const slot=m.path.endsWith('_ex')?-1:m.j;
    return c.shipId===m.ship&&c.slot===slot&&(m.item===-1?c.id.startsWith('equipment.detach.'):c.id==='equipment.confirm'&&c.itemId===m.item&&s.equipment?.mode===0);
  }
  return false;
}
class ControlObserver{
  constructor(host){this.host=host;this.closed=false;this.intent={};}
  async start(host=this.host){this.host=host;this.closed=false;this.intent={};if(typeof host.readControls!=='function')throw controlUnavailable('Game control access unavailable');}
  async read(kind,arg={}){
    if(this.closed)throw Error('Control observer stopped');
    const s=await this.host.readControls();
    if(this.closed)throw Error('Control observer stopped');
    let result;
    try{result=observeControls(s,kind,arg,this.host.getStore());}
    catch(error){if(!(error instanceof TypeError))throw error;throw controlUnavailable('Game control structure unsupported',error);}
    if(result.valid){
      if(arg.targetShip)this.intent.organization={shipId:arg.targetShip,slot:arg.targetSlot,fleet:arg.fleet,mask:arg.mask};
      if(kind==='rowicon'||kind==='pix'||kind==='borrowconfirm')this.intent.equipment=arg;
      if(kind==='equipview')this.intent.emptyEquipmentMode=result.empty?{...arg,mode:result.mode}:null;
      if(kind==='airbase-action')this.intent.airbaseAction=arg;
      if(kind==='airbase-swap')this.intent.airbaseDrag=arg;
      if(kind==='airbase-slot')this.intent.airbaseSlot=arg;
      if(kind==='airbase-row')this.intent.airbaseRow=arg;
      if(kind==='airbase-selection')this.intent.airbaseSelection=arg;
      if(kind==='airbase-tab')this.intent.airbaseTab=arg;
      if(kind==='airbase-close-clean')this.intent.airbaseClose=arg;
      if(kind==='airbase-navigation')this.intent.airbaseNavigation=arg;
      if(kind==='batch')for(let i=0;i<arg.checks.length;i++)if(arg.checks[i].kind==='rowicon'&&result.results[i].valid)this.intent.equipment=arg.checks[i].arg;
    }
    return result;
  }
  async prepareInput(input){
    if(this.closed)throw Error('Control observer stopped');
    const s=await this.host.readControls();checkInterruption(s);if(!s.valid||s.blocked)throw controlUnavailable('Game controls changed before input: '+(s.reason||'not ready'));
    if(this.closed)throw Error('Control observer stopped');
    if(input.kind==='hover'&&input.x===0&&input.y===0)return {x:0,y:0};
    const inside=c=>c.bounds&&input.x>=c.bounds.left&&input.x<=c.bounds.right&&input.y>=c.bounds.top&&input.y<=c.bounds.bottom;
    let targets=s.controls.filter(c=>(c.id==='navigate.home'?homeReady(c):ready(c))&&(input.controlId?c.id===input.controlId:inside(c))&&(input.kind==='hover'||matchesMutation(c,input.mutation,s)));
    if(!input.mutation&&input.kind!=='hover')targets=targets.filter(c=>{
      if(c.id.startsWith('organization.row.')){
        const a=this.intent.organization,o=s.organization;
        return a&&c.shipId===a.shipId&&o.slot===a.slot&&o.targetFleet===a.fleet&&o.sort===3&&
          JSON.stringify(o.filters.map(f=>Number(f.state)))===JSON.stringify(a.mask)&&observeControls(s,'picker',{fleet:a.fleet},this.host.getStore()).valid;
      }
      if(c.id.startsWith('equipment.row.')){const a=this.intent.equipment;return a&&c.row===a.row&&observeControls(s,'rowicon',a,this.host.getStore()).valid;}
      if(c.id==='equipment.mode'&&this.intent.emptyEquipmentMode){const a=this.intent.emptyEquipmentMode;
        const v=observeControls(s,'equipview',a,this.host.getStore());return v.valid&&v.empty&&v.mode===a.mode;}
      if(c.id==='equipment.confirm'){const a=this.intent.equipment;return a&&observeControls(s,'pix',{...a,purpose:'equipment-confirm'},this.host.getStore()).valid;}
      if(c.id==='airbase.action'){const a=this.intent.airbaseAction;return a&&observeControls(s,'airbase-action',a,this.host.getStore()).valid;}
      if(c.id.startsWith('airbase.slot.')){const a=this.intent.airbaseSlot;return a&&c.slot===a.slot&&observeControls(s,'airbase-slot',a,this.host.getStore()).valid;}
      if(c.id.startsWith('airbase.row.')){const a=this.intent.airbaseRow;return a&&c.row===a.row&&observeControls(s,'airbase-row',a,this.host.getStore()).valid;}
      if(c.id.startsWith('airbase.tab.')){const a=this.intent.airbaseTab;return a&&c.base===a.base&&observeControls(s,'airbase-tab',a,this.host.getStore()).valid;}
      if(c.id==='airbase.close'){const a=this.intent.airbaseClose;return a&&observeControls(s,'airbase-close-clean',a,this.host.getStore()).valid;}
      if(c.id.startsWith('airbase.nav.')){const a=this.intent.airbaseNavigation;return a&&observeControls(s,'airbase-navigation',a,this.host.getStore()).valid;}
      return true;
    });
    if(targets.length!==1){
      const message='Unique enabled control not confirmed before input ('+targets.map(c=>c.id).join(',')+')';
      if(!targets.length)throw controlUnavailable(message);
      throw Error(message);
    }
    const target=targets[0];
    if(target.id==='equipment.mode')this.intent.emptyEquipmentMode=null;
    if(input.mutation?.path==='api_req_air_corps/set_plane'&&target.id==='airbase.confirm'){
      const a=this.intent.airbaseSelection;
      if(!a||a.itemId!==input.mutation.item||a.slot!==input.mutation.slot||a.area!==input.mutation.area||a.base!==input.mutation.base||
        !observeControls(s,'airbase-selection',a,this.host.getStore()).valid)throw controlUnavailable('Exact base aircraft confirmation precondition changed');
    }
    if(input.mutation?.path==='api_req_kaisou/slot_deprive'){
      const donor=this.host.getStore().info.ships[input.mutation.sourceShip];
      const id=input.mutation.sourceKind===1?donor?.api_slot_ex:donor?.api_slot?.[input.mutation.sourceJ];
      if(id!==s.equipment.itemId)throw Error('Borrowed equipment source instance changed');
    }
    return target.point;
  }
  async prepareDrag({mutation}){
    if(this.closed)throw Error('Control observer stopped');
    const arg=this.intent.airbaseDrag,s=await this.host.readControls();checkInterruption(s);
    if(!arg||mutation?.path!=='api_req_air_corps/set_plane'||mutation.area!==arg.area||mutation.base!==arg.base||
      mutation.slot!==arg.to||mutation.item!==arg.itemId)throw controlUnavailable('Base drag intent does not match mutation');
    const result=observeControls(s,'airbase-swap',arg,this.host.getStore());
    if(!result.valid)throw controlUnavailable('Base drag precondition changed: '+result.reason);
    return {source:result.source,destination:result.destination};
  }
  releaseFrame(){}
  async dispose(){this.closed=true;this.intent={};}
}
module.exports={ControlObserver,observeControls,matchesMutation};
