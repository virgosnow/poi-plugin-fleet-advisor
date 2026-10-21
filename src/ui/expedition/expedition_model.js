'use strict';
const tooltip=require('../../shared/mechanism_text');
const UNLOCKS=require('../../../data/expedition_requirements.json').unlocks;
const REWARDS=require('../../../data/expedition_rewards.json');
const {expeditionPeriod}=require('../../infrastructure/persistence/expedition_progress');
const {equipmentRewardRate}=require('../../domain/expeditions/expedition_income');
const RESOURCES=['燃料','弹药','钢材','铝土'];
const ITEMS={1:'高速修复材',2:'高速建造材',3:'开发资材',4:'改修资材',10:'家具箱（小）',11:'家具箱（中）',12:'家具箱（大）',59:'伊良湖'};
function missionSummary(mission,master={},useItems={},progress={},fleets=[]){
  const minutes=master.api_time,hours=Math.floor(minutes/60),rest=minutes%60;
  const time=Number.isFinite(minutes)&&minutes>0?`${hours?hours+'时':''}${rest?rest+'分':''}`:'—';
  const amounts=REWARDS.missions[mission.missionId]?.resources;
  const resources=RESOURCES.flatMap((name,i)=>(amounts?amounts[i]:master.api_win_mat_level?.[i])>0?[{name,amount:amounts?.[i]}]:[]);
  const items=[master.api_win_item1,master.api_win_item2].filter(x=>x?.[0]>0).map(([id])=>({name:ITEMS[id]||useItems[id]?.api_name||`道具 ${id}`}));
  const rewards=[...resources,...items.filter((item,i)=>items.findIndex(x=>x.name===item.name)===i)];
  const monthly=Number(master.api_reset_type)===1,record=progress?.records?.[mission.missionId];
  const current=record&&(!monthly||record.period===(progress?.period||expeditionPeriod()));
  const completed=current&&record.state===2;
  const running=fleets.flatMap((fleet,i)=>Number(fleet.api_mission?.[0])>0&&Number(fleet.api_mission[1])===mission.missionId?[i+1]:[]);
  const period=progress?.period||expeditionPeriod(),list=progress?.list;
  const locked=!running.length&&list?.period===period&&list.catalogIds.includes(mission.missionId)&&!list.ids.includes(mission.missionId)&&
    !(current&&record.period===period&&[0,1,2].includes(record.state));
  const completion=locked?'locked':completed?'completed':current&&[0,1].includes(record.state)?'incomplete':'unknown',status=running.length?'running':completion;
  const completionText=locked?'未解锁':completed?monthly?'本期已完成':'已完成':completion==='incomplete'?monthly?'本期未完成':'未完成':'完成状态待同步：登录游戏后自动读取';
  const statusText=[running.length?`第 ${running.join('、')} 舰队远征中`:'',completionText].filter(Boolean).join(' · ');
  const name=mission.name||master.api_name||'远征名称待载入';
  const unlocked=running.length>0||!!(current&&[0,1,2].includes(record.state))||!!(list?.period===period&&list.ids.includes(mission.missionId));
  return {number:master.api_disp_no||String(mission.missionId),name,time,minutes,rewards,monthly,status,completion,statusText,unlocked};
}
const TYPES={DD:'驱逐',DE:'海防',CL:'轻巡',CLT:'雷巡',CA:'重巡',CAV:'航巡',CVL:'轻空母',CV:'正空',CVB:'装甲空母',BB:'战舰',FBB:'高速战舰',BBV:'航战',AV:'水母',AO:'补给舰',LHA:'登陆舰',AS:'潜水母舰',CT:'练巡',AR:'工作舰',DDorDE:'驱逐 / 海防',SSLike:'潜水舰',CVLike:'空母 / 水母',CVE:'护卫空母'};
const LABELS={flagshipLevel:'旗舰等级',shipCount:'舰船数量',levelSum:'舰队总等级',flagshipType:'旗舰舰种',drumCarriers:'载桶舰数',drums:'运输桶数',resupply:'补给',minMorale:'士气',totalFirepower:'总火力',totalAntiAir:'总对空',totalAsw:'总对潜',totalLos:'总索敌'};
function rateText(rate){
  if(!Number.isFinite(rate))return '—';
  if(rate>=100)return '100%';
  // Never label a probability just below 100% as full probability.
  return `${Math.floor(Math.max(0,rate)*100+1e-8)/100}%`;
}
function requirements(evaluation,mission){
  let checks=evaluation?.checks||[];
  if(!evaluation&&mission){
    checks=['flagshipLevel','shipCount','levelSum','drumCarriers','drums','minMorale'].filter(k=>mission[k]!=null).map(k=>({type:k,left:'—',right:mission[k]}));
    if(mission.flagshipType)checks.push({type:'flagshipType',right:mission.flagshipType});
    if(mission.fleetCompos)checks.push({type:'fleetCompo',detail:mission.fleetCompos.map(r=>({parts:Object.entries(r).map(([estype,need])=>({estype,need,actual:'—'}))}))});
    for(const [key,need] of Object.entries(mission.totals||{}))checks.push({type:'total'+key[0].toUpperCase()+key.slice(1),left:'—',right:need});
  }
  return checks.map(c=>{
    if(c.type==='fleetCompo')return {type:c.type,label:'舰种组合',sat:c.sat,value:c.detail.map(r=>r.parts.map(p=>`${TYPES[p.estype]||p.estype} ${p.actual} / ${p.need}`).join(' · ')).join(' 或 ')};
    if(c.type==='flagshipType')return {type:c.type,label:LABELS[c.type],sat:c.sat,value:TYPES[c.right]||c.right,detail:c.left?`当前旗舰：${c.left}`:'尚未选择旗舰'};
    if(c.left!=null)return {type:c.type,label:LABELS[c.type]||c.type,sat:c.sat,value:`${c.estimated?'≥ ':''}${c.left} / ${c.right}`,
      ...(c.sat===false&&Number.isFinite(c.left)&&Number.isFinite(c.right)?{deficit:Math.max(0,Math.round((c.right-c.left)*10)/10)}:{}),
      detail:'当前 / 至少'+(typeof c.detail==='string'&&c.detail?` · ${c.detail}`:'')};
    return {type:c.type,label:LABELS[c.type]||c.type,sat:c.sat,value:c.sat?'满足':'未满足',detail:c.detail||''};
  });
}
function missingConditions(evaluation){
  return (evaluation?.checks||[]).filter(c=>c.sat===false).map(c=>{
    if(c.type==='flagshipType')return `旗舰需为${TYPES[c.right]||c.right}`;
    if(c.type==='resupply')return '需要补给';
    if(c.type==='fleetCompo'){
      const parts=c.detail?.length===1?c.detail[0].parts||[]:[];
      const missing=parts.filter(p=>Number.isFinite(p.actual)&&Number.isFinite(p.need)&&p.actual<p.need);
      return missing.length?missing.map(p=>`缺${TYPES[p.estype]||p.estype} ${p.need-p.actual} 艘`).join(' · '):'舰种组合不满足';
    }
    const names={flagshipLevel:['旗舰等级','级'],shipCount:['舰船','艘'],levelSum:['舰队总等级','级'],drumCarriers:['载桶舰','艘'],drums:['运输桶','个']};
    const [name,unit]=names[c.type]||[LABELS[c.type]||c.type,''];
    return Number.isFinite(c.left)&&Number.isFinite(c.right)&&c.right>c.left?`${name}差 ${Number((c.right-c.left).toFixed(2))}${unit?' '+unit:''}`:`${name}未满足`;
  });
}
function baseRewardRows(missionId){
  const resources=REWARDS.missions[missionId]?.resources;
  if(!resources||resources.some(n=>!Number.isFinite(n)))return null;
  return resources.map((base,i)=>({name:RESOURCES[i],success:base,great:Math.floor(base*1.5)})).filter(row=>row.success>0);
}
function probabilityDetails(gs){
  if(!gs)return [];
  const flash=`当前 ${gs.sparkledCount} / ${gs.shipCount} 艘有闪`;
  if(gs.kind==='flagship')return [`基础 ${rateText(gs.basePercent)} + 旗舰等级加成 ${rateText(gs.bonusPercent)}`,`${flash} · Lv.${gs.flagshipLevel} 旗舰`];
  if(gs.kind==='drum')return [`不刷闪也有基础概率 ${rateText(gs.basePercent)}`,`${flash} · ${gs.drums} 桶 / ${gs.drumCarriers} 艘载桶`,gs.fullDrumBonus?'运输桶加成已满档，再加桶不提高概率':'增加运输桶或闪舰可提高概率'];
  return [flash,gs.sparkledCount===gs.shipCount&&gs.shipCount?'全队有闪，概率按舰数估算':'普通远征需要全队有闪才有大成功概率'];
}
function fleetStatus(store,slots){
  const ships=slots.filter(s=>s&&store.info.ships[s.id]).map(s=>{
    const morale=store.info.ships[s.id].api_cond;
    const items=s.slots.concat(s.ex).filter(id=>id>0).map(id=>store.info.equips[id]?.api_slotitem_id);
    const drums=items.filter(id=>id===75).length;
    // Show each hull's uncapped base contribution. Improvement and special
    // craft synergies depend on the entire fleet and cannot be added per hull.
    const equipmentIncome=Math.round(items.reduce((n,id)=>n+equipmentRewardRate(id)*100,0));
    const innateIncome=Number(store.info.ships[s.id].api_ship_id)===487?5:0;
    return {id:s.id,morale:Number.isFinite(morale)?morale:null,drums,equipmentIncome,innateIncome};
  });
  return {ships,count:ships.length,sparkled:ships.filter(s=>s.morale!==null&&s.morale>=50).length,
    unknownMorale:ships.some(s=>s.morale===null),drums:ships.reduce((n,s)=>n+s.drums,0),carriers:ships.filter(s=>s.drums>0).length};
}
function shipBadges(status,{incomeDetail='改修与特大发组合统一计入左侧实际收益。'}={}){
  return new Map(status.ships.map(s=>[s.id,[
    {key:'expedition-morale',category:s.morale!==null&&s.morale>=50?'morale':'support',state:s.morale===null?'unknown':'ready',
      label:s.morale===null?'士气':s.morale>=50?`✦ 有闪 ${s.morale}`:`士气 ${s.morale}`,
      detail:tooltip(s.morale===null?'发动情况：待确认':s.morale>=50?'士气 ≥50 时固定计入有闪':'当前未计入有闪',
        s.morale===null?'士气：待确认。':`士气：${s.morale}`,s.morale>=50?'提高远征大成功概率。':'')},
    ...(s.drums?[{key:'expedition-drums',category:'support',state:'ready',label:`运输桶 ${s.drums}`,detail:tooltip('携带时固定计入',`运输桶：${s.drums} 个`,'计入远征运输桶要求。')}]:[]),
    ...(s.equipmentIncome+s.innateIncome>0?[{key:'expedition-income',category:'income',state:'ready',
      label:`基础收益 +${s.equipmentIncome+s.innateIncome}%`,
      detail:tooltip('远征成功时固定生效',[s.equipmentIncome?`装备加成：+${s.equipmentIncome}%`:'',s.innateIncome?'舰娘自带：+5%（鬼怒改二）':'','舰队基础加成上限：20%'],incomeDetail)}]:[])
  ]]));
}
function durationText(minutes){
  if(!Number.isFinite(minutes)||minutes<=0)return null;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return `${hours?hours+'小时':''}${rest?rest+'分':''}`;
}
function incomeText(net,unit,minutes){
  if(!Number.isFinite(net))return '—';
  if(unit==='hour'&&(!Number.isFinite(minutes)||minutes<=0))return '—';
  const value=unit==='hour'?Math.round(net*60/minutes*10)/10:net;
  return (value>0?'+':'')+value;
}
function referenceIncome(missionId){
  const preset=REWARDS.incomeReference?.missions?.[missionId],resources=REWARDS.missions[missionId]?.resources;
  if(!preset||!resources||!Number.isFinite(preset.minutes)||preset.minutes<=0||
    ![preset.fuelCost,preset.ammoCost,...resources].every(Number.isFinite))return null;
  return {cost:{fuelCost:preset.fuelCost,ammoCost:preset.ammoCost},minutes:preset.minutes,
    hourly:Object.fromEntries(['燃料','弹药','钢材','铝土'].map((name,i)=>
      [name,(resources[i]-(i===0?preset.fuelCost:i===1?preset.ammoCost:0))*60/preset.minutes]))};
}
function rewardItems(master={},useItems={}){
  // First/sole item is random; with two items, the second needs great success.
  // https://wikiwiki.jp/kancolle/遠征#shiyou
  const entries=[master.api_win_item1,master.api_win_item2].filter(row=>Number(row?.[0])>0);
  return entries.map(([id,count],index)=>({id,name:ITEMS[id]||useItems[id]?.api_name||`道具 ${id}`,
    count:Number.isFinite(count)&&count>0?count:null,greatOnly:entries.length>1&&index===1}));
}
function unlockItems(missionId,masters={},progress={}){
  const rule=UNLOCKS.missions[missionId];
  if(!rule)return [{text:'解锁条件资料待补充'}];
  const period=progress.period||expeditionPeriod();
  const rows=(rule.missions||[]).map(id=>{
    const master=masters[id]||{},record=progress.records?.[id];
    const monthly=master.api_reset_type==null?UNLOCKS.monthly.includes(id):Number(master.api_reset_type)===1;
    const current=record&&(!monthly||record.period===period),done=current&&record.state===2;
    const listed=progress.list?.period===period&&progress.list.ids.includes(id);
    const locked=progress.list?.period===period&&progress.list.catalogIds.includes(id)&&!listed&&!current;
    const state=done?'已完成':locked?'未解锁':current&&[0,1].includes(record.state)?'未完成':'待同步';
    const series=Math.floor(id/10),prefix=({10:'A',11:'B',13:'D',14:'E'})[series];
    const number=master.api_disp_no||(prefix?prefix+(id%10+([10,11].includes(series)?1:0)):String(id));
    return {missionId:id,completed:!!done,text:`${done?'✓':'○'} ${number}${master.api_name?' '+master.api_name:''}（${monthly?'本期':''}${state}）`};
  });
  return [...rows,...(rule.maps||[]).map(area=>({text:`通关海域 ${area}`})),
    ...(rule.quests||[]).map(quest=>({text:`完成任务 ${quest}`}))];
}
function unlockText(missionId,masters={},progress={}){
  const items=unlockItems(missionId,masters,progress);
  return [UNLOCKS.missions[missionId]?'解锁条件（全部满足）':null,...items.map(item=>item.text)].filter(Boolean).join('\n');
}
module.exports={missionSummary,rewardItems,rateText,requirements,missingConditions,baseRewardRows,probabilityDetails,fleetStatus,shipBadges,durationText,incomeText,unlockItems,unlockText,referenceIncome};
