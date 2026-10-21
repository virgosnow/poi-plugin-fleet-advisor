'use strict';
// Reviewed guide policies, fleet templates and special-attack seed positions.
const {doubleAttack}=require('./loadout/night_equipment');
const {specialAttackCores,arrangeSpecialAttack}=require('../domain/combat/special_attacks');
const {aswEscortLimit,aswEscortIds}=require('./loadout/loadout_policy');
const aswCombat=require('../domain/combat/asw_combat');
const {aswPotential,hasDuplicateShipFamily,idsKey,num,schemeOf,shipCost,usableSlots}=require('./context');
const {antiGroundShips,requiredDestroyerGuns,surfaceWeaponCount}=require('./fitting');
const {carrierStrike,openingAirStrike,openingTorpedo}=require('./scoring');

const THREE_FIVE_MIN_LEVEL=70;
const THREE_FIVE_UPPER_MIN_AIR=170;
const THREE_FIVE_TEMPLATES=[
  {style:'lower',slots:[[3],[2],[2],[2],[2],[2]]},
  {style:'lower',slots:[[2],[2],[2],[2],[2],[2]]},
  {style:'upper',slots:[[11,18],[11,18],[11,18],[5,6],[5,6],[5,6]]},
  {style:'upper',slots:[[8,9],[11,18],[11,18],[5,6],[5,6],[5,6]]}
];
function threeFiveEquipmentTypes(store,row,scheme){
  const assigned=scheme?.ships.find(ship=>ship.id===row.id);
  return (assigned?.slots||row.ship.api_slot||[]).filter(id=>id>0).map(id=>
    Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]));
}
function threeFiveArmed(store,row,scheme){
  const types=threeFiveEquipmentTypes(store,row,scheme);
  if(row.stype===2)return types.filter(type=>type===1||type===5).length>=2;
  if([11,18].includes(row.stype))return types.some(type=>type===7||type===8);
  return true;
}
function threeFiveSeeds(ctx){
  const score=row=>num(row.ship.api_karyoku)+num(row.ship.api_raisou)*0.6+
    num(row.ship.api_soukou)*0.35+row.level*0.5;
  const sorters=[
    (a,b)=>b.power-a.power||a.id-b.id,
    (a,b)=>score(b)-score(a)||a.id-b.id,
    (a,b)=>shipCost(a)-shipCost(b)||score(b)-score(a)||a.id-b.id,
    (a,b)=>num(b.ship.api_sakuteki)-num(a.ship.api_sakuteki)||score(b)-score(a)
  ];
  const results=[];
  for(const template of THREE_FIVE_TEMPLATES)for(const compare of sorters){
    const rows=ctx.fixed.map(id=>ctx.byId.get(id)),slots=template.slots.slice();
    if(rows.some(row=>row.level<THREE_FIVE_MIN_LEVEL||
      !threeFiveArmed(ctx.store,row)))continue;
    let compatible=true;
    for(const row of rows){
      const index=slots.findIndex(types=>types.includes(row.stype));
      if(index<0){compatible=false;break;}
      slots.splice(index,1);
    }
    if(!compatible)continue;
    const used=new Set(rows.map(row=>row.id));
    for(const types of slots){
      const next=ctx.roster.filter(row=>types.includes(row.stype)&&
        row.level>=THREE_FIVE_MIN_LEVEL&&threeFiveArmed(ctx.store,row)&&
        !used.has(row.id)&&
        !hasDuplicateShipFamily([...rows,row])).sort(compare)[0];
      if(!next){compatible=false;break;}
      rows.push(next);used.add(next.id);
    }
    if(compatible)results.push(rows);
  }
  return results;
}
function threeFiveStyle(store,scheme,rows,route,profile){
  const path=profile?.examples?.[0]?.join('');
  const los=route.lineOfSight;
  const losCoefficient=path==='BDHK'?4:path==='FGK'?1:null;
  const losMinimum=path==='BDHK'?40:path==='FGK'?28:null;
  const pathNodes=path?['start',...path.slice(0,-1).split('')]:[];
  const plannedRoute=los?.status==='estimate'&&profile?.status==='possible'&&
    route.chanceRange?.[1]===1&&losCoefficient!==null&&
    Number(los.scoresByCoefficient?.[losCoefficient])-Number(los.thresholdMargin||0)>=losMinimum&&
    route.pointAssessments?.filter(point=>pathNodes.includes(point.from)).every(point=>
      point.assessment?.status==='fixed'||
      (point.from===(path==='BDHK'?'H':'G')&&point.assessment?.status==='unknown'));
  if(rows.length!==6||rows.some(row=>row.level<THREE_FIVE_MIN_LEVEL)||
    rows.some(row=>!threeFiveArmed(store,row,scheme))||
    !(route.chanceRange?.[0]===1&&profile?.status==='known'||plannedRoute)||
    profile.pathCount!==1)
    return null;
  const count=types=>rows.filter(row=>types.includes(row.stype)).length;
  if(path==='FGK'&&((count([2])===5&&count([3])===1)||count([2])===6))
    return 'lower';
  const carriers=count([11,18]),cruisers=count([5,6]),battleships=count([8,9]);
  const air=route.airControl?.fleetAirPower;
  // 170 is an approximate pre-sortie parity floor inferred from the upper
  // route's final-state 381 air-superiority quick-reference line.
  if(path==='BDHK'&&cruisers===3&&
    (carriers===3&&battleships===0||carriers===2&&battleships===1)&&
    air?.status==='range'&&air.min>=THREE_FIVE_UPPER_MIN_AIR)return 'upper';
  return null;
}
// These are攻略 suitability checks, not additional route rules. In particular,
// a route to an installation boss is not useful without an installation hitter.
// Keep the thresholds deliberately modest and label them as recommendation
// heuristics rather than wiki branching conditions.
const GUIDE_POLICIES={
  '1-1':{minLevel:1,minShips:1,templates:null},
  '1-2':{minLevel:10,templates:[[[3],[2],[2],[2],[2]]]},
  '1-3':{minLevel:25,templates:[
    [[6],[2],[2],[7],[3],[5,6]],
    [[6],[2],[2],[2],[2],[3,4]],
    [[16],[6],[2],[2],[7],[3]]]},
  '1-4':{minLevel:30,minShips:4,templates:null},
  '1-6:N':{minLevel:30,templates:[[[3],[2],[2],[2],[2],[2]]]},
  '2-1':{minLevel:35,templates:[
    [[16],[3],[2],[2],[2],[2]],
    [[7],[11,18],[5,6],[3,4],[2],[2]],
    [[16],[7],[5,6],[3],[2],[2]],
    [[16],[7],[3],[2],[2],[2]]]},
  '2-2':{minLevel:35,templates:[
    [[16],[7],[7],[5,6],[1],[1]],
    [[16],[8,9],[7],[5,6],[1],[1]],
    [[16],[7],[7],[5,6],[2],[2]],
    [[16],[5,6],[3],[2],[2],[2]]]},
  '2-3':{minLevel:40,templates:[
    [[16],[2],[2],[8,9,10],[11,18],[3,4]],
    [[16],[2],[2],[11,18],[7],[5,6]],
    [[3],[2],[2],[2],[2],[7,11,18]]]},
  '2-4':{minLevel:50,templates:[
    [[5,6],[3],[2],[2],[2],[2]],
    [[7],[3],[2],[2],[8,9],[5,6]]]},
  '2-5':{minLevel:50,templates:[
    [[7],[3],[2],[2],[2],[11,18,5,6]],
    [[6],[6],[9,10],[5,6,8,9,10],[5,6,8,9,10],[5,6,8,9,10]]]},
  '3-1':{minLevel:50,templates:[
    [[2],[2],[8,9,11,18],[7,8,9,11,18],[5,6,3,4],[5,6,3,4]]]},
  '3-2':{minLevel:55,templates:[[[3],[2],[2],[2],[2],[2]]]},
  '3-3':{minLevel:55,templates:[
    [[11,18],[7,8,9,10],[2],[2],[3,4,5,6],[3,4,5,6]]]},
  '3-4':{minLevel:65,templates:[
    [[6],[3],[3],[2],[2],[2]],
    [[16],[11,18],[11,18],[7],[7],[3]],
    [[16],[11,18],[11,18],[8,9],[7],[3]]]},
  '4-1':{minLevel:55,templates:[
    [[3],[2],[2],[2],[2],[6,16]],
    [[7],[8,9],[5,6],[3,4],[2],[2]]]},
  '4-2':{minLevel:55,templates:[
    [[11,18],[8,9,10],[7],[5,6,16],[2],[2]],
    [[11,18],[7],[5,6,16],[2],[2],[2]]]},
  '4-3':{minLevel:50,templates:[
    [[7],[7],[3],[2],[2],[2]],
    [[11,18],[7,11,18],[3],[2],[2],[5,6,4]]]},
  '4-4':{minLevel:65,templates:[
    [[11,18],[11,18],[2],[2],[5,6],[8,9,10]],
    [[11,18],[11,18],[7],[2],[2],[5,6]]]},
  '4-5':{minLevel:75,templates:[
    [[8,9,10],[11,18],[11,18],[7],[5,6],[5,6]],
    [[8,9,10],[8,9,10],[11,18],[11,18],[5,6],[2]]]},
  '5-1':{minLevel:65,templates:[
    [[8,9,10],[7],[5,6,4],[3],[2],[2]]]},
  '5-2':{minLevel:60,templates:[
    [[11,18],[11,18],[2],[2],[8,9,10],[8,9,10]],
    [[11,18],[11,18],[2],[2],[5,6],[5,6]],
    [[11,18],[11,18],[8,9,10],[8,9,10],[5,6],[5,6]]]},
  '5-3':{minLevel:75,templates:[
    [[5,6],[5,6],[5,6],[5,6],[5,6],[3]],
    [[8,9],[6],[6],[3],[2],[2]],
    [[8],[8,9],[6],[3],[2],[2]]]},
  '5-4':{minLevel:75,templates:[
    [[11,18],[8,9,10],[7],[5,6],[2],[2]],
    [[10],[6],[3],[2],[2],[2]]]},
  '5-5':{minLevel:85,templates:[
    [[8,9,10],[8,9,10],[11,18],[11,18],[6],[6]],
    [[8,9,10],[8,9,10],[11,18],[7],[6],[3,4]]]},
  '6-1':{minLevel:60,templates:[
    [[13,14],[13,14],[13,14],[11,18],[4],[3]],
    [[13,14],[13,14],[13,14],[20],[3],[11,18]],
    [[13,14],[13,14],[13,14],[13,14],[13,14],[20]]]},
  '6-2':{minLevel:75,templates:[
    [[8,9],[11,18],[2],[2],[5,6,4],[5,6,4]]]},
  '6-3':{minLevel:70,templates:[
    [[16],[3],[3],[2],[2],[2]],
    [[16],[3],[2],[2],[2],[2]]]},
  '6-4':{minLevel:70,templates:[
    [[3],[8],[2],[2],[2],[5,6,4,3,16]]]},
  '6-5':{minLevel:80,templates:[
    [[8,9],[11,18],[11,18],[4],[5,6],[2]],
    [[10],[10],[6],[3],[2],[2]]]},
  '7-1':{minLevel:60,coastalMinLevel:40,templates:[[[3],[2],[2],[2],[2]],[[2],[1],[1],[1]]]},
  '7-2:gauge1':{minLevel:40,templates:[
    [[1],[1],[1],[7,3,4],[2,3,4,5,6,7]]]},
  '7-2:gauge2':{minLevel:70,templates:[
    [[8],[11,18],[7],[6],[2],[2]],
    [[11,18],[7],[7],[6],[2],[2]]]},
  '7-3:gauge1':{minLevel:40,templates:[
    [[5],[2],[2],[2]],
    [[5],[2],[2]],
    [[5],[2],[6,3],[2]]]},
  '7-3:gauge2':{minLevel:60,templates:[
    [[5],[5],[3,4,16],[2],[2],[2]],
    [[5],[2],[6,3],[6,3]]]},
  '7-4':{minLevel:70,coastalMinLevel:40,templates:[
    [[10],[7],[2,1],[2,1],[5,6,3,4,21],[2,1]],
    [[10],[7],[1],[1],[3,4],[5,6]]]},
  '7-5:gauge1':{minLevel:70,templates:[
    [[10],[6],[3],[2],[2],[2]],
    [[8,9,10],[4],[4],[3],[2],[2]]]},
  '7-5:gauge2':{minLevel:75,templates:[
    [[10],[6],[3],[2],[2],[2]]]},
  '7-5:gauge3':{minLevel:80,templates:[
    [[10],[6],[3],[2],[2],[2]],
    [[8],[4],[4],[3],[2],[2]],
    [[7],[6],[6],[3],[2],[2]]]}
};
const GUIDE_WORLD={1:'鎮守府海域',2:'南西諸島海域',3:'北方海域',
  4:'西方海域',5:'南方海域',6:'中部海域',7:'南西海域'};
const guideSource=area=>`https://wikiwiki.jp/kancolle/${GUIDE_WORLD[area[0]]}/${area}`;
const guidePolicy=(area,target,phase)=>{
  if(target!=='boss'&&!(area==='1-6'&&target==='N'))return null;
  const policy=GUIDE_POLICIES[`${area}:${phase}`]||
    GUIDE_POLICIES[`${area}:${target}`]||
    (area!=='7-2'?GUIDE_POLICIES[area]:null);
  return policy?{...policy,area,phase}:null;
};
const guideShipAllowed=(policy,area,phase,row)=>
  row.level>=(row.stype===1&&policy.coastalMinLevel||policy.minLevel)&&
  (!['6-4'].includes(area)&&!(area==='7-2'&&phase==='gauge2')||
    Number(row.ship.api_soku)>=10);
function remainingSlots(rows,slots){
  if(!rows.length)return slots;
  const row=rows[0];
  for(let i=0;i<slots.length;i++)if(slots[i].includes(row.stype)){
    const rest=remainingSlots(rows.slice(1),slots.filter((_,index)=>index!==i));
    if(rest)return rest;
  }
  return null;
}
function guideHull(policy,rows){
  if(!policy)return true;
  const minShips=policy.minShips||Math.min(...policy.templates.map(slots=>slots.length));
  if(rows.length<minShips||rows.some(row=>!guideShipAllowed(policy,policy.area,policy.phase,row)))return false;
  if(!policy.templates)return rows.every(row=>
    !(policy.area==='1-1'?[19,20,22]:[13,14,19,20,22]).includes(row.stype));
  return policy.templates.some(slots=>rows.length===slots.length&&
    remainingSlots(rows,slots)?.length===0);
}
function guideSeeds(ctx,policy,sorterLimit=6){
  if(!policy?.templates)return [];
  const battle=row=>num(row.ship.api_karyoku)+num(row.ship.api_raisou)*0.6+
    num(row.ship.api_soukou)*0.4+row.level*0.5;
  const sorters=[
    (a,b)=>b.power-a.power||a.id-b.id,
    (a,b)=>battle(b)-battle(a)||a.id-b.id,
    (a,b)=>shipCost(a)-shipCost(b)||battle(b)-battle(a)||a.id-b.id,
    // Keep the inexpensive air/utility backbone, but cover fighting destroyers
    // independently. A whole-fleet battle sort can change the aircraft carriers
    // at the same time and lose an otherwise feasible night/air configuration.
    (a,b)=>a.stype===2&&b.stype===2?battle(b)-battle(a)||a.id-b.id:
      shipCost(a)-shipCost(b)||battle(b)-battle(a)||a.id-b.id,
    (a,b)=>(b.ship.api_slot||[]).filter(id=>id>0).length-
      (a.ship.api_slot||[]).filter(id=>id>0).length||battle(b)-battle(a),
    (a,b)=>{
      const aAsw=aswPotential(ctx.store,a),bAsw=aswPotential(ctx.store,b);
      return (Number.isFinite(bAsw-aAsw)?bAsw-aAsw:0)||battle(b)-battle(a);
    }
  ];
  const results=[];
  for(const slots of policy.templates)for(const compare of sorters.slice(0,sorterLimit)){
    const needsFastSouth=policy.area==='2-5'&&slots[0][0]===7;
    const rows=ctx.fixed.map(id=>ctx.byId.get(id));
    const remaining=remainingSlots(rows,slots);
    if(!remaining||rows.some(row=>!guideShipAllowed(policy,policy.area,policy.phase,row)||
      needsFastSouth&&Number(row.ship.api_soku)<10))continue;
    const used=new Set(rows.map(row=>row.id));let complete=true;
    for(const types of remaining){
      const next=ctx.roster.filter(row=>types.includes(row.stype)&&
        guideShipAllowed(policy,policy.area,policy.phase,row)&&!used.has(row.id)&&
        (!needsFastSouth||Number(row.ship.api_soku)>=10)&&
        !hasDuplicateShipFamily([...rows,row])).sort(compare)[0];
      if(!next){complete=false;break;}
      rows.push(next);used.add(next.id);
    }
    if(complete)results.push(rows);
  }
  return results;
}
function oneOneSeeds(ctx){
  const fixed=ctx.fixed.map(id=>ctx.byId.get(id));
  if(fixed.length>=2)return [];
  const options=ctx.roster.filter(row=>!ctx.fixed.includes(row.id)&&
    ![1,19,20,22].includes(row.stype)&&
    !hasDuplicateShipFamily([...fixed,row])).map(row=>{
    const scheme=schemeOf(ctx.fleet,[row]);
    const early=openingTorpedo(ctx.store,[row],scheme).power+
      openingAirStrike(ctx.store,[row],scheme);
    return {row,early,cost:shipCost(row)};
  });
  const chosen=new Map();
  for(const item of options.slice().sort((a,b)=>b.early-a.early||a.cost-b.cost).slice(0,16))
    chosen.set(item.row.id,item.row);
  for(const item of options.filter(item=>item.early>0).sort((a,b)=>
    b.early/Math.max(1,b.cost)-a.early/Math.max(1,a.cost)).slice(0,12))
    chosen.set(item.row.id,item.row);
  for(const item of options.filter(item=>[4,7,13,14,16].includes(item.row.stype))
    .sort((a,b)=>a.cost-b.cost||b.row.level-a.row.level).slice(0,12))
    chosen.set(item.row.id,item.row);
  const dualCapable=row=>[3,6,16].includes(row.stype)&&
    (row.master.api_maxeq||[]).some(count=>Number(count)>0)&&
    openingTorpedo(ctx.store,[row],schemeOf(ctx.fleet,[row])).count>0;
  const dualRows=options.filter(item=>dualCapable(item.row))
    .sort((a,b)=>b.row.level-a.row.level||a.cost-b.cost).slice(0,8);
  for(const item of dualRows)
    chosen.set(item.row.id,item.row);
  const shortlist=[...dualRows.map(item=>item.row),...chosen.values()]
    .filter((row,index,array)=>array.findIndex(other=>other.id===row.id)===index)
    .slice(0,28),results=[];
  const pairOptions=[
    ...[4,7,3,6,16,13,14,11,18].flatMap(type=>shortlist.filter(row=>row.stype===type)
      .sort((a,b)=>Number(dualCapable(b))-Number(dualCapable(a)))
      .slice(0,type===16?3:2)),
    ...shortlist.slice(0,4)
  ].filter((row,index,array)=>array.findIndex(other=>other.id===row.id)===index)
    .slice(0,22);
  for(const row of shortlist){
    results.push([...fixed,row]);
    if(!fixed.length&&pairOptions.includes(row))for(const second of pairOptions){
      if(second.id===row.id||hasDuplicateShipFamily([row,second]))continue;
      results.push([row,second]);
    }
  }
  return results;
}
function guideReady(policy,area,phase,store,scheme,rows,route,profile){
  if(!policy)return true;
  if(!guideHull(policy,rows)||!['known','possible'].includes(profile?.status))return false;
  const paths=(profile.examples||[]).map(nodes=>nodes.join(''));
  const counts=type=>rows.filter(row=>type.includes(row.stype)).length;
  const destroyers=scheme.ships.filter(entry=>Number(store.const.$ships[
    store.info.ships[entry.id].api_ship_id]?.api_stype)===2);
  const guns=destroyers.map(entry=>surfaceWeaponCount(store,entry));
  const escorts=aswEscortIds(store,scheme.ships,aswEscortLimit(profile));
  const armed=minimum=>destroyers.every((entry,i)=>guns[i]>=minimum||escorts.has(entry.id)&&
    aswCombat.requiresAswPackages(profile)&&entry.slots.filter(id=>aswCombat.isAswWeapon(
      store.const.$equips[store.info.equips[id]?.api_slotitem_id])).length>=2);
  // A real ASW escort may trade guns for a useful package. Do not veto it
  // with a template preference before its damage and boss firepower are scored.
  if(!armed(requiredDestroyerGuns(area,phase,profile)))return false;
  const capitalGuns=scheme.ships.filter(entry=>[8,9,10].includes(Number(
    store.const.$ships[store.info.ships[entry.id].api_ship_id]?.api_stype)))
    .map(entry=>(entry.slots||usableSlots(store,entry.id)).filter(id=>
      [2,3,4].includes(Number(store.const.$equips[
        store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]))).length);
  if(capitalGuns.some(count=>count<(area==='1-1'?1:2)))return false;
  const aswCount=(route.openingASW?.ships||[]).filter(ship=>ship.predictedEligible).length;
  const safeLos=coefficient=>Number(route.lineOfSight?.scoresByCoefficient?.[coefficient])-
    Number(route.lineOfSight?.thresholdMargin||0);
  const strike=()=>carrierStrike(store,rows,scheme)>0;
  const ground=()=>antiGroundShips(store,scheme);
  const hasPath=path=>paths.includes(path);
  if(area==='1-1')return rows.length<=2&&rows.every(row=>![1,19,20,22].includes(row.stype));
  if(area==='1-2')return rows.every(row=>Number(row.ship.api_soku)>=10)&&hasPath('AE');
  if(area==='1-3')return counts([2])>=2&&counts([6,16])>=1&&
    paths.some(path=>path.endsWith('J'));
  if(area==='1-4')return rows.length>=4&&counts([1])===0&&
    guns.every(count=>count>=2);
  if(area==='1-6')return counts([2])===5&&hasPath('AEGFBN');
  if(area==='2-1')return counts([11,18,7])<=2&&counts([10,22])===0&&
    paths.some(path=>path.endsWith('H'));
  if(area==='2-2')return counts([16])===1&&counts([11,18,7,8,9])>=1&&
    paths.some(path=>path.endsWith('K'));
  if(area==='2-3')return (counts([16])>=1||counts([3])>=1&&counts([2])>=4)&&
    paths.some(path=>path.endsWith('N'));
  if(area==='2-4')return (hasPath('BGHLP')||counts([7])>=1&&counts([3])>=1&&
    counts([2])>=2&&paths.some(path=>path.endsWith('P')))&&
    (counts([7,11,18])===0||strike());
  if(area==='2-5'){
    const south=counts([7])>=1&&counts([3])===1&&counts([2])===3&&
      rows.every(row=>Number(row.ship.api_soku)>=10)&&
      safeLos(1)>=34&&paths.includes('CEIO');
    const drums=scheme.ships.filter(entry=>(entry.slots||usableSlots(store,entry.id))
      .some(id=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]
        ?.api_type?.[3])===30)).length;
    const north=counts([6])>=2&&drums>=2&&
      rows.some(row=>Number(row.ship.api_soku)<10)&&safeLos(1)>=49&&paths.includes('BFJO');
    return (south||north)&&guns.every(count=>count>=2);
  }
  if(area==='3-1')return counts([2])===2&&counts([8,9,10,11,18,7])<=2&&
    paths.some(path=>path.endsWith('G'));
  if(area==='3-2')return counts([2])===5&&counts([3])===1&&
    paths.some(path=>path.endsWith('L'));
  if(area==='3-3')return counts([11,18])===1&&counts([2])>=2&&
    paths.some(path=>path.endsWith('M'))&&strike();
  if(area==='3-4')return paths.some(path=>path.endsWith('P'))&&
    (counts([11,18,7])===0||strike());
  if(area==='4-1')return paths.some(path=>path.endsWith('J'))&&
    (counts([7])===0||strike());
  if(area==='4-2')return counts([2])>=2&&paths.some(path=>path.endsWith('L'))&&strike();
  if(area==='4-3')return guns.every(count=>count>=1)&&
    antiGroundShips(store,scheme).length>=1&&
    paths.some(path=>path.endsWith('N'));
  if(area==='4-4')return counts([2])===2&&aswCount>=1&&strike()&&
    paths.some(path=>path.endsWith('K'));
  if(area==='4-5')return ground().length>=2&&strike()&&
    paths.some(path=>path.endsWith('T'));
  if(area==='5-1')return counts([7])===1&&counts([2])===2&&strike()&&hasPath('BCFJ');
  if(area==='5-2')return armed(2)&&
    carrierStrike(store,rows,scheme)>0&&
    paths.some(path=>path.endsWith('O'));
  if(area==='5-3'){
    return scheme.ships.every(entry=>doubleAttack(store,entry))&&
      paths.some(path=>path==='DGIOKEQ');
  }
  if(area==='5-4')return paths.some(path=>path.endsWith('P')&&
      (path.includes('L')?safeLos(2)>=60:safeLos(2)>=45))&&
    (counts([7,11,18])===0||strike());
  if(area==='5-5')return safeLos(2)>=80&&counts([8,9,10])>=2&&
    counts([7,11,18])>=1&&strike()&&aswCount>=1&&hasPath('BKPS');
  if(area==='6-1')return counts([13,14])>=3&&
    safeLos(4)>=(counts([20])?25:36)&&paths.some(path=>path.endsWith('K'));
  if(area==='6-2')return counts([2])===2&&strike()&&
    paths.some(path=>path.endsWith('K')&&
      (path.includes('J')?safeLos(3)>=50:safeLos(3)>=40));
  if(area==='6-3')return counts([16])===1&&counts([3,21])>=1&&counts([2])>=2&&
    safeLos(3)>=38&&paths.some(path=>path.endsWith('J'));
  if(area==='6-4')return rows[0]?.stype===3&&guns.every(count=>count>=1)&&
    antiGroundShips(store,scheme).filter(value=>value>=2).length>=2&&
    paths.some(path=>path.startsWith('B')&&path.endsWith('N'));
  if(area==='6-5')return paths.some(path=>path.endsWith('M')&&
      (path.includes('G')?safeLos(3)>=50:safeLos(3)>=35))&&
    (counts([7,11,18])===0||strike());
  if(area==='7-1')return aswCount>=2&&counts([3])===1&&counts([2])===4&&
    hasPath('DEGHK');
  if(area==='7-2'&&phase==='gauge1')return counts([1])>=3&&counts([7,3,4,5,6])>=1&&
    (route.openingASW?.ships||[]).filter(ship=>ship.predictedEligible).length>=3&&
    paths.includes('CEG');
  if(area==='7-2'&&phase==='gauge2')return guns.every(count=>count>=1)&&
    (route.openingASW?.ships||[]).some(ship=>ship.predictedEligible)&&
    paths.includes('BCDIM');
  if(area==='7-3'&&phase==='gauge1')return rows.length<=4&&
    counts([5])>=1&&paths.some(path=>path.endsWith('E'));
  if(area==='7-3'&&phase==='gauge2')return counts([5])>=1&&
    paths.some(path=>path.endsWith('P'));
  if(area==='7-4')return Number(route.lineOfSight?.scoresByCoefficient?.[4])-
      Number(route.lineOfSight?.thresholdMargin||0)>=37&&
    (route.openingASW?.ships||[]).filter(ship=>ship.predictedEligible).length>=2&&
    carrierStrike(store,rows,scheme)>0&&
    paths.includes('ABEJLP');
  if(area==='7-5'&&phase==='gauge1')return aswCount>=2&&
    paths.some(path=>path.endsWith('K'));
  if(area==='7-5'&&phase==='gauge2')return aswCount>=2&&
    ground().filter(value=>value>=2).length>=2&&
    paths.some(path=>path.endsWith('Q'));
  if(area==='7-5'&&phase==='gauge3')return aswCount>=2&&safeLos(4)>=63&&
    paths.some(path=>path.endsWith('T'));
  return true;
}
function specialPositionLocks(ctx,heldSlots){
  const locked=new Map();
  (heldSlots||[]).forEach((s,i)=>{if(s&&(s.pin||Object.keys(s.keep||{}).length))locked.set(i,s.id);});
  // Explicit held positions take precedence; legacy fixedShipIds retain their
  // existing prefix positions when there is no draft-position information.
  if(!locked.size)ctx.fixed.forEach((id,i)=>locked.set(i,id));
  return locked;
}
function specialFleetSeeds(ctx,policies,heldSlots,night){
  const locked=specialPositionLocks(ctx,heldSlots);
  const cores=specialAttackCores(ctx.roster),output=[],seen=new Set();
  const power=row=>num(row.ship.api_karyoku)+(night?num(row.ship.api_raisou):0);
  const templates=[...new Map(policies.filter(Boolean).filter(p=>p.templates)
    .flatMap(p=>p.templates.map(t=>[JSON.stringify(t),{...p,templates:[t]}]))).values()];
  for(const core of cores){
    if(core.some((r,i)=>locked.has(i)&&locked.get(i)!==r.id||[...locked].some(([p,id])=>id===r.id&&p!==i)))continue;
    const fixed=[...new Set([...ctx.fixed,...locked.values(),...core.map(r=>r.id)])];
    if(fixed.length>6)continue;
    for(const policy of templates){
      for(const rows of guideSeeds({...ctx,fixed},policy,4)){
        const ordered=arrangeSpecialAttack(rows,core,{locked,power});if(!ordered)continue;
        const key=idsKey(ordered);if(seen.has(key))continue;seen.add(key);output.push(ordered);
        if(output.length>=64)return output;
      }
    }
  }
  return output;
}


module.exports={THREE_FIVE_MIN_LEVEL,THREE_FIVE_UPPER_MIN_AIR,guideHull,guidePolicy,guideReady,guideSeeds,guideShipAllowed,guideSource,oneOneSeeds,remainingSlots,specialFleetSeeds,specialPositionLocks,threeFiveSeeds,threeFiveStyle};
