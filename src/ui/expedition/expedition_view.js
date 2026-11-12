'use strict';
require('../i18n/readability');
const {t,registerCatalog}=require('../../shared/i18n');
const localeCatalog=require('../i18n/expedition_practice');
registerCatalog('ja',localeCatalog.ja);registerCatalog('zh-TW',localeCatalog.zhTW);registerCatalog('zh-CN',localeCatalog.zhCN);
const E=require('./expedition_model');
module.exports=React=>{
  const h=React.createElement,ResourceIcon=require('../components/resource_icon')(React);
  const resource=(name,itemId)=>h('span',{className:'paa-exp-resource','data-resource':name},
    h(ResourceIcon,{name}),(itemId==null?['燃料','弹药','钢材','铝土'].includes(name):[1,2,3,4,10,11,12,59].includes(itemId))?t(name):name);
  const unitBadge=unit=>h('small',{className:'paa-exp-value-unit'},t(unit==='hour'?'/小时':'/次'));
  const outcomeLabel=(label,percent)=>h(React.Fragment,null,`${t(label)} `,h('span',{className:'paa-exp-outcome-probability','data-known':percent!==null},percent===null?'—':percent+'%'));
  const incomeValue=(value,unit,minutes)=>{
    return [E.incomeText(value,unit,minutes)];
  };
  const itemResult=(item,available,guaranteed=false,great=false)=>{
    const value=!available?'—':!item.count?t('待确认'):guaranteed&&item.count===1?'1':`${guaranteed?1:0} ~ ${item.count}`;
    return h('span',{role:'cell',className:'paa-exp-item-condition','data-guaranteed':guaranteed,'data-great':great,'data-available':available&&item.count>0},h('strong',null,value,...(available&&item.count>0?[unitBadge('trip')]:[])));
  };
  const incomeFormula=(row,missionId,outcome)=>{
    const parts=E.incomeBreakdown(row,missionId),terms=parts.filter(part=>part.key!=='great'||outcome==='great');
    const labels={base:'基础',great:'大成功',bonus:'加成',cost:'补给',repair:'修理参考'};
    const rendered=terms.map((part,index)=>{
      const value=part[outcome],known=Number.isFinite(value);
      const sign=index===0?(known&&value<0?'− ':''):(known&&value<0||part.key==='cost'&&(!known||value===0)?'− ':'+ ');
      return h('span',{key:part.key,className:'paa-exp-formula-term','data-kind':part.key,'data-negative':known&&value<0},
        `${sign}${t(labels[part.key])} ${known?Math.abs(value):'—'}`);
    });
    const total=outcome==='great'?row.greatNet:row.net;
    return h('div',{className:'paa-exp-formula-row','data-outcome':outcome},
      h('span',{className:'paa-exp-formula-outcome'},t(outcome==='great'?'大成功':'成功')),
      h('span',{className:'paa-exp-formula-expression'},...rendered,
        h('strong',{'data-negative':total<0,'data-missing':!Number.isFinite(total)},`= ${E.incomeText(total,'trip')}`)));
  };
  // Render fleet composition from type identifiers and numeric checks;
  // never parse translated display strings for a business decision.
  const conditionValue=(c,checks,mission)=>{
    if(c.type!=='fleetCompo')return t(c.value);
    const check=checks?.find(row=>row.type==='fleetCompo');
    const groups=check?.detail||mission?.fleetCompos?.map(rule=>({parts:Object.entries(rule).map(([estype,need])=>({estype,need,actual:'—'}))}));
    if(!groups)return t(c.value);
    return h('span',{className:'paa-exp-condition-groups'},...groups.map((group,index)=>
      h('span',{className:'paa-exp-condition-group',key:index},index?h('span',{className:'paa-exp-condition-or'},t('或')):null,
        ...(group.parts||[]).flatMap((part,i)=>[
          ...(i?[h('span',{className:'paa-exp-condition-or',key:`and:${i}`},t('readability.and'))]:[]),
          h('span',{className:'paa-exp-condition-part',key:`${part.estype}:${i}`},`${t(E.TYPES[part.estype]||part.estype)} ${part.actual} / ${part.need}`)
        ]))));
  };
  const conditionDetail=(c,checks)=>{
    const flagship=checks?.find(check=>check.type==='flagshipType');
    return flagship?.left?t('当前旗舰：{name}',{name:flagship.left}):t('尚未选择旗舰');
  };
  const repairTooltip=repair=>{
    if(!repair)return undefined;
    if(repair.status!=='reference')return t(repair.reason||'修理待确认');
    if(repair.protectedLine)return t(repair.note||'交战 II 型各项属性达到要求的 220%，已有无伤报告；实际损伤仍以游戏为准');
    if(![1,2].includes(repair.type)||typeof repair.protectedLine!=='boolean')return t(repair.note||repair.reason||'修理待确认');
    return t('参考情景：每艘受损最大耐久的 25%，{scope}；非实际损伤概率或平均值',{
      scope:t(repair.type===1?'按最多 3 艘平均分配':'按全队计算')});
  };
  const conditionList=(conditions,checks,mission)=>h(React.Fragment,null,
    h('div',{className:'paa-exp-condition-caption'},t('当前 / 要求')),
    h('div',{className:'paa-exp-conditions'},...conditions.map((c,i)=>h('div',{className:'paa-exp-condition','data-satisfied':c.sat,'data-type':c.type,key:i},
      h('span',{className:'paa-exp-condition-label'},h('span',{'aria-hidden':true},c.sat===undefined?'·':c.sat?'✓':'!'),t(c.label)),h('strong',null,conditionValue(c,checks,mission),c.deficit>0?t('（差 {n}）',{n:c.deficit}):null),
      c.type==='flagshipType'&&c.detail?h('small',{className:'paa-exp-condition-detail'},conditionDetail(c,checks)):null))));
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
  const localizedStatus=summary=>{
    const completion=summary.completion==='locked'?'未解锁':summary.completion==='completed'?(summary.monthly?'本期已完成':'已完成'):
      summary.completion==='incomplete'?(summary.monthly?'本期未完成':'未完成'):'完成状态待同步：登录游戏后自动读取';
    return [summary.runningFleets?.length?t('第 {n} 舰队远征中',{n:summary.runningFleets.join('、')}):'',t(completion)].filter(Boolean).join(' · ');
  };
  function overview({mission,master,missionMasters={},missionProgress={},fleets=[],useItems={},expedition,rate,income,hasShips,incomeUnit='trip',onIncomeUnitChange,onMissionChange,disabled=false}){
    const conditions=E.requirements(expedition,mission),missing=conditions.filter(c=>c.sat===false);
    const ready=!expedition?t('待核对'):expedition.eligible?t('全部满足'):t('{n} 项待调整',{n:missing.length});
    const minutes=master?.api_time,hours=Math.floor(minutes/60),rest=minutes%60;
    const duration=Number.isFinite(minutes)&&minutes>0?`${hours?t('{n}小时',{n:hours}):''}${rest?t('{n}分',{n:rest}):''}`:null;
    const summary=mission?E.missionSummary(mission,master,useItems,missionProgress,fleets):null;
    const items=E.rewardItems(master,useItems),chain=mission?E.missionChain(mission.missionId,missionMasters,missionProgress):null;
    const rateState=!Number.isFinite(rate)?'unknown':rate===0?'zero':rate>=100?'full':'partial';
    const showGreat=rate>0||!Number.isFinite(rate)&&items.length>0,showSuccess=!(Number.isFinite(rate)&&rate>=100);
    const greatPercent=Number.isFinite(rate)?Math.round(Math.min(100,Math.max(0,rate))):null;
    const successPercent=greatPercent===null?null:100-greatPercent;
    const basePreview=!hasShips&&!income,baseRows=basePreview?E.baseRewardRows(mission?.missionId):null;
    const incomeLabel=t(basePreview?'基础奖励':expedition?.eligible===false?'达标后净收益':income?.repair?.status==='reference'?'参考净收益':'净收益');
    const rewardRows=income?.rows||baseRows||['燃料','弹药','钢材','铝土'].map(name=>({name,net:null,greatNet:null}));
    const chainText=item=>item.missionId?`${item.completed?'✓':'○'} ${item.number}${item.name?' '+item.name:''}（${item.monthly?t('本期'):''}${t(item.status)}）`:
      item.kind==='map'?t('通关海域 {area}',{area:item.area}):item.kind==='quest'?t('完成任务 {quest}',{quest:item.quest}):t(item.text);
    const chainItem=(item,index)=>item.missionId?h('button',{key:index,type:'button',className:'paa-exp-chain-item',
      'data-mission-id':item.missionId,'data-completed':item.completed,'data-tooltip':item.name||undefined,'aria-label':chainText(item),disabled:disabled||!onMissionChange,
      onClick:()=>{if(!disabled)onMissionChange?.(item.missionId);}},h('strong',null,item.number),h('span',null,t(item.status))):
      h('span',{key:index,className:'paa-exp-chain-condition'},chainText(item));
    const chainRow=(label,items,all=false)=>items.length?h('div',{className:'paa-exp-chain-row',role:'group','aria-label':all?t('前置条件，全部需要'):t(label)+' '+t('远征')},h('span',{className:'paa-exp-chain-label'},t(label)),
      h('div',{className:'paa-exp-chain-items'},...items.flatMap((item,i)=>[all&&i?h('span',{key:`plus-${i}`,className:'paa-exp-chain-plus','aria-hidden':true},'＋'):null,chainItem(item,i)]))):null;
    return h(React.Fragment,null,
      summary&&(summary.monthly||summary.completion==='locked'||summary.status==='running'||chain&&(chain.before.length||chain.after.length))?h('section',{className:'paa-exp-unlock','aria-label':t('远征状态与前置')},
        h('div',{className:'paa-exp-section-head'},h('h4',null,t(summary.monthly?'月度远征':'远征状态')),h('span',{'data-state':summary.status},localizedStatus(summary))),
        chain&&(chain.before.length||chain.after.length)?h('div',{className:'paa-exp-chain','aria-label':t('远征链')},
          chainRow('前置',chain.before,true),chainRow('后续',chain.after)):null):null,
      h('section',{className:'paa-exp-time','aria-label':t('远征时间')},
        h('div',{className:'paa-exp-section-head'},h('h4',null,t('远征时间')),h('span',{className:'paa-exp-duration'},
          h('svg',{viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('circle',{cx:8,cy:8,r:6}),h('path',{d:'M8 4v4l3 2'})),duration||'—'))),
      h('section',{className:'paa-exp-outcome','aria-label':t('出航条件'),'data-ready':expedition?.eligible,
        onClick:event=>toggleOutcomeSpace(event,disabled)},
        h('details',{key:mission?.missionId,className:'paa-exp-requirements','aria-label':t('出航条件')},
          h('summary',null,t('出航条件'),h('span',{className:'paa-exp-ready','data-ready':expedition?.eligible},readyIcon(expedition?.eligible),h('span',null,ready))),
          h('div',{className:'paa-exp-requirements-content'},conditionList(conditions,expedition?.checks,mission))),
        missing.length?h('div',{className:'paa-exp-shortfalls','aria-label':t('未满足的出航条件')},h('div',{className:'paa-exp-condition-caption'},t('参考编成 · 尚未满足出航条件')),conditionList(missing,expedition?.checks,mission)):null),
      h('section',{className:'paa-exp-income','data-rate':rateState,'aria-label':(incomeUnit==='hour'?t('每小时'):t('expedition.incomePerTrip'))+incomeLabel},
        h('div',{className:'paa-exp-section-head'},h('div',{className:'paa-exp-income-title'},h('h4',null,incomeLabel),basePreview||!income?h('span',null,t(basePreview?'未扣补给 · 未计加成':'待核算补给')):
          income.repair?h('span',{tabIndex:0,'data-tooltip':repairTooltip(income.repair)},t(income.repair.status==='reference'?'含修理参考':'修理待确认')):null),
          h('div',{className:'paa-exp-income-unit',role:'group','aria-label':t('收益时间单位')},...['trip','hour'].map(unit=>h('button',{key:unit,type:'button','aria-pressed':incomeUnit===unit,onClick:()=>onIncomeUnitChange?.(unit)},unit==='hour'?t('每小时'):t('expedition.incomePerTrip'))))),
        h('div',{className:'paa-exp-income-table','data-columns':showGreat&&showSuccess?3:2,'data-has-items':items.length>0,'data-great-available':Number.isFinite(rate)?rate>0:'unknown','data-unit':incomeUnit,'data-preview':basePreview,role:'table','aria-label':t(basePreview?'远征基础奖励':income?.repair?.status==='reference'?'扣补给和参考修理后的远征收益':'扣补给后的远征收益')},
          h('div',{className:'paa-exp-income-row paa-exp-income-heading',role:'row'},h('span',{role:'columnheader'},t('奖励')),showSuccess?h('span',{role:'columnheader'},outcomeLabel('成功',successPercent)):null,showGreat?h('span',{role:'columnheader',className:'paa-exp-great-heading'},outcomeLabel('大成功',greatPercent)):null),
          ...rewardRows.map(r=>h('div',{className:'paa-exp-income-row',role:'row',key:r.name},h('span',{role:'rowheader'},resource(r.name)),
            showSuccess?h('strong',{role:'cell','data-negative':r.net<0,'data-zero':(basePreview?r.success:r.net)===0,'data-missing':!Number.isFinite(basePreview?r.success:r.net)},...incomeValue(basePreview?r.success:r.net,incomeUnit,master?.api_time)):null,showGreat?h('strong',{role:'cell',className:'paa-exp-resource-great','data-negative':r.greatNet<0,'data-zero':(basePreview?r.great:r.greatNet)===0,'data-missing':!Number.isFinite(basePreview?r.great:r.greatNet)},...incomeValue(basePreview?r.great:r.greatNet,incomeUnit,master?.api_time)):null)),
          ...items.map((item,index)=>h('div',{className:'paa-exp-income-row paa-exp-item-row',role:'row',key:`item-${index}`,'data-great-only':item.greatOnly},
            h('span',{role:'rowheader'},resource(item.name,item.id)),
            showSuccess?itemResult(item,!item.greatOnly):null,showGreat?itemResult(item,true,item.greatOnly,true):null))),
        income?h('details',{className:'paa-exp-income-details'},h('summary',null,t('单次补给与收益明细')),
          h('div',{className:'paa-exp-detail-groups'},...income.rows.map(r=>h('section',{key:r.name,className:'paa-exp-formula-group','aria-label':t('{name}单次收益明细',{name:t(r.name)})},
            h('div',{className:'paa-exp-formula-resource'},resource(r.name)),
            showSuccess?incomeFormula(r,mission?.missionId,'success'):null,showGreat?incomeFormula(r,mission?.missionId,'great'):null)))):
          basePreview&&baseRows?null:h('span',{className:'paa-exp-income-empty paa-muted'},t(hasShips?'收益或补给资料不足':'基础奖励资料不足'))));
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
    const drumHint=!mission?t('选择远征后核对'):!hasDrumGate?hasShips&&drumsKnown?t('{n} 艘载桶 · 无出航门槛',{n:status.carriers}):t('本远征无运输桶门槛'):hasShips&&!drumsKnown?t('运输桶资料待同步'):
      `${hasShips?`${t('载桶 {n}',{n:status.carriers})}${carrierNeed?` / ${carrierNeed}`:''} ${t('艘')}`:carrierNeed?t('需要 {n} 艘载桶',{n:carrierNeed}):''}${drumNeed?`${hasShips||carrierNeed?' · ':''}${t('需要 {n} 个',{n:drumNeed})}`:''}`;
    return h('div',{className:'paa-wb-metrics paa-exp-metrics','data-columns':3,'aria-label':t('舰队远征状态')},
      metric('air',t(flash),hasShips&&Number.isFinite(status.sparkled)?`${status.sparkled} / ${status.count}`:'—',t(!hasShips?'选择舰娘后核对':status.unknownMorale?'部分士气待同步':'士气 ≥ 50 计入有闪'),
        allSparkled?'green':moraleKnown&&status.sparkled>0?'blue':'neutral',allSparkled?'check':moraleKnown&&status.sparkled>0?'info':'neutral'),
      metric('los',t(drums),hasShips&&drumsKnown?t('{n} 个',{n:status.drums}):'—',drumHint,
        drumReviewed?drumSatisfied?'green':'warning':'neutral',drumReviewed?drumSatisfied?'check':'warning':'neutral'),
      metric('income',t(reward),bonusKnown?`${bonus>=0?'+':''}${Number((bonus*100).toFixed(2))}%`:'—',t(hasShips?bonusKnown?'远征收益 · 含改修与特大发':'收益资料待同步':'选择舰娘后核对'),
        bonusKnown&&bonus>0?'income':bonusKnown&&bonus<0?'warning':'neutral',bonusKnown&&bonus>0?'check':bonusKnown&&bonus<0?'warning':'neutral'));
  }
  function goal({value,onChange,disabled=false}){
    return h('div',{className:'paa-exp-goal-field'},
      h('div',{className:'paa-exp-goal',role:'group','aria-label':t('远征目标')},
        h('span',{className:'paa-picker-title'},t('目标')),
        h('div',{className:'paa-exp-goal-options','data-goal':value},
        ...[['great','优先大成功'],['success','成功即可']].map(([id,label])=>h('button',{
          key:id,type:'button','data-goal':id,'aria-pressed':value===id,disabled,onClick:()=>{if(!disabled&&value!==id)return onChange(id);}},t(label))))));
  }
  return {overview,metrics,goal};
};
