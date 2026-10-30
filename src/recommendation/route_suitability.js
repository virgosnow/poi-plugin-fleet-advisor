'use strict';
// Experimental offline prototype, not yet wired into recommendation or UI.
// Its fleet power proxies still need target-capability checks and calibration;
// these values are not probabilities, damage or search-ranking weights.
const catalog=new Map(require('../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const encounters=new Map();
const profiles=new WeakMap();
const FIGHTS=new Set(['battle','nightBattle','asw','aerialCombat','aerialRaid']);
const BASE='参考适配度，不代表胜率';
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const scalar=v=>Number.isFinite(v)?v:Array.isArray(v)&&v.length&&v.every(Number.isFinite)?Math.max(...v):null;
function enemyDemand(enemy){
  if(!/^verified/.test(enemy.apiIdStatus||''))return null;
  const item=catalog.get(enemy.apiId),stats=item?.stats;
  if(!stats)return null;
  if(/潜水|陸上/.test(item.shipType||''))return 0;
  const hp=scalar(stats['耐久']),armor=scalar(stats['装甲']),fire=scalar(stats['火力']),torpedo=scalar(stats['雷装']);
  if([hp,armor,fire,torpedo].some(v=>v===null))return null;
  return hp+armor*1.4+fire*.6+torpedo*.3;
}
function mapData(area){
  if(!/^\d-\d$/.test(area||''))return null;
  if(!encounters.has(area)){
    try{encounters.set(area,require(`../../data/sortie/encounters/${area}.json`));}
    catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;encounters.set(area,null);}
  }
  return encounters.get(area);
}
function formations(node){
  return Object.values(node?.phases||{}).flatMap(phase=>{
    const rows=phase.patterns||[];
    const resolve=(row,seen=new Set())=>{
      if(!row||seen.has(row))return null;
      seen.add(row);
      if(row.enemyShips?.length)return row;
      if(!row.sameAsPattern)return null;
      const parent=resolve(rows.find(p=>p.pattern===row.sameAsPattern),seen);
      return parent?{...parent,...row,enemyShips:row.enemyShips||parent.enemyShips,escortFleet:row.escortFleet||parent.escortFleet}:null;
    };
    return rows.map(row=>resolve(row));
  });
}
function threats(profile){
  if(!profile||typeof profile!=='object')return null;
  if(profiles.has(profile))return profiles.get(profile);
  const data=mapData(profile.area),paths=profile.routePaths||[];
  if(!data||!paths.length||profile.incomplete||profile.truncated||profile.status==='unavailable')return null;
  const ids=new Set(paths.flatMap(p=>p.nodes)),nodes=(profile.mapPreview?.nodes||[]).filter(n=>ids.has(n.id));
  if([...ids].some(id=>!nodes.some(n=>n.id===id)))return null;
  const result=[];
  for(const node of nodes){
    if(!FIGHTS.has(node.kind))continue;
    const raw=data.nodes[node.id],patterns=formations(raw);
    if(!patterns.length||node.compositionUncertain||node.threatStatus==='unknown')return null;
    let max=0;
    for(const pattern of patterns){
      if(!pattern)return null;
      const ships=[...(pattern.enemyShips||[]),...(pattern.escortFleet?.enemyShips||[])];
      if(!ships.length)return null;
      const values=ships.map(enemyDemand);
      if(values.some(v=>v===null))return null;
      max=Math.max(max,values.reduce((a,b)=>a+b,0));
    }
    result.push({id:node.id,kind:node.kind,boss:!!node.boss,demand:max,hasSubmarines:(node.submarines?.maximum||0)>0});
  }
  profiles.set(profile,result);return result;
}
function index(ratio){
  const points=[[0,0],[.5,40],[.8,60],[1,75],[1.3,90],[1.6,100]];
  if(!Number.isFinite(ratio)||ratio<=0)return 0;
  for(let i=1;i<points.length;i++)if(ratio<=points[i][0]){
    const [a,x]=points[i-1],[b,y]=points[i];return x+(ratio-a)/(b-a)*(y-x);
  }
  return 100;
}
function grade(score){return score>=90?'充裕':score>=75?'合适':score>=60?'可用':score>=40?'吃力':'不足';}
function cost(profile,ships){
  const fuel=profile?.fuelConsumedFraction,ammo=profile?.ammoConsumedFraction;
  const range=(key,value)=>{
    if(!ships.length||!Number.isFinite(value?.minimum)||!Number.isFinite(value?.maximum)||ships.some(s=>!Number.isFinite(s[key])))return null;
    return {min:ships.reduce((n,s)=>n+Math.ceil(s[key]*value.minimum),0),max:ships.reduce((n,s)=>n+Math.ceil(s[key]*value.maximum),0)};
  };
  return {fuel:range('fuel',fuel),ammo:range('ammo',ammo),estimated:true};
}
// Exposed separately to test the product policy without constructing an
// account snapshot. `nodes` are already limited to viable selected paths.
function assess({nodes,scores,profile,ships=[],reachable=true}){
  const resources=cost(profile,ships),base={version:1,basis:BASE,cost:resources};
  if(reachable===false)return {...base,status:'unreachable',score:null,grade:null,dimensions:[],reasons:['当前编成无法沿所选路线到达']};
  if(!nodes?.length||!scores)return {...base,status:'unconfirmed',score:null,grade:null,dimensions:[],reasons:['所选路线的敌情或舰队能力资料不足']};
  const dimensions=[],asw=scores.aswCombat;
  if(nodes.some(n=>n.kind==='asw'||n.hasSubmarines)){
    if(!asw||asw.status!=='known'||!Number.isFinite(asw.readiness))return {...base,status:'unconfirmed',score:null,grade:null,dimensions:[],reasons:['对潜能力或敌潜艇资料不足']};
    const weakest=(asw.nodes||[]).filter(n=>Number.isFinite(n.readiness)).sort((a,b)=>a.readiness-b.readiness)[0];
    dimensions.push({key:'asw',label:'对潜',node:weakest?.id||null,score:clamp(asw.readiness*100,0,100),reason:asw.readiness<.6?'对潜攻击覆盖不足':'对潜攻击已计入'});
  }
  for(const node of nodes.filter(n=>n.demand>0&&['battle','nightBattle'].includes(n.kind))){
    const power=node.kind==='nightBattle'?scores.nightStrengthProxy:scores.surfaceStrengthProxy;
    if(!Number.isFinite(power))return {...base,status:'unconfirmed',score:null,grade:null,dimensions:[],reasons:['水上或夜战能力资料不足']};
    const opening=node.kind==='battle'?Math.max(0,scores.openingAirStrikeProxy||0)*.7:0;
    const bonus=scores.specialAttack?.bonus>0?1.05:1;
    dimensions.push({key:node.kind==='nightBattle'?'night':'surface',label:node.kind==='nightBattle'?'夜战':'水上战',node:node.id,boss:node.boss,
      score:index((power+opening)*bonus/node.demand),reason:`${node.id} 点${node.kind==='nightBattle'?'夜战':'水上战'}压力`});
  }
  if(scores.groundAttack?.targets?.length){
    if(!Array.isArray(scores.groundAttack.powers))return {...base,status:'unconfirmed',score:null,grade:null,dimensions:[],reasons:['对地配装资料不足']};
    const power=scores.groundAttack.powers.reduce((a,b)=>a+b,0);
    dimensions.push({key:'ground',label:'对地',score:index(power/600),reason:power<300?'对地攻击能力不足':'已计入路线陆基目标'});
  }
  if(['belowAlongRoute','uncertainAlongRoute','unknown'].includes(scores.airGoalStatus)){
    if(scores.airGoalStatus==='unknown')return {...base,status:'unconfirmed',score:null,grade:null,dimensions:[],reasons:['沿途制空资料不足']};
    dimensions.push({key:'air',label:'制空',score:scores.airGoalStatus==='belowAlongRoute'?45:65,reason:'沿途空优未能稳定满足'});
  }
  if(!dimensions.length)return {...base,status:'unconfirmed',score:null,grade:null,dimensions:[],reasons:['缺少可评价的战斗能力']};
  const ordered=dimensions.slice().sort((a,b)=>a.score-b.score),worst=ordered[0].score,
    average=dimensions.reduce((sum,d)=>sum+d.score,0)/dimensions.length;
  const risk=Math.max(0,Math.min(8,(scores.aircraftRisk?.slots||[]).reduce((n,s)=>n+Math.max(0,s.risk||0),0)*8));
  const score=Math.round(clamp(Math.min(worst+15,worst*.7+average*.3)-risk,0,100)/5)*5;
  const reasons=[...new Set(ordered.slice(0,3).map(d=>d.reason))];
  if(risk>=4)reasons.push('沿途攻击机损耗偏高');
  return {...base,status:'ready',score,grade:grade(score),dimensions:dimensions.map(d=>({...d,score:Math.round(d.score)})),reasons:reasons.slice(0,3)};
}
function evaluate(profile,scores,ships,reachable=true){
  const nodes=threats(profile);
  const submarineNodes=new Set((scores?.aswCombat?.nodes||[]).map(n=>n.id));
  return assess({nodes:nodes?.map(n=>({...n,hasSubmarines:n.hasSubmarines||submarineNodes.has(n.id)})),scores,profile,ships,reachable});
}
module.exports={assess,evaluate,enemyDemand,grade,index,threats};
