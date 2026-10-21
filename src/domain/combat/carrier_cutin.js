'use strict';
// 戦闘について#FAcutin: conditional rolls share observation terms; only the
// first successful mode occurs. Pure references, never execution checks.
const {combatBonuses}=require('./equipment_bonuses');
const {airPower}=require('../fleet/fleet_metrics');
const {routeAirReference,estimateRouteAir}=require('../routes/route_air');
const coefficients={jFjBjB:135,jFjB:125,jFBA:115,FBA:125,BBA:140,BA:155};
const value=v=>{const n=Array.isArray(v)?v[0]:v;return n==null||n===''||!Number.isFinite(Number(n))?null:Number(n);};
const ids=s=>(s.slots||[]).concat(s.ex).filter(id=>id>0);
const raw=e=>value(e.master?.api_saku??0);
const capacity=(target,slot)=>value(target.master.api_maxeq?.[slot]);

function createContext(store,targets,profile,{airReference,airEstimate,incomplete=false}={}){
  const reasons=new Set(incomplete?['舰队舰娘资料缺失']:[]);let search=0;
  for(const target of targets){
    const worn=ids(target.before).map(id=>{const instance=store.info.equips[id],master=store.const.$equips[instance?.api_slotitem_id];return {id,instance,master,type:Number(master?.api_type?.[2])};});
    const observed=value(target.ship.api_sakuteki),blue=combatBonuses(store,{...target,after:target.before,items:worn});
    const stats=worn.map(raw);
    if(observed===null||stats.some(n=>n===null||n<0)||worn.some(e=>!e.master)||!blue.known){reasons.add('舰队基础索敌资料不足');continue;}
    // Remove the worn raw AND blue LoS. Draft blue bonuses never enter either
    // term, so swapping a radar does not leave its old bonus in the hull stat.
    const base=observed-stats.reduce((a,b)=>a+b,0)-blue.scout;
    if(base<0){reasons.add('无法还原舰娘基础索敌');continue;}search+=base;
    target.after.slots.forEach((id,slot)=>{
      const equipment=target.items.find(e=>e.id===id);if(!equipment||![10,11].includes(equipment.type))return;
      const count=capacity(target,slot),stat=raw(equipment);
      if(count===null||count<0||stat===null||stat<0){reasons.add('水侦／水爆索敌或容量资料不足');return;}
      search+=stat*Math.floor(Math.sqrt(count));
    });
  }
  let route;
  return {fleetTerm:Math.floor(Math.sqrt(search)+.1*search),reason:[...reasons].join('；'),
    route(){if(route!==undefined)return route;
      const paths=profile?.routePaths?.map(p=>p.nodes)||profile?.examples||[];
      if(!paths.some(p=>p.length))return route=null;
      const reference=airReference||routeAirReference({},profile.area,profile);
      if(reference.status!=='known')return route={unknown:true};
      const battleIds=reference.nodes.filter(n=>n.kind==='battle').map(n=>n.id);
      if(!battleIds.length)return route={groups:[],noDayBattle:true};
      if(targets.some(t=>t.after.slots.some((id,slot)=>{
        const e=t.items.find(e=>e.id===id);return e&&[6,7,8,11,26,45,56,57].includes(e.type)&&capacity(t,slot)===null;
      })))return route={unknown:true};
      const full=targets.map(t=>({...t,before:t.after,ship:{...t.ship,api_onslot:t.after.slots.map((_,i)=>capacity(t,i)??NaN)}}));
      const air=airPower(store,full),estimate=airEstimate||estimateRouteAir(air,reference);
      if(estimate.status!=='estimated')return route={unknown:true};
      const states=new Map(battleIds.map(id=>[id,new Set()]));
      const classify=(power,required)=>power>=required.supremacy?'supremacy':power>=required.superiority?'superiority':'none';
      for(const path of estimate.paths||[])for(const step of path.steps||[]){
        if(!states.has(step.node))continue;
        const low=classify(step.before.min,step.required),high=classify(step.before.max,step.required);
        states.get(step.node).add(low);states.get(step.node).add(high);
        if(low!==high)states.get(step.node).add('unknown');
      }
      if([...states.values()].some(s=>s.size!==1))return route={unknown:true};
      const groups=[];
      for(const [node,possibilities] of states){const state=[...possibilities][0];let group=groups.find(g=>g.state===state);
        if(!group){group={state,nodes:[]};groups.push(group);}group.nodes.push(node);
      }
      return route={groups};
    }};
}
function read(context,target,flagship,modes,{blocked=false,uncertain=false,constants=coefficients}={}){
  const luck=value(target.ship.api_lucky),stats=target.items.map(raw),reason=context.reason||
    (luck===null||luck<0?'缺少运资料':target.items.some(e=>!e.master)||stats.some(n=>n===null||n<0)?'装备索敌资料不足':
      uncertain?'飞机槽位容量待确认':modes.some(mode=>!constants[mode])?'组合发动率资料不足':'');
  const equipment=stats.reduce((n,v)=>n+(v||0),0),rates={};
  for(const state of ['superiority','supremacy']){
    const term=reason?null:Math.floor(Math.floor(Math.sqrt(luck)+10)+
      (state==='supremacy'?.7*(context.fleetTerm+1.6*equipment+10):.6*(context.fleetTerm+1.2*equipment)))+(flagship?15:0);
    let remaining=1;const rows=modes.map(label=>{
      const chance=blocked?0:term===null?null:Math.min(1,Math.max(0,Math.ceil(term)/constants[label]));
      const rate=chance===null?null:remaining*chance;if(chance!==null)remaining*=1-chance;
      return {label,coefficient:constants[label],chance,rate};
    });
    rates[state]={term,rows,total:blocked?0:term===null?null:1-remaining};
  }
  const percentage=n=>`${(n*100).toFixed(1)}%`,lines=[];
  const route=blocked?null:context.route();
  if(blocked)lines.push('参考发动率：0.0%');
  else if(reason)lines.push('参考发动率：待确认',reason);
  else if(route?.noDayBattle)lines.push('参考发动率：0.0%','所选路线没有昼战炮击。');
  else if(route?.groups)for(const group of route.groups){
    const state={supremacy:'空确',superiority:'空优',none:'制空不足'}[group.state],rate=group.state==='none'?0:rates[group.state].total;
    lines.push(`参考发动率（${group.nodes.join('／')} 点，${state}）：${percentage(rate)}`);
  }else{
    lines.push(`参考发动率（空优）：${percentage(rates.superiority.total)}`,`参考发动率（空确）：${percentage(rates.supremacy.total)}`);
    if(route?.unknown)lines.push('路线制空待确认，以上为对应制空状态下的参考。');
  }
  return {rates,route,reason,detail:lines.join('\n')};
}
function attackPowers(target,store,modes){
  const attack=require('./attack_power'),base=attack.fireBase(target,store),blue=combatBonuses(store,target);
  const multipliers={jFjBjB:1.35,jFjB:1.3,jFBA:1.27,FBA:1.25,BBA:1.2,BA:1.15};
  const aircraft=target.items.filter(e=>[7,8,57,58].includes(e.type)&&target.after.slots.includes(e.id));
  const torpedo=aircraft.reduce((n,e)=>n+Number(e.master.api_raig||0),0)+blue.torpedo;
  const bomb=aircraft.reduce((n,e)=>n+Number(e.master.api_baku||0),0)+blue.bomber;
  const power=base.value===null||!blue.known?null:attack.cap(Math.floor((base.value+torpedo+Math.floor(bomb*1.3))*1.5)+55,220);
  return {rows:modes.map(label=>({label,hits:1,power:power===null?null:Math.floor(power*multipliers[label])})),
    reasons:[...new Set([...base.reasons,...blue.reasons])]};
}
module.exports={createContext,read,attackPowers};
