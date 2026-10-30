'use strict';
// Full-resupply, normal-hit UI references. Not a battle simulation or a
// recommendation score. See docs/ARCHITECTURE.md for mechanism boundaries.
const {cap,torpedoPanel}=require('./attack_power'),{bonus}=require('./opening_asw'),{combatBonuses}=require('./equipment_bonuses');
const jet=require('./jet_aviation');
const {aircraftTypes,activeAircraft,aswMode}=require('./asw_capability');
const compact=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const first=v=>number(Array.isArray(v)?v[0]:v);
const named=(e,names)=>names.some(n=>compact(n)===compact(e.master?.api_name));
const depthNames=['九五式爆雷','二式爆雷','二式爆雷改二','対潜短魚雷(試作初期型)','Hedgehog(初期型)'];
const projectorNames=['九四式爆雷投射機','三式爆雷投射機','三式爆雷投射機改','三式爆雷投射機 集中配備','試製15cm9連装対潜噴進砲','RUR-4A Weapon Alpha改','Mk.32 対潜魚雷(Mk.2落射機)'];
const fighterBomber=e=>e.type===7&&(Number(e.master.api_type?.[3])===7||/^(零戦6[234]型|零式艦戦6[234]型|F4U-1D|FM-2)/.test(compact(e.master.api_name)));
function torpedoPower(target,store){
 const panel=torpedoPanel(target,store),reasons=[...panel.reasons];let improvement=0;
 for(const e of target.items){
  if(![5,21,32].includes(e.type))continue;
  const star=number(e.instance?.api_level);
  if(star===null||star<0){reasons.push('雷击装备改修资料缺失');continue;}
  improvement+=e.type===32?.2*star:1.2*Math.sqrt(star);
 }
 const power=panel.value===null||reasons.length?null:cap(panel.value+improvement+5,180);
 return {status:power===null?'unknown':'known',power,hits:1,reasons:[...new Set(reasons)],detail:`鱼雷\n攻击力：${power??'待确认'} × 1击`};
}
function aswPower(target,store,{opening=false}={}){
 const oldItems=(target.before.slots||[]).concat(target.before.ex).filter(id=>id>0).map(id=>{
  const instance=store.info.equips[id],master=store.const.$equips[instance?.api_slotitem_id];
  return {id:Number(instance?.api_slotitem_id),level:instance?.api_level,type:Number(master?.api_type?.[2]),master,raw:master?Number(master.api_tais||0):null};
 });
 const items=target.items.map(e=>({...e,slot:target.after.slots.indexOf(e.id)<0?'ex':target.after.slots.indexOf(e.id),
  id:Number(e.instance?.api_slotitem_id),level:e.instance?.api_level,raw:e.master?Number(e.master.api_tais||0):null}));
 const old=bonus(store,target,oldItems),blue=bonus(store,target,items),panel=first(target.ship.api_taisen);
 const reasons=[...new Set([...old.reasons,...blue.reasons])];
 const hull=panel===null||!old.known||oldItems.some(e=>e.raw===null)?null:panel-oldItems.reduce((n,e)=>n+e.raw,0)-old.value;
 if(hull===null||hull<0)reasons.push('无法还原舰娘基础对潜');
 const slots=target.after.slots.flatMap((id,slot)=>{
  const e=target.items.find(e=>e.id===id);return e?[{...e,planes:number(target.master.api_maxeq?.[slot])}]:[];
 });
 const aircraft=slots.filter(e=>[7,8,11,25,26,41].includes(e.type)&&([11,25,26,41].includes(e.type)||Number(e.master.api_tais)>0));
 const live=aircraft.some(e=>e.planes>0),unknownCapacity=aircraft.some(e=>e.planes===null);
 const mode=aswMode(target,items,hull??1),air=mode==='air'||opening&&mode===null;
 if(!opening&&mode===null&&!unknownCapacity)return {status:'unavailable',reason:'当前舰种或配装不能对潜',detail:'对潜攻击力：不可用'};
 if((air||mode===null)&&unknownCapacity&&!live)reasons.push('对潜航空槽容量待确认');
 const sonar=items.some(e=>[14,40].includes(e.type)),small=items.some(e=>e.type===14),depth=items.some(e=>e.type===15&&named(e,depthNames)),projector=items.some(e=>e.type===15&&named(e,projectorNames)),mortar=items.some(e=>e.type===15&&/迫撃砲/.test(e.master?.api_name));
 if(items.some(e=>e.type===15&&!named(e,depthNames)&&!named(e,projectorNames)&&!/迫撃砲/.test(e.master?.api_name)))reasons.push('对潜兵装协同未收录');
 const synergy=(sonar&&(projector||mortar)?1.15:1)*(1+(depth&&(small||sonar&&!projector&&!mortar)?.15:0)+(depth&&projector?.1:0));
 const weapons=items.filter(e=>[7,8,11,14,15,25,26,40].includes(e.type)&&(!aircraftTypes.has(e.type)||activeAircraft(target,e)));
 const raw=weapons.reduce((n,e)=>n+(e.raw||0),0);
 let improvement=0;
 for(const e of weapons){
  const star=number(e.level);if(star===null||star<0){reasons.push('对潜装备改修资料缺失');continue;}
  if([14,15,40].includes(e.type))improvement+=Math.sqrt(star);
  else if(e.type===25)improvement+=.3*star;
  else if(e.type===26)improvement+=(compact(e.master.api_name)==='三式指揮連絡機改'?.3:.2)*star;
  else if([7,8].includes(e.type)&&!fighterBomber(e))improvement+=.2*star;
  else if(e.type===11&&star>0)reasons.push('水爆对潜改修补正未确认');
 }
 const base=reasons.length||!blue.known?null:(2*Math.sqrt(hull)+1.5*(raw+blue.value)+improvement+(air?8:13))*synergy;
 const rows=[['单横',1.3],['单纵',.6]].map(([formation,multiplier])=>({formation,power:base===null?null:cap(base*multiplier,170),hits:1}));
 return {status:base===null?'unknown':'known',base,synergy,rows,reasons:[...new Set(reasons)],
  detail:rows.map(r=>`${r.formation}攻击力：${r.power??'待确认'} × 1击`).join('\n')};
}
function aviationPowers(target,store,slots,allocationSlots=slots,{withoutBlueReference=false}={}){
 const observed=combatBonuses(store,target),blue=withoutBlueReference?{...observed,known:true,matches:[]}:observed,
  reasons=new Set(observed.reasons),bonuses=new Map();
 if(withoutBlueReference)reasons.add('假设航空攻击不计蓝字加成，仅作基础参考，实际数值可能不同');
 for(const m of blue.matches){if(!bonuses.has(m.fromInstance))bonuses.set(m.fromInstance,{torpedo:0,bomber:0});
  const own=bonuses.get(m.fromInstance);own.torpedo+=m.torpedo;own.bomber+=m.bomber;}
 const stat=s=>Number(s.equipment.master[s.equipment.type===8?'api_raig':'api_baku']||0);
 const eligible=allocationSlots.filter(s=>s.planes>0).sort((a,b)=>stat(b)-stat(a)||b.planes-a.planes||a.slot-b.slot);
 const contributed=type=>allocationSlots.filter(s=>s.equipment.type===type).map(s=>bonuses.get(s.equipment.id)?.torpedo||0).filter(v=>v>0);
 const torp=contributed(8),water=contributed(11),planeBonus=(torp.length?Math.min(...torp):0)+(water.length?Math.max(...water):0);
 const crew=blue.matches.filter(m=>m.fromType===35).reduce((n,m)=>({torpedo:n.torpedo+m.torpedo,bomber:n.bomber+m.bomber}),{torpedo:0,bomber:0});
 // Unknown slot sizes can change which aircraft receives the one plane bonus.
 const ambiguous=planeBonus>0&&allocationSlots.some(s=>s.planes===null);if(ambiguous)reasons.add('航空槽容量不足以分配蓝字加成');
 const rows=slots.map(({equipment:e,slot,planes})=>{
  const jets=e.type===57,unsupported=e.type===58,star=number(e.instance?.api_level),n=number(planes),value=number(e.master[e.type===8?'api_raig':'api_baku']??0);
  const bombFighter=fighterBomber(e);
  const improvement=[8,11].includes(e.type)||e.type===7&&!bombFighter?star===null?null:.2*star:0;
  if(unsupported)reasons.add('喷式舰攻攻击倍率未收录');
  const extra=(eligible[0]?.slot===slot?planeBonus:0)+(e.type===8?crew.torpedo:crew.bomber);
  const base=!blue.known||ambiguous||n===null||n<0||value===null||value<0||improvement===null||unsupported?null:(value+improvement+extra)*Math.sqrt(n)+25;
  const powers=n===0?[]:base===null?[null]:e.type===8?[cap(base*.8,170),cap(base*1.5,170)]:
    [jets?jet.jetPower(value,n,{phase:'ordinary',extra:(improvement||0)+extra}):cap(base,170)];
  if(n===null)reasons.add(`第 ${slot+1} 槽容量待确认`);if(improvement===null)reasons.add(`第 ${slot+1} 槽改修资料缺失`);
  const line=n===0?'攻击力：不可用':`攻击力：${powers.map(p=>p??'待确认').join(' 或 ')} × 1击`;
  return {slot,name:e.master.api_name,planes:n,powers,...jets?{jetAssault:jet.jetPower(value,n)}:{},
   detail:`第 ${slot+1} 槽 ${e.master.api_name}（${n??'待确认'} 架）\n${line}`};
 });
 return {rows,reasons:[...reasons],notes:rows.some(r=>r.powers.length===2)?['舰攻两档威力各约50%。']:[],detail:rows.map(r=>r.detail).join('\n')};
}
module.exports={aswPower,aviationPowers,torpedoPower};
