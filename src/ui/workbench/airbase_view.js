'use strict';
const {maps}=require('../../../data/sortie/land_base/maps.json');
const V=require('../models/presentation_model');

const mapFor=area=>maps.find(map=>map.id===area&&map.available);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const modes={0:'待机',1:'出击',2:'防空',3:'退避',4:'休息'};
function range(base){
  const distance=base?.api_distance;
  if(typeof distance==='number')return number(distance);
  const main=number(distance?.api_base),bonus=number(distance?.api_bonus);
  return main===null||bonus===null?null:main+bonus;
}
function basesFor(store,area){
  const map=mapFor(area);
  if(!map)return null;
  const rows=Array.isArray(store.info?.airbase)?store.info.airbase:[];
  return {map,bases:rows.filter(base=>Number(base?.api_area_id)===map.baseAreaId)
    .slice().sort((a,b)=>Number(a.api_rid)-Number(b.api_rid))};
}
// poi may update a base or an equipment instance in place. Capture only the
// selected area's displayed information, not the entire account inventory.
function signature(store,area){
  const view=basesFor(store,area);
  if(!view)return '';
  return JSON.stringify([store.airbaseSync?.complete,view.bases.map(base=>[base,(base.api_plane_info||[]).map(slot=>{
    const item=store.info?.equips?.[slot.api_slotid];
    return [item,store.const?.$equips?.[item?.api_slotitem_id]];
  })])]);
}
function model(store,area){
  const view=basesFor(store,area);
  if(!view)return null;
  return {...view,locked:!view.bases.length&&store.airbaseSync?.complete===true&&Array.isArray(store.info?.airbase),bases:view.bases.map(base=>{
    const distance=range(base),planes=Array.isArray(base.api_plane_info)?base.api_plane_info:[];
    const byNumber=new Map(planes.filter(p=>Number.isInteger(p?.api_squadron_id)&&p.api_squadron_id>0)
      .map(p=>[p.api_squadron_id,p]));
    return {id:base.api_rid,name:base.api_name||`第 ${base.api_rid} 航空队`,
      mode:modes[base.api_action_kind]||'状态待确认',distance,
      slots:Array.from({length:4},(_,i)=>{
        const slot=byNumber.get(i+1),id=number(slot?.api_slotid),count=number(slot?.api_count),max=number(slot?.api_max_count);
        const item=id>0?V.equipmentItem(store,id,i):null;
        return {number:i+1,item,name:!slot||id===null?'资料待同步':id===0?'空槽':item?.tooltip.replace(/^.*? · /,'')||'飞机资料待同步',
          count:id>0?`${count===null?'?':count}/${max===null?'?':max}`:null,
          state:id>0&&slot.api_state!==1?'状态待确认':null};
      })};
  })};
}
function render(h,EquipmentIcon,store,area){
  const view=model(store,area);
  if(!view)return null;
  const heading=h('div',{className:'paa-airbase-heading'},h('h3',null,'基地航空队'),
    h('span',null,`本海域最多出击 ${view.map.maxSortieSquadrons} 队`));
  return h('section',{className:'paa-airbase','aria-label':'基地航空队'},
    !view.bases.length?h('div',null,heading,h('div',{className:'paa-airbase-placeholder','data-state':view.locked?'locked':'pending'},
      h('div',{className:'paa-airbase-skeleton','aria-hidden':true},
        h('span',{className:'paa-airbase-skeleton-title'}),h('span',null)),
      h('div',{className:'paa-airbase-veil',role:'status'},
        view.locked?h('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
          h('rect',{x:5,y:10,width:14,height:11,rx:2}),h('path',{d:'M8 10V7a4 4 0 0 1 8 0v3'})):null,
        h('span',null,view.locked?'待解锁':'基地航空队待同步')))):
    h('details',{className:'paa-airbase-disclosure'},
      h('summary',null,heading,
        h('div',{className:'paa-airbase-summary-collapse'},
          h('div',{className:'paa-airbase-summary'},...view.bases.map(base=>
            h('span',{className:'paa-airbase-summary-unit',key:base.id,title:base.name},
              h('strong',null,`${base.id} 队`),h('span',null,base.mode),
              h('span',null,`航程 ${base.distance===null?'待确认':base.distance}`))))),
        h('svg',{className:'paa-airbase-chevron',viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
          h('path',{d:'m4 6 4 4 4-4'}))),
      h('div',{className:'paa-airbase-list'},...view.bases.map(base=>
        h('div',{className:'paa-airbase-unit',key:base.id},
          h('div',{className:'paa-airbase-unit-heading'},h('strong',null,base.name),
            h('span',{className:'paa-airbase-mode','data-mode':base.mode},base.mode),
            h('span',{className:'paa-airbase-range'},`航程 ${base.distance===null?'待确认':base.distance}`)),
          h('div',{className:'paa-airbase-slots'},...base.slots.map(slot=>
            h('div',{className:'paa-airbase-slot',key:slot.number},
              h('span',{className:'paa-airbase-slot-number'},slot.number),
              slot.item?h(EquipmentIcon,{item:slot.item}):h('span',{className:'paa-airbase-slot-empty','aria-hidden':true},'—'),
              h('span',{className:'paa-airbase-slot-name',title:slot.name},slot.name),
              slot.state?h('span',{className:'paa-airbase-slot-state'},slot.state):null,
              slot.count?h('span',{className:'paa-airbase-slot-count','aria-label':`搭载 ${slot.count}`},slot.count):null))))))));
}
module.exports={model,render,signature};
