'use strict';
// Base aviation is a bounded battle reference, not a prediction of the game's
// hidden random rolls. Inputs are owned equipment instances and explicit targets.
// Rules: data/sortie/land_base/mechanics.json and its linked community sources.
const {maps}=require('../../../data/sortie/land_base/maps.json');
const ranges=[[0,9],[10,24],[25,39],[40,54],[55,69],[70,84],[85,99],[100,120]];
const fighterBonus=[0,0,2,5,9,14,14,22],bomberBonus=[0,0,1,1,1,3,3,6];
const fighters=new Set([6,45,48,56]),airCombat=new Set([6,7,8,11,45,47,48,53,56,91]);
const scouts=new Set([9,10,41,49,59,94]),surfaceAttack=new Set([7,8,11,47,53,91]);
const aswAttack=new Set([8,10,11,25,26,47,53,91]);
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
// The attack bonus is aircraft-specific, not the sortie air-power bonus:
// Mosquito PR has the same air bonus as the skilled Type 2, but less damage.
function reconAttackMultiplier(slots){
  let multiplier=1;
  for(const s of slots||[]){
    if(s.type!==49||!finite(s.count)||s.count<=0)continue;
    const id=Number(s.masterId),name=String(s.name||'').normalize('NFKC');
    if(id===312||/二式陸上偵察機\s*\(熟練\)/.test(name))multiplier=Math.max(multiplier,1.15);
    else if(id===311||id===480||/二式陸上偵察機|Mosquito\s+PR\s+Mk\.?\s*IV/i.test(name))multiplier=Math.max(multiplier,1.125);
  }
  return multiplier;
}
function surfacePower(slot,count,recon=1,installation=false){
  const type=slot.type,land=type===47,heavy=type===53;
  const stat=installation?(type===8?0:slot.fire):[8,47,53].includes(type)?slot.torpedo:slot.fire;
  if(!finite(stat)||!finite(count)||!count)return 0;
  const improvement=land||heavy?.7*Math.sqrt(slot.stars||0):.2*(slot.stars||0);
  const raw=(land?.8:1)*((stat+improvement)*Math.sqrt((heavy?1:1.8)*count)+25)*recon;
  const capped=raw>220?220+Math.sqrt(raw-220):raw;
  return Math.floor(Math.floor(capped)*(land?1.8:1));
}
const slotId=s=>s?.itemId==null&&s?.api_slotid==null?NaN:Number(s.itemId??s.api_slotid);
const unique=list=>[...new Set(list)];
function observedRange(base){
  const value=base?.range??base?.api_distance;
  if(finite(value))return value;
  return finite(value?.api_base)&&finite(value?.api_bonus)?value.api_base+value.api_bonus:null;
}
function inspectSquadron(store,base){
  const input=base?.slots??base?.api_plane_info;
  if(!Array.isArray(input)||input.length>4)return {status:'unknown',range:null,airPower:null,slots:[],reasons:['基地飞机槽资料不足']};
  const actual=(store?.info?.airbase||[]).find(row=>Number(row?.api_area_id)===Number(base?.areaId??base?.api_area_id)&&
    Number(row?.api_rid)===Number(base?.rid??base?.api_rid));
  const reasons=[],slots=[];let rangeUnknown=false,airUnknown=false;
  for(let i=0;i<input.length;i++){
    const s=input[i],id=slotId(s),count=Number(s?.count??s?.api_count),max=s?.maxCount??s?.api_max_count;
    if(!Number.isSafeInteger(id)||id<0){reasons.push('基地飞机实例资料不足');rangeUnknown=airUnknown=true;continue;}
    if(!id)continue;
    if(!Number.isInteger(count)||count<0||max!=null&&(!Number.isInteger(Number(max))||count>Number(max))){reasons.push('基地飞机搭载数待确认');rangeUnknown=airUnknown=true;continue;}
    if(!count)continue;
    const item=store?.info?.equips?.[id],master=store?.const?.$equips?.[item?.api_slotitem_id];
    if(!item||!master){reasons.push('基地飞机装备资料不足');rangeUnknown=airUnknown=true;continue;}
    const type=Number(master.api_type?.[2]),rank=Number(item.api_alv??0),stars=Number(item.api_level??0),distance=Number(master.api_distance);
    const position=Number(s?.slotId??s?.api_squadron_id??i+1);
    const observed=actual?.api_plane_info?.find(p=>Number(p.api_squadron_id)===position&&Number(p.api_slotid)===id);
    const state=s?.state??s?.api_state??observed?.api_state;
    if(!s.planned&&Number(state)!==1){reasons.push('基地飞机尚未就绪或状态待确认');rangeUnknown=airUnknown=true;continue;}
    if(s.planned)reasons.push('计划中的飞机需完成转场并补给后才能出击');
    if(!Number.isFinite(distance)||distance<=0)rangeUnknown=true;
    if(!Number.isInteger(rank)||rank<0||rank>7||!finite(stars)){airUnknown=true;reasons.push('基地飞机熟练度或改修资料不足');continue;}
    if([57,58,91].includes(type)){airUnknown=true;reasons.push('基地喷气或特殊大型飞机规则待确认');continue;}
    if(!airCombat.has(type)&&!scouts.has(type)&&![25,26].includes(type)){airUnknown=true;reasons.push('基地飞机类型暂未支持');continue;}
    const aa=Number(master.api_tyku??0),intercept=type===48?Number(master.api_houk??0):0;
    if(!finite(aa)||!finite(intercept)){airUnknown=true;reasons.push('基地飞机对空或迎击资料不足');continue;}
    const improvement=fighters.has(type)?stars*.2:type===47||type===53?.5*Math.sqrt(stars):0;
    // The aircraft data does not identify every fighter-bomber improvement.
    if(type===7&&stars>0)reasons.push('舰爆改修制空补正未全部确认');
    const bonus=fighters.has(type)?fighterBonus[rank]:type===11?bomberBonus[rank]:0;
    const coeff=aa+improvement+1.5*intercept;
    slots.push({itemId:id,slotId:position,count,maxCount:max==null?null:Number(max),
      type,masterId:item.api_slotitem_id,name:master.api_name||'',distance:finite(distance)&&distance>0?distance:null,
      aa:coeff,proficiency:[bonus+Math.sqrt(ranges[rank][0]/10),bonus+Math.sqrt(ranges[rank][1]/10)],
      fire:Number(master.api_baku??0),torpedo:Number(master.api_raig??0),asw:Number(master.api_tais??0),stars,
      planned:!!s.planned});
  }
  const known=slots.filter(s=>s.distance!==null),baseMin=known.length?Math.min(...known.map(s=>s.distance)):null;
  const recon=known.filter(s=>scouts.has(s.type)),maxRecon=recon.length?Math.max(...recon.map(s=>s.distance)):null;
  let distance=rangeUnknown||baseMin===null?null:baseMin+(maxRecon===null?0:Math.min(3,Math.round(Math.sqrt(Math.max(0,maxRecon-baseMin)))));
  if(distance===null&&!input.some(s=>s?.planned)&&observedRange(base)!==null){distance=observedRange(base);reasons.push('航程采用当前基地实测值');}
  let reconMultiplier=1;
  for(const s of slots.filter(s=>s.type===49)){
    const m=store.const.$equips[s.masterId],los=Number(m.api_saku);
    if(!finite(los)){airUnknown=true;reasons.push('陆侦索敌资料不足');}
    else reconMultiplier=Math.max(reconMultiplier,los>=9?1.18:los>=8?1.15:1);
  }
  // Reconnaissance planes contribute their AA and generic proficiency bonus
  // in land-base air combat even though they do not participate in the
  // ordinary fleet air-state calculation.
  const value=(count,side)=>Math.floor(slots.reduce((sum,s)=>sum+((airCombat.has(s.type)||scouts.has(s.type))&&count(s)>0?
    Math.floor(s.aa*Math.sqrt(count(s))+s.proficiency[side]):0),0)*reconMultiplier);
  const airPower=airUnknown?null:{min:value(s=>s.count,0),max:value(s=>s.count,1)};
  if(distance===null)reasons.push('基地航空队航程待确认');
  return {status:airUnknown||distance===null?'unknown':reasons.length?'partial':'ready',range:distance,airPower,slots,
    reconMultiplier,reasons:unique(reasons)};
}
function nodeRadius(area,nodeId){
  try{
    const n=require(`../../../data/sortie/encounters/${area}.json`).nodes?.[nodeId];
    const values=Object.values(n?.phases||{}).flatMap(phase=>(phase.patterns||[]).map(p=>p.lbasRadius));
    return values.length&&values.every(v=>finite(v)&&v===values[0])?values[0]:null;
  }catch(_){return null;}
}
function prepare(store,bases,{area,nodeId,nodeKind,enemyAirPower}={}){
  if(!Array.isArray(bases)||!bases.length)return {status:'none',waves:[],reasons:[]};
  const map=maps.find(m=>m.id===area&&m.available),reasons=[],waves=[];
  if(!map)return {status:'none',waves:[],reasons:[]};
  const selected=bases.filter(b=>Array.isArray(b?.targets)&&b.targets.slice(0,2).some(Boolean))
    .slice().sort((a,b)=>Number(a.rid??a.api_rid)-Number(b.rid??b.api_rid))
    .slice(0,map.maxSortieSquadrons);
  const assigned=selected.filter(b=>b.targets.slice(0,2).includes(nodeId));
  if(!assigned.length)return {status:'none',waves:[],reasons:[]};
  const ids=selected.map(b=>Number(b.rid??b.api_rid));
  const items=selected.flatMap(b=>{const slots=b.slots??b.api_plane_info;return Array.isArray(slots)?slots.map(slotId).filter(id=>id>0):[];});
  if(selected.some(b=>Number(b.areaId??b.api_area_id)!==map.baseAreaId)||new Set(ids).size!==ids.length||new Set(items).size!==items.length)
    return {status:'unknown',waves:[],reasons:['基地航空队区域或飞机实例分配不正确']};
  if(nodeKind==='nightBattle')return {status:'partial',waves:[],reasons:['夜战节点不计基地航空攻击']};
  const radius=nodeRadius(area,nodeId);
  for(const base of assigned){
    const view=inspectSquadron(store,base),rid=Number(base.rid??base.api_rid);
    if(!Number.isInteger(rid)||rid<1||view.status==='unknown'||radius===null||view.range<radius){
      reasons.push(`${nodeId} 点基地 ${Number.isInteger(rid)?rid:'?'} 队${radius===null?'航程需求待确认':view.range!==null&&view.range<radius?'航程不足':'资料待确认'}`);continue;
    }
    if(!finite(enemyAirPower)){reasons.push(`${nodeId} 点敌制空资料不足，未计基地航空攻击`);continue;}
    for(const target of base.targets.slice(0,2))if(target===nodeId)waves.push({rid,slots:view.slots,reconMultiplier:view.reconMultiplier,
      reconAttackMultiplier:reconAttackMultiplier(view.slots),airPower:view.airPower});
    reasons.push(...view.reasons);
  }
  if(waves.length&&nodeKind==='aerialRaid')reasons.push('空袭点的基地攻击对敌舰伤害尚未完整建模，预测主要反映敌机削减');
  if(waves.length)reasons.push('基地航空为参考估算：敌对空炮火、触接与对地特效未完整计入；基地飞机损耗取参考中值',
    '敌机逐槽按制空战抽样；本队制空参考区间为 5%–95% 分位，并非极限或保证');
  return {status:waves.length?'partial':'unknown',waves,reasons:unique(reasons),enemyAirPower};
}
const zForState={supremacy:1,superiority:3,parity:5,disadvantage:7,loss:10,none:0};
function stateFor(own,enemy){
  if(!own&&!enemy)return 'none';
  return !enemy||own>=3*enemy?'supremacy':own>=1.5*enemy?'superiority':
    own>2*enemy/3?'parity':own>enemy/3?'disadvantage':'loss';
}
function simulateWaves(waves,enemyPower,foes,hp,rng,{hitDamage,applyDamage,trace,state,enemySlots}={}){
  if(!waves?.length||!finite(enemyPower))return {enemyPower,remainingRatio:1};
  const counts=state?.counts||(state?(state.counts={}):{}),initial=new Map(),losses=new Map();
  const baseKey=(wave,slot)=>`${wave.rid}:${slot.slotId}:${slot.itemId}`;
  for(const wave of waves)for(const slot of wave.slots){
    const key=baseKey(wave,slot);if(!initial.has(key))initial.set(key,Number.isInteger(counts[key])?counts[key]:slot.count);
  }
  const enemy=Array.isArray(enemySlots)?enemySlots.map(slot=>({...slot})):null;
  const enemyModel=enemy?require('./enemy_land_air'):null;
  if(enemy)enemyPower=enemyModel.power(enemy,true);
  const original=enemyPower,originalAttack=enemy?.filter(slot=>[7,8,11].includes(slot.type)).reduce((sum,slot)=>sum+slot.count,0);
  for(const wave of waves){
    if(!hp.some(value=>value>0))break;
    const living=foes.filter((foe,i)=>hp[i]>0);
    if(living.length&&living.every(foe=>foe.submarine)&&
      !wave.slots.some(slot=>aswAttack.has(slot.type)&&finite(slot.asw)&&slot.asw>=7&&initial.get(baseKey(wave,slot))>0))continue;
    const air=Math.floor(wave.slots.reduce((sum,slot)=>{
      const count=initial.get(baseKey(wave,slot));
      return sum+((airCombat.has(slot.type)||scouts.has(slot.type))&&count>0?Math.floor(slot.aa*Math.sqrt(count)+(slot.proficiency[0]+slot.proficiency[1])/2):0);
    },0)*wave.reconMultiplier);
    const mode=stateFor(air,enemyPower),z=zForState[mode],before=hp.slice();
    if(enemy){
      const maximum=11-z;
      for(const slot of enemy){if(slot.recon||!slot.count)continue;
        const a=Math.floor(rng()*(maximum+1)),b=Math.floor(rng()*(maximum+1));
        slot.count-=Math.floor(slot.count*(.035*a+.065*b)+1e-10);
      }
      enemyPower=enemyModel.power(enemy,true);
    }else if(enemyPower>0&&z){
      // Legacy callers lacking a formation keep an explicitly approximate
      // scalar reference; production map forecasts provide enemy slots.
      const fraction=(11-z)/20;enemyPower=Math.floor(enemyPower*Math.sqrt(Math.max(0,1-fraction)));
    }
    for(const slot of wave.slots){
      const key=baseKey(wave,slot),count=initial.get(key),loss=airCombat.has(slot.type)?Math.floor(count*z*5/120):0;
      // Concentrated waves at this node both depart with the aircraft count
      // from before the first wave. Only the last wave's losses persist after
      // the node; first-wave losses are restored between the two attacks.
      // Dispersed waves run at different nodes and carry counts via state.
      losses.set(key,loss);
      const aircraft=Math.max(0,count-loss);if(!aircraft)continue;
      const canAsw=aswAttack.has(slot.type)&&finite(slot.asw)&&slot.asw>=7;
      const submarines=canAsw?foes.map((foe,i)=>({foe,i})).filter(x=>x.foe.submarine&&before[x.i]>0):[];
      const targets=submarines.length?submarines:surfaceAttack.has(slot.type)?
        foes.map((foe,i)=>({foe,i})).filter(x=>!x.foe.submarine&&before[x.i]>0&&finite(x.foe.armor)):[];
      if(!targets.length)continue;
      const target=targets[Math.min(targets.length-1,Math.floor(rng()*targets.length))],isAsw=target.foe.submarine;
      let power;
      if(isAsw){
        const factor=slot.asw>=10?.85:.575,recon=wave.reconAttackMultiplier??reconAttackMultiplier(wave.slots);
        power=Math.floor(Math.min(170,((slot.asw+.66*Math.sqrt(slot.stars))*Math.sqrt(1.8*aircraft)+25)*factor)*recon*(slot.type===47?1.8:1));
      }else{
        power=surfacePower(slot,aircraft,wave.reconAttackMultiplier??reconAttackMultiplier(wave.slots),target.foe.installation);
      }
      if(Array.isArray(trace))trace.push({stage:'landBase',phase:isAsw?'asw':'air',side:'own',base:wave.rid,slot:slot.slotId,target:target.i});
      if(rng()>=.75||!finite(power))continue;
      const damage=hitDamage(power,target.foe,rng,1,isAsw,0,hp[target.i]);
      hp[target.i]=applyDamage(target.foe,hp[target.i],damage,rng);
    }
  }
  for(const [key,loss] of losses)counts[key]=Math.max(0,initial.get(key)-loss);
  const afterAttack=enemy?.filter(slot=>[7,8,11].includes(slot.type)).reduce((sum,slot)=>sum+slot.count,0);
  return {enemyPower,remainingRatio:enemy&&originalAttack>0?afterAttack/originalAttack:
    original>0?Math.max(0,Math.min(1,(enemyPower/original)**2)):1};
}
module.exports={inspectSquadron,prepare,nodeRadius,stateFor,simulateWaves,reconAttackMultiplier,surfacePower,airCombat,surfaceAttack,aswAttack};
