'use strict';

// Candidate metrics are calculated from the same immutable store and pinned
// instance allocation as Controller.preview(). No game operation is needed.
const RULE_VERSION='candidate-metrics-2026-10-21-los-bonuses';
const {lineOfSight}=require('./line_of_sight');
const {openingASW}=require('../combat/opening_asw');
const AIR_TYPES=new Set([6,7,8,11,26,45,56,57]);
const PROFICIENCY_RANGES=[[0,9],[10,24],[25,39],[40,54],[55,69],[70,84],[85,99],[100,120]];
const FIGHTER_BONUS=[0,0,2,5,9,14,14,22];
const BOMBER_BONUS=[0,0,1,1,1,3,3,6];
const PROPULSION=new Set([33,34,87]);
const SPEED_NAME={5:'slow',10:'fast',15:'fastPlus',20:'fastest'};
const SPEED_CODE={slow:5,fast:10,fastPlus:15,fastest:20};
const SPEED_ORDER=['slow','fast','fastPlus','fastest'];
const number=value=>Array.isArray(value)?Number(value[0]):Number(value);
const valid=value=>Number.isFinite(value)&&value>=0;
const item=(store,id)=>id>0?store.info.equips[id]:null;
const master=(store,id)=>{
  const instance=item(store,id);return instance?store.const.$equips[instance.api_slotitem_id]:null;
};
const typeOf=(store,id)=>Number(master(store,id)?.api_type?.[2]);
const ids=state=>state.slots.filter(id=>id>0).concat(state.ex>0?[state.ex]:[]);

function projectFleet(store,plan){
  const expected=new Map(plan.equipment.expected.map(entry=>[entry.shipId,entry.state]));
  return plan.organization.targets.map(id=>{
    const ship=store.info.ships[id],shipMaster=store.const.$ships[ship.api_ship_id];
    const count=Number(shipMaster.api_slot_num??ship.api_slotnum??ship.api_slot.length);
    const before={slots:ship.api_slot.slice(0,count).map(Number),ex:Number(ship.api_slot_ex)};
    const after=expected.get(id)||before;
    return {id,ship,master:shipMaster,before,after,
      changed:JSON.stringify(before)!==JSON.stringify(after),
      items:ids(after).map(equipmentId=>({id:equipmentId,instance:item(store,equipmentId),
        master:master(store,equipmentId),type:typeOf(store,equipmentId)}))};
  });
}

function aircraftImprovement(equipment){
  const star=Number(equipment.instance?.api_level||0);
  if(equipment.type===6||equipment.type===45)return [0.2*star,0.2*star];
  if(equipment.type===7&&star>0){
    // Some fighter-bombers have an AA improvement bonus; ordinary dive
    // bombers do not. Without a versioned item rule, preserve both cases.
    return [0,0.3*star];
  }
  return [0,0];
}

function airPower(store,projected,conditions={}){
  const slots=[];let lower=0,upper=0;
  for(const target of projected){
    target.after.slots.forEach((equipmentId,slot)=>{
      if(equipmentId<=0)return;
      const equipment={id:equipmentId,instance:item(store,equipmentId),
        master:master(store,equipmentId),type:typeOf(store,equipmentId)};
      if(!equipment.master){slots.push({shipId:target.id,slot,itemId:equipmentId,unknown:'equipmentMaster'});return;}
      if(!AIR_TYPES.has(equipment.type))return;
      const observed=Number(target.ship.api_onslot?.[slot]);
      const capacity=Number(target.master.api_maxeq?.[slot]);
      if(!valid(observed)&&!valid(capacity)){slots.push({shipId:target.id,slot,itemId:equipmentId,unknown:'slotCapacity'});return;}
      const current=valid(observed)?observed:capacity;
      const maximum=valid(capacity)?capacity:current;
      const counts=target.before.slots[slot]===equipmentId?[current,current]:[Math.min(current,maximum),Math.max(current,maximum)];
      const rank=Number(equipment.instance?.api_alv||0);
      if(!Number.isInteger(rank)||rank<0||rank>7){slots.push({shipId:target.id,slot,itemId:equipmentId,unknown:'proficiency'});return;}
      const aa=Number(equipment.master.api_tyku||0),[impLo,impHi]=aircraftImprovement(equipment);
      const bonus=equipment.type===6||equipment.type===45?FIGHTER_BONUS[rank]
        :equipment.type===11?BOMBER_BONUS[rank]:0;
      const [profLo,profHi]=PROFICIENCY_RANGES[rank];
      const compute=(count,imp,prof)=>count>0?Math.floor((aa+imp)*Math.sqrt(count)+bonus+Math.sqrt(prof/10)):0;
      const min=compute(counts[0],impLo,profLo),max=compute(counts[1],impHi,profHi);
      lower+=min;upper+=max;
      slots.push({shipId:target.id,slot,itemId:equipmentId,planes:counts,proficiencyRank:rank,min,max,
        aircraftType:equipment.type,effectiveAntiAir:[aa+impLo,aa+impHi],
        proficiencyBonus:[bonus+Math.sqrt(profLo/10),bonus+Math.sqrt(profHi/10)]});
    });
  }
  const unknown=slots.filter(entry=>entry.unknown);
  if(unknown.length)return {status:'unknown',reason:'部分航空槽位缺少搭载数或熟练度',slots};
  const result={status:'range',min:lower,max:upper,slots,
    assumptions:['母港观测搭载数；候选新装机在未补给槽位使用观测数与最大数的范围',
      '内部熟练度按可见段位的上下限计算；不包含基地航空队与道中损耗']};
  const enemy=conditions.enemyAirPower;
  if(enemy!==undefined){
    const classify=own=>enemy===0?own>0?'supremacy':'noAirBattle':own>=3*enemy?'supremacy'
      :own>=1.5*enemy?'superiority':own>2*enemy/3?'parity'
      :own>enemy/3?'disadvantage':'loss';
    result.enemyAirPower=enemy;
    const first=classify(lower),last=classify(upper);
    result.airState=first===last?first:'uncertain';
    const order=['loss','disadvantage','parity','superiority','supremacy'];
    result.possibleAirStates=first===last?[first]:first==='noAirBattle'?[first,last]
      :order.slice(order.indexOf(first),order.indexOf(last)+1);
  }
  return result;
}

function propulsion(store,state){
  const rows=ids(state).map(id=>({id,masterId:Number(item(store,id)?.api_slotitem_id),
    star:item(store,id)?.api_level==null?null:Number(item(store,id).api_level)}));
  const equipped=rows.filter(value=>PROPULSION.has(value.masterId));
  return {turbines:equipped.filter(value=>value.masterId===33).length,
    oldBoilers:equipped.filter(value=>value.masterId===34).length,
    newBoilers:equipped.filter(value=>value.masterId===87).length,
    newBoilers7:equipped.filter(value=>value.masterId===87&&value.star>=7).length,
    unresolvedItems:rows.filter(value=>!Number.isInteger(value.masterId)||value.masterId<=0).map(value=>value.id),
    unresolvedStars:equipped.filter(value=>value.masterId===87&&(value.star===null||!Number.isInteger(value.star)||value.star<0)).map(value=>value.id)};
}

// Wiki speed groups and boiler combinations checked 2026-10-13:
// https://wikiwiki.jp/kancolle/速力#table01
function speedGroup(target){
  const name=String(target.master.api_name||'').normalize('NFKC').replace(/\s/g,''),base=Number(target.master.api_soku);
  if(base===10){
    if(/翔鶴|瑞鶴|大鳳|飛龍改三|最上|三隈|鈴谷|熊野|利根|筑摩|吹雪改三護|島風|天津風改二|Ташкент|Vautour|Visby/.test(name))return 'fastA';
    if(/蒼龍|飛龍|雲龍|天城|金剛|比叡|榛名|霧島|Iowa|大和改二$|Algérie|北上改三|阿賀野|能代|矢矧|酒匂|天津風|吹雪改三/.test(name))return 'fastB1';
    if(/加賀|夕張(?!改二)|SamuelB\.RobertsMk\.II/.test(name)||Number(target.master.api_stype)===16)return 'fastC';
    if([2,3,4,5,6,7,8,9,10,11,18].includes(Number(target.master.api_stype)))return 'fastB2';
  }
  if(base===5){
    if(/大和|武蔵|長門改二|陸奥改二/.test(name))return 'slowA';
    if(/SamuelB\.Roberts(?!Mk\.II)|夕張改二特/.test(name))return 'slowSpecialB';
    if(/鳳翔改二/.test(name))return 'slowE';
    if(/稲木改二|伊201|伊203/.test(name))return 'slowD';
    if(/Béarn|明石|速吸|あきつ丸/.test(name)||[13,14].includes(Number(target.master.api_stype)))return 'slowC';
    if(/Norge|Eidsvold|Thonburi/.test(name)||[7,8,9,10,16,17,19,20,21,22].includes(Number(target.master.api_stype)))return 'slowB';
  }
  return null;
}

function predictedSpeed(group,gear){
  const {turbines:t,oldBoilers:old,newBoilers:fresh,newBoilers7:seven}=gear,boilers=old+fresh;
  if(group==='fastA')return seven>=2||t>=1&&(fresh>=1||boilers>=2)?'fastest'
    :seven>=1||t>=1&&boilers>=1?'fastPlus':'fast';
  if(group==='fastB1')return t>=1&&fresh>=1&&boilers>=2?'fastest'
    :t>=1&&boilers>=1?'fastPlus':'fast';
  if(group==='fastB2')return t>=1&&(fresh>=2||boilers>=3)?'fastest'
    :t>=1&&boilers>=1?'fastPlus':'fast';
  if(group==='fastC')return t>=1&&boilers>=1?'fastPlus':'fast';
  if(group==='slowA')return t>=1&&(seven>=2||fresh>=1&&boilers>=3)?'fastest'
    :t>=1&&(seven>=1||fresh>=2||fresh>=1&&boilers>=2)?'fastPlus'
      :t>=1&&boilers>=1?'fast':'slow';
  if(group==='slowB')return t>=1&&(fresh>=2||boilers>=3)?'fastPlus':t>=1&&boilers>=1?'fast':'slow';
  if(group==='slowSpecialB')return t>=1&&(fresh>=2||boilers>=3)?'fastPlus':t>=1?'fast':'slow';
  if(group==='slowC')return t>=1&&boilers>=1?'fast':'slow';
  if(group==='slowD')return t>=1&&(fresh>=1||boilers>=3)?'fastPlus':fresh>=1||t>=1&&boilers>=1?'fast':'slow';
  if(group==='slowE')return t>=1&&(fresh>=2||fresh>=1&&boilers>=3)?'fastest'
    :t>=1&&fresh>=1?'fastPlus':fresh>=1||t>=1&&boilers>=1?'fast':'slow';
  return null;
}

function speed(store,projected){
  if(!projected.length)return {status:'unknown',fleetSpeed:null,fleetSpeedCode:null,ships:[],reason:'尚未编入舰娘'};
  const ships=projected.map(target=>{
    const before=propulsion(store,target.before),after=propulsion(store,target.after);
    if(JSON.stringify(before)===JSON.stringify(after)){
      const observed=SPEED_NAME[Number(target.ship.api_soku)];
      if(observed)return {shipId:target.id,speed:observed,status:'observed',reason:null};
    }
    if(after.unresolvedItems.length)return {shipId:target.id,speed:null,status:'unknown',propulsion:after,reason:'装备资料缺失，无法确认速力'};
    // Removing every engine restores the master hull speed, including ships
    // whose upgrade group is not catalogued. Never retain stale boosted api_soku.
    const base=SPEED_NAME[Number(target.master.api_soku)];
    if(base&&!after.turbines&&!after.oldBoilers&&!after.newBoilers)
      return {shipId:target.id,speed:base,status:'computed',reason:null,propulsion:after};
    const group=speedGroup(target),predicted=group&&predictedSpeed(group,after);
    if(group&&after.unresolvedStars.length&&predicted!==predictedSpeed(group,{...after,newBoilers7:after.newBoilers7+after.unresolvedStars.length}))
      return {shipId:target.id,speed:null,status:'unknown',group,propulsion:after,reason:'新型缶改修资料缺失，无法确认速力档位'};
    return {shipId:target.id,speed:predicted||null,status:predicted?'computed':'unknown',
      group:group||null,propulsion:after,reason:predicted?null:'未收录该舰的速力强化组'};
  });
  if(ships.some(entry=>!entry.speed))return {status:'unknown',ships,reason:'至少一舰的速力无法判定'};
  const index=Math.min(...ships.map(entry=>SPEED_ORDER.indexOf(entry.speed)));
  return {status:ships.some(entry=>entry.status==='computed')?'computed':'observed',
    fleetSpeed:SPEED_ORDER[index],fleetSpeedCode:SPEED_CODE[SPEED_ORDER[index]],ships,
    assumptions:['速力按已收录舰型、锅炉／涡轮组合与改修规则判定；会影响档位的资料缺失时返回待确认']};
}

function asw(store,projected){
  const ships=projected.map(target=>openingASW(store,target));
  return {status:ships.some(ship=>ship.status==='unknown')?'unknown':'computed',ships,
    assumptions:['按通常舰队昼战、有潜水目标的出击前条件检查',
      '换装对潜扣除旧装备及蓝字、加入新装备及蓝字；缺失资料不视为通过']};
}

function evaluateCandidate(store,plan,conditions={}){
  const projected=projectFleet(store,plan);
  return {airPower:airPower(store,projected,conditions),lineOfSight:lineOfSight(store,projected,conditions),
    speed:speed(store,projected),openingASW:asw(store,projected)};
}

module.exports={RULE_VERSION,projectFleet,evaluateCandidate,airPower,lineOfSight,speed,speedGroup,asw};
