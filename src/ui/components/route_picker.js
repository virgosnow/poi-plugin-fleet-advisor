'use strict';
const {routeFormula}=require('../models/route_presentation');
function routeGroups(options,currentPhase){
  const groups=new Map();
  for(const option of options){
    const phase=option.phase||'';
    if(!groups.has(phase))groups.set(phase,{phase,label:option.phaseLabel||
      (phase.startsWith('gauge')?`第 ${phase.slice(5)} 阶段`:'推荐路线'),options:[]});
    groups.get(phase).options.push(option);
  }
  return [...groups.values()].sort((a,b)=>Number(b.phase===currentPhase)-Number(a.phase===currentPhase));
}
module.exports=function createRoutePicker(React){
  const h=React.createElement,placementEffect=React.useLayoutEffect||React.useEffect;
  return function RoutePicker({options=[],value='',onChange,currentPhase,disabled=false,hidden=false,showNext=false,area}){
    const [open,setOpen]=React.useState(false),anchor=React.useRef(null),trigger=React.useRef(null),panel=React.useRef(null);
    const [expanded,setExpanded]=React.useState({});
    const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
    const show=()=>{setExpanded({});setOpen(true);};
    const choose=key=>{if(disabled||hidden)return;if(key!==value)onChange(key);close();};
    React.useEffect(()=>setOpen(false),[area,disabled,hidden]);
    placementEffect(()=>{
      if(!open||disabled||hidden)return;
      const root=anchor.current,dialog=panel.current,doc=root.ownerDocument,win=doc.defaultView;
      const place=()=>{
        const r=root.getBoundingClientRect(),width=Math.min(520,doc.documentElement.clientWidth-24);
        dialog.style.width=`${width}px`;
        dialog.style.left=`${Math.max(12-r.left,Math.min(0,doc.documentElement.clientWidth-12-r.left-width))}px`;
        dialog.style.maxHeight=`${Math.max(100,Math.min(350,doc.documentElement.clientHeight-r.bottom-18))}px`;
      };
      const outside=e=>{if(!root.contains(e.target))setOpen(false);};
      place();
      const selected=dialog.querySelector('[aria-selected=true]')||dialog.querySelector('[role=option]');
      selected?.focus({preventScroll:true});
      const list=dialog.querySelector('.paa-route-list');
      if(selected&&list)list.scrollTop+=selected.getBoundingClientRect().top-list.getBoundingClientRect().top-30;
      doc.addEventListener('pointerdown',outside,true);win.addEventListener('resize',place);doc.addEventListener('scroll',place,true);
      return ()=>{doc.removeEventListener('pointerdown',outside,true);win.removeEventListener('resize',place);doc.removeEventListener('scroll',place,true);};
    },[open,disabled,hidden]);
    const keys=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
      if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();if(!open){show();return;}
      const buttons=[...panel.current.querySelectorAll('[role=option], .paa-route-phase-toggle')]
        .filter(button=>!button.closest('[aria-hidden=true]')),i=buttons.indexOf(e.target);
      const direction=['ArrowDown','ArrowRight'].includes(e.key)?1:-1;
      let next=e.key==='Home'?0:e.key==='End'?buttons.length-1:i+direction;
      const grid=e.target.closest?.('.paa-route-options');
      if(grid&&['ArrowDown','ArrowUp'].includes(e.key)){
        const siblings=[...grid.querySelectorAll('[role=option]')],at=siblings.indexOf(e.target);
        const columns=grid.ownerDocument.defaultView.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
        const target=siblings[at+direction*columns];
        next=target?buttons.indexOf(target):direction>0?i+siblings.length-at:i-at-1;
      }
      buttons[(next+buttons.length)%buttons.length]?.focus();
    };
    const selected=options.find(o=>o.key===value),groups=routeGroups(options,currentPhase);
    const cycleGroup=groups.find(group=>group.phase===(selected?.phase||currentPhase||''))||groups[0];
    const cycle=cycleGroup?.options||[],cycleIndex=cycle.findIndex(option=>option.key===value);
    const nextRoute=cycle.length?cycle[(cycleIndex+1)%cycle.length]:null;
    const context=[area,currentPhase,selected?.phase].join(':');
    const isExpanded=group=>groups.length===1||(expanded.context===context&&Object.hasOwn(expanded.phases,group.phase)?
      expanded.phases[group.phase]:group.phase===currentPhase||group.phase===selected?.phase||!currentPhase&&group===groups[0]);
    const toggle=group=>setExpanded({context,phases:{...(expanded.context===context?expanded.phases:{}),[group.phase]:!isExpanded(group)}});
    const path=routeFormula;
    return h('div',{className:'paa-area-picker paa-wb-route-picker','data-kind':'route'},
      h('span',{className:'paa-area-label'},'路线'),
      h('div',{className:'paa-area-anchor',ref:anchor,onKeyDown:keys,
        onBlur:e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}},
        h('button',{type:'button',className:'paa-area-trigger paa-route-trigger',ref:trigger,disabled,
          'aria-label':'路线','aria-haspopup':'dialog','aria-expanded':open&&!disabled&&!hidden,
          onClick:()=>{if(!disabled&&!hidden){if(open)setOpen(false);else show();}}},
          h('span',{className:'paa-wb-route-name'},selected?.name||'选择路线'),
          selected?h('span',{className:'paa-wb-route-path'},`${selected.phaseLabel?selected.phaseLabel+'　':''}${path(selected)}`):null,
          h('span',{className:'paa-area-chevron','aria-hidden':true})),
        open&&!disabled&&!hidden?h('section',{className:'paa-area-panel paa-route-panel',ref:panel,role:'dialog','aria-label':'选择路线'},
          h('div',{className:'paa-area-panel-head'},h('span',null,'选择路线'),h('button',{type:'button','aria-label':'关闭路线选择',onClick:close},'×')),
          h('div',{className:'paa-area-regions paa-route-list',role:'listbox','aria-label':'推荐路线'},
            h('button',{className:'paa-route-clear',type:'button',role:'option','aria-selected':!selected,onClick:()=>choose('')},'选择路线',h('small',null,'取消路线预选')),
            ...groups.map(group=>{
              const expanded=isExpanded(group),id=`paa-routes-${area}-${group.phase}`;
              const rows=group.options.map(option=>h('button',{key:option.key,type:'button',className:'paa-route-option',role:'option',tabIndex:expanded?0:-1,'aria-selected':option.key===value,onClick:()=>{if(expanded)choose(option.key);}},
                h('span',{className:'paa-route-option-head'},h('span',null,option.name),h('small',null,option.status==='notFound'?'条件未满足':option.priority==='优先'?'优先':'')),
                h('span',{className:'paa-route-option-path'},path(option))));
              return h('section',{key:group.phase,role:'group','aria-label':group.label,className:'paa-route-group'},
                groups.length>1?h('button',{type:'button',className:'paa-route-phase-toggle','aria-expanded':expanded,'aria-controls':id,onClick:()=>toggle(group)},
                  h('span',{className:'paa-fleet-chevron','data-open':expanded,'aria-hidden':true},'›'),
                  h('span',null,group.label),group.phase===currentPhase?h('small',null,'当前阶段'):null,
                  h('small',{className:'paa-route-phase-count'},`${group.options.length} 条`)):null,
                h('div',{id,className:'paa-collapse','data-open':expanded,'aria-hidden':!expanded,inert:expanded?undefined:''},
                  h('div',{className:'paa-collapse-clip'},h('div',{className:'paa-route-options'},...rows))));
            })),
          !options.length?h('p',{className:'paa-muted'},'当前没有推荐路线'):null):null),
      showNext?h('button',{type:'button',className:'paa-route-next',disabled:disabled||hidden||!nextRoute||nextRoute.key===value,
        'aria-label':'下一条路线','data-tooltip':nextRoute?`下一条：${nextRoute.name}${cycleGroup.phase?'\n仅在'+cycleGroup.label+'内切换':''}`:'没有可切换的路线',
        onClick:()=>{if(disabled||hidden||!nextRoute||nextRoute.key===value)return;setOpen(false);onChange(nextRoute.key);}},
        h('svg',{width:16,height:16,viewBox:'0 0 16 16',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
          h('path',{d:'M3 8h10M9 4l4 4-4 4'}))):null);
  };
};
module.exports.routeGroups=routeGroups;
