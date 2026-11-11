'use strict';
const {maps}=require('../../../data/sortie/land_base/maps.json');
const V=require('../models/presentation_model');
const {t,registerCatalog}=require('../../shared/i18n');
const catalog=require('../i18n/airbase');
registerCatalog('zh-CN',catalog.zhCN);registerCatalog('ja',catalog.ja);registerCatalog('zh-TW',catalog.zhTW);

const mapFor=area=>maps.find(map=>map.id===area&&map.available);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const modes={0:'待机',1:'出击',2:'防空',3:'退避',4:'休息'};
const visibleWarnings=values=>(values||[]).flatMap(value=>String(value).split('；'))
  .filter(value=>value&&!/^(?:第 \d+ 航空队(?:防空)?换装后需完成转场和补给|计划中的飞机需完成转场并补给后才能出击)$/.test(value));
function relocationWindow(startedAt,now=Date.now()){
  if(!Number.isFinite(startedAt)||!Number.isFinite(now)||now<startedAt)return null;
  const elapsed=Math.floor((now-startedAt)/1000),remaining=Math.max(0,720-elapsed);
  if(!remaining)return null; // The server must confirm that it is usable.
  const format=value=>`${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
  const minimum=Math.max(0,360-elapsed);
  return {minimum:format(minimum),remaining:format(remaining)};
}
function relocationLabel(startedAt,now=Date.now()){
  const window=relocationWindow(startedAt,now);
  return window?`转场 ${window.minimum}–${window.remaining}`:'转场中';
}
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
  return JSON.stringify([store.airbaseSync,store.info?.airbaseRelocations,view.bases.map(base=>[base,(base.api_plane_info||[]).map(slot=>{
    const item=store.info?.equips?.[slot.api_slotid];
    return [item,store.const?.$equips?.[item?.api_slotitem_id]];
  })])]);
}
// Planning inventory checks all regions, not just the selected map: a plane
// newly assigned to another area's base must not be treated as warehouse stock.
function planningSignature(store){
  const rows=Array.isArray(store.info?.airbase)?store.info.airbase:[];
  return JSON.stringify([store.airbaseSync,store.info?.airbaseRelocations,rows.map(base=>[base,(base.api_plane_info||[]).map(slot=>{
    const item=store.info?.equips?.[slot.api_slotid];return [item,store.const?.$equips?.[item?.api_slotitem_id]];
  })])]);
}
function airValue(store,base,planned){
  const input=planned||base,slots=input?.slots??input?.api_plane_info;
  const defense=planned?.targets?.some(Boolean)?false:
    Number(planned?.modePlanned?planned.mode:base.api_action_kind)===2;
  const label=defense?'防空制空':'出击制空';
  const reading=defense?require('../../domain/combat/land_base_defense').defenseAirPower(store,input):
    require('../../domain/combat/land_base').inspectSquadron(store,input);
  const power=Array.isArray(slots)&&slots.length===4?reading.airPower:null;
  const value=Number.isFinite(power?.min)&&Number.isFinite(power?.max)?
    power.min===power.max?`${power.min}`:`${power.min}–${power.max}`:'待确认';
  const reasons=visibleWarnings(Array.isArray(reading.reasons)?reading.reasons:reading.reason?[reading.reason]:[]).join('；');
  return {label,value,power,tooltip:[`${label}：${value}`,reasons].filter(Boolean).join('\n')};
}
function model(store,area,draft){
  const view=basesFor(store,area);
  if(!view)return null;
  return {...view,locked:!view.bases.length&&store.airbaseSync?.complete===true&&Array.isArray(store.info?.airbase),bases:view.bases.map(base=>{
    const planned=draft?.find(row=>row.rid===Number(base.api_rid));
    const changed=planned?.slots?.some(slot=>slot.planned||slot.locked);
    const plannedRange=changed?require('../../recommendation/land_base').inspectSquadron(store,planned):null;
    const distance=changed?(Number.isFinite(plannedRange?.range)?plannedRange.range:null):range(base),planes=Array.isArray(base.api_plane_info)?base.api_plane_info:[];
    const byNumber=new Map(planes.filter(p=>Number.isInteger(p?.api_squadron_id)&&p.api_squadron_id>0)
      .map(p=>[p.api_squadron_id,p]));
    const isPlanned=!!planned?.targets?.some(Boolean)||!!planned?.modePlanned&&!!modes[planned.mode];
    const modeLabel=planned?.targets?.some(Boolean)?modes[1]:planned?.modePlanned&&modes[planned.mode]?modes[planned.mode]:modes[base.api_action_kind]||'状态待确认';
    return {id:base.api_rid,name:base.api_name||`第 ${base.api_rid} 航空队`,nameIsFallback:!base.api_name,targets:planned?.targets||['',''],air:airValue(store,base,planned),modeLabel,modePlanned:isPlanned,
      mode:planned?.targets?.some(Boolean)?'出击方案':planned?.modePlanned&&modes[planned.mode]?
        `${modes[planned.mode]}方案`:modes[base.api_action_kind]||'状态待确认',distance,
      slots:Array.from({length:4},(_,i)=>{
        const slot=byNumber.get(i+1),edit=planned?.slots?.find(row=>row.slotId===i+1);
        const id=edit?number(edit.itemId):number(slot?.api_slotid),count=edit?number(edit.count):number(slot?.api_count),max=edit?number(edit.maxCount):number(slot?.api_max_count);
        const item=id>0?V.equipmentItem(store,id,i):null;
        const relocation=(store.info?.airbaseRelocations||[]).find(row=>row.itemId===id);
        return {number:i+1,item,unknown:id===null,name:id===null?'资料待同步':id===0?'空槽':item?.tooltip.replace(/^.*? · /,'')||'飞机资料待同步',
          count:id>0?`${count===null?'?':count}/${max===null?'?':max}`:null,
          relocating:Number(slot?.api_state)===2,
          state:Number(slot?.api_state)===2?'转场中':edit?.planned?(edit.withinBase?'交换后参考':'转场补给后参考'):id>0&&slot?.api_state!==1?'状态待确认':null,
          relocationStartedAt:Number.isFinite(relocation?.startedAt)?relocation.startedAt:null};
      })};
  })};
}
function render(h,EquipmentIcon,store,area,editor){
  const view=model(store,area,editor?.bases);
  if(!view)return null;
  const warnings=visibleWarnings(editor?.warnings);
  if(store.airbaseSync?.relocationsComplete===false)warnings.push('飞机转场状态待同步，请返回母港');
  const crossSwap=editor?.bases?.some(base=>(base.slots||[]).some(slot=>slot.planned&&slot.withinBase&&
    (store.info?.airbase||[]).some(row=>Number(row.api_area_id)===Number(base.areaId)&&Number(row.api_rid)!==Number(base.rid)&&
      (row.api_plane_info||[]).some(plane=>Number(plane.api_slotid)===Number(slot.itemId)))));
  if(crossSwap)warnings.push('同海域跨队交换请在游戏中直接完成，暂不支持自动应用');
  // All locale-sensitive formatting stays downstream of the original mode,
  // slot state and warning filters; none of these display strings decide an
  // operation or alter source game names.
  const baseName=base=>base.nameIsFallback?t('airbase.name',{number:base.id}):base.name;
  const slotName=slot=>slot.item?slot.name:t(slot.name);
  const relocationText=slot=>{
    const window=relocationWindow(slot.relocationStartedAt,editor?.now);
    return window?t('airbase.relocation',window):t('转场中');
  };
  const airTooltip=(base,compact)=>{
    const [, ...reasons]=base.air.tooltip.split('\n');
    const detail=[t('airbase.metric',{label:t(base.air.label),value:t(base.air.value)}),
      ...reasons.map(line=>line.split('；').map(value=>t(value)).join('；'))];
    if(compact&&Number.isFinite(base.air.power?.min)&&base.air.power.min!==base.air.power.max)detail.push(t('摘要显示下限'));
    return detail.join('\n');
  };
  const modeBadge=base=>{
    const mode=base.modeLabel;
    return h('span',{className:'paa-airbase-mode','data-mode':mode,'aria-label':t('airbase.mode',{name:baseName(base),mode:t(mode)})},t(mode));
  };
  const airMetric=(base,compact=false)=>h('span',{className:'paa-airbase-air',
    'data-tooltip':airTooltip(base,compact),
    'aria-label':`${t(base.air.label)} ${t(base.air.value)}`,tabIndex:0},h('span',null,t('制空')),
    h('span',null,compact&&Number.isFinite(base.air.power?.min)?base.air.power.min:t(base.air.value)));
  const targetMetric=base=>{
    const targets=base.targets.slice(0,2),hasTarget=targets.some(Boolean);
    const value=hasTarget?[0,1].map(index=>targets[index]||'—').join('/'):'—';
    const detail=hasTarget?[0,1].map(index=>t('airbase.waveDetail',{wave:index+1,target:targets[index]?t('airbase.node',{node:targets[index]}):t('未指定')})).join('；'):t('攻击目标未指定');
    return h('span',{className:'paa-airbase-summary-target','data-tooltip':detail,'aria-label':detail,tabIndex:0},
      h('span',null,t('目标')),h('span',null,value));
  };
  const rangeMetric=base=>{
    const value=base.distance===null?t('待确认'):base.distance;
    return h('span',{className:'paa-airbase-range','aria-label':t('airbase.range',{value})},
      h('span',null,t('airbase.rangeLabel')),h('span',null,value));
  };
  const heading=h('div',{className:'paa-airbase-heading'},h('h3',null,t('基地航空队')),
    h('span',null,t('airbase.maxSortie',{number:view.map.maxSortieSquadrons})));
  return h('section',{className:'paa-airbase','aria-label':t('基地航空队')},
    !view.bases.length?h('div',null,heading,h('div',{className:'paa-airbase-placeholder','data-state':view.locked?'locked':'pending'},
      h('div',{className:'paa-airbase-skeleton','aria-hidden':true},
        h('span',{className:'paa-airbase-skeleton-title'}),h('span',null)),
      h('div',{className:'paa-airbase-veil',role:'status'},
        view.locked?h('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
          h('rect',{x:5,y:10,width:14,height:11,rx:2}),h('path',{d:'M8 10V7a4 4 0 0 1 8 0v3'})):null,
        h('span',null,t(view.locked?'待解锁':'基地航空队待同步'))))):
    h('details',{className:'paa-airbase-disclosure'},
      h('summary',null,heading,
        h('div',{className:'paa-airbase-summary-collapse'},
          h('div',{className:'paa-airbase-summary'},...view.bases.map(base=>
            h('span',{className:'paa-airbase-summary-unit',key:base.id,title:baseName(base)},
              h('strong',null,t('airbase.unit',{number:base.id})),modeBadge(base),airMetric(base,true),targetMetric(base))))),
        h('svg',{className:'paa-airbase-chevron',viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
          h('path',{d:'m4 6 4 4 4-4'}))),
      h('div',{className:'paa-airbase-list'},...view.bases.map(base=>{
        const targets=editor?h('div',{className:'paa-airbase-targets'},...[0,1].map(wave=>
          h('label',{key:wave,'data-tooltip':t('airbase.waveTarget',{wave:wave+1})},h('span',{className:'paa-airbase-wave','aria-hidden':true},wave+1),
            h('select',{'aria-label':t('airbase.baseWaveTarget',{name:baseName(base),wave:wave+1}),value:base.targets[wave]||'',disabled:editor.disabled,
            onChange:event=>editor.onTarget(base.id,wave,event.target.value)},h('option',{value:''},t('不出击')),
            base.targets[wave]&&!(editor.targets||[]).some(target=>target.id===base.targets[wave])?h('option',{value:base.targets[wave],disabled:true},t('airbase.offRoute',{node:base.targets[wave]})):null,
            ...(editor.targets||[]).map(target=>h('option',{key:target.id,value:target.id},
              target.label===`${target.id} 点`?t('airbase.node',{node:target.id}):target.label===`${target.id} 点 · Boss`?t('airbase.nodeBoss',{node:target.id}):target.label)))))):null;
        const slots=h('div',{className:'paa-airbase-slots'},...base.slots.map(slot=>
          h(editor?'button':'div',{type:editor?'button':undefined,className:'paa-airbase-slot',key:slot.number,disabled:editor?(editor.disabled||slot.unknown||slot.relocating):undefined,
            onClick:editor?()=>editor.onEditSlot(base.id,slot.number):undefined,'aria-label':editor?t('airbase.slot',{name:baseName(base),slot:slot.number,item:slotName(slot)}):undefined},
            h('span',{className:'paa-airbase-slot-number'},slot.number),
            slot.item?h(EquipmentIcon,{item:slot.item}):h('span',{className:'paa-airbase-slot-empty','aria-hidden':true},'—'),
            h('span',{className:'paa-airbase-slot-name',title:slotName(slot)},slotName(slot)),
            slot.relocating?h('span',{className:'paa-airbase-slot-state',role:'status',
              'data-tooltip':t('转场时间取决于基地整备等级，最终状态以游戏数据为准')},relocationText(slot)):
              slot.count?h('span',{className:'paa-airbase-slot-count','aria-label':t('airbase.loaded',{count:slot.count})},slot.count):null)));
        return h('div',{className:'paa-airbase-unit',key:base.id},
          h('div',{className:'paa-airbase-unit-heading'},h('strong',null,baseName(base)),
            modeBadge(base),h('span',{className:'paa-airbase-metrics'},airMetric(base),rangeMetric(base))),targets,slots);
      }),warnings.length?h('p',{className:'paa-airbase-note',role:'status'},warnings.map(value=>t(value)).join('；')):null)));
}
module.exports={model,render,signature,planningSignature,relocationLabel};
