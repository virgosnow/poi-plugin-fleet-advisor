'use strict';
// Offline calibration only. A reference opportunity comparison has not yet
// been calibrated against battle outcomes and MUST NOT be presented as a
// certified route grade or used to reorder recommendations.
const {routeEncounters}=require('./combat_encounters');
const {projectedHull,surfaceBattle}=require('./combat_projection');
const SIMPLE_TYPES=new Set([1,2,3,4,5,21]);
const LIMITS=Object.freeze({ships:6,nodes:24,formationsPerNode:16,totalFormations:128});
function referenceEnemy(enemy){
  if(enemy.status!=='known'||enemy.kind!=='surface'||enemy.carrier||
    !enemy.aircraft||enemy.aircraft.max>0)return null;
  return {kind:'surface',carrier:false,hp:enemy.hp.max,armor:enemy.armor.max,
    fire:enemy.fire.max,torpedo:enemy.torpedo.max};
}
function evaluateEvidence(friendly,evidence){
  if(!friendly?.length)return {status:'unknown',nodes:[],reasons:['没有可评估的舰队']};
  if(evidence?.status!=='known')return {status:'unknown',nodes:[],reasons:evidence?.reasons||['路线敌情待确认']};
  if(friendly.length>LIMITS.ships||!Array.isArray(evidence.nodes)||evidence.nodes.length>LIMITS.nodes||
    evidence.nodes.some(node=>!Array.isArray(node.formations)||node.formations.length>LIMITS.formationsPerNode||
      node.formations.some(formation=>!Array.isArray(formation.ships)||formation.ships.length>LIMITS.ships||!Array.isArray(formation.escort)))||
    evidence.nodes.reduce((n,node)=>n+node.formations.length,0)>LIMITS.totalFormations)
    return {status:'unknown',nodes:[],reasons:['战斗规模超过计算预算']};
  const eligible=friendly.every(ship=>ship.status==='known'&&!ship.submarine&&
    SIMPLE_TYPES.has(ship.stype)&&ship.hasAircraft===false);
  if(!eligible)return {status:'unknown',nodes:[],reasons:['舰种或航空战机制尚未完成校准']};
  const nodes=[],reasons=[];
  for(const node of evidence.nodes){
    if(node.kind!=='battle'){
      reasons.push(`${node.id} 点战斗机制尚未完成校准`);continue;
    }
    const battles=[];
    for(const formation of node.formations){
      const enemies=formation.ships.map(referenceEnemy);
      if(formation.phase!=='base'||formation.escort.length||formation.hqLevelRange||
        formation.availability||formation.finalForm!=null||enemies.some(enemy=>!enemy)){
        reasons.push(`${node.id} 点敌编成尚不能完整比较`);continue;
      }
      const result=surfaceBattle(friendly,enemies);
      if(result.status!=='experimental'){reasons.push(`${node.id} 点攻击能力待确认`);continue;}
      battles.push({pattern:formation.pattern,balance:result.balance,outgoing:result.outgoing,incoming:result.incoming});
    }
    if(battles.length!==node.formations.length)continue;
    nodes.push({id:node.id,target:node.target,battles});
  }
  if(reasons.length||nodes.length!==evidence.nodes.length||!nodes.length)
    return {status:'unknown',nodes,reasons:[...new Set(reasons.length?reasons:['没有可评估的战斗'])]};
  const least=nodes.flatMap(node=>node.battles.map(battle=>({node:node.id,...battle})))
    .sort((a,b)=>a.balance.ratio-b.balance.ratio)[0];
  return {status:'experimental',nodes,reference:least.balance,
    reasons:['仅供离线校准，不是胜率','尚未模拟命中、战损、阵形和逐点战损累积']};
}
function evaluateRoute(store,scheme,profile){
  if(!scheme?.ships?.length)return {status:'unknown',nodes:[],reasons:['没有可评估的舰队']};
  if(scheme.ships.length>LIMITS.ships)return {status:'unknown',nodes:[],reasons:['舰队规模超过计算预算']};
  if(!profile||profile.referenceOnly)return {status:'unknown',nodes:[],reasons:['尚未核对当前编成的可达路线']};
  const fleet=scheme.ships.map(entry=>projectedHull(store,entry));
  return evaluateEvidence(fleet,routeEncounters(profile));
}
module.exports={LIMITS,referenceEnemy,evaluateEvidence,evaluateRoute};
