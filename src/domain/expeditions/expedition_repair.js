'use strict';
// Reference scenarios, not measured damage probabilities:
// https://wikiwiki.jp/kancolle/遠征#monthlyensei
// https://wikiwiki.jp/kancolle/入渠#cost
const requirements=require('../../../data/expedition_requirements.json').missions;
const ENGAGEMENT=new Map([[104,1],[113,1],[43,1],[132,1],
  [105,2],[114,2],[115,2],[46,2],[133,2],[141,2],[142,2]]);
const typeOf=missionId=>ENGAGEMENT.get(Number(missionId))||0;

function noDamageReference(store,slots,missionId,evaluation){
  const totals=requirements[missionId]?.totals;if(!totals||!Object.keys(totals).length)return false;
  if(evaluation?.checks){
    return Object.entries(totals).every(([key,need])=>{
      const check=evaluation.checks.find(c=>c.type==='total'+key[0].toUpperCase()+key.slice(1));
      return Number.isFinite(check?.left)&&check.left+1e-9>=need*2.2;
    });
  }
  const {readShipStats}=require('./expedition_stats');
  try{
    const readings=slots.map(entry=>readShipStats(store,entry.id,{slots:entry.slots||store.info.ships[entry.id].api_slot||[],ex:entry.ex??store.info.ships[entry.id].api_slot_ex}));
    return Object.entries(totals).every(([key,need])=>readings.reduce((n,row)=>n+(row[key]?.lower||0),0)+1e-9>=need*2.2);
  }catch(_){return false;}
}

function repairReference(store,slots,missionId,evaluation){
  const type=typeOf(missionId);if(!type)return null;
  const entries=slots.filter(Boolean),ships=entries.map(entry=>{
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship?.api_ship_id];
    const hp=Number(ship?.api_maxhp??master?.api_taik?.[1]),fuel=Number(master?.api_fuel_max);
    if(!Number.isFinite(hp)||hp<=0||!Number.isFinite(fuel)||fuel<0)return null;
    const current=Number(ship?.api_nowhp),damage=Math.min(Math.floor(hp/4),Number.isFinite(current)?Math.max(0,current-1):hp);
    return {fuel:Math.floor(damage*fuel*.032+1e-9),steel:Math.floor(damage*fuel*.06+1e-9)};
  });
  const source='https://wikiwiki.jp/kancolle/遠征#monthlyensei';
  if(!ships.length||ships.some(ship=>!ship))return {type,status:'unknown',source,reason:'舰娘耐久或燃料资料不完整，修理消耗待确认'};
  const protectedLine=type===2&&noDamageReference(store,entries,missionId,evaluation);
  const affected=type===1?Math.min(3,ships.length):ships.length,weight=affected/ships.length;
  const costs=protectedLine?{fuel:0,steel:0}:{fuel:Math.round(ships.reduce((n,s)=>n+s.fuel,0)*weight),
    steel:Math.round(ships.reduce((n,s)=>n+s.steel,0)*weight)};
  return {type,status:'reference',source,...costs,protectedLine,
    note:protectedLine?'交战 II 型各项属性达到要求的 220%，已有无伤报告；实际损伤仍以游戏为准':
      `参考情景：每艘受损最大耐久的 25%，${type===1?'按最多 3 艘平均分配':'按全队计算'}；非实际损伤概率或平均值`};
}
module.exports={typeOf,repairReference};
