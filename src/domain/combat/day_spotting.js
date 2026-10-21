'use strict';
// 戦闘について#Observation: rolls occur in this order; unsuccessful
// higher-priority CIs leave a chance for the lower-priority double attack.
const observation=require('./carrier_cutin'),attack=require('./attack_power'),text=require('../../shared/mechanism_text');
const rules=[['主主 CI',1.5,1,150],['主彻 CI',1.3,1,140],['主电 CI',1.2,1,130],['主副 CI',1.1,1,120],['昼战连击',1.2,2,130]];
const constants=Object.fromEntries(rules.map(([label,,,n])=>[label,n]));
const pct=n=>n==null?'待确认':(n*100).toFixed(1)+'%';
function read(target,store,flagship,context,{blocked=false,uncertain=false}={}){
 const main=target.items.filter(e=>[1,2,3,38].includes(e.type)).length,
  secondary=target.items.some(e=>e.type===4),ap=target.items.some(e=>e.type===19),radar=target.items.some(e=>[12,13,93].includes(e.type));
 const eligible=[main>=2&&ap,main>=1&&secondary&&ap,main>=1&&secondary&&radar,main>=1&&secondary,main>=2];
 const modes=rules.filter((_,i)=>eligible[i]);
 const ci=observation.read(context,target,flagship,modes.map(m=>m[0]),{blocked,uncertain,constants});
 const base=attack.fireBase(target,store),attacks=modes.map(([label,multiplier,hits])=>({label,multiplier,hits,
  power:base.value===null?null:Math.floor(attack.cap(base.value+5+base.fit,220)*multiplier)}));
 const rates=[ci.detail];
 if(modes.length>1&&!ci.reason&&!blocked&&!ci.route?.noDayBattle){
  const groups=ci.route?.groups||[{state:'superiority',nodes:[]},{state:'supremacy',nodes:[]}];
  for(const g of groups){if(!ci.rates[g.state])continue;
   const where=(g.nodes?.length?g.nodes.join('／')+' 点，':'')+(g.state==='superiority'?'空优':'空确');
   rates.push(...ci.rates[g.state].rows.map(r=>`${r.label}（${where}）：${pct(r.rate)}`));
  }
 }
 const power=attacks.map(r=>`${r.label}\n攻击力：${r.power??'待确认'} × ${r.hits}击`);
 const notes=['需空优／空确及可用水侦／水爆。',blocked?'当前大破或水侦／水爆容量为 0，需修复／换槽。':'',
  uncertain?'水侦／水爆槽位容量：待确认。':'',...base.reasons];
 return {ci,attacks,detail:text(rates,power,notes)};
}
module.exports={read};
