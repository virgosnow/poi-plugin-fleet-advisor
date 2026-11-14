'use strict';
const path=require('path'),{pathToFileURL}=require('url');
const equipmentIcons=new Map(require('../../../data/equip_icon_index.json').icons.map(icon=>
  [icon.t3,pathToFileURL(path.join(__dirname,'../../../data/icons',icon.file)).href]));
const equipmentIconUrl=type=>equipmentIcons.get(Number(type))||null;
const {shipName}=require('../shell/model');
const {referenceWeights}=require('../../domain/routes/route_policy');
const {t}=require('../../shared/i18n');
require('../i18n/workbench_catalog');
const equipmentTypes=require('../i18n/equipment_types');
function equipmentTooltip(item){return item?[item.tooltip||item.name,equipmentTypes.line(item.equipmentTypeId??item.aircraftType,item.equipmentTypeName),item.statsText].filter(Boolean).join('\n'):'';}
function equipmentTooltipProps(item,notes=[]){
  if(!item)return {'data-tooltip':t('空槽')};
  const values=[...(item.stats||[]),...(item.airPowerText!==undefined?[['制空值',item.airPowerText]]:[])],rows=[],statKeys=[];
  // Older callers can provide plain label/value pairs. New equipment models
  // carry stable stat IDs so translation never controls fit highlighting.
  const keys=[...(item.stats||[]).map((row,index)=>item.statKeys?.[index]||(row[0]==='命中'?'accuracy':null)),
    ...(item.airPowerText!==undefined?['airPower']:[])];
  const fitDelta=item.gunFit?.known?Number(item.gunFit.delta):0,roundedFit=Number.isFinite(fitDelta)?Number(fitDelta.toFixed(1)):0;
  for(let i=0;i<values.length;i+=2){
    rows.push([...values[i],...(values[i+1]||['',''])]);
    statKeys.push([keys[i]||null,keys[i+1]||null]);
  }
  return require('./metric_tooltips').attributes({kind:'equipment',title:item.tooltip||item.name,compact:true,
    equipmentTitle:item.displayTitle||null,
    equipmentMasterId:item.masterId??null,equipmentTypeId:item.equipmentTypeId??item.aircraftType??null,equipmentTypeName:item.equipmentTypeName||null,equipmentIcon:item.icon||null,sections:values.length?
    [{layout:'equipment-stats',columns:['属性','数值','属性','数值'],rows,statKeys,numeric:[1,3],fitTone:roundedFit>0?'positive':roundedFit<0?'negative':null}]:[],notes:[...notes,item.airPowerBasis,item.gunFitNote,
      item.stats?.length?'':item.stats?'无属性加成':'装备属性资料待同步'].filter(Boolean)},
    [equipmentTooltip(item),item.airPowerText!==undefined?`制空值：${item.airPowerText}`:'',...notes].filter(Boolean).join('\n'));
}
function withAirPower(item,reading,shipId,{current=false}={}){
  if(!item||![6,7,8,9,10,11,25,26,41,45,56,57,58,59].includes(item.aircraftType)||item.slot==='ex')return item;
  const participates=[6,7,8,11,26,45,56,57,58].includes(item.aircraftType);
  const slot=reading?.slots?.find(s=>s.shipId===shipId&&s.slot===item.slot&&s.itemId===item.id);
  const known=slot&&!slot.unknown&&Number.isFinite(slot.min)&&Number.isFinite(slot.max);
  const text=!participates?'0':!reading?'待计算':!known?'待确认':slot.min===slot.max?String(slot.min):`${slot.min}–${slot.max}`;
  return {...item,airPowerText:text,airPowerBasis:current?'制空按当前搭载':'制空按出击前满载'};
}
function equipmentMasterItem(master,item={},id=0,slot=null,typeNames){
  if(!master)return null;
  const name=master.api_name||'未知装备',extra=slot==='ex';
  const interceptor=Number(master.api_type?.[2])===48;
  const fields=[['api_houg','火力','firepower'],['api_raig','雷装','torpedo'],['api_baku','爆装','bomber'],['api_tyku','对空','antiAir'],['api_tais','对潜','antiSubmarine'],['api_saku','索敌','lineOfSight'],['api_houm',interceptor?'对爆':'命中',interceptor?'bomberDefense':'accuracy'],['api_houk',interceptor?'迎击':'回避',interceptor?'interception':'evasion'],['api_souk','装甲','armor']];
  const values=[],statKeys=[];
  for(const [key,label,statKey]of fields){const n=Number(master[key]);if(Number.isFinite(n)&&n!==0){values.push([label,`${n>0?'+':''}${n}`]);statKeys.push(statKey);}}
  if(Number(master.api_leng)>0){values.push(['射程',({1:'短',2:'中',3:'长',4:'超长',5:'超超长'}[master.api_leng]||String(master.api_leng))]);statKeys.push('range');}
  if(Number(master.api_distance)>0){values.push(['航程',String(master.api_distance)]);statKeys.push('flightRange');}
  const stats=values.map(row=>row.join(' '));
  const typeId=Number(master.api_type?.[2]);
  const masterId=Number(item.api_slotitem_id??master.api_id);
  return {id,masterId:Number.isSafeInteger(masterId)&&masterId>0?masterId:null,slot,extra,name,aircraftType:typeId,equipmentTypeId:Number.isSafeInteger(typeId)&&typeId>0?typeId:null,
    equipmentTypeName:typeNames?.[typeId]?.api_name||null,stats:values,statKeys,statsSummary:stats.map(s=>s.replace(' ','')).join(' '),statsText:stats.length?'基础属性：'+stats.join(' · '):'',icon:equipmentIconUrl(master.api_type?.[3]),
    displayTitle:{name,slot,extra,improvement:Number(item.api_level)||0,proficiency:Number(item.api_alv)||0},
    tooltip:(slot===null?'':`${extra?'增设':`${Number(slot)+1} 槽`} · `)+name+(item.api_level>0?` ★${item.api_level}`:'')+(item.api_alv>0?` · 熟练度 ${item.api_alv}`:'')};
}
function equipmentItem(store,id,slot){
  const item=store.info?.equips?.[id],master=store.const?.$equips?.[item?.api_slotitem_id];
  return id>0?equipmentMasterItem(master,item,id,slot,store.const?.$equipTypes):null;
}
function withGunFit(store,entry,item){
  if(!item||![1,2,3].includes(item.aircraftType)||!entry?.id)return item;
  const result=require('../../domain/combat/gun_fit').fitChange(store,entry.id,entry,item.slot,item.id);
  if(!result.applicable)return item;
  const rounded=n=>Number(n.toFixed(1));
  const signed=n=>`${rounded(n)>=0?'+':''}${rounded(n)}`;
  const base=Number(store.const?.$equips?.[store.info?.equips?.[item.id]?.api_slotitem_id]?.api_houm||0);
  const hasFit=result.known&&rounded(result.delta)!==0;
  const accuracy=result.known?`${signed(base+result.delta)}${hasFit?`（${signed(result.delta)}）`:''}`:`${signed(base)}（待确认）`;
  const stats=[],statKeys=[];
  for(const [index,row]of (item.stats||[]).entries()){
    const key=item.statKeys?.[index];
    if(key==='accuracy'||['命中','适重','适重总计'].includes(row[0]))continue;
    stats.push(row);statKeys.push(key||null);
  }
  stats.push(['命中',accuracy]);statKeys.push('accuracy');
  return {...item,gunFit:result,stats,statKeys,statsSummary:stats.map(row=>row.join('')).join(' '),
    gunFitNote:result.known?(hasFit?`括号内为昼战适重${result.estimated?'（预估）':''}`:result.estimated?'适重预估':''):'适重待确认'};
}

function rosterRows(store){
  const busy=new Set((store.info?.fleets||[]).filter(f=>Number(f.api_mission?.[0])!==0)
    .flatMap(f=>f.api_ship||[]).filter(id=>id>0));
  const repairing=new Set((store.info?.repairs||[]).map(row=>Number(typeof row==='object'?row.api_ship_id:row)));
  return Object.entries(store.info?.ships||{}).map(([key,ship])=>{
    const id=Number(key),master=store.const?.$ships?.[ship.api_ship_id];
    return {id,name:master?.api_name||`舰娘 #${id}`,level:Number(ship.api_lv||0),
      label:shipName(store,id),unavailable:busy.has(id)?'远征中':
        repairing.has(id)||ship.api_situation===2?'修理中':null};
  }).sort((a,b)=>b.level-a.level||a.id-b.id);
}
const nodeKind={start:'出发',battle:'水上战',nightBattle:'夜战',asw:'对潜战',
  aerialCombat:'航空战',aerialRaid:'空袭',noBattle:'无战斗',resources:'资源',transport:'运输卸载',
  item:'资源',whirlpool:'涡潮',activeBranch:'能动分岐',airRecon:'航空侦察',unknown:'资料不足'};
function portraitUrl(store,masterId,resolver,graphIndex){
  if(!masterId)return null;
  try{
    const getPath=resolver||require('views/utils/ship-img').getShipImgPath;
    const graphs=store.const?.$shipgraph;
    const graph=graphIndex?graphIndex.get(Number(masterId)):Array.isArray(graphs)?graphs.find(g=>g.api_id===masterId):graphs?.[masterId];
    return getPath(masterId,'banner',false,store.info?.server?.ip,graph?.api_version?.[0])||null;
  }catch(_){return null;}
}
function fleetRows(store,scheme){
  return (scheme?.ships||[]).map((entry,index)=>{
    const ship=store.info?.ships?.[entry.id],master=store.const?.$ships?.[ship?.api_ship_id];
    const slots=entry.slots||ship?.api_slot||[];
    const gearIcons=[];
    const equipmentRow=(id,slot)=>{
      if(id<=0)return null;
      const item=store.info?.equips?.[id],equipment=store.const?.$equips?.[item?.api_slotitem_id];
      const name=equipment?.api_name||'未知装备',extra=slot==='ex';
      const tooltip=`${extra?'增设':`${slot+1} 槽`} · ${name}`+
        (item?.api_level>0?` ★${item.api_level}`:'')+
        (item?.api_alv>0?` · 熟练度 ${item.api_alv}`:'');
      gearIcons.push(withGunFit(store,entry,equipmentItem(store,id,slot))||{id,slot,extra,name,tooltip,
        icon:equipmentIconUrl(equipment?.api_type?.[3])});
      return tooltip;
    };
    const gear=slots.map(equipmentRow).filter(Boolean);
    const extra=entry.ex??ship?.api_slot_ex;
    if(extra>0)gear.push(equipmentRow(extra,'ex'));
    return {id:entry.id,name:master?.api_name||`舰娘 #${entry.id}`,level:ship?.api_lv||'?',
      type:store.const?.$shipTypes?.[master?.api_stype]?.api_name||'',flagship:index===0,
      portrait:portraitUrl(store,ship?.api_ship_id),gear,gearIcons};
  });
}
function routeReasons(row){
  const route=row.route||{},profile=row.profile;
  if(route.fixedArrivalCondition?.confirmedMeets)
    return profile?.incomplete?['部分出口或连接尚未确认；当前地图只展示已核对的连接。']:[];
  const visited=new Set(['start',...(profile?.routePaths||[]).flatMap(p=>p.nodes),
    ...(profile?.examples||[]).flat()]);
  const selectedExits=new Map();
  for(const path of [...(profile?.routePaths||[]).map(p=>p.nodes),...(profile?.examples||[])]){
    let from='start';
    for(const to of path){
      if(!selectedExits.has(from))selectedExits.set(from,new Set());
      selectedExits.get(from).add(to);from=to;
    }
  }
  const reasons=[];
  for(const point of route.pointAssessments||[]){
    if(profile?.status!=='unavailable'&&!visited.has(point.from))continue;
    const a=point.assessment||{};
    if(a.status==='random'||a.status==='tentativeRandom'){
      const probabilities=a.probabilities||[];
      const normalized=referenceWeights(probabilities.map(p=>({to:p.to,weight:p.probability})),route.ships?.length);
      const reference=a.referencePathProbability??normalized.referencePathProbability;
      if(reference!==undefined||!probabilities.length){
        const chosen=[...(selectedExits.get(point.from)||[])].filter(to=>!a.destinations?.length||a.destinations.includes(to));
        const explicit=chosen.length===1?probabilities.find(p=>p.to===chosen[0])?.probability:null;
        const chance=Math.round((Number.isFinite(explicit)?explicit:reference??.5)*100);
        reasons.push(`${point.from==='start'?'起点':`${point.from} 点`}随机分岐：${chosen.length===1?`所选出口 ${chosen[0]} ${chance}%；其余偏航`:'所选出口概率按当前路线计算'}。`);
        continue;
      }
      const choices=normalized.weights.map(p=>`${p.to} ${Math.round(p.probability*100)}%`).join(' / ');
      reasons.push(`${point.from==='start'?'起点':`${point.from} 点`}随机分岐${choices?`：${choices}`:`：可能前往 ${(a.destinations||[]).join(' / ')}`}。${a.rule||'该编成无法固定这一出口。'}`);
    }else if(a.status==='tentative')reasons.push(`${point.from} 点条件待确认。`);
    else if(a.status==='unknown'){
      if(a.choiceKind==='player'){
        reasons.push(`${point.from} 点为能动分岐，可自行选择 ${(a.destinations||[]).join(' / ')}；请按路线预览的出口选择。`);
        continue;
      }
      const losConditions=value=>!value||typeof value!=='object'?[]:value.los?[value.los]:
        [...(value.and||[]),...(value.or||[])].flatMap(losConditions);
      const los=losConditions(a.unconfirmedCondition);
      const values=los.map(condition=>{
        const score=route.lineOfSight?.scoresByCoefficient?.[condition.coefficient];
        return `33 式（系数 ${condition.coefficient}）${Number.isFinite(score)?`约 ${Math.round(score*100)/100}`:'资料不足'}`;
      });
      reasons.push(`${point.from} 点条件待确认：${values.length?`${values.join('、')}；索敌${route.lineOfSight?.status==='estimate'?'来自换装估算':'资料未确认'}`:a.reason||a.rule||'舰队或装备信息尚不能确认该分岐条件。'}${a.destinations?.length?`。可能前往 ${(a.destinations||[]).join(' / ')}。`:''}`);
    }
  }
  const losRelevant=!route.pointAssessments||route.pointAssessments.some(p=>visited.has(p.from)&&
    /索[敵敌]|\bLOS\b/i.test((p.clauses||[]).join(' ')+' '+(p.assessment?.reason||'')));
  if(row.routeAfterEquipPending&&losRelevant)reasons.push('换装后的索敌为估算值，带路仍待游戏回读确认。');
  if(profile?.status==='unavailable')reasons.push(profile.reason||'路线资料不完整，无法列出沿途节点。');
  if(profile?.incomplete)reasons.push('部分出口或连接尚未确认；当前地图只展示已核对的连接。');
  if(profile?.truncated)reasons.push('可达路线过多，预览未覆盖全部路线；补给范围可能不完整。');
  if(!reasons.length&&route.verdict!=='guaranteed')reasons.push(route.note||'带路资料尚不能确认固定到达。');
  return [...new Set(reasons)];
}
// Topological route preview, not game-map coordinates. Stable breadth-first
// layers keep alternate branches readable without inventing geographical data.
function mapLayout(preview){
  if(!preview?.nodes?.length)return null;
  const ids=new Set(preview.nodes.map(n=>n.id)),depth=new Map([['start',0]]),queue=['start'];
  for(let i=0;i<queue.length;i++)for(const edge of preview.edges||[]){
    if(edge.from===queue[i]&&ids.has(edge.to)&&!depth.has(edge.to)){
      depth.set(edge.to,depth.get(edge.from)+1);queue.push(edge.to);
    }
  }
  const groups=new Map();
  for(const node of preview.nodes){
    if(!depth.has(node.id))continue;
    const d=depth.get(node.id);if(!groups.has(d))groups.set(d,[]);groups.get(d).push(node);
  }
  const layers=Math.max(...groups.keys())+1;
  const width=Math.max(360,layers*72+24),height=Math.max(160,Math.max(...[...groups.values()].map(g=>g.length))*66+40);
  const nodes=[...groups].flatMap(([d,group])=>group.sort((a,b)=>a.id.localeCompare(b.id)).map((n,i)=>({...n,
    x:28+d*(width-56)/Math.max(1,layers-1),y:height/2+(i-(group.length-1)/2)*66})));
  return {width,height,nodes,edges:(preview.edges||[]).filter(e=>depth.has(e.from)&&depth.has(e.to))};
}
module.exports={equipmentIconUrl,equipmentItem,equipmentMasterItem,equipmentTooltip,equipmentTooltipProps,withAirPower,withGunFit,rosterRows,nodeKind,portraitUrl,fleetRows,routeReasons,mapLayout};
