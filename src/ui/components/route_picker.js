'use strict';
const {routeFormula}=require('../models/route_presentation');
const renderCombatBalance=require('./combat_balance');
const {LABELS}=require('../../domain/combat/combat_balance');
const usePickerToggle=require('./picker_hover');
const {pickerPlacement}=require('./picker_placement');
const {t,useLocale}=require('../../shared/i18n');
const localized=require('../maps/map_localization');
const routeBlocked=option=>['notFound','unconfirmed'].includes(option?.status);
const combatScore=option=>{
  const {status,balance}=option?.combat||{};
  if(routeBlocked(option)||!['estimated','ready'].includes(status)||
    !Number.isInteger(balance?.rank)||balance.rank<0||balance.rank>4||
    !Number.isFinite(balance.ratio)||balance.ratio<0||
    !Number.isFinite(balance.blueShare)||balance.blueShare<0||balance.blueShare>1||
    !LABELS.includes(balance.label))return null;
  return balance;
};
const compareCombat=(a,b)=>{
  const left=combatScore(a),right=combatScore(b);
  if(!left||!right)return Number(!!right)-Number(!!left);
  return right.rank-left.rank||right.ratio-left.ratio;
};
function routeGroups(options,currentPhase){
  const groups=new Map();
  for(const option of options){
    const phase=option.phase||'';
    if(!groups.has(phase))groups.set(phase,{phase,label:option.phaseLabel||
      (phase.startsWith('gauge')?`第 ${phase.slice(5)} 阶段`:'推荐路线'),options:[]});
    groups.get(phase).options.push(option);
  }
  for(const group of groups.values())group.options.sort(compareCombat);
  return [...groups.values()].sort((a,b)=>Number(b.phase===currentPhase)-Number(a.phase===currentPhase));
}
module.exports=function createRoutePicker(React){
  const h=React.createElement,placementEffect=React.useLayoutEffect||React.useEffect;
  return function RoutePicker({options=[],value='',onChange,currentPhase,disabled=false,hidden=false,area}){
    useLocale(React);
    const [open,setOpen]=React.useState(false),anchor=React.useRef(null),trigger=React.useRef(null),panel=React.useRef(null),pointerInside=React.useRef(false);
    const [expanded,setExpanded]=React.useState({});
    const [muteHover,setMuteHover]=React.useState(false);
    const show=()=>{setExpanded({});setOpen(true);};
    const picker=usePickerToggle(React,{enabled:!disabled&&!hidden,open,anchor,onOpen:show,onClose:()=>setOpen(false)});
    const close=()=>{picker.dismiss();setOpen(false);trigger.current?.focus({preventScroll:true});};
    const choose=key=>{if(disabled||hidden)return;if(key!==value)onChange(key);close();};
    React.useEffect(()=>{picker.dismiss();setOpen(false);},[area,disabled,hidden]);
    placementEffect(()=>{
      if(!open||disabled||hidden)return;
      const root=anchor.current,dialog=panel.current,doc=root.ownerDocument,win=doc.defaultView;
      const place=()=>{
        const {rect:r,width,left}=pickerPlacement(root,doc.documentElement.clientWidth);
        dialog.style.width=`${width}px`;
        dialog.style.left=`${left}px`;
        dialog.style.maxHeight=`${Math.max(100,Math.min(350,doc.documentElement.clientHeight-r.bottom-18))}px`;
      };
      const outside=e=>{if(e.type==='focusin'&&pointerInside.current)return;if(!root.contains(e.target)){picker.dismiss();setOpen(false);}};
      const pointerDown=e=>{pointerInside.current=root.contains(e.target);outside(e);};
      const pointerEnd=()=>{pointerInside.current=false;};
      const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
      place();
      const selected=dialog.querySelector('[aria-selected=true]:not(:disabled)')||dialog.querySelector('[role=option]:not(:disabled)');
      if(!picker.isHover())selected?.focus({preventScroll:true});
      const list=dialog.querySelector('.paa-route-list');
      if(selected&&list)list.scrollTop+=selected.getBoundingClientRect().top-list.getBoundingClientRect().top-30;
      doc.addEventListener('pointerdown',pointerDown,true);doc.addEventListener('pointerup',pointerEnd,true);doc.addEventListener('pointercancel',pointerEnd,true);doc.addEventListener('focusin',outside,true);doc.addEventListener('keydown',escape);win.addEventListener('resize',place);doc.addEventListener('scroll',place,true);
      return ()=>{pointerInside.current=false;doc.removeEventListener('pointerdown',pointerDown,true);doc.removeEventListener('pointerup',pointerEnd,true);doc.removeEventListener('pointercancel',pointerEnd,true);doc.removeEventListener('focusin',outside,true);doc.removeEventListener('keydown',escape);win.removeEventListener('resize',place);doc.removeEventListener('scroll',place,true);};
    },[open,disabled,hidden]);
    const keys=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
      if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();if(!open){picker.click();return;}
      const buttons=[...panel.current.querySelectorAll('[role=option], .paa-route-phase-toggle')]
        .filter(button=>!button.disabled&&!button.closest('[aria-hidden=true]')),i=buttons.indexOf(e.target);
      const direction=['ArrowDown','ArrowRight'].includes(e.key)?1:-1;
      let next=e.key==='Home'?0:e.key==='End'?buttons.length-1:i+direction;
      const grid=e.target.closest?.('.paa-route-options');
      if(grid&&['ArrowDown','ArrowUp'].includes(e.key)){
        const siblings=[...grid.querySelectorAll('[role=option]')].filter(button=>!button.disabled),at=siblings.indexOf(e.target);
        const columns=grid.ownerDocument.defaultView.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
        const target=siblings[at+direction*columns];
        next=target?buttons.indexOf(target):direction>0?i+siblings.length-at:i-at-1;
      }
      buttons[(next+buttons.length)%buttons.length]?.focus();
    };
    // An automatically selected rescue route can remain the displayed value,
    // but it is never a manual option or a shortcut destination.
    const selected=options.find(o=>o.key===value),groups=routeGroups(options.filter(o=>!o.fallback),currentPhase);
    const context=[area,currentPhase,selected?.phase].join(':');
    const isExpanded=group=>groups.length===1||(expanded.context===context&&Object.hasOwn(expanded.phases,group.phase)?
      expanded.phases[group.phase]:group.phase===currentPhase||group.phase===selected?.phase||!currentPhase&&group===groups[0]);
    const toggle=group=>setExpanded({context,phases:{...(expanded.context===context?expanded.phases:{}),[group.phase]:!isExpanded(group)}});
    const path=routeFormula;
    return h('div',{className:'paa-area-picker paa-wb-route-picker','data-kind':'route'},
      h('div',{className:'paa-area-anchor',ref:anchor,'data-has-selection':!!value,'data-mute-hover':muteHover||undefined,onKeyDown:keys,
        onClickCapture:e=>{if(!e.target?.closest?.('.paa-route-clear'))picker.guardClick(e);},onPointerEnter:picker.enter,
        onPointerLeave:e=>{if(e.pointerType==='mouse')setMuteHover(false);picker.leave(e);}},
        h('button',{type:'button',className:'paa-area-trigger paa-route-trigger',ref:trigger,disabled,
          'aria-label':t('路线'),'aria-haspopup':'dialog','aria-expanded':open&&!disabled&&!hidden,
          onClick:()=>{if(!disabled&&!hidden)picker.click();}},
          h('span',{className:'paa-picker-title'},t('路线')),
          h('span',{className:'paa-wb-route-name'},selected?localized.routeName(selected):t('选择路线')),
          selected?h('span',{className:'paa-wb-route-path'},`${selected.phaseLabel?localized.phaseLabel(selected.phaseLabel)+'　':''}${path(selected)==='无可达分支'?t('map.noRoute'):path(selected)}`):null,
          h('span',{className:'paa-area-chevron','aria-hidden':true})),
        value?h('button',{className:'paa-route-clear',type:'button',disabled:disabled||hidden,'aria-label':t('取消路线选择'),
          onPointerEnter:e=>{if(e.pointerType==='mouse')picker.cancelPendingHover();},
          onPointerLeave:e=>{if(e.pointerType==='mouse'&&anchor.current?.contains(e.relatedTarget))picker.enter(e);},
          onClick:e=>{if(e?.detail!==0){picker.suppressHoverUntilLeave();setMuteHover(true);}choose('');}},
          h('svg',{viewBox:'0 0 20 20',width:18,height:18,fill:'none',stroke:'currentColor',strokeWidth:1.3,strokeLinecap:'round','aria-hidden':true},
            h('circle',{cx:10,cy:10,r:7}),h('path',{d:'M7.5 7.5l5 5m0-5l-5 5'}))):null,
        open&&!disabled&&!hidden?h('section',{className:'paa-area-panel paa-route-panel',ref:panel,role:'dialog','aria-label':t('选择路线'),
          onKeyDownCapture:picker.engageKeyboard,onPointerDownCapture:picker.engageSelect},
          h('div',{className:'paa-area-regions paa-route-list',role:'listbox','aria-label':t('推荐路线')},
            ...groups.map(group=>{
              const expanded=isExpanded(group),id=`paa-routes-${area}-${group.phase}`;
              const rows=group.options.map(option=>h('button',{key:option.key,type:'button',className:'paa-route-option',role:'option',disabled:routeBlocked(option),tabIndex:expanded&&!routeBlocked(option)?0:-1,'aria-selected':option.key===value,onClick:()=>{if(expanded&&!routeBlocked(option))choose(option.key);}},
                h('span',{className:'paa-route-option-head'},h('span',null,localized.routeName(option)),
                  combatScore(option)?renderCombatBalance.renderTier(h,option.combat):
                    h('small',null,t(option.status==='notFound'?'上次未找到方案':option.status==='unconfirmed'?'方案待确认':option.status==='notSearched'?'选择后计算':option.combat?.status==='pending'?'计算中':option.combat?'暂不可评估':''))),
                h('span',{className:'paa-route-option-path'},path(option)==='无可达分支'?t('map.noRoute'):path(option))));
              return h('section',{key:group.phase,role:'group','aria-label':localized.phaseLabel(group.label),className:'paa-route-group'},
                groups.length>1?h('button',{type:'button',className:'paa-route-phase-toggle','aria-expanded':expanded,'aria-controls':id,onClick:()=>toggle(group)},
                  h('span',{className:'paa-fleet-chevron','data-open':expanded,'aria-hidden':true},'›'),
                  h('span',null,localized.phaseLabel(group.label)),group.phase===currentPhase?h('small',null,t('当前阶段')):null,
                  h('small',{className:'paa-route-phase-count'},t('map.routeCount',{count:group.options.length}))):null,
                h('div',{id,className:'paa-collapse','data-open':expanded,'aria-hidden':!expanded,inert:expanded?undefined:''},
                  h('div',{className:'paa-collapse-clip'},h('div',{className:'paa-route-options'},...rows))));
            })),
          !groups.length?h('p',{className:'paa-muted'},t('当前没有推荐路线')):null):null));
  };
};
module.exports.routeGroups=routeGroups;
// Follow the same order and availability as the picker, without crossing gauges.
module.exports.routeNeighbor=(options,value,phase,direction)=>{
  const rows=routeGroups(options.filter(option=>!option.fallback&&(option.phase||'')===(phase||'')),phase)[0]?.options||[];
  if(!rows.length)return null;
  const current=rows.findIndex(option=>option.key===value);
  for(let step=1;step<=rows.length;step++){
    const index=current<0?(direction>0?step-1:rows.length-step):(current+direction*step+rows.length*2)%rows.length;
    const option=rows[index];
    if(option.key!==value&&!routeBlocked(option))return option.key;
  }
  return null;
};
