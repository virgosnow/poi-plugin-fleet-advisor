'use strict';
const {t}=require('../../shared/i18n');
require('../i18n/readability');
const questDisplay=require('../i18n/quest_display');
const resourceIcon=require('./resource_icon');
const {equipmentIconUrl,equipmentMasterItem,equipmentTooltipProps}=require('../models/presentation_model');

// Shared visual presentation; all known rewards are immediately visible.
module.exports=React=>{
  const h=React.createElement,ResourceIcon=resourceIcon(React);
  return function questRewards(task,state,lookup){
    const {resources,fixed,choices,reference,shipBonus}=task.rewards;
    const itemView=(item,key)=>{
      const master=item.kind===12?state?.const?.$equips?.[item.id]:item.kind?null:lookup?.(item.name);
      let equipment=master?equipmentMasterItem(master,{api_level:item.level||0},0,null,state?.const?.$equipTypes):null;
      // A name-only master record is not evidence that every stat is zero.
      if(equipment&&!['api_houg','api_raig','api_baku','api_tyku','api_tais','api_saku','api_houm','api_houk','api_souk','api_leng','api_distance'].some(key=>master[key]!==undefined&&Number.isFinite(Number(master[key]))))
        equipment={...equipment,stats:undefined};
      const tooltip=equipment?equipmentTooltipProps(equipment):item.kind===12?equipmentTooltipProps({name:item.name}):{};
      const icon=equipmentIconUrl(item.iconType??master?.api_type?.[3]);
      return h('span',{className:'paa-overview-reward-item',key,...tooltip,...tooltip['data-tooltip']?{tabIndex:0}:{}},icon?h('img',{src:icon,alt:'',draggable:false,onError:event=>{event.currentTarget.style.display='none';}}):resourceIcon.resourceSource(item.name)?h(ResourceIcon,{name:item.name,size:15}):null,
        h('span',null,questDisplay.reward(item),item.level?` ★${item.level}`:'',` ×${item.count}`));};
    const hasDetails=fixed.length>0||choices.length>0||shipBonus||!reference;
    return h('div',{className:'paa-overview-rewards','aria-label':t('报酬')},h('span',{className:'paa-quest-row-label'},t('报酬')),h('div',{className:'paa-overview-reward-summary','data-has-details':Boolean(hasDetails)},
      hasDetails?h('div',{className:'paa-overview-reward-details'},
        fixed.length?h('div',{className:'paa-overview-reward-choice'},h('span',null,t('readability.fixedRewards')),
          h('div',{className:'paa-overview-reward-items'},...fixed.map(itemView))):null,
        ...choices.map((group,index)=>h('div',{key:index,className:'paa-overview-reward-choice'},h('span',null,t('任选其一')+(choices.length>1?` ${index+1}`:'')),
          h('div',{className:'paa-overview-reward-items'},...group.map(itemView)))),
        shipBonus&&!fixed.some(item=>item.kind===11)?h('span',{className:'paa-overview-rewards-unknown'},t('舰娘报酬详情以游戏为准')):null,
        !reference&&!choices.length&&!shipBonus?h('span',{className:'paa-overview-rewards-unknown'},t('其他报酬以游戏为准')):null):null,
      h('div',{className:'paa-overview-reward-resources'},resources===null?h('span',{className:'paa-overview-rewards-unknown'},t('资源报酬待同步')):
        resources.length?[h('span',{key:'label',className:'paa-overview-resources-label'},t('readability.resourceRewards')),h('div',{key:'list',className:'paa-overview-reward-list'},...resources.map(row=>h('span',{key:row.name,className:'paa-overview-reward','aria-label':`${t(row.name)} ${row.amount}`},
          h(ResourceIcon,{name:row.name,size:15}),h('span',null,row.amount.toLocaleString()))))]:
          h('span',{className:'paa-overview-rewards-unknown'},t('无资源报酬')))));
  };
};
