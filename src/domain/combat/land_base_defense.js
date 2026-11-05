'use strict';
// One squadron's normal-altitude defense value, before any map-specific
// high-altitude interception multiplier. Sources disagree whether a 9+ LoS
// land recon multiplier is 1.23 or 1.24, so retain both endpoints.
// https://wikiwiki.jp/kancolle/基地航空隊#sccf3a4c
// https://en.kancollewiki.net/Land_Base#Defense_Fighter-Power
const AIR=new Set([6,7,8,9,10,11,41,45,47,48,49,53,56,59,94]);
const CARRIER_RECON=new Set([9,94]),SEA_RECON=new Set([10,41]),LAND_RECON=new Set([49]);
function defenseAirPower(store,base){
  const input=base?.slots??base?.api_plane_info;
  if(!Array.isArray(input)||input.length!==4)return {airPower:null,reason:'基地飞机槽资料不足'};
  const {inspectSquadron}=require('./land_base'),view=inspectSquadron(store,base);
  if(view.airPower===null)return {airPower:null,reason:view.reasons?.join('；')||'防空资料待确认'};
  let minimum=1,maximum=1,conflicting=false;
  for(const slot of view.slots){
    const master=store.const?.$equips?.[slot.masterId];
    if(!master)return {airPower:null,reason:'飞机主数据待确认'};
    if(slot.type===7&&slot.stars>0)return {airPower:null,reason:'舰爆改修防空补正待确认'};
    if(slot.type===59)return {airPower:null,reason:'喷气侦察机防空补正待确认'};
    if(slot.type===48&&(!Number.isFinite(master.api_houk)||!Number.isFinite(master.api_houm)))
      return {airPower:null,reason:'飞机迎击或对爆资料待确认'};
    if(!CARRIER_RECON.has(slot.type)&&!SEA_RECON.has(slot.type)&&!LAND_RECON.has(slot.type))continue;
    const los=master.api_saku;
    if(!Number.isFinite(los)||los<0)return {airPower:null,reason:'侦察机索敌资料待确认'};
    let lo=1,hi=1;
    if(CARRIER_RECON.has(slot.type)){
      if(los===8)return {airPower:null,reason:'舰侦索敌 8 的防空补正待确认'};
      lo=hi=los>=9?1.3:1.2;
    }
    else if(SEA_RECON.has(slot.type))lo=hi=los>=9?1.16:los===8?1.13:1.1;
    else if(los>=9){lo=1.23;hi=1.24;conflicting=true;}
    else if(los===8)lo=hi=1.18;
    else return {airPower:null,reason:'陆侦索敌不足 8 的防空补正待确认'};
    minimum=Math.max(minimum,lo);maximum=Math.max(maximum,hi);
  }
  const sum=side=>view.slots.reduce((total,slot)=>{
    if(!AIR.has(slot.type)||slot.count<=0)return total;
    const master=store.const.$equips[slot.masterId];
    const adjustment=slot.type===48?-0.5*master.api_houk+2*master.api_houm:0;
    return total+Math.floor((slot.aa+adjustment)*Math.sqrt(slot.count)+slot.proficiency[side]);
  },0);
  const airPower={min:Math.floor(sum(0)*minimum+1e-9),max:Math.floor(sum(1)*maximum+1e-9)};
  return {airPower,reason:conflicting?'防空陆侦补正资料存在差异，显示参考范围':'普通防空参考值，不含高高度空袭特殊补正'};
}
module.exports={defenseAirPower};
