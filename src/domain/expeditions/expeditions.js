'use strict';
// Expedition eligibility engine over snapshot stores. Requirement data
// lives in data/expedition_requirements.json (community-maintained);
// CVE ships follow poi's own rule (stype 7 with a non-zero base ASW stat,
// see views/utils/selectors/const-derived.js in the poi app).
const DATA=require('../../../data/expedition_requirements.json');
const GREAT_SUCCESS_MODEL=require('../../../data/expedition_rewards.json').rules.greatSuccess;
const STYPE=Object.freeze({DE:1,DD:2,CL:3,CLT:4,CA:5,CAV:6,CVL:7,FBB:8,BB:9,BBV:10,CV:11,XBB:12,SS:13,SSV:14,AP:15,AV:16,LHA:17,CVB:18,AR:19,AS:20,CT:21,AO:22});
const DRUM_MASTER_ID=75;
const isESType=(name,stype,masterId,masters)=>{
  switch(name){
    case 'SSLike':return stype===STYPE.SS||stype===STYPE.SSV;
    case 'CVLike':return [STYPE.CV,STYPE.CVL,STYPE.AV,STYPE.CVB].includes(stype);
    case 'DDorDE':return stype===STYPE.DD||stype===STYPE.DE;
    case 'CVE':{
      const m=masters[masterId];
      return stype===STYPE.CVL&&!!m&&Array.isArray(m.api_tais)&&m.api_tais[0]>0;
    }
    default:{
      if(!(name in STYPE))throw new Error('未知舰种类别: '+name);
      return stype===STYPE[name];
    }
  }
};
// Assemble the engine's per-ship view from a snapshot store fleet.
function expeditionFleet(store,fleet,scheme,shipViews,readStats){
  const fleetData=store.info.fleets[fleet-1];
  if(!fleetData)throw new Error('舰队数据不可用');
  const masters=store.const.$ships||{};
  const busy=Number(fleetData.api_mission?.[0])!==0;
  const overrides=new Map((scheme?.ships||[]).map(s=>[s.id,s]));
  const ships=(scheme?scheme.ships.map(s=>s.id):fleetData.api_ship||[]).filter(id=>id>0).map(id=>{
    const ship=store.info.ships[id];if(!ship)return null;
    const master=masters[ship.api_ship_id]||{};
    const draft=overrides.get(id),ordinary=draft?.slots||ship.api_slot||[];
    const ex=draft?.slots&&draft.ex!==undefined?draft.ex:ship.api_slot_ex;
    const isDrum=eid=>eid>0&&store.info.equips[eid]?.api_slotitem_id===DRUM_MASTER_ID;
    let drums=0;for(const eid of ordinary)if(isDrum(eid))drums++;
    if(isDrum(ex))drums++;
    let variants=shipViews?.get(id);
    const cacheKey=readStats?JSON.stringify([ordinary,ex]):drums;
    if(variants?.has(cacheKey))return variants.get(cacheKey);
    const view={
      instanceId:Number(id),masterId:Number(ship.api_ship_id),name:master.api_name||'',
      stype:Number(master.api_stype)||0,level:Number(ship.api_lv)||0,morale:Number(ship.api_cond)||0,
      sparkled:Number(ship.api_cond)>=50,drums,
      los:Array.isArray(ship.api_sakuteki)?ship.api_sakuteki[0]:0,
      asw:Array.isArray(ship.api_taisen)?ship.api_taisen[0]:0,
      antiAir:Array.isArray(ship.api_taiku)?ship.api_taiku[0]:0,
      firepower:Array.isArray(ship.api_karyoku)?ship.api_karyoku[0]:0,
      resupplied:(ship.api_fuel??0)>=(master.api_fuel_max??0)&&(ship.api_bull??0)>=(master.api_bull_max??0),
    };
    if(readStats){view.statReadings=readStats(id,{slots:ordinary,ex});
      for(const key of Object.keys(view.statReadings))view[key]=view.statReadings[key].lower;
    }
    if(shipViews){if(!variants){variants=new Map();shipViews.set(id,variants);}variants.set(cacheKey,view);}
    return view;
  }).filter(Boolean);
  return {fleet,busy,ships,masters};
}
const ge=(left,right)=>({sat:left>=right,left,right});
function checkNorm(spec,fleetView,compiled){
  const {ships,masters}=fleetView,checks=[];
  if(!ships.length)checks.push({type:'flagshipLevel',sat:false,left:0,right:spec.flagshipLevel,detail:'舰队为空'});
  else checks.push({type:'flagshipLevel',...ge(ships[0].level,spec.flagshipLevel)});
  checks.push({type:'shipCount',...ge(ships.length,spec.shipCount)});
  if(spec.minMorale!==undefined){
    const low=ships.filter(s=>s.morale<spec.minMorale);
    checks.push({type:'minMorale',sat:low.length===0,left:Math.min(...ships.map(s=>s.morale),100),right:spec.minMorale,detail:low.map(s=>`${s.name}(${s.morale})`).join(', ')||null});
  }
  if(spec.levelSum!==undefined)checks.push({type:'levelSum',...ge(ships.reduce((n,s)=>n+s.level,0),spec.levelSum)});
  if(spec.flagshipType!==undefined){
    const ok=ships.length>0&&isESType(spec.flagshipType,ships[0].stype,ships[0].masterId,masters);
    checks.push({type:'flagshipType',sat:ok,left:ships[0]?ships[0].name:null,right:spec.flagshipType});
  }
  if(spec.fleetCompos){
    let counts;
    if(compiled){
      counts=Array(compiled.types.length).fill(0);
      for(const ship of ships){
        let members=compiled.members.get(ship.instanceId);
        if(!members){members=compiled.types.map((type,i)=>isESType(type,ship.stype,ship.masterId,masters)?i:-1).filter(i=>i>=0);compiled.members.set(ship.instanceId,members);}
        for(const i of members)counts[i]++;
      }
    }
    const results=(compiled?.compositions||spec.fleetCompos.map(Object.entries)).map(compo=>({
      parts:compo.map(([estype,need,index])=>{
        const actual=compiled?counts[index]:ships.filter(s=>isESType(estype,s.stype,s.masterId,masters)).length;
        return {estype,need,actual,sat:actual>=need};
      }),
    })).map(r=>({...r,sat:r.parts.every(p=>p.sat)}));
    checks.push({type:'fleetCompo',sat:results.some(r=>r.sat),detail:results});
  }
  if(spec.drumCarriers!==undefined)checks.push({type:'drumCarriers',...ge(ships.filter(s=>s.drums>0).length,spec.drumCarriers)});
  if(spec.drums!==undefined)checks.push({type:'drums',...ge(ships.reduce((n,s)=>n+s.drums,0),spec.drums)});
  if(spec.totals)for(const [key,need] of Object.entries(spec.totals)){
    const lower=Math.round(ships.reduce((n,s)=>n+s[key],0)*10)/10,uncertain=ships.some(s=>s.statReadings?.[key]?.upper===null);
    checks.push({type:'total'+key[0].toUpperCase()+key.slice(1),...ge(lower,need),
      ...(uncertain?{estimated:true,detail:'按可确认的保守下限核对；部分飞机或加成资料待确认'}:{})});
  }
  const unsupplied=ships.filter(s=>!s.resupplied);
  checks.push({type:'resupply',sat:unsupplied.length===0,detail:unsupplied.map(s=>s.name).join(', ')||null});
  return checks;
}
// Wiki theoretical table for drum expeditions and the documented flagship
// formula. Other all-sparkled fleets use an explicitly approximate reference.
function greatSuccessEstimate(spec,fleetView){
  const model=GREAT_SUCCESS_MODEL,counts={sparkled:0,drums:0,carriers:0};
  for(const ship of fleetView.ships){counts.sparkled+=Number(ship.sparkled);counts.drums+=ship.drums;counts.carriers+=Number(ship.drums>0);}
  const shipCount=fleetView.ships.length,flagshipLevel=fleetView.ships[0]?.level||0;
  let rawPercent=0,basePercent=0,bonusPercent=0,fullDrumBonus=false;
  if(shipCount>0){
    switch(spec.gs.kind){
      case 'drum':{
        fullDrumBonus=counts.drums>=spec.gs.max&&counts.carriers>=(spec.gs.carriers??Math.max(1,spec.drumCarriers||0));
        const table=model.drum[fullDrumBonus?'full':'minimum'];
        if(counts.drums>=spec.gs.min)rawPercent=table[counts.sparkled];
        basePercent=model.drum.minimum[0];bonusPercent=fullDrumBonus?model.drum.full[0]-basePercent:0;
        break;
      }
      case 'flagship':
        basePercent=model.flagship.basePercent;
        bonusPercent=model.flagship.sqrtLevelFactor*Math.sqrt(flagshipLevel)+model.flagship.linearLevelFactor*flagshipLevel;
        rawPercent=basePercent+counts.sparkled*model.flagship.perSparkledPercent+bonusPercent;
        break;
      default:
        if(counts.sparkled===shipCount){
          basePercent=model.ordinary.basePercent;
          rawPercent=basePercent+counts.sparkled*model.ordinary.perSparkledPercent;
        }
    }
  }
  return {estimatedPercent:Math.min(100,Math.max(0,rawPercent)),rawPercent,basePercent,bonusPercent,
    sparkledCount:counts.sparkled,shipCount,drums:counts.drums,drumCarriers:counts.carriers,fullDrumBonus,flagshipLevel,
    source:'https://wikiwiki.jp/kancolle/遠征#success',
    note:'Wiki 社区参考估算；普通远征少于 4 舰为线性参考；优先大成功不要求达到 100%'};
}
function checkGreatSuccess(spec,fleetView){
  const {ships}=fleetView,checks=[],gs=spec.gs;
  if(gs.kind==='drum')
    checks.push({type:'gsDrums',...ge(ships.reduce((n,s)=>n+s.drums,0),gs.extraDrums),detail:`提高概率的桶数（非出航门槛）`});
  else if(gs.kind==='flagship'){
    checks.push({type:'gsFlagshipLevelBonus',sat:ships.length>0,left:ships[0]?.level||0,
      detail:'旗舰等级提高大成功概率，不要求高于所有僚舰'});
  } else {
    const unsparkled=ships.filter(s=>!s.sparkled);
    checks.push({type:'gsAllSparkled',sat:ships.length>0&&unsparkled.length===0,detail:unsparkled.map(s=>`${s.name}(${s.morale})`).join(', ')||null});
  }
  return checks;
}
const missionName=(store,missionId)=>{
  const m=store.const.$missions&&store.const.$missions[missionId];
  return m&&m.api_name||null;
};
function evaluateExpedition(store,fleet,missionId,scheme){
  const spec=DATA.missions[missionId];
  if(!spec)throw new Error('未知远征: '+missionId);
  const readStats=spec.totals?require('./expedition_stats').createStatReader(store):null;
  const fleetView=expeditionFleet(store,fleet,scheme,undefined,readStats);
  return evaluateView(store,fleet,missionId,spec,fleetView);
}
function evaluateView(store,fleet,missionId,spec,fleetView,compiled){
  const norm=checkNorm(spec,fleetView,compiled);
  const gsChecks=checkGreatSuccess(spec,fleetView);
  const estimate=greatSuccessEstimate(spec,fleetView);
  return {
    missionId:Number(missionId),world:spec.world,name:missionName(store,Number(missionId)),
    fleet,fleetBusy:fleetView.busy,
    ships:fleetView.ships.map(s=>({instanceId:s.instanceId,name:s.name,level:s.level,morale:s.morale,drums:s.drums})),
    eligible:norm.every(c=>c.sat),
    checks:norm,
    greatSuccess:{kind:spec.gs.kind,...estimate,checks:gsChecks},
  };
}
// This evaluator belongs only to one immutable recommendation snapshot.
// Live checks continue to use evaluateExpedition without retained ship views.
function createEvaluator(store,fleet,missionId,options={}){
  const spec=DATA.missions[missionId];if(!spec)throw new Error('未知远征: '+missionId);
  const shipViews=new Map(),compositions=(spec.fleetCompos||[]).map(Object.entries);
  const readStats=spec.totals?(options.readStats||require('./expedition_stats').createStatReader(store)):null;
  const compiled={compositions,types:[...new Set(compositions.flatMap(parts=>parts.map(([type])=>type)))],members:new Map()};
  for(const parts of compositions)for(const part of parts)part.push(compiled.types.indexOf(part[0]));
  return scheme=>evaluateView(store,fleet,missionId,spec,expeditionFleet(store,fleet,scheme,shipViews,readStats),compiled);
}
function listExpeditions(store){
  return Object.entries(DATA.missions).map(([id,spec])=>({
    missionId:Number(id),world:spec.world,name:missionName(store,Number(id)),
    flagshipLevel:spec.flagshipLevel,shipCount:spec.shipCount,
    minMorale:spec.minMorale??null,levelSum:spec.levelSum??null,flagshipType:spec.flagshipType??null,
    fleetCompos:spec.fleetCompos||null,drumCarriers:spec.drumCarriers??null,drums:spec.drums??null,
    totals:spec.totals||null,gs:spec.gs,
  })).sort((a,b)=>a.missionId-b.missionId);
}
function requirementGaps(evaluation){
  return evaluation.checks.filter(c=>!c.sat).map(c=>({type:c.type,
    ...(Number.isFinite(c.left)&&Number.isFinite(c.right)?{actual:c.left,required:c.right,missing:Math.max(0,Math.round((c.right-c.left)*10)/10)}:{}),
    ...(c.detail?{detail:c.detail}:{})}));
}
module.exports={evaluateExpedition,createEvaluator,listExpeditions,expeditionFleet,isESType,STYPE,DATA,requirementGaps};
