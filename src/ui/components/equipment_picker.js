'use strict';
require('../shared_catalog');
const i18n=require('../../shared/i18n');
const {equipmentTooltipProps}=require('../models/presentation_model');
const statIcon=require('./stat_icon');

// Equipment categories follow the game's filters. Each category belongs to a
// single broad group so the picker can narrow a large inventory in two steps.
const GROUPS=[
  ['air','航空',[1,2,3,12]],
  ['gun','炮装',[4,5,6]],
  ['torpedo','水雷／对潜',[7,8]],
  ['support','辅助',[9,10,11,13,14]],
];
const SORTS=[['default','默认顺序'],['fire','火力'],['torpedo','雷装'],['bomb','爆装'],
  ['aa','对空'],['asw','对潜'],['los','索敌'],['armor','装甲'],['accuracy','命中'],['evasion','回避'],['range','航程']];
const STAT_LABELS={fire:'火力',torpedo:'雷装',bomb:'爆装',aa:'对空',asw:'对潜',los:'索敌',armor:'装甲',accuracy:'命中',evasion:'回避',range:'航程'};
const STAT_FIELDS={fire:'api_houg',torpedo:'api_raig',bomb:'api_baku',aa:'api_tyku',asw:'api_tais',los:'api_saku',armor:'api_souk',accuracy:'api_houm',evasion:'api_houk',range:'api_distance'};
const groupForCategory=id=>GROUPS.find(group=>group[2].includes(Number(id)))?.[0]||'all';
const statValue=(row,sort,store)=>{
  const master=store?.const?.$equips?.[row.masterId];
  // Land interceptors use these fields for anti-bomber/interception instead.
  if(Number(master?.api_type?.[2])===48&&['accuracy','evasion'].includes(sort))return 0;
  const value=master?.[STAT_FIELDS[sort]];
  const n=Number(value),base=Number.isFinite(n)?n:0;
  return sort==='accuracy'&&row.gunFit?.known?base+row.gunFit.delta:base;
};
function filterRows(rows,group,category,sort,store){
  const result=rows.filter(row=>(group==='all'||groupForCategory(row.categoryId)===group)&&
    (category==='all'||String(row.categoryId)===String(category)));
  // Stable fallback preserves the established game/category order and avoids
  // sorting instance IDs or qualities in a way that changes what is selected.
  return sort==='default'||!STAT_LABELS[sort]?result:result.map((row,index)=>({row,index}))
    .sort((a,b)=>statValue(b.row,sort,store)-statValue(a.row,sort,store)||a.index-b.index).map(x=>x.row);
}

function createEquipmentPicker(React){
  const h=React.createElement,EquipmentIcon=require('./equipment_icon')(React);
  return function EquipmentPicker({index,slot,rows=[],search,setSearch,group='all',setGroup,category='all',setCategory,
    sort='default',setSort,store,currentEquipment,disabled,onClose,onPick,onClear,onAuto,listRef,title}){
    const t=i18n.t;
    const categories=new Map();
    for(const row of rows)if((group==='all'||groupForCategory(row.categoryId)===group)&&!categories.has(String(row.categoryId)))
      categories.set(String(row.categoryId),row.category);
    const visible=filterRows(rows,group,category,sort,store);
    const choice=(key,label,active,onClick)=>h('button',{key,type:'button','aria-pressed':active,onClick},t(label));
    const activeSort=SORTS.find(([key])=>key===sort)||SORTS[0];
    const icon=label=>statIcon.react(React,label)||h('svg',{className:'paa-stat-icon',viewBox:'0 0 16 16',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},
      h('path',{d:'M2 4h12M2 8h12M2 12h12 M5 2v4 M11 6v4 M7 10v4'}));
    return h('div',{className:'paa-wb-popup-shade','data-picker':'equipment',onClick:onClose},
      h('section',{className:'paa-wb-popup','data-picker':'equipment',role:'dialog','aria-modal':true,'aria-label':t('替换装备'),onClick:e=>e.stopPropagation()},
        h('div',{className:'paa-wb-section-head'},h('h3',null,title||t('第 {n} 位 · {slot}',{n:index+1,slot:slot==='ex'?t('补强增设'):t('第 {n} 槽',{n:Number(slot)+1})})),h('button',{type:'button',onClick:onClose},t('关闭'))),
        h('div',{className:'paa-wb-popup-filters'},
          h('input',{autoFocus:true,type:'search',value:search,'aria-label':t('搜索候选'),placeholder:t('装备名称 / 分类 / ID'),onChange:e=>setSearch(e.target.value)}),
          h('details',{className:'paa-wb-priority',onBlur:e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;},
            onKeyDown:e=>{if(e.key==='Escape'&&e.currentTarget.open){e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}},
            h('summary',{'aria-label':t('优先属性')},icon(activeSort[1]),h('span',null,activeSort[0]==='default'?t('优先属性'):t('优先属性 · {attribute}',{attribute:t(activeSort[1])})),
              h('svg',{className:'paa-wb-priority-chevron',viewBox:'0 0 16 16',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},h('path',{d:'m4 6 4 4 4-4'}))),
            h('div',{className:'paa-wb-priority-menu',role:'group','aria-label':t('优先属性选项')},...SORTS.map(([key,label])=>
              h('button',{key,type:'button','aria-pressed':sort===key,onClick:e=>{setSort(key);const details=e.currentTarget.closest('details');if(details)details.open=false;}},icon(label),h('span',null,t(label))))))),
        h('div',{className:'paa-wb-ship-filters'},
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':t('装备大类')},h('span',null,t('类别')),
            h('div',{className:'paa-wb-ship-filter-options'},choice('all','全部',group==='all',()=>{setGroup('all');setCategory('all');}),
              ...GROUPS.map(([key,label])=>choice(key,label,group===key,()=>{setGroup(key);setCategory('all');})))),
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':t('装备细类')},h('span',null,t('细分')),
            h('div',{className:'paa-wb-ship-filter-options'},choice('all','全部',category==='all',()=>setCategory('all')),
              ...[...categories].map(([key,label])=>choice(key,label,String(category)===key,()=>setCategory(key)))))),
        h('div',{className:'paa-wb-popup-list',ref:listRef},...visible.map(row=>
          h('button',{key:row.id,type:'button',className:'paa-wb-equipment-option','aria-current':row.id===currentEquipment?'true':undefined,
            ...equipmentTooltipProps(row),disabled:disabled||!!row.unavailable,onClick:()=>onPick(row)},
            h(EquipmentIcon,{item:row}),h('span',{className:'paa-wb-equipment-label'},h('span',{className:'paa-wb-equipment-name'},h('strong',null,row.name),
              row.stars>0||row.proficiency>0?h('span',{className:'paa-wb-equipment-quality'},[row.stars>0?`★${row.stars}`:'',row.proficiency>0?t('熟练 {n}',{n:row.proficiency}):''].filter(Boolean).join(' · ')):null),
              sort!=='default'?h('span',{className:'paa-wb-equipment-stats'},`${t(STAT_LABELS[sort])} ${statValue(row,sort,store)}`):row.statsSummary?h('span',{className:'paa-wb-equipment-stats'},i18n.getLocale()==='zh-CN'||!Array.isArray(row.stats)?row.statsSummary:row.stats.map(([label,value])=>`${t(label)}${value}`).join(' ')):null,
              h('span',{className:'paa-wb-equipment-count'},t('可用 {n}',{n:row.count||1})),
              row.id===currentEquipment?h('span',{className:'paa-wb-equipment-current'},t('当前')):null))),
          !visible.length?h('p',{className:'paa-muted'},t('没有匹配装备，请调整筛选或搜索。')):null),
        h('div',{className:'paa-wb-popup-bottom'},h('span',{className:'paa-muted'},t('{n} 种配置',{n:visible.length})),
          onClear?h('button',{type:'button',disabled,onClick:onClear},t('清空此槽')):null,
          onAuto?h('button',{type:'button',disabled,onClick:onAuto},t('交给自动配装')):null)));
  };
}
module.exports=createEquipmentPicker;
module.exports.groupForCategory=groupForCategory;
module.exports.filterRows=filterRows;
module.exports.statValue=statValue;
module.exports.GROUPS=GROUPS;
module.exports.SORTS=SORTS;
