'use strict';
// Independent implementation of WikiWiki expedition rules. Parsed tables,
// source URLs and hashes live in data/expedition_rewards.json.
// https://wikiwiki.jp/kancolle/遠征#daihatsu
// https://wikiwiki.jp/kancolle/特大発動艇#bonus
// https://wikiwiki.jp/kancolle/ケッコンカッコカリ
const DATA=require('../../../data/expedition_rewards.json');
const RULES=DATA.rules;
const BASIS_POINTS=10000;
const RESOURCE_NAMES=['燃料','弹药','钢材','铝土'];
const equipmentRewardRate=masterId=>RULES.equipmentRates[masterId]||0;
const basisPoints=rate=>Math.round(rate*BASIS_POINTS);

function rewardBonus(ships){
  let basePoints=0,equipmentCount=0,improvementSum=0,normalCraft=0,specialCraft=0;
  for(const ship of ships){
    basePoints+=basisPoints(RULES.innateShipRates[ship.masterId]||0);
    for(const item of ship.equipment){
      const rate=equipmentRewardRate(item.masterId);
      if(rate<=0)continue;
      basePoints+=basisPoints(rate);equipmentCount++;
      improvementSum+=Math.min(10,Math.max(0,Number(item.stars)||0));
      normalCraft+=Number(item.masterId===68);specialCraft+=Number(item.masterId===193);
    }
  }
  const cappedPoints=Math.min(basisPoints(RULES.baseCap),basePoints);
  const baseRate=cappedPoints/BASIS_POINTS;
  const improvementRate=equipmentCount?baseRate*RULES.improvementFactor*improvementSum/equipmentCount:0;
  const synergyRate=RULES.specialSynergy[Math.min(4,specialCraft)][Math.min(4,normalCraft)];
  return {baseRate,improvementRate,synergyRate,totalRate:baseRate+improvementRate+synergyRate,
    equipmentCount,improvementSum,baseBasisPoints:cappedPoints,synergyBasisPoints:basisPoints(synergyRate)};
}

function resupplyCost(ships,ratios){
  const total={fuelCost:0,ammoCost:0};
  for(const ship of ships){
    for(const [resource,capacity,key] of [['fuel','fuelCapacity','fuelCost'],['ammo','ammoCapacity','ammoCost']]){
      const consumed=Math.floor(ship[capacity]*basisPoints(ratios[resource])/BASIS_POINTS);
      const supplied=ship.married&&consumed>0?Math.max(1,Math.floor(consumed*basisPoints(RULES.marriageSupplyFactor)/BASIS_POINTS)):consumed;
      total[key]+=supplied;
    }
  }
  return total;
}

function grossReward(base,bonus,great=false){
  // Wiki floors the ordinary/improvement part and special-craft part separately.
  // Use integer fractions to avoid losing one unit at floating-point boundaries.
  const count=Math.max(1,bonus.equipmentCount),starDivisor=Math.round(1/RULES.improvementFactor);
  const numerator=great?3:1,denominator=great?2:1;
  const ordinaryFactor=(BASIS_POINTS+bonus.baseBasisPoints)*starDivisor*count+
    bonus.baseBasisPoints*bonus.improvementSum;
  return Math.floor(base*numerator*ordinaryFactor/(denominator*BASIS_POINTS*starDivisor*count))+
    Math.floor(base*numerator*bonus.synergyBasisPoints/(denominator*BASIS_POINTS));
}

function missionIncome(store,slots,missionId){
  const rewards=DATA.missions[missionId]?.resources,mission=store.const.$missions?.[missionId];
  if(!rewards||rewards.length!==4||!rewards.every(Number.isFinite)||
    !Number.isFinite(mission?.api_use_fuel)||!Number.isFinite(mission?.api_use_bull))return null;
  const ships=[];
  for(const entry of slots.filter(Boolean)){
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship?.api_ship_id];
    if(!ship||!master||!Number.isFinite(master.api_fuel_max)||!Number.isFinite(master.api_bull_max))return null;
    const itemIds=(entry.slots||ship.api_slot||[]).concat(entry.ex??ship.api_slot_ex).filter(id=>id>0);
    ships.push({masterId:ship.api_ship_id,married:ship.api_lv>=100,
      fuelCapacity:master.api_fuel_max,ammoCapacity:master.api_bull_max,
      equipment:itemIds.map(id=>({masterId:store.info.equips[id]?.api_slotitem_id,stars:store.info.equips[id]?.api_level||0}))});
  }
  const bonus=rewardBonus(ships),cost=resupplyCost(ships,{fuel:mission.api_use_fuel,ammo:mission.api_use_bull});
  const rows=rewards.map((base,index)=>{
    const used=index===0?cost.fuelCost:index===1?cost.ammoCost:0;
    const success=grossReward(base,bonus),great=grossReward(base,bonus,true);
    return {name:RESOURCE_NAMES[index],cost:used,success,great,net:success-used,greatNet:great-used};
  }).filter(row=>row.success||row.cost);
  return {bonus:bonus.totalRate,cost,rows};
}
module.exports={equipmentRewardRate,rewardBonus,resupplyCost,grossReward,missionIncome};
