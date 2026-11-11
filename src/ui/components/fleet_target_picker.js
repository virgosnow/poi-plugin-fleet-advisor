'use strict';
const {t,useLocale,registerCatalog}=require('../../shared/i18n');
const catalog=require('../i18n/fleet_target');
registerCatalog('zh-CN',catalog.zhCN);registerCatalog('ja',catalog.ja);registerCatalog('zh-TW',catalog.zhTW);

// Keep the list in the plugin window: native select popups can be positioned
// in the wrong screen coordinate space in poi's detached window.
module.exports=function createFleetTargetPicker(React){
  const h=React.createElement,layoutEffect=React.useLayoutEffect||React.useEffect;
  return function FleetTargetPicker({value,options=[],onChange,disabled=false,hidden=false}){
    const [open,setOpen]=React.useState(false),anchor=React.useRef(null),menu=React.useRef(null),trigger=React.useRef(null);
    useLocale(React);
    const close=restore=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});};
    React.useEffect(()=>{if(disabled||hidden)setOpen(false);},[disabled,hidden]);
    layoutEffect(()=>{
      if(!open||disabled||hidden)return;
      const root=anchor.current,list=menu.current;if(!root||!list)return;
      const doc=root.ownerDocument,win=doc.defaultView;
      const place=()=>{
        const rect=root.getBoundingClientRect(),viewport=doc.documentElement.clientWidth;
        const width=Math.max(0,Math.min(Math.max(rect.width,156),viewport-16));
        const left=Math.max(8-rect.left,Math.min(rect.width-width,viewport-8-rect.left-width));
        list.style.width=`${width}px`;list.style.left=`${left}px`;
        const below=Math.max(0,doc.documentElement.clientHeight-rect.bottom-8),above=Math.max(0,rect.top-8);
        const upwards=below<list.scrollHeight+4&&above>below;
        list.style.top=upwards?'auto':'calc(100% + 4px)';list.style.bottom=upwards?'calc(100% + 4px)':'auto';
        list.style.maxHeight=`${Math.max(0,(upwards?above:below)-4)}px`;
      };
      const outside=event=>{if(!root.contains(event.target))setOpen(false);};
      place();(list.querySelector('[aria-selected=true]:not(:disabled)')||list.querySelector('[role=option]:not(:disabled)'))?.focus({preventScroll:true});
      doc.addEventListener('pointerdown',outside,true);doc.addEventListener('focusin',outside,true);
      win.addEventListener('resize',place);doc.addEventListener('scroll',place,true);
      return()=>{doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('focusin',outside,true);
        win.removeEventListener('resize',place);doc.removeEventListener('scroll',place,true);};
    },[open,disabled,hidden]);
    const selected=options.find(option=>option.value===value);
    const menuKeys=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      const items=[...menu.current.querySelectorAll('[role=option]:not(:disabled)')];if(!items.length)return;
      event.preventDefault();const index=items.indexOf(event.target);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:
        (index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next].focus({preventScroll:true});
    };
    return h('div',{className:'paa-wb-field paa-fleet-target-field'},h('span',null,t('编入')),
      h('div',{className:'paa-fleet-target',ref:anchor},
        h('button',{type:'button',className:'paa-fleet-target-trigger',ref:trigger,disabled:disabled||hidden,
          'aria-label':t('编入舰队'),'aria-haspopup':'listbox','aria-expanded':open&&!disabled&&!hidden,
          'data-fleet-value':value,onClick:()=>setOpen(previous=>!previous),
          onKeyDown:event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);}}},
          h('span',null,selected?.label||t('fleetTarget.default',{fleet:value})),h('span',{className:'paa-fleet-target-chevron','aria-hidden':true})),
        open&&!disabled&&!hidden?h('div',{className:'paa-fleet-target-menu',ref:menu,role:'listbox','aria-label':t('选择编入舰队'),onKeyDown:menuKeys},
          ...options.map(option=>h('button',{key:option.value,type:'button',role:'option',disabled:option.disabled,
            'aria-selected':option.value===value,onClick:()=>{if(!option.disabled){onChange(option.value);close(true);}}},option.label))):null));
  };
};
