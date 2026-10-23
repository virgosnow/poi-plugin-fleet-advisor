'use strict';
const E=require('./expedition_model');
module.exports=React=>{
  const h=React.createElement,ResourceIcon=require('../components/resource_icon')(React);
  const resource=name=>h('span',{className:'paa-exp-resource','data-resource':name},
    h(ResourceIcon,{name}),name);
  const unitBadge=unit=>h('small',{className:'paa-exp-value-unit'},unit==='hour'?'/小时':'/次');
  const outcomeLabel=(label,percent)=>h(React.Fragment,null,`${label} `,h('span',{className:'paa-exp-outcome-probability','data-known':percent!==null},percent===null?'—':percent+'%'));
  const incomeValue=(value,unit,minutes)=>{
    const label=E.incomeText(value,unit,minutes);
    return [label,...(label==='—'?[]:[unitBadge(unit)])];
  };
  const itemResult=(item,available,guaranteed=false)=>{
    const value=!available?'—':!item.count?'待确认':guaranteed&&item.count===1?'1':`${guaranteed?1:0} ~ ${item.count}`;
    return h('span',{role:'cell',className:'paa-exp-item-condition','data-guaranteed':guaranteed},h('strong',null,value,...(available&&item.count>0?[unitBadge('trip')]:[])));
  };
  const conditionList=conditions=>h(React.Fragment,null,
    h('div',{className:'paa-exp-condition-caption'},'当前 / 要求'),
    h('div',{className:'paa-exp-conditions'},...conditions.map((c,i)=>h('div',{className:'paa-exp-condition','data-satisfied':c.sat,'data-type':c.type,key:i},
      h('span',{className:'paa-exp-condition-label'},h('span',{'aria-hidden':true},c.sat===undefined?'·':c.sat?'✓':'!'),c.label),h('strong',null,c.value,c.deficit>0?`（差 ${c.deficit}）`:null),
      c.type==='flagshipType'&&c.detail?h('small',{className:'paa-exp-condition-detail'},c.detail):null))));
  const readyIcon=ready=>h('svg',{className:'paa-exp-ready-icon',viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
    ready===false?[h('path',{key:'outline',d:'M8 2 15 14H1Z'}),h('path',{key:'mark',d:'M8 6v4m0 2v.1'})]:
      [h('circle',{key:'outline',cx:8,cy:8,r:6}),h('path',{key:'mark',d:ready?'m5 8 2 2 4-4':'M5 8h6'})]);
  const toggleOutcomeSpace=(event,disabled)=>{
    if(disabled||event.defaultPrevented||event.button!==undefined&&event.button!==0)return;
    const card=event.currentTarget,target=event.target?.nodeType===3?event.target.parentElement:event.target;
    if(!target||target.closest?.('summary, .paa-exp-requirements-content, .paa-exp-shortfalls'))return;
    if(card.ownerDocument?.getSelection?.()?.isCollapsed===false)return;
    card.querySelector('.paa-exp-requirements > summary')?.click();
  };
  function overview({mission,master,missionMasters={},missionProgress={},fleets=[],useItems={},expedition,rate,income,hasShips,incomeUnit='trip',onIncomeUnitChange,onMissionChange,disabled=false}){
    const conditions=E.requirements(expedition,mission),missing=conditions.filter(c=>c.sat===false);
    const ready=!expedition?'待核对':expedition.eligible?'全部满足':`${missing.length} 项待调整`;
    const duration=E.durationText(master?.api_time);
    const summary=mission?E.missionSummary(mission,master,useItems,missionProgress,fleets):null;
    const items=E.rewardItems(master,useItems),showUnlock=summary&&(summary.monthly||summary.completion==='locked');
    const rateState=!Number.isFinite(rate)?'unknown':rate===0?'zero':rate>=100?'full':'partial';
    const showGreat=rate>0||!Number.isFinite(rate)&&items.length>0,showSuccess=!(Number.isFinite(rate)&&rate>=100);
    const greatPercent=Number.isFinite(rate)?Math.round(Math.min(100,Math.max(0,rate))):null;
    const successPercent=greatPercent===null?null:100-greatPercent;
    const basePreview=!hasShips&&!income,baseRows=basePreview?E.baseRewardRows(mission?.missionId):null;
    const incomeLabel=basePreview?'基础奖励':expedition?.eligible===false?'达标后净收益':'净收益';
    const rewardRows=income?.rows||baseRows||['燃料','弹药','钢材','铝土'].map(name=>({name,net:null,greatNet:null}));
    const unlock=showUnlock?E.unlockItems(mission.missionId,missionMasters,missionProgress):[];
    const unlockList=showUnlock?h('div',{className:'paa-exp-unlock-list'},!summary.unlocked?h('span',{className:'paa-exp-unlock-caption'},'解锁前置'):null,
      ...unlock.map((item,index)=>item.missionId&&onMissionChange?h('button',{key:index,type:'button',className:'paa-exp-unlock-link',
        'data-mission-id':item.missionId,'data-completed':item.completed,disabled,onClick:()=>{if(!disabled)onMissionChange(item.missionId);}},item.text):
        h('span',{key:index,'data-completed':item.completed},item.text))):null;
    return h(React.Fragment,null,
      summary&&(summary.monthly||summary.completion==='locked'||summary.status==='running')?h('section',{className:'paa-exp-unlock','aria-label':'远征状态与前置'},
        h('div',{className:'paa-exp-section-head'},h('h4',null,summary.monthly?'月度远征':'远征状态'),h('span',{'data-state':summary.status},summary.statusText)),
        showUnlock&&summary.unlocked?h('details',{key:mission.missionId,className:'paa-exp-unlock-details'},h('summary',null,'解锁前置'),unlockList):unlockList):null,
      h('section',{className:'paa-exp-time','aria-label':'远征时间'},
        h('div',{className:'paa-exp-section-head'},h('h4',null,'远征时间'),h('span',{className:'paa-exp-duration'},
          h('svg',{viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('circle',{cx:8,cy:8,r:6}),h('path',{d:'M8 4v4l3 2'})),duration||'—'))),
      h('section',{className:'paa-exp-outcome','aria-label':'出航条件','data-ready':expedition?.eligible,
        onClick:event=>toggleOutcomeSpace(event,disabled)},
        h('details',{key:mission?.missionId,className:'paa-exp-requirements','aria-label':'出航条件'},
          h('summary',null,'出航条件',h('span',{className:'paa-exp-ready','data-ready':expedition?.eligible},readyIcon(expedition?.eligible),h('span',null,ready))),
          h('div',{className:'paa-exp-requirements-content'},conditionList(conditions))),
        missing.length?h('div',{className:'paa-exp-shortfalls','aria-label':'未满足的出航条件'},h('div',{className:'paa-exp-condition-caption'},'参考编成 · 尚未满足出航条件'),conditionList(missing)):null),
      h('section',{className:'paa-exp-income','data-rate':rateState,'aria-label':(incomeUnit==='hour'?'每小时':'单次')+incomeLabel},
        h('div',{className:'paa-exp-section-head'},h('div',{className:'paa-exp-income-title'},h('h4',null,incomeLabel),basePreview||!income?h('span',null,basePreview?'未扣补给 · 未计加成':'待核算补给'):null),
          h('div',{className:'paa-exp-income-unit',role:'group','aria-label':'收益时间单位'},...['trip','hour'].map(unit=>h('button',{key:unit,type:'button','aria-pressed':incomeUnit===unit,onClick:()=>onIncomeUnitChange?.(unit)},unit==='hour'?'每小时':'单次')))),
        h('div',{className:'paa-exp-income-table','data-columns':showGreat&&showSuccess?3:2,'data-has-items':items.length>0,'data-great-available':rate>0,'data-unit':incomeUnit,'data-preview':basePreview,role:'table','aria-label':basePreview?'远征基础奖励':'扣补给后的远征收益'},
          h('div',{className:'paa-exp-income-row paa-exp-income-heading',role:'row'},h('span',{role:'columnheader'},'奖励'),showSuccess?h('span',{role:'columnheader'},outcomeLabel('成功',successPercent)):null,showGreat?h('span',{role:'columnheader'},outcomeLabel('大成功',greatPercent)):null),
          ...rewardRows.map(r=>h('div',{className:'paa-exp-income-row',role:'row',key:r.name},h('span',{role:'rowheader'},resource(r.name)),
            showSuccess?h('strong',{role:'cell','data-negative':r.net<0,'data-zero':(basePreview?r.success:r.net)===0},...incomeValue(basePreview?r.success:r.net,incomeUnit,master?.api_time)):null,showGreat?h('strong',{role:'cell',className:'paa-exp-resource-great','data-negative':r.greatNet<0,'data-zero':(basePreview?r.great:r.greatNet)===0},...incomeValue(basePreview?r.great:r.greatNet,incomeUnit,master?.api_time)):null)),
          ...items.map((item,index)=>h('div',{className:'paa-exp-income-row paa-exp-item-row',role:'row',key:`item-${index}`,'data-great-only':item.greatOnly},
            h('span',{role:'rowheader'},resource(item.name)),
            showSuccess?itemResult(item,!item.greatOnly):null,showGreat?itemResult(item,true,item.greatOnly):null))),
        income?h('details',{className:'paa-exp-income-details'},h('summary',null,'单次补给与收益明细'),
          h('div',{className:'paa-exp-detail-table','data-columns':showGreat&&showSuccess?4:3},h('div',null,h('span',null,'资源'),showSuccess?h('span',null,'成功毛收益'):null,showGreat?h('span',null,'大成功毛收益'):null,h('span',null,'补给消耗')),
            ...income.rows.map(r=>h('div',{key:r.name},h('span',null,r.name),showSuccess?h('span',null,r.success):null,showGreat?h('span',null,r.great):null,h('span',null,r.cost))))):
          basePreview&&baseRows?null:h('span',{className:'paa-exp-income-empty paa-muted'},hasShips?'收益或补给资料不足':'基础奖励资料不足')));
  }
  function metrics({status,mission,income}){
    const hasShips=status.count>0,drumNeed=Math.max(0,Number(mission?.drums)||0),carrierNeed=Math.max(0,Number(mission?.drumCarriers)||0);
    const hasDrumGate=drumNeed>0||carrierNeed>0,drumsKnown=Number.isFinite(status.drums)&&Number.isFinite(status.carriers);
    const drumsReady=drumsKnown&&status.drums>=drumNeed&&status.carriers>=carrierNeed;
    const moraleKnown=hasShips&&!status.unknownMorale&&Number.isFinite(status.sparkled),allSparkled=moraleKnown&&status.sparkled===status.count;
    const drumReviewed=Boolean(mission)&&(!hasDrumGate||hasShips&&drumsKnown),drumSatisfied=drumReviewed&&(!hasDrumGate||drumsReady);
    const flash= !hasShips?'有闪待核对':!moraleKnown?'士气待确认':status.sparkled===status.count?'全队有闪':status.sparkled>0?'部分有闪':'全队无闪';
    const drums=!mission?'桶数待核对':!hasDrumGate?'无需运输桶':!hasShips||!drumsKnown?'桶数待核对':drumsReady?'运输桶达标':'运输桶不足';
    const bonusKnown=hasShips&&Number.isFinite(income?.bonus),bonus=bonusKnown?income.bonus:null;
    const reward=!bonusKnown?'收益待核算':bonus>0?'收益提升':bonus<0?'收益减少':'无收益加成';
    const metric=(cls,label,value,hint,tone,icon)=>h('div',{className:'paa-wb-metric '+cls,'data-tone':tone},
      h('span',{className:'paa-wb-metric-state'},h('svg',{viewBox:'0 0 16 16','aria-hidden':true},icon==='warning'?
        h('path',{d:'M8 2 15 14H1ZM8 6v4m0 2v.1'}):
        [h('circle',{key:'outline',cx:8,cy:8,r:6}),h('path',{key:'mark',d:icon==='check'?'m5 8 2 2 4-4':icon==='info'?'M8 7v4m0-6v.1':'M5 8h6'})]),label),
      h('strong',null,value),h('small',null,hint));
    const drumHint=!mission?'选择远征后核对':!hasDrumGate?hasShips&&drumsKnown?`${status.carriers} 艘载桶 · 无出航门槛`:'本远征无运输桶门槛':hasShips&&!drumsKnown?'运输桶资料待同步':
      `${hasShips?`载桶 ${status.carriers}${carrierNeed?` / ${carrierNeed}`:''} 艘`:carrierNeed?`需要 ${carrierNeed} 艘载桶`:''}${drumNeed?`${hasShips||carrierNeed?' · ':''}需要 ${drumNeed} 个`:''}`;
    return h('div',{className:'paa-wb-metrics paa-exp-metrics','data-columns':3,'aria-label':'舰队远征状态'},
      metric('air',flash,hasShips&&Number.isFinite(status.sparkled)?`${status.sparkled} / ${status.count}`:'—',!hasShips?'选择舰娘后核对':status.unknownMorale?'部分士气待同步':'士气 ≥ 50 计入有闪',
        allSparkled?'green':moraleKnown&&status.sparkled>0?'blue':'neutral',allSparkled?'check':moraleKnown&&status.sparkled>0?'info':'neutral'),
      metric('los',drums,hasShips&&drumsKnown?`${status.drums} 个`:'—',drumHint,
        drumReviewed?drumSatisfied?'green':'warning':'neutral',drumReviewed?drumSatisfied?'check':'warning':'neutral'),
      metric('income',reward,bonusKnown?`${bonus>=0?'+':''}${Number((bonus*100).toFixed(2))}%`:'—',hasShips?bonusKnown?'远征收益 · 含改修与特大发':'收益资料待同步':'选择舰娘后核对',
        bonusKnown&&bonus>0?'income':bonusKnown&&bonus<0?'warning':'neutral',bonusKnown&&bonus>0?'check':bonusKnown&&bonus<0?'warning':'neutral'));
  }
  function goal({value,onChange,disabled=false}){
    return h('div',{className:'paa-exp-goal-field'},h('span',null,'目标'),
      h('div',{className:'paa-exp-goal',role:'group','aria-label':'远征目标'},
        ...[['great','优先大成功'],['success','成功即可']].map(([id,label])=>h('button',{
          key:id,type:'button','aria-pressed':value===id,disabled,onClick:()=>{if(!disabled&&value!==id)return onChange(id);}},label))));
  }
  return {overview,metrics,goal};
};
