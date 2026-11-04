'use strict';
// Per-ship consumption and marriage resupply: wikiwiki.jp/kancolle/資材.
// Aircraft replenishment: wikiwiki.jp/kancolle/補給 (5 bauxite per plane).
const jets=require('./jet_aviation');
const AIR_TYPES=new Set([6,7,8,11,25,26,45,56,57,58]);
// These take the air-state proportional loss, but are not targeted by
// ship-based anti-air fire. Jets have an extra phase and stay conservative.
const NON_STRIKE=new Set([6,25,26,45]);
const AIR_STATES=[['supremacy','空确',1],['superiority','空优',3],['parity','均衡',5],['disadvantage','劣势',7],['loss','丧失',10]];
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const supply=(amount,married)=>married&&amount>0?Math.max(1,Math.floor(amount*85/100)):amount;
const battleCost=capacity=>capacity===0?0:Math.max(1,Math.floor(capacity/5));
function estimate(store,scheme,{enemy}={}){
  if(!scheme?.ships?.length)return {status:'empty'};
  let fuel=0,ammoDay=0,ammoNight=0,planes=0,steel=0,airKnown=true,steelKnown=true,hasJets=false,unknownAsw=false;
  const airSlots=[];
  for(const entry of scheme.ships){
    const ship=store.info?.ships?.[entry.id],master=store.const?.$ships?.[ship?.api_ship_id];
    if(!ship||!master||!integer(master.api_fuel_max)||!integer(master.api_bull_max)||!integer(ship.api_lv))return {status:'unknown',reason:'舰娘补给资料不足'};
    const married=ship.api_lv>=100,day=battleCost(master.api_bull_max);
    fuel+=supply(battleCost(master.api_fuel_max),married);
    ammoDay+=supply(day,married);ammoNight+=supply(Math.ceil(day*1.5),married);
    if(!Array.isArray(entry.slots)){airKnown=false;steelKnown=false;continue;}
    for(let i=0;i<entry.slots.length;i++){
      const id=entry.slots[i];if(id<=0)continue;
      const item=store.info.equips?.[id],equip=store.const.$equips?.[item?.api_slotitem_id];
      if(!Array.isArray(equip?.api_type)){airKnown=false;steelKnown=false;continue;}
      const type=Number(equip.api_type[2]);
      if(!Number.isSafeInteger(type)||type<=0){airKnown=false;steelKnown=false;continue;}
      if(!AIR_TYPES.has(type))continue;
      if(jets.isJet(type))hasJets=true;
      const capacity=master.api_maxeq?.[i];if(!integer(capacity)){airKnown=false;if(jets.isJet(type))steelKnown=false;continue;}
      // Every ordinary fighter/ASW slot can lose at most 70/120 in this
      // single ordinary air battle. Attack aircraft may be wiped by the
      // opponent's unknown anti-air equipment, and jet phases remain unknown.
      // The 20th Squadron variants are exceptional type-26 aircraft: they
      // can also attack and suffer fleet AA, unlike ordinary ASW aircraft.
      const specialAsw=type===26&&([489,491].includes(Number(item.api_slotitem_id))||/20戦隊/.test(equip.api_name||''));
      const possibleAttackAsw=type===26&&!specialAsw&&(Number(equip.api_baku||0)>0||Number(equip.api_raig||0)>0);
      if(possibleAttackAsw)unknownAsw=true;
      planes+=NON_STRIKE.has(type)&&!specialAsw&&!possibleAttackAsw?Math.floor(capacity*70/120):capacity;
      airSlots.push({type,capacity,uncertainFirst:([25,26].includes(type)&&!specialAsw)});
      if(jets.isJet(type)){
        const cost=jets.steelCost(Number(item.api_slotitem_id),type,capacity);
        if(cost===null)steelKnown=false;else steel+=cost;
      }
    }
  }
  const available=jets.steelAvailable(store);if(available!==null)steel=Math.min(available,steel);
  const allSubmarines=enemy?.known===true&&Array.isArray(enemy.ships)&&enemy.ships.length>0&&
    enemy.ships.every(ship=>[13,14].includes(Number(ship.master?.api_stype)));
  // A conventional-only air battle permits meaningful conditional stage-1
  // ranges. They exclude unknown ship interception and are not total costs.
  const airScenarios=airKnown&&!hasJets&&!unknownAsw?AIR_STATES.map(([state,label,k])=>({state,label,
    stageOneBauxite:{min:5*airSlots.reduce((sum,slot)=>sum+(slot.uncertainFirst?0:Math.floor(slot.capacity*k*3/120)),0),
      max:5*airSlots.reduce((sum,slot)=>sum+Math.floor(slot.capacity*k*7/120),0)}})):null;
  return {status:'known',fuel,ammoDay,ammoNight,bauxite:airKnown?{min:0,max:planes*5}:null,
    steel:hasJets?(allSubmarines||available===0?{min:0,max:0}:steelKnown?{min:0,max:steel}:null):undefined,hasJets,airScenarios,
    bauxiteBound:{kind:airKnown?'ceiling':'unknown',stageOneOnly:false},
    detail:'按出击前满补给和满载计算，不包含已有短缺。燃料为昼战消耗；弹药范围为仅昼战至进入夜战。铝土上限计入防空可能击落攻击机，但不代表平均值；对手装备和制空未知，每架飞机补充消耗 5 铝。制空条件参考只计制空比例损耗，不含对空迎击；回转翼和普通对潜机的损耗系数待确认。喷式强袭可能另耗钢材。'};
}
module.exports={estimate,battleCost,supply};
