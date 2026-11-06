'use strict';
// Bounded, deterministic reference simulation for enemy aircraft after the
// selected land-base waves. It never assumes that a carrier is sunk.
// Enemy stage-one formula: https://en.kancollewiki.net/Aerial_Combat
// LBAS recon participation: https://en.kancollewiki.net/Land_Base
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(row=>[row.apiId,row]));
const TYPES=new Set([6,7,8,11,45,56]),RECON=new Set([9,10,41,49,59,94]);
const ATTACK=new Set([7,8,11,47,53,91]);
const ASW=new Set([8,10,11,25,26,47,53,91]);
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const name=value=>String(value||'').normalize('NFKC').replace(/[―ー－]/g,'ー').replace(/\s+/g,'');
const indexCache=new WeakMap();
function equipmentIndex(store){
  const masters=store?.const?.$equips;
  // poi may update its master table in place; object identity alone would
  // retain stale AA or type values after a data refresh.
  const signature=JSON.stringify(Object.entries(masters||{}).map(([id,m])=>[id,m?.api_name,m?.api_type?.[2],m?.api_tyku]));
  const cached=masters&&indexCache.get(masters);
  if(cached?.signature===signature)return cached.index;
  const index=new Map();
  for(const master of Object.values(masters||{})){
    const key=name(master?.api_name),type=Number(master?.api_type?.[2]),aa=Number(master?.api_tyku);
    if(!key||!Number.isInteger(type)||!valid(aa))continue;
    const old=index.get(key);if(old&&(old.type!==type||old.aa!==aa))index.set(key,null);
    else if(!index.has(key))index.set(key,{type,aa});
  }
  if(masters)indexCache.set(masters,{signature,index});
  Object.defineProperty(index,'signature',{value:signature});
  return index;
}
function formationSlots(formation,index){
  const refs=[...(formation.enemyShips||[]),...(formation.escortFleet?.enemyShips||[])];
  if(!refs.length)return null;
  const slots=[];
  for(const ref of refs){
    const enemy=catalog.get(ref.apiId);if(!enemy||!Array.isArray(enemy.equipment))return null;
    // Verified zero total aircraft capacity makes every slot non-flying even
    // when the source omits individual slot capacities or equipment names.
    if(enemy.stats?.['搭載']===0)continue;
    for(const item of enemy.equipment){
      if(item.notEquippable||/砲|魚雷|電探|レーダ|ソナー|爆雷|探照灯|機銃|徹甲弾|高射装置|FCS|CIC/i.test(item.name||''))continue;
      if(!valid(item.slotCapacity))return null;
      if(!item.slotCapacity)continue;
      const entry=index.get(name(item.name));
      // Non-air equipment may have a positive ship slot capacity. Unknown
      // aircraft cannot be treated as harmless or assigned invented AA.
      if(!entry)return null;
      if(TYPES.has(entry.type)||RECON.has(entry.type))slots.push({count:item.slotCapacity,aa:entry.aa,type:entry.type,recon:RECON.has(entry.type)});
      else if([57,58,91].includes(entry.type))return null;
    }
  }
  return slots;
}
const power=(slots,includeRecon)=>slots.reduce((sum,slot)=>sum+((includeRecon||!slot.recon)&&slot.count>0?Math.floor(slot.aa*Math.sqrt(slot.count)):0),0);
function alternatives(node,index){
  const air=valid(node.enemyAirPower)?node.enemyAirPower:node.upperBound;
  if(!valid(air)||!Array.isArray(node.airFormations))return null;
  const values=[];
  for(const formation of node.airFormations){
    if(valid(formation.enemyAirPower)&&formation.enemyAirPower<air)continue;
    const slots=formationSlots(formation,index);if(!slots)return null;
    const computed=power(slots,false),recorded=formation.enemyAirPower;
    if(valid(recorded)&&recorded!==computed)return null;
    if(computed===air)values.push(slots);
  }
  const unique=new Map(values.map(slots=>[JSON.stringify(slots.map(s=>[s.count,s.aa,s.type,s.recon]).sort()),slots]));
  return unique.size?[...unique.values()]:null;
}
function rng(seed){let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function state(own,enemy){return enemy===0?'supremacy':own>=enemy*3?'supremacy':own>=enemy*1.5?'superiority':
  own>enemy*2/3?'parity':own>enemy/3?'disadvantage':'loss';}
const modifier={supremacy:1,superiority:3,parity:5,disadvantage:7,loss:10};
function basePower(wave,counts){
  let total=0;
  for(const slot of wave.slots){const count=counts.get(`${wave.rid}:${slot.slotId}:${slot.itemId}`)??slot.count;
    if(count>0&&(TYPES.has(slot.type)||RECON.has(slot.type)||[47,48,53].includes(slot.type)))
      total+=Math.floor(slot.aa*Math.sqrt(count)+(slot.proficiency[0]+slot.proficiency[1])/2);
  }
  return Math.floor(total*wave.reconMultiplier);
}
function percentile(values,fraction){const copy=values.slice().sort((a,b)=>a-b);return copy[Math.floor((copy.length-1)*fraction)];}
function simulatePath(nodes,wavesByNode,alternativesByNode,{samples=1024}={}){
  const outputs=new Map(nodes.filter(node=>wavesByNode.get(node.id)?.length).map(node=>[node.id,new Map()]));
  const random=rng(0x4c424153);
  // Each possible strongest formation needs its own sample population. A
  // fixed total would leave the 95th percentile based on only a handful of
  // trials when a node has several variants.
  const variants=Math.max(1,...nodes.filter(node=>wavesByNode.get(node.id)?.length)
    .map(node=>alternativesByNode.get(node.id)?.length||0));
  for(let sample=0;sample<samples*variants;sample++){
    const counts=new Map();
    for(const node of nodes){
      const waves=wavesByNode.get(node.id);if(!waves?.length)continue;
      const variants=alternativesByNode.get(node.id);if(!variants?.length)return null;
      const enemy=variants[sample%variants.length].map(slot=>({...slot}));
      const start=new Map(counts),last=new Map();
      for(const wave of waves){
        if(node.pureSubmarines&&!wave.slots.some(slot=>ASW.has(slot.type)&&slot.asw>=7&&(start.get(`${wave.rid}:${slot.slotId}:${slot.itemId}`)??slot.count)>0))continue;
        const z=modifier[state(basePower(wave,start),power(enemy,true))],max=11-z;
        for(const slot of enemy){if(slot.recon||!slot.count)continue;
          const a=Math.floor(random()*(max+1)),b=Math.floor(random()*(max+1));
          slot.count-=Math.floor(slot.count*(.035*a+.065*b)+1e-10);
        }
        for(const slot of wave.slots){const key=`${wave.rid}:${slot.slotId}:${slot.itemId}`;
          const before=start.get(key)??slot.count;
          if(RECON.has(slot.type)){last.set(key,before);continue;}
          const down=Math.floor(before*z*(3+4*random())/120),remaining=Math.max(0,before-down);
          let after=remaining;
          // Base bombers can additionally be intercepted by ordinary fleet AA.
          if(ATTACK.has(slot.type)&&!node.pureSubmarines&&node.antiAir?.status==='known'&&node.antiAir.profiles?.length){
            const profile=node.antiAir.profiles[Math.floor(random()*node.antiAir.profiles.length)],factor=profile.combinedFactor;
            if(random()<.5)after-=Math.floor(remaining*profile.weighted*factor/400);
            if(random()<.5)after-=Math.floor((profile.weighted+profile.defense)*factor*.09375);
          }
          last.set(key,Math.max(0,after));
        }
      }
      for(const [key,count] of last)counts.set(key,count);
      const groups=outputs.get(node.id),key=sample%variants.length;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(power(enemy,false));
    }
  }
  // Formation appearance rates are not known. Cover each plausible strongest
  // formation rather than silently assuming they occur equally often.
  return new Map([...outputs].map(([id,groups])=>{const ranges=[...groups.values()];return [id,
    {min:Math.min(...ranges.map(values=>percentile(values,.05))),max:Math.max(...ranges.map(values=>percentile(values,.95)))}];}));
}
module.exports={equipmentIndex,formationSlots,alternatives,simulatePath,power};
