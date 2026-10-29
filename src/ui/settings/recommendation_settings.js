'use strict';
module.exports=React=>{
  const h=React.createElement,feedback=require('./settings_feedback');
  const common=[['excludeUnremodeled','排除未改造舰'],['excludeExpedition','排除远征中的舰'],
    ['excludeRepairing','排除入渠中的舰'],['excludeUnlocked','排除未锁定舰']];
  const specific={normal:[['excludeHeavyDamage','排除大破舰'],['excludeFatigued','排除疲劳舰']],
    expedition:[['excludeFirstFleet','保留第一舰队成员']]};
  return ({value,onChange,disabled,feedbacks={}})=>h('section',{className:'paa-selection-settings','aria-label':'全局推荐排除'},
    h('div',{className:'paa-selection-grid'},...['normal','expedition'].map(kind=>{
      const group=value[kind],title=kind==='normal'?'出击设置':'远征设置';
      const change=(key,v)=>onChange({...value,[kind]:{...group,[key]:v}},kind+'.'+key);
      const hint=kind==='normal'?'选择推荐时能否借用其他舰娘的装备。\n不借用：仅使用仓库和本次编成舰娘身上的装备。\n允许借用包含入渠舰娘的装备；远征中的装备始终不可借用。\n下方设置排除自动选船的范围，不改动已有草稿。':
        '切换远征时，自动选中默认目标。\n排除暂时不想参与推荐的舰娘，不改动已有编成。';
      return h('section',{className:'paa-settings-card',key:kind},h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,title),feedback(React,undefined,{label:title,text:hint}))),
        kind==='normal'?h('div',{className:'paa-selection-count'},h('span',{className:'paa-settings-label'},h('span',null,'装备借用')),h('span',{className:'paa-settings-value'},
          h('div',{className:'paa-exp-goal paa-settings-goal',role:'group','aria-label':'出击装备借用'},
            ...[[true,'允许借用'],[false,'不借用']].map(([id,label])=>h('button',{key:String(id),type:'button','aria-pressed':group.allowEquipmentBorrowing===id,disabled,
              onClick:()=>{if(!disabled&&group.allowEquipmentBorrowing!==id)return change('allowEquipmentBorrowing',id);}},label))),feedback(React,feedbacks[kind+'.allowEquipmentBorrowing']))):
          h('div',{className:'paa-selection-count'},h('span',{className:'paa-settings-label'},h('span',null,'默认目标')),h('span',{className:'paa-settings-value'},
            h('div',{className:'paa-exp-goal paa-settings-goal',role:'group','aria-label':'远征默认目标'},
              ...[['great','优先大成功'],['success','成功即可']].map(([id,label])=>h('button',{key:id,type:'button','aria-pressed':group.defaultGoal===id,disabled,
                onClick:()=>{if(!disabled&&group.defaultGoal!==id)return change('defaultGoal',id);}},label))),feedback(React,feedbacks[kind+'.defaultGoal']))),
        h('div',{className:'paa-settings-row paa-selection-exclusions'},h('div',{className:'paa-selection-caption'},'排除以下舰娘'),
        h('div',{className:'paa-selection-options'},
        h('div',{className:'paa-selection-level'},
          h('label',null,h('input',{type:'checkbox',checked:group.minLevel>0,disabled,'aria-label':title+'等级限制',onChange:e=>change('minLevel',e.target.checked?30:0)}),'低于'),
          h('input',{type:'number',min:1,max:999,step:1,value:group.minLevel||30,disabled:disabled||group.minLevel===0,'aria-label':title+'最低等级',onChange:e=>{const v=Number(e.target.value);if(Number.isInteger(v)&&v>=1&&v<=999)change('minLevel',v);}}),h('span',null,'级'),feedback(React,feedbacks[kind+'.minLevel'])),
        ...[...common,...specific[kind]].map(([key,label])=>h('div',{className:'paa-settings-label',key},h('label',{className:'paa-selection-option'},
          h('input',{type:'checkbox',checked:group[key],disabled,'aria-label':title+'：'+label,onChange:e=>change(key,e.target.checked)}),h('span',null,({excludeUnremodeled:'未改造',excludeExpedition:'远征中',excludeRepairing:'入渠中',excludeUnlocked:'未锁定',excludeHeavyDamage:'大破',excludeFatigued:'疲劳（士气 < 40）',excludeFirstFleet:'第一舰队成员'})[key])),feedback(React,feedbacks[kind+'.'+key]))))));
    })));
};
