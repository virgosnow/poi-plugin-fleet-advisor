'use strict';
// Opponent equipment is hidden. The reference fleet uses developable aircraft,
// so it has no jets; its real anti-air fire and any real jets are unknown.
const jets=require('./jet_aviation');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function estimate(store,scheme,foes){
  const rows=[],aircraft=scheme.ships.map(()=>({})),attacks=scheme.ships.map(()=>({attacks:[]}));
  for(let i=0;i<scheme.ships.length;i++){
    const entry=scheme.ships[i],ship=store.info.ships[entry.id],master=store.const.$ships[ship?.api_ship_id];
    if(!ship||!master||!Array.isArray(entry.slots))return {status:'unknown',reason:'舰娘或槽位资料不足'};
    for(let slot=0;slot<entry.slots.length;slot++){
      const instance=store.info.equips[entry.slots[slot]],gear=store.const.$equips[instance?.api_slotitem_id],type=Number(gear?.api_type?.[2]);
      if(!jets.isJet(type))continue;
      const count=Number(master.api_maxeq?.[slot]);
      if(!integer(count))return {status:'unknown',reason:'喷式机搭载数或型号资料不足'};
      if(count===0)continue;
      const rule=jets.spec(Number(instance.api_slotitem_id),type);
      if(!rule||type===58)return {status:'unknown',reason:'喷式机搭载数或型号资料不足'};
      rows.push({i,slot,count,type,rule,masterId:Number(instance.api_slotitem_id),bomb:Number(gear.api_baku||0)});
    }
  }
  if(!rows.length)return {status:'none',aircraft,attacks,active:false};
  const canLaunch=foes.some(foe=>!foe.submarine)&&rows.some(row=>row.count>0);
  const available=canLaunch?jets.steelAvailable(store):0;
  if(available===null)return {status:'unknown',reason:'钢材资料不足，喷式强袭发动情况待确认'};
  const active=available>0&&canLaunch;
  let requiredSteel=0;
  for(const row of rows){
    if(active)requiredSteel+=jets.steelCost(row.masterId,row.type,row.count);
    // Assumed opponent has no jets. Supremacy stage-1 upper survivor count;
    // unknown opponent interception can wipe bomber slots, so use the middle
    // of that range as a reference, not a probability distribution.
    const after=active?row.count-Math.floor(row.count*3/120*jets.PHASES.proportionalLoss+1e-10):row.count;
    const min=active&&row.type===57?0:after,max=after,reference=Math.round((min+max)/2);
    aircraft[row.i][row.slot]={min,max,reference};
    if(active&&row.type===57&&reference>0){
      const power=jets.jetPower(row.bomb,reference);
      if(power===null)return {status:'unknown',reason:'喷式攻击力资料不足'};
      attacks[row.i].attacks.push({slot:row.slot,powerMin:power,powerMax:power,referencePowers:[power]});
    }
  }
  return {status:'estimated',aircraft,attacks,active,steel:active?Math.min(available,requiredSteel):0,
    assumptions:active?'喷式强袭按对手参考配装无喷式机、未知对空拦截下的残机区间中值估算；对手实际喷式机和拦截能力未知。':'喷式强袭未发动'};
}
function ordinaryRemaining(store,scheme,aircraft,states){
  const coefficients={supremacy:1,superiority:3,parity:5,disadvantage:7,loss:10,noAirBattle:0};
  const available=Array.isArray(states)&&states.length&&states.every(state=>Object.hasOwn(coefficients,state));
  return scheme.ships.map((entry,i)=>Object.fromEntries(Object.entries(aircraft[i]||{}).map(([slot,reading])=>{
    if(!available)return [slot,[0,reading.max]];
    const coeff=states.map(state=>coefficients[state]),minCoeff=Math.min(...coeff),maxCoeff=Math.max(...coeff);
    const minimum=Math.max(0,reading.min-Math.floor(reading.min*maxCoeff*7/120*jets.PHASES.proportionalLoss+1e-10));
    const maximum=Math.max(0,reading.max-Math.floor(reading.max*minCoeff*3/120*jets.PHASES.proportionalLoss+1e-10));
    const gear=store.const.$equips[store.info.equips[entry.slots[Number(slot)]]?.api_slotitem_id];
    return [slot,[Number(gear?.api_type?.[2])===57?0:minimum,maximum]];
  })));
}
module.exports={estimate,ordinaryRemaining};
