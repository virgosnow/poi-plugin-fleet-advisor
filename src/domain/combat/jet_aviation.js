'use strict';
// Shared ship-borne jet facts, not land-base/support or enemy-jet simulation.
// wikiwiki.jp/kancolle/噴式景雲改#JetAssault / #eaec51fd
// wikiwiki.jp/kancolle/航空戦#Airstrike / 対空砲火#avoid_AAfire
// wikiwiki.jp/kancolle/震電改三(試製 噴式震電), checked 2026-10-26.
const VERSION='ship-jets-2026-10-26';
const tooltip=require('../../shared/mechanism_text');
const TYPES={fighter:56,bomber:57,attacker:58};
const PHASES={softCap:170,ordinaryPower:1/Math.SQRT2,proportionalLoss:0.6};
const RULES={
  199:{role:'bomber',steel:2.8,weightedEvasion:0.5,fleetEvasion:0.7},
  200:{role:'bomber',steel:2.6,weightedEvasion:0.5,fleetEvasion:0.5},
  548:{role:'fighter',steel:2.2,weightedEvasion:1,fleetEvasion:1}
};
const CI={jFjBjB:{multiplier:1.35,observationConstant:135},
  jFjB:{multiplier:1.30,observationConstant:125},jFBA:{multiplier:1.27,observationConstant:115}};
function carrierModes(types){
  const n=t=>types.filter(v=>v===t).length,f=n(6),b=n(7),a=n(8),jf=n(56),jb=n(57),m=[];
  if(jf&&jb>=2)m.push('jFjBjB');if(jf&&jb)m.push('jFjB');if(jf&&b&&a)m.push('jFBA');
  if(f&&b&&a)m.push('FBA');if(b>=2&&a)m.push('BBA');if(b&&a)m.push('BA');
  return m;
}
const isJet=type=>[56,57,58].includes(Number(type));
const spec=(masterId,type)=>{
  const row=RULES[masterId];
  return row&&TYPES[row.role]===Number(type)?row:null;
};
function steelAvailable(store){
  const r=store?.info?.resources;
  const n=Array.isArray(r)?typeof r[2]==='number'?r[2]:r.find(e=>Number(e?.api_id)===3)?.api_value:
    r?.steel??r?.api_steel;
  return Number.isFinite(n)&&n>=0?n:null;
}
function steelCost(masterId,type,planes){
  const rule=spec(masterId,type);
  return rule&&Number.isInteger(planes)&&planes>=0?Math.round(planes*rule.steel):null;
}
// Species multiplier is pre-cap. The final floor is after the 170 soft cap;
// no intermediate 0.7 approximation, contact or proficiency critical bonus.
function jetPower(bomb,planes,{phase='assault',extra=0}={}){
  if(!Number.isFinite(bomb)||bomb<0||!Number.isFinite(planes)||planes<=0)return null;
  const base=(bomb+extra)*Math.sqrt(planes)+25;
  const n=phase==='ordinary'?base*PHASES.ordinaryPower:base;
  return Math.floor(n>PHASES.softCap?PHASES.softCap+Math.sqrt(n-PHASES.softCap):n);
}
function applicable(node){
  if(node.noAirBattle===true||node.jetAssault===false||node.pureSubmarines===true)return false;
  if(['asw','aerialRaid','nightBattle','start','noBattle','resources','item','transport','whirlpool','activeBranch','airRecon'].includes(node.kind))return false;
  return ['battle','aerialCombat'].includes(node.kind)?true:null;
}
function selectedNodes(profile){
  const paths=profile?.routePaths?.length?profile.routePaths.map(p=>p.nodes):profile?.examples||[];
  if(profile?.area&&paths.length){
    const reference=require('../routes/route_air').routeAirReference({},profile.area,profile);
    if(reference.nodes?.length)return reference.nodes;
  }
  const ids=new Set(paths.flat());
  return (profile?.mapPreview?.nodes||[]).filter(n=>!ids.size||ids.has(n.id));
}
function assaultBadge(target,store,profile){
  const jets=target.after.slots.flatMap((id,slot)=>{
    const e=target.items.find(e=>e.id===id);return e&&[57,58].includes(e.type)?[{e,slot}]:[];
  });
  if(!jets.length)return null;
  const rows=[],reasons=[],steel=steelAvailable(store);let unknown=false,live=false,illegal=false;
  for(const {e,slot} of jets){
    const raw=target.master.api_maxeq?.[slot],planes=raw==null?null:Number(raw);
    let legal;
    try{legal=require('../fleet/equipment_rules').canEquip(store,target.id,e.id,slot);}catch(_){legal=null;}
    if(legal===false){illegal=true;reasons.push(`第${slot+1}槽装备资格不符`);}
    if(legal===null){unknown=true;reasons.push(`第${slot+1}槽装备资格资料缺失`);}
    if(planes===null||!Number.isInteger(planes)||planes<0){unknown=true;reasons.push(`第${slot+1}槽容量资料缺失`);}
    if(e.type===58){unknown=true;reasons.push('喷式舰攻的强袭与损耗规则未确认');}
    const rule=spec(e.instance?.api_slotitem_id,e.type);
    if(!rule){unknown=true;reasons.push(`${e.master.api_name}的钢材与回避资料缺失`);}
    const available=legal===true&&planes>0&&e.type===57;
    live||=available;
    rows.push({slot,name:e.master.api_name,planes,power:available?jetPower(Number(e.master.api_baku),planes):null,
      steel:steelCost(e.instance?.api_slotitem_id,e.type,planes),legal});
  }
  if(steel===null){unknown=true;reasons.push('当前钢材资料缺失');}
  if(steel===0)reasons.push('钢材为0，不能喷式强袭；仍可参加普通航空战');
  if(!live&&!unknown&&!illegal)reasons.push('喷气舰爆所在槽位容量为0');
  const nodes=selectedNodes(profile);
  if(nodes.length&&!nodes.some(n=>applicable(n)!==false))reasons.push('所选路线没有喷式强袭适用节点');
  const state=illegal||steel===0||!live&&!unknown?'blocked':unknown?'unknown':'ready';
  const totalSteel=rows.every(r=>r.steel!==null)?rows.reduce((sum,r)=>sum+r.steel,0):null;
  const detail=tooltip(state==='ready'?'有可用喷气攻击机时固定发动':state==='unknown'?'发动情况：待确认':'当前无法发动',
    rows.flatMap(r=>[
      `第 ${r.slot+1} 槽 ${r.name}（${r.planes??'待确认'} 架）`,
      r.planes===0||r.legal===false?'攻击力：不可用':`攻击力：${r.power??'待确认'} × 1击`]),
    [`本舰钢材消耗：${totalSteel??'待确认'}／次`,
      '普通航空战前攻击敌舰。','按出击前满载；未计损耗与暴击。',...reasons]);
  return {key:'jet-assault',label:'喷式强袭',state,
    attacks:rows,steelAvailable:steel,reasons,detail};
}
function antiAirLoss(count,node,jet){
  if(count<=0||jet.role==='fighter')return 0;
  const aa=node.antiAir;
  if(aa?.status!=='known')return null;
  if(!aa.profiles?.length){
    // Synthetic/legacy envelopes cannot reconstruct the two separately rounded
    // evasion terms. Keep the unreduced loss as a conservative bound.
    return Math.floor(count*aa.proportion)+aa.fixed;
  }
  let maximum=0;
  for(const p of aa.profiles){
    const weighted=Math.floor(p.weighted*jet.weightedEvasion),defense=Math.floor(p.defense*jet.fleetEvasion);
    const proportion=weighted*p.combinedFactor/400;
    const fixed=Math.floor((weighted+defense)*p.combinedFactor*0.09375);
    maximum=Math.max(maximum,Math.floor(count*proportion)+fixed);
  }
  return maximum;
}
module.exports={VERSION,TYPES,PHASES,RULES,CI,isJet,spec,carrierModes,steelAvailable,steelCost,jetPower,applicable,selectedNodes,assaultBadge,antiAirLoss};
