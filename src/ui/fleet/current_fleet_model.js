'use strict';
const W=require('../workbench/workbench_model'),V=require('../models/presentation_model'),E=require('../expedition/expedition_model');
const {evaluateCandidate}=require('../../domain/fleet/fleet_metrics');
const {fleetMechanisms,fleetSpeed,aircraftCapacity}=require('../../domain/combat/ship_mechanisms');
const {rewardBonus}=require('../../domain/expeditions/expedition_income');
const number=value=>{const n=Array.isArray(value)?value[0]:value;return typeof n==='number'&&Number.isFinite(n)?n:null;};
const pair=(current,max)=>({current:number(current),max:number(max)});
function countdown(end,now){
  if(!Number.isFinite(end)||end<=0)return '时间待同步';
  const seconds=Math.max(0,Math.ceil((end-now)/1000));
  if(!seconds)return '等待归航';
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function fleetHeading(store,fleet,now=Date.now()){
  const row=store.info?.fleets?.[fleet-1],mission=row?.api_mission,state=Number(mission?.[0]);
  const ids=(row?.api_ship||[]).filter(id=>id>0),away=state>0;
  const missionId=Number(mission?.[1]),master=store.const?.$missions?.[missionId];
  return {number:fleet,exists:!!row,ids,name:row?.api_name||'',state:!row?'unknown':away?'away':state===0?'idle':'unknown',
    status:!row?'数据待同步':away?'远征中':state===0?ids.length?'待命':'空舰队':'状态待同步',
    mission:away?`${master?.api_disp_no||missionId||'—'} ${master?.api_name||'远征'}`:'',
    remaining:away?countdown(Number(mission?.[2]),now):'',returnAt:away&&Number(mission?.[2])>0?Number(mission[2]):null};
}
function presetList(store){
  const presets=store.info?.presets;
  return {synced:Number(presets?.api_max_num)>0||Object.keys(presets?.api_deck||{}).length>0,
    items:Object.entries(presets?.api_deck||{}).map(([key,row])=>({id:Number(key),name:row.api_name||`预设 ${key}`,ids:(row.api_ship||[]).filter(id=>id>0)}))
      .filter(row=>Number.isInteger(row.id)&&row.id>0).sort((a,b)=>a.id-b.id)};
}
function presetHeading(store,id){
  const presets=presetList(store),row=presets.items.find(p=>p.id===id);
  return {number:id,exists:!!row,ids:row?.ids||[],name:row?.name||'',state:row?'preset':'unknown',
    status:row?'当前装备':presets.synced?'预设已移除':'预设待同步',mission:'',remaining:'',preset:true};
}
// Lightweight overview for all four selectors; do not evaluate combat metrics.
function summarize(store,fleet){
  const heading=fleetHeading(store,fleet),composition=new Map(),issues=[],unknown=[];
  const totals={fuel:{current:0,max:0},ammo:{current:0,max:0},aircraft:{current:0,max:0,slots:0}};
  const signals=['supply','aircraft','fatigue','damage','repair'].map(key=>({key,ships:[],danger:false}));
  const add=(key,row,reason,danger=false)=>{const signal=signals.find(s=>s.key===key);signal.ships.push({id:row.id,name:row.name,reason});signal.danger||=danger;row.reasons.push(reason);row.danger||=danger;};
  const sum=(key,current,max)=>{const p=totals[key];p.current=current===null||p.current===null?null:p.current+current;p.max=max===null||p.max===null?null:p.max+max;};
  for(const id of heading.ids.slice(0,6)){
    const ship=store.info?.ships?.[id],master=store.const?.$ships?.[ship?.api_ship_id];
    const row={id,name:master?.api_name||`舰娘 #${id}`,masterId:ship?.api_ship_id,reasons:[],danger:false},missing=[];
    const type=master?W.TYPES[master.api_stype]||'未知舰种':'未知舰种';composition.set(type,(composition.get(type)||0)+1);
    for(const [key,current,max] of [['fuel',number(ship?.api_fuel),number(master?.api_fuel_max)],['ammo',number(ship?.api_bull),number(master?.api_bull_max)]])sum(key,current,max);
    const hp=pair(ship?.api_nowhp,ship?.api_maxhp),morale=number(ship?.api_cond);
    const fuel=pair(ship?.api_fuel,master?.api_fuel_max),ammo=pair(ship?.api_bull,master?.api_bull_max);
    if([fuel,ammo].some(p=>p.current!==null&&p.max!==null&&p.current<p.max))add('supply',row,'燃弹未满');
    if([fuel,ammo].some(p=>p.current===null||p.max===null))missing.push('补给');
    if(hp.current!==null&&hp.max>0){if(hp.current<hp.max){const ratio=hp.current/hp.max;add('damage',row,ratio<=.25?'大破':ratio<=.5?'中破':ratio<=.75?'小破':'轻伤',ratio<=.25);}}
    else missing.push('耐久');
    if(morale!==null){if(morale<40)add('fatigue',row,`士气 ${morale}`);}else missing.push('士气');
    if(store.info?.repairs?.some(r=>Number(r.api_ship_id)===id)||ship?.api_situation===2)add('repair',row,'入渠中');
    let lostPlanes=false,planesUnknown=!ship||!master||!Array.isArray(ship.api_slot);
    for(const [slot,equipId] of (ship?.api_slot||[]).entries()){
      if(equipId<=0)continue;
      const equip=store.info?.equips?.[equipId],equipMaster=store.const?.$equips?.[equip?.api_slotitem_id];
      if(!equipMaster){planesUnknown=true;continue;}
      const max=aircraftCapacity(master,equipMaster,slot);if(max===undefined)continue;
      const current=number(ship.api_onslot?.[slot]);totals.aircraft.slots++;sum('aircraft',current,max);
      if(current===null||max===null)planesUnknown=true;
      if(current!==null&&max!==null&&current<max)lostPlanes=true;
    }
    if(lostPlanes)add('aircraft',row,'舰载机未满');
    if(planesUnknown){totals.aircraft.current=null;totals.aircraft.max=null;missing.push('舰载机');}
    if(row.reasons.length)issues.push(row);
    if(missing.length)unknown.push({id,name:row.name,reason:missing.join('、')+'待同步'});
  }
  if(!heading.exists){for(const p of Object.values(totals)){p.current=null;p.max=null;}}
  return {composition:[...composition].map(([type,count])=>({type,count})),totals,issues,unknown,signals:signals.filter(s=>s.ships.length),
    supplied:heading.exists&&heading.ids.length>0&&unknown.length===0&&!signals.some(s=>['supply','aircraft'].includes(s.key)&&s.ships.length)};
}
// Read the observed hulls directly. No controller preview, inventory allocation,
// recommendation, scheme persistence, or game operation is needed for this page.
function inspect(store,fleet,presetId=null){
  const heading=presetId===null?fleetHeading(store,fleet):presetHeading(store,presetId),warnings=[],slots=[];
  for(const id of heading.ids.slice(0,6)){
    try{slots.push(W.entry(store,id));}catch(_){slots.push({id,slots:[],ex:-1,unknown:true});warnings.push(`舰娘 #${id} 的资料待同步`);}
  }
  if(heading.ids.length>6)warnings.push('当前仅展示前 6 艘舰娘');
  const known=slots.filter(s=>!s.unknown),expedition=E.fleetStatus(store,known);
  let metrics={},mechanisms=new Map(),speed={label:'—',detail:''};
  if(known.length){
    try{metrics=evaluateCandidate(store,{organization:{targets:known.map(s=>s.id)},equipment:{expected:[]}});}catch(e){warnings.push('部分舰队数值待同步');}
    try{speed=fleetSpeed(store,known);mechanisms=fleetMechanisms(store,known,speed,undefined,{conditionalGroundDouble:true});}catch(e){warnings.push('部分机制资料待同步');}
  }
  const extra=E.shipBadges(expedition,{incomeDetail:'改修与特大发组合计入舰队收益加成。'});
  for(const s of known)mechanisms.set(s.id,[...(mechanisms.get(s.id)||[]),...(extra.get(s.id)||[])]);
  const ships=slots.map(s=>{
    const ship=store.info?.ships?.[s.id],master=store.const?.$ships?.[ship?.api_ship_id];
    if(s.unknown)return {id:s.id,name:master?.api_name||`舰娘 #${s.id}`,unknown:true,badges:[]};
    const repair=store.info.repairs?.find(r=>Number(r.api_ship_id)===s.id);
    const hp=pair(ship.api_nowhp,ship.api_maxhp),ratio=hp.max>0&&hp.current!==null?hp.current/hp.max:null;
    const health=ratio===null?'待同步':ratio<=.25?'大破':ratio<=.5?'中破':ratio<=.75?'小破':ratio<1?'轻伤':'完好';
    const equipment=s.slots.map((id,k)=>({slot:k,item:V.equipmentItem(store,id,k),id,capacity:aircraftCapacity(master,store.const.$equips[store.info.equips[id]?.api_slotitem_id],k),planes:number(ship.api_onslot?.[k])}));
    if(ship.api_slot_ex!==0)equipment.push({slot:'ex',item:V.equipmentItem(store,s.ex,'ex'),id:s.ex});
    return {id:s.id,name:master.api_name,level:number(ship.api_lv),type:W.TYPES[master.api_stype]||'未知舰种',portrait:V.portraitUrl(store,ship.api_ship_id),
      hp,health,ratio,repair:repair||ship.api_situation===2?repair||{}:null,fuel:pair(ship.api_fuel,master.api_fuel_max),ammo:pair(ship.api_bull,master.api_bull_max),
      stats:[['火力','api_karyoku'],['雷装','api_raisou'],['对空','api_taiku'],['装甲','api_soukou'],['对潜','api_taisen'],['索敌','api_sakuteki'],['回避','api_kaihi'],['运','api_lucky']].map(([label,key])=>({label,value:number(ship[key])})),
      equipment,expansion:ship.api_slot_ex!==0,badges:mechanisms.get(s.id)||[]};
  });
  const uncertain=!heading.exists||slots.some(s=>s.unknown)||known.some(s=>s.slots.concat(s.ex).some(id=>id>0&&!store.info.equips[id]));
  const bonus=uncertain?null:rewardBonus(known.map(s=>({masterId:store.info.ships[s.id].api_ship_id,equipment:s.slots.concat(s.ex).filter(id=>id>0).map(id=>({masterId:store.info.equips[id]?.api_slotitem_id,stars:store.info.equips[id]?.api_level}))})));
  return {heading,ships,metrics,speed,expedition,warnings,bonus,
    bonusPercent:bonus?bonus.totalRate*100:null,
    levelSum:heading.exists&&ships.every(s=>Number.isFinite(s.level))?ships.reduce((n,s)=>n+s.level,0):null,
    hp:heading.exists&&ships.length&&ships.every(s=>s.hp?.current!==null&&s.hp?.max>0)?{current:ships.reduce((n,s)=>n+s.hp.current,0),max:ships.reduce((n,s)=>n+s.hp.max,0)}:null};
}
module.exports={inspect,fleetHeading,countdown,summarize,presetList,presetHeading};
