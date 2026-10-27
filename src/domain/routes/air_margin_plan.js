'use strict';
const jets=require('../combat/jet_aviation');
const perf=require('../../shared/performance_trace');
const nodePlans=new WeakMap(),aircraft=new Map();

// Compile the *same* loss rules used by the detailed report. Equipment trials
// need only the worst margin: shared route prefixes and integer slot losses
// need not be recalculated for every aircraft permutation. Unsupported inputs
// deliberately fall back to the detailed simulator, including unknown reasons.
function createMarginPlan(paths,{airState,stageOneLoss,slotPower}){
  const root={children:new Map()},nodes=new Map();
  let supported=true;
  for(const path of paths){
    let parent=root;
    for(const node of path){
      if(!nodes.has(node)){
        const enemy=Number.isFinite(node.enemyAirPower)?node.enemyAirPower:node.upperBound;
        const applies=jets.applicable(node);
        if(!node.noAirBattle&&(!Number.isFinite(enemy)||enemy<0||applies===null||node.enemyJets||node.antiAir?.status!=='known'))supported=false;
        let data=nodePlans.get(node);
        if(!data){data={node,enemy,applies,required:[Math.max(1,Math.ceil(enemy*1.5)),Math.max(1,enemy*3)],losses:new Map()};nodePlans.set(node,data);}
        nodes.set(node,data);
      }
      if(!parent.children.has(node))parent.children.set(node,{data:nodes.get(node),children:new Map()});
      parent=parent.children.get(node);
    }
  }
  const descriptor=(slot,key)=>{
    if(aircraft.has(key))return aircraft.get(key);
    const jet=jets.spec(slot.masterId,slot.aircraftType),type=slot.aircraftType;
    const value={type,jet,attack:[7,8,11,57].includes(type),power:[[],[]]};
    for(let side=0;side<2;side++)for(let count=0;count<=slot.planes[side];count++)value.power[side][count]=slotPower(slot,count,side);
    if(aircraft.size>=4096)aircraft.delete(aircraft.keys().next().value);
    aircraft.set(key,value);return value;
  };
  const loss=(data,plane,count,side,state,assault=false)=>{
    const key=plane.jet||plane.type;
    let tables=data.losses.get(key);
    if(!tables){tables={};data.losses.set(key,tables);}
    const mode=assault?'assault':state;
    if(!tables[mode])tables[mode]=[[],[]];
    const table=tables[mode][side];
    // Most trials visit a handful of air states with fewer than 50 planes.
    // Grow only the queried side/state, amortizing adjacent counts in a block.
    if(table.length<=count)for(let c=table.length,end=Math.min(512,count+16);c<=end;c++){
      let n=Math.max(0,c-stageOneLoss(c,assault?'supremacy':mode,side===0,plane.jet?jets.PHASES.proportionalLoss:1));
      if(side===0&&plane.attack&&(assault||data.node.kind!=='aerialRaid'))n=Math.max(0,n-(plane.jet?jets.antiAirLoss(n,data.node,plane.jet):Math.floor(n*data.node.antiAir.proportion)+data.node.antiAir.fixed));
      table[c]=n;
    }
    return table[count];
  };
  return (air,keys,minimumOnly=false,threshold)=>{
    if(!supported||air.slots.some(s=>s.planes.some(n=>!Number.isInteger(n)||n<0||n>512)))return undefined;
    const jetPresent=air.slots.some(s=>jets.isJet(s.aircraftType)&&s.planes[1]>0);
    if(air.slots.some(s=>jetPresent?![6,7,8,11,45,56,57].includes(s.aircraftType)||jets.isJet(s.aircraftType)&&s.planes[1]>0&&!jets.spec(s.masterId,s.aircraftType):
      s.planes[1]>0&&![6,7,8,11,45].includes(s.aircraftType)))return undefined;
    const steel=jetPresent?air.slots.find(s=>jets.isJet(s.aircraftType)&&s.planes[1]>0)?.jetSteel:0;
    if(jetPresent&&(steel==null||!Number.isFinite(steel)))return undefined;
    const planes=air.slots.map((s,i)=>descriptor(s,keys[i]));
    const jetIndices=[];for(let i=0;i<planes.length;i++)if(planes[i].jet&&air.slots[i].planes[1]>0)jetIndices.push(i);
    const sides=minimumOnly?1:2,margins=[[Infinity,Infinity],[Infinity,Infinity]];let count=0;
    const visit=(branch,remaining,budget,pathCount=0)=>{
      const {data}=branch,node=data.node;
      if(!node.noAirBattle){
        if(jetPresent&&data.applies)for(let side=0;side<sides;side++)if(budget[side]>0){
          let cost=0;
          for(const i of jetIndices){cost+=Math.round(remaining[side][i]*planes[i].jet.steel);
            remaining[side][i]=loss(data,planes[i],remaining[side][i],side,'supremacy',true);}
          budget[side]-=Math.min(budget[side],cost);
        }
        const rounds=node.kind==='aerialCombat'?2:1;
        for(let round=1;round<=rounds;round++){
          count++;pathCount++;
          const before=[0,0];
          for(let side=0;side<sides;side++)for(let i=0;i<planes.length;i++)before[side]+=planes[i].power[side][remaining[side][i]];
          for(let goal=0;goal<2;goal++)for(let side=0;side<sides;side++)margins[goal][side]=Math.min(margins[goal][side],before[side]-data.required[goal]);
          if(threshold&&before[0]-data.required[threshold.goal]<threshold.minimum)return false;
          // Ordinary terminal losses cannot affect margins. Jet reports still
          // compute them for strike power, but known losses add no new verdict.
          if(!branch.children.size&&round===rounds)continue;
          for(let side=0;side<sides;side++){
            const state=airState(before[side],data.enemy);
            for(let i=0;i<planes.length;i++)remaining[side][i]=loss(data,planes[i],remaining[side][i],side,state);
          }
        }
      }
      if(!branch.children.size&&!pathCount)for(let goal=0;goal<2;goal++)for(let side=0;side<sides;side++)margins[goal][side]=Math.min(margins[goal][side],0);
      let index=0;for(const next of branch.children.values()){
        const last=++index===branch.children.size;
        if(visit(next,last?remaining:remaining.map(n=>n.slice()),last?budget:budget.slice(),pathCount)===false)return false;
      }
    };
    for(const branch of root.children.values())if(visit(branch,[air.slots.map(s=>s.planes[0]),air.slots.map(s=>s.planes[1])],[steel,steel])===false)return false;
    if(paths.some(p=>!p.length))for(let goal=0;goal<2;goal++)for(let side=0;side<sides;side++)margins[goal][side]=Math.min(margins[goal][side],0);
    perf.count('air.plan.used');
    // A successful threshold walk visited every required node. Its exact
    // minimum margins are already known and can serve later fitting/scoring.
    // Early failures still return false without publishing partial margins.
    if(threshold&&(count?margins[threshold.goal][0]:0)<threshold.minimum)return false;
    return {superiority:{min:count?margins[0][0]:0,...minimumOnly?{}:{max:count?margins[0][1]:0}},supremacy:{min:count?margins[1][0]:0,...minimumOnly?{}:{max:count?margins[1][1]:0}}};
  };
}
module.exports={createMarginPlan};
