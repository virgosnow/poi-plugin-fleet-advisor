'use strict';
const categories=require('../../data/equip_categories.json').templates;
const {controlUnavailable}=require('./recognition_fallback');
const ready=c=>c?.attached===true&&c.visible===true&&c.enabled===true&&c.point&&Number.isFinite(c.point.x)&&Number.isFinite(c.point.y);
const invalid=reason=>({valid:false,reason});
const sortModes={1:'level',2:'type',3:'new',4:'damage',5:'repair',6:'morale'};
const pageResult=p=>p?{valid:p.valid,labels:p.labels,centers:p.centers,activePage:p.activePage,y:p.y,...(p.itemIds?{itemIds:p.itemIds}:{})}:invalid('Picker page unavailable');
function observeControls(snapshot,kind,arg={},store){
  if(!snapshot?.valid||snapshot.blocked||snapshot.version!==1)return invalid(snapshot?.reason||'Game controls unavailable');
  const s=snapshot,e=s.equipment,o=s.organization;
  const orgTab={valid:s.scene==='organization'&&s.fleet===arg.fleet,selected:[s.fleet]};
  const equipBase=s.scene==='equipment'&&e?.phase==='base';
  const equipContext=()=>s.scene==='equipment'&&e&&e.shipId===s.shipId&&(!arg.shipId||e.shipId===arg.shipId)
    &&(arg.slot===undefined||e.slot===arg.slot);
  const equipList=()=>equipContext()&&e.phase==='picker'&&(e.slot===-1||Number.isInteger(e.filterDetail)&&e.filterDetail>=0)&&e.page?.valid
    &&Array.isArray(e.sourceIds)&&e.sourceIds.length===e.sourceCount&&new Set(e.sourceIds).size===e.sourceIds.length
    &&e.sourceIds.every(id=>Number.isSafeInteger(id)&&id>0&&store?.info.equips[id])
    &&e.rows.filter(r=>r.control.visible).length===Math.min(10,e.sourceCount-(e.page.activePage-1)*10)
    &&e.rows.filter(r=>r.control.visible).every(r=>Number.isSafeInteger(r.itemId)&&r.itemId>0&&r.itemId===r.expectedId);
  const selection=()=>equipContext()&&e.itemId===arg.itemId&&(e.sourceShip??null)===(arg.sourceShipId??null)&&e.mode===(arg.sourceShipId?1:0)&&ready(e.commit);
  if(kind==='batch'){
    if(!Array.isArray(arg.checks)||!arg.checks.length||arg.checks.length>8||arg.checks.some(c=>!c||c.kind==='batch'||typeof c.kind!=='string'))throw Error('Invalid observation batch');
    const results=arg.checks.map(c=>observeControls(s,c.kind,c.arg,store));return {valid:results.every(r=>r.valid),results};
  }
  if(kind==='navigation'){
    if(!['home','organization','equipment'].includes(arg.destination))return invalid('Unsupported navigation destination');
    const controls=s.controls.filter(c=>c.id==='navigate.'+arg.destination&&ready(c));
    return {valid:controls.length===1,point:controls.length===1?controls[0].point:null};
  }
  if(kind==='screen'){
    if(s.scene==='home')return {valid:true,mode:'home'};
    if(s.scene==='organization'&&o?.phase==='base')return {valid:true,mode:'organization'};
    if(equipBase)return {valid:true,mode:'equipment',...(arg.includeFleet?{fleet:s.fleet}:{})};
    if(arg.allowPortReturn&&s.scene==='other'&&s.controls.some(c=>c.id==='navigate.home'&&ready(c)))return {valid:true,mode:'port-return',returnButton:{x:62,y:58}};
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
    const valid=equipList()&&e.page.activePage===arg.page&&row?.itemId===arg.itemId&&row.itemId===row.expectedId&&ready(row.control)
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
  if(!m)return !['organization.confirm','organization.detach','organization.clear','equipment.borrow','equipment.clear'].includes(c.id)
    &&!c.id.startsWith('equipment.detach.')&&!(c.id==='equipment.confirm'&&s.equipment?.mode===0);
  if(m.path==='api_req_hensei/change')return c.fleet===m.fleet&&c.slot===m.j&&c.shipId===m.ship&&
    c.id===(m.ship===-2?'organization.clear':m.ship===-1?'organization.detach':'organization.confirm');
  if(m.path==='api_req_kaisou/unsetslot_all')return c.id==='equipment.clear'&&c.shipId===m.ship;
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
      if(kind==='batch')for(let i=0;i<arg.checks.length;i++)if(arg.checks[i].kind==='rowicon'&&result.results[i].valid)this.intent.equipment=arg.checks[i].arg;
    }
    return result;
  }
  async prepareInput(input){
    if(this.closed)throw Error('Control observer stopped');
    const s=await this.host.readControls();if(!s.valid||s.blocked)throw controlUnavailable('Game controls changed before input: '+(s.reason||'not ready'));
    if(this.closed)throw Error('Control observer stopped');
    if(input.kind==='hover'&&input.x===0&&input.y===0)return {x:0,y:0};
    const inside=c=>c.bounds&&input.x>=c.bounds.left&&input.x<=c.bounds.right&&input.y>=c.bounds.top&&input.y<=c.bounds.bottom;
    let targets=s.controls.filter(c=>ready(c)&&(input.controlId?c.id===input.controlId:inside(c))&&(input.kind==='hover'||matchesMutation(c,input.mutation,s)));
    if(!input.mutation&&input.kind!=='hover')targets=targets.filter(c=>{
      if(c.id.startsWith('organization.row.')){
        const a=this.intent.organization,o=s.organization;
        return a&&c.shipId===a.shipId&&o.slot===a.slot&&o.targetFleet===a.fleet&&o.sort===3&&
          JSON.stringify(o.filters.map(f=>Number(f.state)))===JSON.stringify(a.mask)&&observeControls(s,'picker',{fleet:a.fleet},this.host.getStore()).valid;
      }
      if(c.id.startsWith('equipment.row.')){const a=this.intent.equipment;return a&&c.row===a.row&&observeControls(s,'rowicon',a,this.host.getStore()).valid;}
      if(c.id==='equipment.confirm'){const a=this.intent.equipment;return a&&observeControls(s,'pix',{...a,purpose:'equipment-confirm'},this.host.getStore()).valid;}
      return true;
    });
    if(targets.length!==1){
      const message='Unique enabled control not confirmed before input ('+targets.map(c=>c.id).join(',')+')';
      if(!targets.length)throw controlUnavailable(message);
      throw Error(message);
    }
    const target=targets[0];
    if(input.mutation?.path==='api_req_kaisou/slot_deprive'){
      const donor=this.host.getStore().info.ships[input.mutation.sourceShip];
      const id=input.mutation.sourceKind===1?donor?.api_slot_ex:donor?.api_slot?.[input.mutation.sourceJ];
      if(id!==s.equipment.itemId)throw Error('Borrowed equipment source instance changed');
    }
    return target.point;
  }
  releaseFrame(){}
  async dispose(){this.closed=true;this.intent={};}
}
module.exports={ControlObserver,observeControls,matchesMutation};
