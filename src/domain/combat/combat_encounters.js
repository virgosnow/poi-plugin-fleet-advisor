'use strict';
// Build battle inputs from individual documented formations. This module does
// not guess a missing identity, merge alternative fleets, or decide which
// multi-gauge phase or HQ-level restriction applies to a player.
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const pending=require('../../../data/sortie/adjudications.json').entries.filter(e=>e.status==='pending'&&e.kind==='compositionConflict');
const formationPending=require('../../../data/sortie/adjudications.json').entries.filter(e=>
  e.status==='pending'&&e.kind==='fieldConflict'&&e.fields?.includes('formation'));
const encounters=new Map();
const COMBAT=new Set(['battle','nightBattle','asw','aerialCombat','aerialRaid']);
const PASSIVE=new Set(['start','noBattle','item','resources','transport','activeBranch','airRecon','whirlpool']);
// Hard bounds guard the offline prototype against accidental full-map or
// malformed input. Exceeding any budget is unknown, never a partial verdict.
const LIMITS=Object.freeze({paths:128,nodesPerPath:64,nodes:24,formationsPerNode:16,shipsPerFormation:6});
function range(value){
  const values=Array.isArray(value)?value:[value];
  if(!values.length||values.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0))return null;
  return {min:Math.min(...values),max:Math.max(...values)};
}
function enemyRecord(ref,lookup=catalog,{nodeKind}={}){
  if(!/^verified/.test(ref?.apiIdStatus||''))return {status:'unknown',reason:'敌舰身份未确认'};
  const master=lookup.get(ref.apiId),stats=master?.stats;
  if(!master||!stats)return {status:'unknown',reason:'敌舰数据缺失'};
  const type=master.shipType||'';
  const kind=/潜水/.test(type)?'submarine':/陸上|沿岸砲台/.test(type)?'installation':type?'surface':null;
  const hp=range(stats['耐久']),armor=range(stats['装甲']),fire=range(stats['火力']),torpedo=range(stats['雷装']);
  const aircraft=range(stats['搭載']);
  // Air-raid installations cannot take part in cannon/torpedo combat and
  // are not targets of the player's air attacks. Their omitted ground combat
  // stats are non-applicable here, not fabricated zero-valued attributes.
  if(nodeKind==='aerialRaid'&&kind==='installation'&&hp?.min>0&&aircraft&&
    Array.isArray(master.equipment)&&(!armor||!fire||!torpedo))
    return {status:'known',apiId:ref.apiId,name:master.kcwikiNameZh||ref.name,kind,carrier:false,
      hp,armor:null,fire:null,torpedo:null,aircraft,airOnly:true};
  if(!kind||!hp||hp.min===0||!armor||!fire||!torpedo)return {status:'unknown',reason:'敌舰类型或战斗数值缺失'};
  return {status:'known',apiId:ref.apiId,name:master.kcwikiNameZh||ref.name,kind,
    carrier:/空母/.test(type),hp,armor,fire,torpedo,aircraft};
}
function formationRecords(node,lookup=catalog){
  const groups=Object.entries(node?.phases||{});
  if(!groups.length)return {status:'unknown',formations:[],reasons:['缺少敌编成']};
  if(groups.reduce((n,[,group])=>n+(group.patterns?.length||0),0)>LIMITS.formationsPerNode)
    return {status:'unknown',formations:[],reasons:['敌编成数量超过计算预算']};
  const formations=[],reasons=[];
  for(const [phase,group] of groups){
    const rows=group.patterns||[];
    if(!rows.length){reasons.push('缺少敌编成');continue;}
    const resolve=(row,seen=new Set())=>{
      if(!row||seen.has(row))return null;
      seen.add(row);
      if(!row.sameAsPattern)return row;
      const parent=resolve(rows.find(other=>other.pattern===row.sameAsPattern),seen);
      return parent?{...parent,...row,enemyShips:row.enemyShips||parent.enemyShips,
        escortFleet:row.escortFleet||parent.escortFleet}:null;
    };
    for(const row of rows){
      const source=resolve(row);
      if(!source||!source.enemyShips?.length){reasons.push('敌编成引用或舰船缺失');continue;}
      if(source.enemyShips.length>LIMITS.shipsPerFormation||
        (source.escortFleet?.enemyShips?.length||0)>LIMITS.shipsPerFormation){reasons.push('敌编成规模超过计算预算');continue;}
      const ships=source.enemyShips.map(ref=>enemyRecord(ref,lookup,{nodeKind:node.kind}));
      const escort=(source.escortFleet?.enemyShips||[]).map(ref=>enemyRecord(ref,lookup,{nodeKind:node.kind}));
      if([...ships,...escort].some(ship=>ship.status!=='known'))reasons.push('敌舰身份或数值未确认');
      formations.push({key:`${phase}:${formations.length}`,phase,pattern:row.pattern,ships,escort,formation:source.formation||[],
        hqLevelRange:row.hqLevelRange||null,availability:row.availability||null,finalForm:row.finalForm??null});
    }
  }
  // Restrictions are retained for a later explicit phase/HQ filter. They must
  // not be silently interpreted as probabilities or as universally available.
  return {status:reasons.length?'partial':'known',formations,reasons:[...new Set(reasons)]};
}
function mapData(area){
  if(!/^\d-\d$/.test(area||''))return null;
  if(!encounters.has(area)){
    try{encounters.set(area,require(`../../../data/sortie/encounters/${area}.json`));}
    catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;encounters.set(area,null);}
  }
  return encounters.get(area);
}
function crossCheckAlternatives(area,id,data,lookup=catalog){
  const expected=pending.filter(row=>row.area===area&&row.node===id),cross=data?.crossCheck?.nodes?.[id];
  if(!expected.length)return {status:'unknown',formations:[],warnings:['敌编成冲突来源未记录']};
  const conflicts=(cross?.conflicts||[]).filter(row=>row.type==='compositionConflict');
  const variants=cross?.kcwikiVariants||[];
  if(!variants.length||expected.some(row=>!conflicts.some(other=>other.wikiwikiPattern===row.pattern)))
    return {status:'unknown',formations:[],warnings:['敌编成资料冲突尚未完整收录']};
  const convert=(enemyId,name)=>enemyRecord({apiId:enemyId,name,apiIdStatus:'verified(crosscheck)'},lookup,
    {nodeKind:data?.nodes?.[id]?.kind});
  const formations=[];
  for(let i=0;i<variants.length;i++){
    const variant=variants[i],ids=variant.apiIds,escortIds=variant.escortApiIds||[];
    if(!Array.isArray(ids)||!ids.length||ids.length>LIMITS.shipsPerFormation||!Array.isArray(escortIds)||escortIds.length>LIMITS.shipsPerFormation||
      [...ids,...escortIds].some(id=>!Number.isInteger(id)||!lookup.has(id)))
      return {status:'unknown',formations:[],warnings:['另一来源的敌编成资料不完整']};
    const ships=ids.map((id,j)=>convert(id,variant.namesJa?.[j])),escort=escortIds.map(id=>convert(id));
    if([...ships,...escort].some(ship=>ship.status!=='known'))
      return {status:'unknown',formations:[],warnings:['另一来源的敌舰战斗资料不完整']};
    const names=String(variant.formation||'').match(/第一警戒航行序列|第二警戒航行序列|第三警戒航行序列|第四警戒航行序列|単縦|複縦|輪形|梯形|単横/g)||[];
    formations.push({key:`crosscheck:${i}`,phase:'crosscheck',pattern:-(i+1),ships,escort,formation:[...new Set(names)],
      hqLevelRange:null,availability:null,finalForm:variant.finalForm??null,source:'kcwiki'});
  }
  return {status:'known',formations,warnings:['敌编成来源存在差异，已分别纳入两边已记录的编成；阶段和出现条件仍可能不同']};
}
// Apply secondary-source formation differences only to a fully identical
// ordered main and escort composition. Pattern numbers alone are not unique
// on some maps, and rows in separate phases must remain separate.
function crossCheckFormations(area,id,record,data){
  const entries=formationPending.filter(row=>row.area===area&&row.node===id);
  if(!entries.length)return {status:'known',warnings:[]};
  const cross=data?.crossCheck?.nodes?.[id],conflicts=cross?.conflicts||[],variants=cross?.kcwikiVariants||[];
  const legal=new Set(['単縦','複縦','輪形','梯形','単横','第一警戒航行序列','第二警戒航行序列','第三警戒航行序列','第四警戒航行序列']);
  const normalize=s=>({'轮形':'輪形','单纵':'単縦','复纵':'複縦','单横':'単横'}[s]||s);
  const sequence=ids=>JSON.stringify(ids||[]),failure=()=>({status:'unknown',warnings:['敌方阵形来源差异未能完整核对']});
  for(const entry of entries){
    const matches=conflicts.filter(c=>c.type==='fieldConflict'&&c.matchBasis==='ids'&&c.wikiwikiPattern===entry.pattern&&
      c.fieldConflicts?.some(f=>f.field==='formation'));
    if(matches.length!==1)return failure();
    const conflict=matches[0],field=conflict.fieldConflicts.find(f=>f.field==='formation');
    if(!Array.isArray(conflict.wikiwikiApiIds)||!conflict.wikiwikiApiIds.length||
      sequence(conflict.wikiwikiApiIds)!==sequence(conflict.kcwikiApiIds)||
      !Array.isArray(field.wikiwiki)||!Array.isArray(field.kcwiki))return failure();
    const possible=record.formations.filter(f=>f.pattern===entry.pattern&&
      sequence(f.ships.map(ship=>ship.apiId))===sequence(conflict.wikiwikiApiIds));
    if(possible.length!==1)return failure();
    const form=possible[0],escort=sequence(form.escort.map(ship=>ship.apiId));
    if(!variants.some(v=>sequence(v.apiIds)===sequence(conflict.kcwikiApiIds)&&sequence(v.escortApiIds)===escort))return failure();
    const wiki=field.wikiwiki.map(normalize).filter(name=>legal.has(name));
    const other=field.kcwiki.map(normalize).filter(name=>legal.has(name));
    if(!wiki.length||!other.length||wiki.some(name=>!form.formation.includes(name)))return failure();
    form.formation=[...new Set([...form.formation,...other])];
  }
  return {status:'known',warnings:['敌方阵形来源存在差异，按同一编成已记录的阵形参考']};
}
function routeEncounters(profile,data=mapData(profile?.area),lookup=catalog){
  if(!data||!profile?.routePaths?.length||profile.incomplete||profile.truncated||profile.status==='unavailable')
    return {status:'unknown',paths:[],nodes:[],reasons:['路线资料不完整']};
  if(profile.routePaths.length>LIMITS.paths||profile.routePaths.some(path=>!Array.isArray(path.nodes)||path.nodes.length>LIMITS.nodesPerPath))
    return {status:'unknown',paths:[],nodes:[],reasons:['路线规模超过计算预算']};
  const summaries=new Map((profile.mapPreview?.nodes||[]).map(node=>[node.id,node]));
  const ids=[...new Set(profile.routePaths.flatMap(path=>path.nodes))];
  if(ids.length>LIMITS.nodes)return {status:'unknown',paths:[],nodes:[],reasons:['路线节点超过计算预算']};
  const nodes=[],reasons=[];
  for(const id of ids){
    const raw=data.nodes?.[id],summary=summaries.get(id),kind=raw?.kind;
    if(!raw||!summary||(!COMBAT.has(kind)&&!PASSIVE.has(kind))){reasons.push(`${id} 点类型或资料缺失`);continue;}
    if(PASSIVE.has(kind))continue;
    const record=formationRecords(raw,lookup),formationCross=crossCheckFormations(profile.area,id,record,data),
      alternatives=summary.compositionUncertain?crossCheckAlternatives(profile.area,id,data,lookup):{status:'known',formations:[],warnings:[]};
    const unique=new Map();
    for(const form of record.formations.concat(alternatives.formations)){
      const key=JSON.stringify([form.phase,form.hqLevelRange,form.availability,form.finalForm,
        form.ships.map(ship=>ship.apiId),form.escort.map(ship=>ship.apiId)]),previous=unique.get(key);
      if(previous)previous.formation=[...new Set([...previous.formation,...form.formation])];
      else unique.set(key,{...form,formation:[...form.formation]});
    }
    const formations=require('./encounter_stage').filterFormations(profile.area,id,[...unique.values()],profile.encounterStage);
    if(record.status!=='known'||formationCross.status!=='known'||alternatives.status!=='known'||formations.length>LIMITS.formationsPerNode){
      reasons.push(`${id} 点敌编成资料待确认`);
    }
    const stageWarning=(!profile.encounterStage||profile.encounterStage==='unknown')&&formations.some(form=>form.finalForm===true)&&formations.some(form=>form.finalForm!==true)?
      ['该点同时收录最终形态及其他编成，暂未按当前血条筛选']:[];
    nodes.push({id,kind,target:(profile.targetNodes||[]).includes(id),...record,
      formations,sourceWarnings:[...formationCross.warnings,...alternatives.warnings,...stageWarning]});
  }
  return {status:reasons.length?'partial':'known',paths:profile.routePaths.map(path=>({nodes:[...path.nodes],uncertain:!!path.uncertain})),
    nodes,reasons:[...new Set(reasons)]};
}
module.exports={LIMITS,range,enemyRecord,formationRecords,crossCheckAlternatives,crossCheckFormations,routeEncounters};
