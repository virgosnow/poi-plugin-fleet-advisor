'use strict';
// Reference scenarios, not calibrated battle probabilities. The opposing
// fleet's equipment, modernization, air power and skill bonuses are private.
// Rank rules: https://wikiwiki.jp/kancolle/勝利条件
const {projectedHull}=require('./combat_projection');
const {deriveFriendlyAir}=require('./combat_air_asw');
const {random,runScenario,deriveOwnNight}=require('./combat_battle');
const nightCombat=require('./night_cutin');
const enemyLoadout=require('./practice_enemy_loadout');
const enemyAviation=require('./practice_enemy_air');
const nightContact=require('./practice_night_contact');
const jetAviation=require('./practice_jet');
const CARRIERS=new Set([7,11,18]),BATTLESHIPS=new Set([8,9,10,12]),SUBMARINES=new Set([13,14]);
const AIR_FLAGSHIPS=new Set([7,11,16,18]);
const finite=n=>Number.isFinite(n)&&n>=0;
const maximum=value=>Array.isArray(value)&&value.length>=2&&value.every(finite)&&value[1]>=value[0]?value[1]:null;
const initial=value=>Array.isArray(value)&&finite(value[0])&&value[0]>0?value[0]:null;
const unknown=reason=>({status:'unknown',reason});
// Marriage HP has a standard table and named exceptions. HP modernization is
// private and is not inferred from the master's maximum-improvable value.
// https://wikiwiki.jp/kancolle/ケッコンカッコカリ
const MARRIAGE_EXCEPTIONS=new Map(Object.entries({
  '大和':5,'武蔵':4,'長門改二':8,'陸奥改二':8,'Bismarck':6,'Bismarck改':5,
  'Bismarckzwei':3,'Bismarckdrei':3,'Littorio':6,'Italia':6,'Roma':6,'Roma改':6,
  'Colorado改':7,'Nelson改':5,'速吸改':2
}));
function referenceHp(master,level){
  const hp=initial(master?.api_taik);if(!hp)return null;
  if(!finite(level)||level<100)return hp;
  const name=String(master.api_name||'').normalize('NFKC').replace(/\s/g,'');if(!name)return null;
  const special=MARRIAGE_EXCEPTIONS.get(name);
  const add=special??(hp===6?3:hp>=7&&hp<=29?4:hp<=39&&hp>=30?5:hp<=49&&hp>=40?6:
    hp<=69&&hp>=50?7:hp<=90&&hp>=70?8:hp>=91?9:null);
  return add===null?null:hp+add;
}
function opponentActor(ship,index){
  const m=ship.master||{},stype=Number(m.api_stype),hp=referenceHp(m,ship.level);
  let armor=maximum(m.api_souk),fire=maximum(m.api_houg),torpedo=maximum(m.api_raig);
  if(!hp||![armor,fire,torpedo].every(finite)||!Number.isInteger(stype)||stype<=0)return null;
  const carrier=CARRIERS.has(stype),submarine=SUBMARINES.has(stype),slots=ship.slots||[];
  if(!Array.isArray(slots)||slots.some(row=>!row.master||!Array.isArray(row.master.api_type)))return null;
  const items=slots.map(row=>({type:Number(row.master.api_type[2]),master:row.master,instance:{api_level:0}}));
  const total=key=>items.reduce((sum,item)=>sum+Number(item.master[key]||0),0);
  fire=Math.max(0,fire+total('api_houg'));torpedo=Math.max(0,torpedo+total('api_raig'));armor=Math.max(0,armor+total('api_souk'));
  const armed=slots.some(row=>[7,8,57,58].includes(Number(row.master.api_type[2]))&&Number(m.api_maxeq?.[row.slot])>0);
  // Existing simulation expects equipped carrier shelling power in `fire`.
  const shelling=carrier?(armed?Math.floor((fire+total('api_raig')+Math.floor(total('api_baku')*1.3))*1.5)+55:0):fire;
  const target={master:m,ship:{api_lv:ship.level,api_lucky:m.api_luck},items},mode=nightCombat.surfaceModes(target)[0];
  const fixed=nightCombat.fixedTerm(target,index===0).term;
  const nightMode=mode?{multiplier:mode.multiplier,hits:mode.hits,rate:mode.coefficient&&fixed!==null?
    Math.max(0,Math.min(1,fixed/mode.coefficient)):mode.coefficient?.4:.7}:null;
  const ranges=[m.api_leng,...items.map(item=>item.master.api_leng)].filter(finite);
  return {side:'enemy',index,hp,armor,stype,submarine,carrier,battleship:BATTLESHIPS.has(stype),installation:false,
    fire:shelling,torpedo,range:ranges.length?Math.max(...ranges):0,nightMode,
    aswCapable:false,nightAswCapable:false,nightCarrier:false,
    openingTorpedo:items.some(item=>item.type===22&&/甲標的/.test(item.master.api_name||''))||submarine&&Number(ship.level)>=10};
}
function friendlyActor(ship,index,night){
  if(ship.status!=='known'||!finite(ship.fire)||!finite(ship.torpedo)||!finite(ship.initialHp)||ship.initialHp<=ship.hp*.25)return null;
  const carrier=CARRIERS.has(ship.stype);
  return {...ship,side:'own',index,carrier,battleship:BATTLESHIPS.has(ship.stype),installation:false,
    aswCapable:ship.asw?.status==='known'&&!!ship.asw.normal,
    nightAswCapable:[1,2,3,4,21,22].includes(ship.stype)&&ship.asw?.status==='known'&&!!ship.asw.normal&&ship.asw.hull>0,
    nightAswScratchOnly:true,nightCarrier:carrier&&night?.available===true,nightBase:carrier?night?.power:ship.nightBase,
    nightCarrierMode:night?.mode,nightOptions:night?.modes||[],nightPowerRange:finite(night?.powerMin)&&finite(night?.powerMax)?[night.powerMin,night.powerMax]:null,
    nightRawBase:night?.basePowerRaw,nightRawRange:finite(night?.basePowerRawMin)&&finite(night?.basePowerRaw)?[night.basePowerRawMin,night.basePowerRaw]:null};
}
// Practice enemy formation has explicit priority based on both fleets.
// https://wikiwiki.jp/kancolle/演習#m478a4e5
function opponentFormation(own,foes){
  if(foes.length<=3)return 'lineAhead';
  if(SUBMARINES.has(own[0]?.stype)&&own.slice(1).some(s=>SUBMARINES.has(s.stype)))return 'lineAbreast';
  if(SUBMARINES.has(foes[0]?.stype))return 'echelon';
  if(foes.length>=5&&AIR_FLAGSHIPS.has(foes[0]?.stype))return 'diamond';
  return 'lineAhead';
}
function playerFormation(own,foes){return own.length>=4&&foes.every(ship=>ship.submarine)?'lineAbreast':'lineAhead';}
const formationName={lineAhead:'单纵阵',doubleLine:'复纵阵',lineAbreast:'单横阵',echelon:'梯形阵',diamond:'轮形阵'};
// Recommend without requiring the opponent's hidden equipment or complete
// battle attributes, so the choice remains available if forecasting cannot.
function recommendFormation(store,scheme,enemy){
  if(!enemy?.known||!Array.isArray(enemy.ships)||!enemy.ships.length||!scheme?.ships?.length)return null;
  const foes=enemy.ships.map(ship=>{
    const type=Number((store.const?.$ships?.[ship.masterId]||ship.master)?.api_stype);
    return Number.isInteger(type)&&type>0?{submarine:SUBMARINES.has(type)}:null;
  });
  return foes.some(ship=>!ship)?null:playerFormation(scheme.ships,foes);
}
// This is the practice-specific rank (HP 0 denotes a knockout in the model).
function rank(own,foes,ownHp,enemyHp){
  const knocked=enemyHp.filter(hp=>hp<=0).length,ownKnocked=ownHp.some(hp=>hp<=0);
  const dealt=foes.reduce((n,s,i)=>n+s.hp-Math.max(1,enemyHp[i]),0)/foes.reduce((n,s)=>n+s.hp,0);
  const taken=own.reduce((n,s,i)=>n+s.initialHp-Math.max(1,ownHp[i]),0)/own.reduce((n,s)=>n+s.initialHp,0);
  if(!ownKnocked&&knocked===foes.length)return taken===0?'SS':'S';
  if(!ownKnocked&&foes.length>1&&knocked>=Math.floor(foes.length*2/3))return 'A';
  if((!ownKnocked&&enemyHp[0]<=0)||dealt>taken*2.5&&dealt>0)return 'B';
  return dealt>=.5||dealt>=taken&&dealt>0?'C':'D';
}
function percentages(counts,total){
  const rows=['S','A','B','C','D'].map(label=>({label,count:(counts[label]||0)+(label==='S'?(counts.SS||0):0)})).filter(row=>row.count);
  for(const row of rows){const exact=row.count*100/total;row.percent=Math.floor(exact);row.remainder=exact-row.percent;}
  let left=100-rows.reduce((n,row)=>n+row.percent,0);
  for(const row of rows.slice().sort((a,b)=>b.remainder-a.remainder||b.count-a.count))if(left-->0)row.percent++;
  return rows.map(({label,count,percent})=>({label,count,percent}));
}
function estimate(store,scheme,enemy,{samples=256,ownFormation:requestedFormation='auto'}={}){
  if(!enemy?.known)return unknown('对手舰队资料待同步');
  if(!scheme?.ships?.length)return unknown('添加己方舰娘后查看');
  if(!Number.isInteger(samples)||samples<1||samples>1024)return unknown('模拟次数无效');
  if(requestedFormation!=='auto'&&!Object.hasOwn(formationName,requestedFormation))return unknown('己方阵形无效');
  if(requestedFormation!=='auto'&&requestedFormation!=='lineAhead'&&scheme.ships.length<4)return unknown('舰队不足 4 艘，只能使用单纵阵');
  const reference=enemyLoadout.generate(store,enemy);
  if(reference.status!=='estimated')return unknown(reference.reason||'对手参考配装资料不足');
  const assumedEquipment=reference.ships.map(ship=>({masterId:ship.masterId,name:ship.master.api_name||'舰娘',
    slots:ship.slots.map(item=>({slot:item.slot+1,masterId:item.masterId,name:item.master.api_name||'装备'}))}));
  let aviation;
  const fail=reason=>({...unknown(reason),assumedEquipment,...(aviation?{air:aviation}:{})});
  const foes=reference.ships.map(opponentActor);if(foes.some(x=>!x))return fail('对手舰娘基础属性资料不足');
  const jet=jetAviation.estimate(store,scheme,foes);
  if(jet.status==='unknown')return fail(jet.reason);
  const friendly=scheme.ships.map(entry=>projectedHull(store,entry));
  const formation=opponentFormation(friendly,foes);
  aviation=enemyAviation.estimate(store,scheme,reference,{enemyFormation:formation,...jet.status==='estimated'?{jetAircraft:jet.aircraft}:{}});
  if(friendly.some(ship=>SUBMARINES.has(ship.stype))&&foes.some(ship=>!ship.submarine))return fail('己方包含潜艇，对手对潜本体属性未知');
  const hasAir=aviation?.status==='estimated'&&Array.isArray(aviation.enemyAir)&&aviation.enemyAir.length===foes.length&&
    aviation.enemyAir.every(reading=>reading&&reading.status!=='unknown');
  const hasLoss=aviation?.status==='estimated'&&Array.isArray(aviation.ownRemaining)&&aviation.ownRemaining.length===scheme.ships.length;
  const ordinaryJets=jetAviation.ordinaryRemaining(store,scheme,jet.aircraft,aviation?.states);
  const ownAir=scheme.ships.map((entry,index)=>{
    const m=store.const.$ships[store.info.ships[entry.id]?.api_ship_id];
    const remaining=hasLoss&&aviation.ownRemaining[index];
    const slots=remaining||Object.fromEntries((m?.api_maxeq||[]).map((n,i)=>[i,n]));
    Object.assign(slots,ordinaryJets[index]);
    return deriveFriendlyAir(store,entry,{nodeKind:'battle',slotRemaining:slots});
  });
  if(ownAir.some(x=>x.status==='unknown'))return fail('己方航空装备资料不足');
  const nights=scheme.ships.map((entry,i)=>deriveOwnNight(store,entry,{flagship:i===0}));
  if(nights.some(x=>x.status==='unknown'))return fail('己方夜战资料不足');
  const own=friendly.map((ship,i)=>friendlyActor(ship,i,nights[i]));
  if(own.some(x=>!x))return fail('舰娘属性不足，或舰队存在大破舰');
  if(foes.some(x=>x.submarine)&&own.some(x=>x.asw?.status==='unknown'))return fail('己方对潜属性资料不足');
  const contactOwn=nightContact.friendly(store,scheme),contactEnemy=nightContact.opposing(reference);
  const contactStates=hasAir&&Array.isArray(aviation?.states)&&aviation.states.length?
    nightContact.statesForContact(aviation.states,ownAir,aviation.enemyAir):null;
  const contactAvailable=!!(contactOwn.candidates.length||contactEnemy.candidates.length);
  const rng=random(173),counts={},enemyFormation=opponentFormation(own,foes),ownFormation=requestedFormation==='auto'?playerFormation(own,foes):requestedFormation;
  const prepared={status:'estimated',kind:'battle',allies:own,foes,combined:false,mainCount:foes.length,includeNight:true,
    ownFormation,enemyFormation,ownAir,enemyAir:hasAir?aviation.enemyAir:[],ownJet:jet.active?jet.attacks:null,special:null,
    ...(contactAvailable&&contactStates?{practiceNightContact:{states:contactStates,own:contactOwn,enemy:contactEnemy}}:{})};
  const xpScenarios=[];
  for(let i=0;i<samples;i++){
    const result=runScenario(prepared,rng);if(result.status==='unknown'||result.status==='partial')return fail('部分攻击机制资料不足');
    const key=rank(own,foes,result.ownHp,result.enemyHp);counts[key]=(counts[key]||0)+1;
    // MVP = 己方存活舰中打出最多伤害的那个（保留 idx 以便 filter 后仍能取到位置）
    const alive=own.map((s,idx)=>({idx,hp:result.ownHp[idx],dmg:(result.damageByOwn||[])[idx]||0})).filter(x=>x.hp>0);
    const mvpIndex=alive.length?alive.reduce((best,x)=>x.dmg>best.dmg?x:best,alive[0]).idx:0;
    xpScenarios.push({rank:key,ownHp:result.ownHp,mvpIndex});
  }
  return {status:'estimated',rows:percentages(counts,samples),samples,xpScenarios,
    enemyFormation,ownFormation,assumedEquipment,air:aviation,...jet.status==='estimated'?{jet}: {},
    assumptions:`模拟昼战与夜战；对手按本体满改和可开发装备常见搭配假设，并非真实配装；对手${formationName[enemyFormation]}，计入已知婚舰耐久，等级未知按未婚，未计耐久改修、装备蓝字与改修。夜战按本体初始运估算，资料不足时按参考发动率。${hasAir?'计入假设敌机开幕航空，敌机未计我方拦截。':'对手航空资料不足，未计敌方开幕航空。'}${hasLoss?'己机按残机范围中间值参考。':'普通飞机损耗未确认，按满载参考。'}${jet.status==='estimated'?jet.assumptions:''}${contactAvailable&&contactStates?'夜间接触按装备、等级及可能制空状态参考；多种制空状态等权近似，并非真实概率，夜侦按存活参考，分散多舰判定规则待验证，命中加成未计。':contactAvailable?'制空资料不足，夜间接触未计。':''}${contactOwn.incomplete||contactEnemy.incomplete?'部分夜侦资料不足，未计其触接。':''}己方采用${formationName[ownFormation]}，双方命中按固定参考值。同射程攻击顺序按等概率随机参考，实际可能存在偏差。暂未计弹着；演习不能发动特殊炮击。结果仅供比较。`};
}
module.exports={estimate,rank,percentages,opponentActor,opponentFormation,playerFormation,recommendFormation,referenceHp};
