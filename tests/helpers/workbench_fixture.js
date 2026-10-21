'use strict';
function fixture(){
  const ships={},masters={},equips={};
  const types=[3,2,2,2,2,2,1,2];
  for(let i=0;i<types.length;i++){
    const id=i+1,cost=i===6?7:10+i;
    masters[id]={api_id:id,api_name:`测试舰${id}`,api_stype:types[i],api_slot_num:2,
      api_maxeq:[0,0],api_soku:10,api_fuel_max:cost,api_bull_max:cost};
    ships[id]={api_id:id,api_ship_id:id,api_lv:50,api_cond:49,api_fuel:cost,api_bull:cost,
      api_slot:[-1,-1],api_slot_ex:0,api_onslot:[0,0],api_soku:10,
      api_sakuteki:[20,40],api_taisen:[20,40],api_taiku:[20,40],api_karyoku:[20,40],
      api_raisou:[20,40],api_soukou:[20,40]};
  }
  return {info:{basic:{api_level:120},ships,equips,repairs:[],airbase:[],
    fleets:[1,2,3,4].map(()=>({api_ship:[-1,-1,-1,-1,-1,-1],api_mission:[0,0]}))},
  const:{$ships:masters,$equips:{},$missions:{1:{api_use_fuel:0.3,api_use_bull:0}},
    $shipTypes:{},$equipShip:{},$exslotEquips:[],$exslotEquipShips:{},$exslotEquipLimits:{}}};
}
module.exports=fixture;
