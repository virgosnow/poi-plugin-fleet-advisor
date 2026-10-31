'use strict';
// Conditional enemy attack threat, evaluated separately for each documented
// formation against the current friendly fleet. It is NOT a retreat chance.
// Sources: wikiwiki.jp/kancolle/戦闘について, /夜戦, /戦艦レ級.
// Unknown mechanics are surfaced as partial; they are never treated as zero.
const {cap}=require('./attack_power');
const {enemyOpeningTorpedo,enemyAswPower}=require('./combat_air_asw');
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const MAX_NODES=24,MAX_FORMATIONS=16,MAX_SHIPS=6,MAX_TOTAL_FORMATIONS=128;
const AIR_ATTACKS=new Set([7,8,11,57,58]);
const valid=n=>Number.isFinite(n)&&n>=0;
const upper=r=>r&&valid(r.max)?r.max:null;
const rawBase=value=>{const n=Array.isArray(value)?value[0]:value;return valid(n)?n:null;};
function equipmentLookup(masters){
  const map=new Map();
  for(const item of Object.values(masters||{})){
    if(!item?.api_name)continue;
    const rows=map.get(item.api_name)||[];rows.push(item);map.set(item.api_name,rows);
  }
  return map;
}
function equipmentAnalysis(master,lookup){
  if(!Array.isArray(master?.equipment))return {status:'unknown',guns:0,torpedoes:0,aircraft:[]};
  let guns=0,torpedoes=0,unknown=false;const aircraft=[];
  for(const row of master.equipment){
    if(row.notEquippable)continue;
    // The catalog explicitly represents 未装備 as name:null and
    // slotCapacity:null; it is not an unidentified equipped item.
    if(row.name===null&&row.slotCapacity===null)continue;
    if(!row.name){unknown=true;continue;}
    const name=row.name;
    if(/魚雷/.test(name))torpedoes++;
    else if(/砲/.test(name)&&!/機銃|爆雷|迫撃/.test(name))guns++;
    // Use the game equipment class when available. Enemy land bombers and
    // the reconnaissance-model sky fortress also make aerial attacks even
    // though their names do not contain the ordinary 艦爆/艦攻 markers.
    const rows=lookup.get(name)||[],types=rows.map(e=>Number(e.api_type?.[2]));
    const looksAircraft=/艦爆|艦攻|水上爆撃|水爆|爆撃機|攻撃機|陸爆|深海空要塞/.test(name);
    if(!looksAircraft&&!types.some(type=>AIR_ATTACKS.has(type)))continue;
    if(!valid(row.slotCapacity)){unknown=true;continue;}
    if(!row.slotCapacity)continue;
    if(!rows.length||rows.some(e=>!valid(e.api_baku)||!valid(e.api_raig)||
      e.api_baku!==rows[0].api_baku||e.api_raig!==rows[0].api_raig)){unknown=true;continue;}
    if(types.some(type=>Number.isFinite(type))&&types.some(type=>!AIR_ATTACKS.has(type))){unknown=true;continue;}
    aircraft.push({bomb:rows[0].api_baku,torpedo:rows[0].api_raig,capacity:row.slotCapacity,
      kind:types[0]===8||!Number.isFinite(types[0])&&/艦攻|攻撃機/.test(name)?'torpedo':'bomb'});
  }
  return {status:unknown?'partial':'known',guns,torpedoes,aircraft};
}
// The following values represent an intact, normal-hit, same-engagement
// comparison only. They are not the chance of receiving any hit or retreat.
function severity(power,friend){
  if(!valid(power)||!valid(friend.hp)||friend.hp<=0||!valid(friend.armor))return null;
  // Armor is randomized; a hit that cannot penetrate produces scratch damage
  // instead of zero. Eight fixed midpoint samples bound cost and prevent a
  // one-point armor change from abruptly dropping an enemy formation entirely.
  // These are conditional normal-hit references, not hit/retreat probabilities.
  const armor=Math.floor(friend.armor),hp=friend.hp,limit=hp*.75;let total=0,scratch=0;
  for(let j=0;j<8;j++)scratch+=Math.min(Math.max(0,hp-1),Math.floor(hp*.06+Math.floor(hp*(j+.5)/8)*.08))/8;
  for(let i=0;i<8;i++){
    const armorRoll=armor>0?Math.floor(armor*(i+.5)/8):0;
    const raw=Math.floor(power-(armor*.7+armorRoll*.6));
    if(raw>0)total+=Math.min(1,raw/limit);
    else total+=Math.min(1,scratch/limit);
  }
  return total/8;
}
function candidateAttack(enemy,friend,nodeKind,lookup,reading){
  const master=catalog.get(enemy.apiId);
  if(enemy.status!=='known'||!master||friend.status!=='known')return {status:'unknown',score:null};
  const fire=upper(enemy.fire),torpedo=upper(enemy.torpedo),equipment=reading||equipmentAnalysis(master,lookup);
  const aerialOnly=nodeKind==='aerialRaid'||nodeKind==='aerialCombat';
  if((!aerialOnly&&(!valid(fire)||!valid(torpedo)))||!valid(friend.hp)||friend.hp<=0||!valid(friend.armor))return {status:'unknown',score:null};
  const submarine=friend.submarine===true,subEnemy=enemy.kind==='submarine',night=nodeKind==='nightBattle';
  if(submarine){
    if(subEnemy)return {status:'known',score:0,mechanisms:[]};
    // Air-only nodes have different aircraft target rules from shelling.
    if(nodeKind==='aerialCombat')return {status:'known',score:0,mechanisms:[]};
    if(nodeKind==='aerialRaid')return {status:'unknown',score:null,warnings:['空袭对潜目标资格待确认']};
    const asw=enemyAswPower(enemy,{phase:night?'night':'shelling',...(night?{nightStart:true}:{})});
    if(asw.status==='unknown')return {status:'unknown',score:null,warnings:asw.reasons||['敌方对潜资料缺失']};
    if(asw.eligible===false)return {status:asw.status==='known'?'known':'partial',score:0,mechanisms:[],warnings:asw.reasons||[]};
    const power=valid(asw.referencePower)?asw.referencePower:valid(asw.powerMin)&&valid(asw.powerMax)?(asw.powerMin+asw.powerMax)/2:null;
    const apply=p=>p===0&&asw.eligible===null?0:severity(p,friend);
    const min=apply(asw.powerMin),max=apply(asw.powerMax),value=apply(power);
    if(!valid(value)||!valid(min)||!valid(max))return {status:'unknown',score:null,warnings:['敌方对潜攻击力缺失']};
    return {status:asw.status==='known'?'known':'partial',score:value,scoreRange:{min,max},
      mechanisms:['对潜攻击'],warnings:asw.reasons||[]};
  }
  if(night&&enemy.carrier&&!/^軽母ヌ級flagship$/.test(master.name||'')){
    // Ordinary carriers cannot shell in night battle, but specific enemy
    // exceptions require a verified hull/plane capability table.
    return {status:'partial',score:0,mechanisms:[],warnings:['敌空母夜战能力未完整核对']};
  }
  const phases=[],warnings=[];
  if(!night){
    for(const aircraft of equipment.aircraft){
      const stat=aircraft.kind==='torpedo'?aircraft.torpedo:aircraft.bomb;
      if(!valid(stat)||stat===0)continue;
      // An upper reference: retain original slot size and the high torpedo
      // bomber modifier. Actual plane losses, target and hit are unknown.
      const raw=(stat*Math.sqrt(aircraft.capacity)+25)*(aircraft.kind==='torpedo'?1.5:1);
      phases.push({power:cap(raw,170),count:nodeKind==='aerialCombat'?2:1,label:'开幕航空'});
    }
    if(equipment.aircraft.length)warnings.push('航空按原始搭载及较高威力参考，未计制空与防空损失');
    if(equipment.status!=='known')warnings.push('敌舰装备细节待确认');
  }
  if(night){
    if(enemy.carrier){
      // The regular Nu flagship participates in night shelling; its printed
      // upper fire field is daytime carrier power, not native night fire.
      // https://wikiwiki.jp/kancolle/軽母ヌ級
      const intrinsicFire=rawBase(master.stats?.['火力']);
      if(intrinsicFire===null)return {status:'unknown',score:null};
      phases.push({power:cap(intrinsicFire+torpedo,360),count:1,label:'夜战攻击'});
      warnings.push('敌空母夜战攻击力按已知基础属性参考');
    }else{
    const double=equipment.guns>=2&&equipment.torpedoes===0;
    phases.push({power:cap((fire+(enemy.kind==='installation'?0:torpedo))*(double?1.2:1),360),count:double?2:1,label:double?'夜战连击':'夜战攻击'});
    }
    if(equipment.status!=='known')warnings.push('夜战装备细节待确认');
  }else if(aerialOnly){
    if(!equipment.aircraft.length)warnings.push('敌方航空攻击装备待确认');
  }else if(subEnemy){
    const opening=enemyOpeningTorpedo(enemy,{nodeKind});
    if(opening.eligible===true)phases.push({power:cap(torpedo+5,180),count:1,label:'开幕雷击'});
    if(opening.eligible===null)warnings.push('敌舰开幕雷击条件待确认');
    if(torpedo>0&&!enemy.carrier)phases.push({power:cap(torpedo+5,180),count:1,label:'雷击'});
    warnings.push('未模拟先制对潜阻止雷击');
  }else {
    const opening=enemyOpeningTorpedo(enemy,{nodeKind});
    if(opening.eligible===true)phases.push({power:cap(torpedo+5,180),count:1,label:'开幕雷击'});
    if(opening.eligible===null&&torpedo>0)warnings.push('敌舰开幕雷击条件待确认');
    const armedAviation=master.equipment?.some(e=>e.name&&/艦爆|艦攻|水上爆撃|水爆|爆撃機|攻撃機/.test(e.name)&&e.slotCapacity>0);
    const aviationShell=enemy.carrier||enemy.kind==='installation'&&armedAviation;
    if(aviationShell){
      // Wiki's second fire entry for these enemies is the *already computed*
      // carrier shelling base including their aircraft. Applying the carrier
      // formula to it again would double-count the equipped planes.
      if(Array.isArray(master.stats?.['火力'])&&master.stats['火力'].length>=2&&armedAviation)
        phases.push({power:cap(fire,220),count:1,label:'航空炮击'});
      else warnings.push('敌舰载机炮击数据待确认');
    }else phases.push({power:cap(fire+5,220),count:1,label:'炮击'});
    // Plane torpedo stats do not grant a torpedo phase to aircraft carriers,
    // installations, or other hulls whose intrinsic torpedo stat is zero.
    const intrinsicTorpedo=rawBase(master.stats?.['雷装']);
    if(enemy.kind!=='installation'&&!enemy.carrier&&intrinsicTorpedo>0)
      phases.push({power:cap(torpedo+5,180),count:1,label:'雷击'});
    if(intrinsicTorpedo===null&&!enemy.carrier&&enemy.kind!=='installation')warnings.push('敌舰雷击资格待确认');
    if(enemy.carrier||upper(enemy.aircraft)>0)warnings.push('未模拟制空与敌机损耗');
    if(equipment.status!=='known')warnings.push('敌舰装备细节待确认');
  }
  let withoutAir=0,fullAir=0;
  for(const phase of phases){const v=severity(phase.power,friend);if(v===null)return {status:'unknown',score:null};
    fullAir+=v*phase.count;if(phase.label!=='开幕航空')withoutAir+=v*phase.count;}
  return {status:warnings.length?'partial':'known',score:withoutAir,scoreRange:{min:withoutAir,max:fullAir},mechanisms:phases.map(p=>p.label),warnings};
}
function enemyThreat(enemy,fleet,nodeKind,lookup){
  const reading=equipmentAnalysis(catalog.get(enemy.apiId),lookup);
  const rows=fleet.map(friend=>candidateAttack(enemy,friend,nodeKind,lookup,reading));
  const known=rows.filter(row=>valid(row.score));
  if(!known.length)return {status:'unknown',score:null,mechanisms:[],warnings:['对当前舰队的攻击能力待确认']};
  const warnings=[...new Set(rows.flatMap(row=>row.warnings||[]))];
  if(known.length!==rows.length)warnings.push('部分舰娘受击情况待确认');
  return {status:rows.some(row=>row.status!=='known')?'partial':'known',
    score:known.reduce((sum,row)=>sum+row.score,0)/known.length,
    scoreRange:{min:known.reduce((sum,row)=>sum+(row.scoreRange?.min??row.score),0)/known.length,
      max:known.reduce((sum,row)=>sum+(row.scoreRange?.max??row.score),0)/known.length},
    mechanisms:[...new Set(rows.flatMap(row=>row.mechanisms||[]))],warnings:[...new Set(warnings)]};
}
function nodeThreat(node,fleet,lookup,cache=new Map()){
  if(!Array.isArray(node.formations)||!node.formations.length)return {status:'unknown',enemy:null,warnings:['缺少敌编成']};
  let strongest=null,strongestHigh=null,partial=node.status!=='known'||!!node.sourceWarnings?.length;
  const candidates=[];
  const warnings=[...(node.sourceWarnings||[])];
  for(const formation of node.formations){
    const ships=[...(formation.ships||[]),...(formation.escort||[])];
    if(!ships.length){partial=true;continue;}
    // Treat each formation separately. The selected enemy is from the single
    // formation with greatest aggregate conditional threat, not a synthetic
    // combination of ships from different patterns.
    const evaluated=ships.map(enemy=>{
      // The cache lives only for this one fleet assessment. An equipment or
      // ship change creates a new evaluation, never reuses a stale result.
      const key=JSON.stringify([enemy.apiId,enemy.status,enemy.kind,enemy.fire,enemy.torpedo,node.kind]);
      if(!cache.has(key))cache.set(key,enemyThreat(enemy,fleet,node.kind,lookup));
      return {enemy,...cache.get(key)};
    });
    if(evaluated.some(row=>row.status!=='known'))partial=true;
    for(const row of evaluated)warnings.push(...row.warnings);
    const known=evaluated.filter(row=>valid(row.score));
    if(!known.length){partial=true;continue;}
    // Each candidate is scored within one actual recorded formation. Listing
    // two alternatives never implies that their ships occur simultaneously.
    const airborne=['aerialRaid','aerialCombat'].includes(node.kind);
    for(const row of known){const score=airborne?(row.scoreRange?.max??row.score):row.score;
      if(score>0)candidates.push({score,enemy:{apiId:row.enemy.apiId,name:row.enemy.name,node:node.id,nodes:[node.id],
        mechanisms:row.mechanisms,pattern:formation.pattern,phase:formation.phase,formationKey:formation.key}});
    }
    const total=known.reduce((sum,row)=>sum+row.score,0);
    const high=known.reduce((sum,row)=>sum+(row.scoreRange?.max??row.score),0);
    // If attacks saturate the same severity, keep the more resilient enemy:
    // a hard-to-disable attacker has more opportunity to carry out its attacks.
    // This is only a tie-breaker, not a probability of surviving opening fire.
    const defense=e=>(upper(e.hp)||0)+(upper(e.armor)||0);
    const main=known.sort((a,b)=>b.score-a.score||defense(b.enemy)-defense(a.enemy)||a.enemy.apiId-b.enemy.apiId)[0];
    if(!strongest||total>strongest.total)strongest={total,main,rows:known.slice(),pattern:formation.pattern,phase:formation.phase,formationKey:formation.key};
    const highMain=known.slice().sort((a,b)=>(b.scoreRange?.max??b.score)-(a.scoreRange?.max??a.score)||defense(b.enemy)-defense(a.enemy)||a.enemy.apiId-b.enemy.apiId)[0];
    if(!strongestHigh||high>strongestHigh.total)strongestHigh={total:high,main:highMain,rows:known.slice(),pattern:formation.pattern,phase:formation.phase,formationKey:formation.key};
  }
  if(!strongest)return {status:'unknown',enemy:null,warnings:['敌舰对当前舰队的攻击能力待确认']};
  // Zero normal-hit damage does not prove safety: scratch damage and later
  // hits can still cause retreat. A tie between zeros is not a threat ranking.
  if(strongestHigh.total<=0)return {status:'unknown',enemy:null,warnings:['未模拟刮伤和连续命中，威胁待确认']};
  const {main}=strongest,selected=['aerialRaid','aerialCombat'].includes(node.kind)?strongestHigh:strongest;
  if(strongestHigh.main.enemy.apiId!==main.enemy.apiId||strongestHigh.pattern!==strongest.pattern||
    strongestHigh.formationKey!==strongest.formationKey){
    partial=true;warnings.push('航空损耗参考范围内，主要敌舰可能改变');
  }
  return {status:partial?'partial':'estimated',score:selected.total,scoreRange:{min:strongest.total,max:strongestHigh.total},candidates,
    enemy:{apiId:selected.main.enemy.apiId,name:selected.main.enemy.name,node:node.id,nodes:[node.id],
      mechanisms:selected.main.mechanisms,pattern:selected.pattern,phase:selected.phase,formationKey:selected.formationKey},
    warnings:[...new Set(warnings)]};
}
// The same enemy model may occur in several nodes. Merge its node labels but
// never combine enemy ships into a synthetic formation. Candidate scores from
// distinct nodes are compared under the same ranking method by the caller.
function uniqueThreatCandidates(candidates,limit=2){
  const byId=new Map();
  for(const row of candidates){
    if(!row?.enemy||!valid(row.score))continue;
    const id=row.enemy.apiId??row.enemy.name;if(id==null)continue;
    const previous=byId.get(id),nodes=row.enemy.nodes||[row.enemy.node];
    if(!previous)byId.set(id,{score:row.score,enemy:{...row.enemy,nodes:[...new Set(nodes.filter(Boolean))]}});
    else{
      const all=[...new Set([...previous.enemy.nodes,...nodes.filter(Boolean)])];
      if(row.score>previous.score)byId.set(id,{score:row.score,enemy:{...row.enemy,nodes:all}});
      else previous.enemy.nodes=all;
    }
  }
  return [...byId.values()].sort((a,b)=>b.score-a.score).slice(0,limit).map(row=>row.enemy);
}
function rankThreats(friendly,evidence,{equipmentMasters,rankedNodes}={}){
  if(!Array.isArray(friendly)||!friendly.length||friendly.length>MAX_SHIPS||!evidence||
    !Array.isArray(evidence.nodes)||evidence.nodes.length>MAX_NODES)
    return {status:'unknown',target:{status:'unknown',enemies:[]},enroute:{status:'unknown',enemies:[]},warnings:['舰队或路线资料待确认']};
  let count=0;
  for(const n of evidence.nodes){
    if(!Array.isArray(n.formations)||n.formations.length>MAX_FORMATIONS)
      return {status:'unknown',target:{status:'unknown',enemies:[]},enroute:{status:'unknown',enemies:[]},warnings:['敌编成超过计算预算']};
    count+=n.formations.length;
    if(n.formations.some(f=>!Array.isArray(f.ships)||f.ships.length>MAX_SHIPS||!Array.isArray(f.escort)||f.escort.length>MAX_SHIPS))
      return {status:'unknown',target:{status:'unknown',enemies:[]},enroute:{status:'unknown',enemies:[]},warnings:['敌编成超过计算预算']};
  }
  if(count>MAX_TOTAL_FORMATIONS)return {status:'unknown',target:{status:'unknown',enemies:[]},enroute:{status:'unknown',enemies:[]},warnings:['敌编成超过计算预算']};
  if(evidence.status==='unknown')return {status:'unknown',target:{status:'unknown',enemies:[]},enroute:{status:'unknown',enemies:[]},warnings:evidence.reasons||['敌情资料待确认']};
  const lookup=equipmentLookup(equipmentMasters),cache=new Map(),
    evaluated=evidence.nodes.map(node=>{
      const reading=nodeThreat(node,friendly,lookup,cache);
      rankedNodes?.set(node.id,reading);
      return {...reading,target:node.target};
    });
  const result=target=>{
    const rows=evaluated.filter(n=>!!n.target===target);
    if(!rows.length)return {status:evidence.status==='known'?'none':'unknown',enemies:[],warnings:[]};
    const known=rows.filter(n=>valid(n.score)).sort((a,b)=>b.score-a.score);
    if(!known.length)return {status:'unknown',enemies:[],warnings:[...new Set(rows.flatMap(n=>n.warnings||[]).concat('敌舰攻击能力待确认'))]};
    const winner=known[0],winnerHigh=known.slice().sort((a,b)=>(b.scoreRange?.max??b.score)-(a.scoreRange?.max??a.score))[0];
    const uncertain=winnerHigh.enemy?.node!==winner.enemy?.node||winnerHigh.enemy?.apiId!==winner.enemy?.apiId;
    const partial=evidence.status!=='known'||rows.some(n=>n.status!=='estimated')||uncertain;
    // Compare actual enemies using the same per-enemy score at each node.
    const enemies=uniqueThreatCandidates(known.flatMap(row=>row.candidates||[]),2);
    return {status:partial?'partial':'estimated',enemies:enemies.length?enemies:[winner.enemy],
      scoreRange:{min:winner.score,max:winnerHigh.scoreRange?.max??winnerHigh.score},
      warnings:[...new Set(rows.flatMap(n=>n.warnings||[]).concat(uncertain?['航空损耗参考范围内，主要威胁可能改变']:[]))]};
  };
  return {status:'partial',target:result(true),enroute:result(false),
    warnings:['按当前舰队与敌舰普通命中条件比较；未计算阵形、命中、暴击、行动抑制和连续战损，不是大破概率']};
}
// Optional short scenario ranking. Use only actual documented formations and
// attribute the damage of *simulated* battles to their enemy attackers. It is
// a comparative reference, not a calibrated retreat probability. Sampling and
// formation count are hard-limited to avoid slowing edits of the workbench.
function simulateNodeThreat(friendly,node,{store,scheme,samples=8,maxFormations=3,seed=1,special,ownFormation,specialUsed}={}){
  if(!Array.isArray(friendly)||!friendly.length||friendly.length>MAX_SHIPS||!store?.const?.$equips||
    !Array.isArray(node?.formations)||!node.formations.length||node.formations.length>MAX_FORMATIONS||
    node.formations.some(f=>!Array.isArray(f.ships)||!f.ships.length||f.ships.length>MAX_SHIPS||
      !Array.isArray(f.escort)||f.escort.length>MAX_SHIPS)||
    !Number.isInteger(samples)||samples<1||samples>16||!Number.isInteger(maxFormations)||maxFormations<1||maxFormations>3)
    return {status:'unknown',enemy:null,score:null,unresolvedCritical:true,warnings:['舰队、敌情或模拟预算不足']};
  const {deriveFriendlyAir,deriveEnemyAir,enemyAswPower}=require('./combat_air_asw');
  const battle=require('./combat_battle'),lookup=equipmentLookup(store.const.$equips);
  // Select up to two high-potential formations, plus the first documented
  // formation when distinct. Never manufacture a combined enemy formation.
  const cache=new Map(),rows=node.formations.map((formation,index)=>({formation,index,
    estimate:nodeThreat({...node,formations:[formation]},friendly,lookup,cache)}));
  const ordered=rows.slice().sort((a,b)=>(b.estimate.scoreRange?.max??-1)-(a.estimate.scoreRange?.max??-1)||a.index-b.index);
  const chosen=ordered.slice(0,Math.min(2,maxFormations));
  if(chosen.length<maxFormations&&!chosen.some(row=>row.index===0))chosen.push(rows[0]);
  for(const row of ordered)if(chosen.length<maxFormations&&!chosen.includes(row))chosen.push(row);
  const ownAir=scheme?.ships?.length===friendly.length?scheme.ships.map(entry=>deriveFriendlyAir(store,entry,{nodeKind:node.kind})):null;
  const results=[],warnings=new Set(['少量场景用于相对比较，不是大破或撤退概率','未覆盖所有敌编成、命中因素与航空损耗']);
  const critical=new Set();
  const explicitSpecial=special?.available===true&&typeof specialUsed==='boolean'&&
    typeof ownFormation==='string'&&ownFormation===special.formation;
  if(explicitSpecial)warnings.add(specialUsed?'特殊炮击按本次出击已发动参考':'特殊炮击按指定阵形和本次出击未发动参考，仍可能不发动');
  else warnings.add('特殊炮击未计入；须明确阵形和本次出击是否已发动');
  if(node.status!=='known')critical.add('敌编成资料不完整');
  // Audit every documented formation, even those not selected for simulation:
  // a missing critical attack in an unsampled alternative cannot silently be
  // excluded from the result. Duplicate hulls reuse the same pure reading.
  const airCache=new Map(),enemyAirFor=enemy=>{
    const key=JSON.stringify([enemy.apiId,enemy.status]);
    if(!airCache.has(key))airCache.set(key,deriveEnemyAir(store,enemy,{nodeKind:node.kind}));
    return airCache.get(key);
  };
  for(const formation of node.formations)for(const enemy of formation.ships.concat(formation.escort)){
    if(enemy.status!=='known')critical.add('敌舰身份或关键属性缺失');
    if(enemy.kind==='installation')critical.add('陆上目标行动尚未完整计入');
    if(enemyAirFor(enemy).unresolvedAttack)critical.add('敌方攻击机装备未识别');
    const master=catalog.get(enemy.apiId),type=master?.shipType||'';
    if(friendly.some(ship=>ship.submarine)&&/駆逐|軽巡|雷装巡|海防|空母|レ級/.test(`${type} ${master?.name||''}`)&&
      enemyAswPower(enemy,{phase:node.kind==='nightBattle'?'night':'shelling'}).status==='unknown')
      critical.add('敌方对潜攻击资料缺失');
    if(enemy.kind==='submarine'&&friendly.some(ship=>ship.asw?.status==='unknown'))critical.add('己方对潜攻击资料缺失');
    const opening=enemyOpeningTorpedo(enemy,{nodeKind:node.kind});
    if(opening.status==='unknown'&&/潜水|棲姫|棲鬼|レ級/.test(master?.name||''))critical.add('关键敌舰开幕雷击条件待确认');
  }
  if(node.formations.length>chosen.length)warnings.add('仅抽取部分敌编成进行短样本比较');
  for(const {formation} of chosen){
    if(!Array.isArray(formation.ships)||!formation.ships.length||formation.ships.length>MAX_SHIPS||
      !Array.isArray(formation.escort)||formation.escort.length>MAX_SHIPS){warnings.add('敌编成资料不完整');critical.add('敌编成资料不完整');continue;}
    const foes=formation.ships.concat(formation.escort),enemyAir=foes.map(enemyAirFor);
    const prepared=battle.prepareBattle(friendly,formation.ships,{kind:node.kind,
      escort:formation.escort,ownAir,enemyAir,enemyFormation:formation.formation?.[0],
      ...(explicitSpecial?{special,ownFormation}: {})});
    if(prepared.status==='unknown'){warnings.add('部分敌编成无法模拟');critical.add('部分敌编成无法模拟');continue;}
    if(explicitSpecial&&!prepared.special){warnings.add('特殊炮击资料或阵形不完整，未纳入模拟');critical.add('特殊炮击资料或阵形不完整');}
    prepared.reasons.forEach(reason=>warnings.add(reason));
    if(prepared.foes.some(actor=>actor.installation))critical.add('陆上目标行动尚未完整计入');
    if(enemyAir.some(air=>air.unresolvedAttack))critical.add('敌方攻击机装备未识别');
    if(friendly.some(ship=>ship.hasAircraft)&&(!ownAir||ownAir.some(air=>air.status==='unknown')))
      critical.add('己方航空攻击资料缺失');
    if(prepared.allies.some(ship=>ship.submarine)&&prepared.foes.some(enemy=>enemy.aswCapable&&enemy.enemyAsw?.status==='unknown'))
      critical.add('敌方对潜攻击资料缺失');
    if(prepared.foes.some(enemy=>enemy.submarine)&&prepared.allies.some(ship=>ship.asw?.status==='unknown'))
      critical.add('己方对潜攻击资料缺失');
    if(prepared.allies.some(ship=>!Number.isFinite(ship.fire)||!Number.isFinite(ship.torpedo)||
      ship.carrier&&ship.armedCarrier&&!Number.isFinite(ship.carrierRaw)))critical.add('己方关键攻击资料缺失');
    if(prepared.foes.some(enemy=>enemy.openingUncertain&&/潜水|棲姫|棲鬼|レ級/.test(enemy.master?.name||'')))
      critical.add('关键敌舰开幕雷击条件待确认');
    for(const air of enemyAir)if(air.status!=='known')warnings.add('敌机损耗或装备资料待确认');
    if(ownAir?.some(air=>air.status!=='known'))warnings.add('己方航空损耗或装备资料待确认');
    if((formation.formation?.length||0)>1)warnings.add('敌方可能使用其他阵形');
    const rng=battle.random((seed+formation.pattern*0x9e37)>>>0),runs=[];
    for(let i=0;i<samples;i++)runs.push(battle.runScenario(prepared,rng,{specialUsed:explicitSpecial?specialUsed:false}));
    if(runs.some(run=>run.status==='unknown')){warnings.add('部分模拟场景资料不足');critical.add('部分模拟场景资料不足');continue;}
    if(runs.some(run=>run.status==='partial')){warnings.add('部分攻击缺少资料');critical.add('部分攻击缺少资料');}
    const severe=runs.filter(run=>run.severe),basis=severe.length?severe:runs;
    const damage=foes.map((enemy,index)=>({enemy,index,impact:basis.reduce((sum,run)=>sum+run.damageByEnemy[index],0)/basis.length}));
    const leader=damage.sort((a,b)=>b.impact-a.impact||a.index-b.index)[0];
    if(!leader||leader.impact<=0){warnings.add('当前样本不足以区分敌舰威胁');continue;}
    const ownLost=runs.reduce((sum,run)=>sum+run.ownLost,0)/samples;
    const severeFraction=severe.length/samples;
    const score=.45*ownLost+.55*severeFraction;
    const candidates=damage.filter(row=>row.impact>0).map(row=>({score:row.impact,
      enemy:{apiId:row.enemy.apiId,name:row.enemy.name,node:node.id,nodes:[node.id],
        pattern:formation.pattern,phase:formation.phase}}));
    results.push({score,enemy:{apiId:leader.enemy.apiId,name:leader.enemy.name,node:node.id,nodes:[node.id],
      pattern:formation.pattern,phase:formation.phase},candidates,ownLost,severeFraction});
  }
  if(!results.length)return {status:'unknown',enemy:null,score:null,unresolvedCritical:true,warnings:[...warnings,...critical]};
  results.sort((a,b)=>b.score-a.score);
  return {status:'partial',score:results[0].score,enemy:results[0].enemy,candidates:results.flatMap(row=>row.candidates),unresolvedCritical:critical.size>0,
    sampledFormations:results.length,samples,warnings:[...new Set([...warnings,...critical])]};
}
module.exports={rankThreats,nodeThreat,enemyThreat,candidateAttack,equipmentLookup,simulateNodeThreat,uniqueThreatCandidates};
