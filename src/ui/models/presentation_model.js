'use strict';
const path=require('path'),{pathToFileURL}=require('url');
const equipmentIcons=new Map(require('../../../data/equip_icon_index.json').icons.map(icon=>
  [icon.t3,pathToFileURL(path.join(__dirname,'../../../data/icons',icon.file)).href]));
const equipmentIconUrl=type=>equipmentIcons.get(Number(type))||null;
const {shipName}=require('../shell/model');
const {referenceWeights}=require('../../domain/routes/route_policy');
function equipmentTooltip(item){return [item?.tooltip,item?.statsText].filter(Boolean).join('\n');}
function equipmentItem(store,id,slot){
  const item=store.info?.equips?.[id],master=store.const?.$equips?.[item?.api_slotitem_id];
  if(!master||id<=0)return null;
  const name=master.api_name||'未知装备',extra=slot==='ex';
  const interceptor=Number(master.api_type?.[2])===48;
  const fields=[['api_houg','火力'],['api_raig','雷装'],['api_baku','爆装'],['api_tyku','对空'],['api_tais','对潜'],['api_saku','索敌'],['api_houm',interceptor?'对爆':'命中'],['api_houk',interceptor?'迎击':'回避'],['api_souk','装甲']];
  const stats=fields.flatMap(([key,label])=>{const n=Number(master[key]);return Number.isFinite(n)&&n!==0?[`${label} ${n>0?'+':''}${n}`]:[];});
  if(Number(master.api_leng)>0)stats.push('射程 '+({1:'短',2:'中',3:'长',4:'超长',5:'超超长'}[master.api_leng]||master.api_leng));
  if(Number(master.api_distance)>0)stats.push('航程 '+master.api_distance);
  return {id,slot,extra,name,statsSummary:stats.map(s=>s.replace(' ','')).join(' '),statsText:stats.length?'基础属性：'+stats.join(' · '):'',icon:equipmentIconUrl(master.api_type?.[3]),
    tooltip:`${extra?'增设':`${Number(slot)+1} 槽`} · ${name}`+(item.api_level>0?` ★${item.api_level}`:'')+(item.api_alv>0?` · 熟练度 ${item.api_alv}`:'')};
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
function portraitUrl(store,masterId,resolver){
  if(!masterId)return null;
  try{
    const getPath=resolver||require('views/utils/ship-img').getShipImgPath;
    const graphs=store.const?.$shipgraph;
    const graph=Array.isArray(graphs)?graphs.find(g=>g.api_id===masterId):graphs?.[masterId];
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
      gearIcons.push({id,slot,extra,name,tooltip,
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
      if(/能動分岐|能动分岐/.test(a.reason||a.rule||'')){
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
module.exports={equipmentIconUrl,equipmentItem,equipmentTooltip,rosterRows,nodeKind,portraitUrl,fleetRows,routeReasons,mapLayout};
