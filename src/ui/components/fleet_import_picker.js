'use strict';
const {t,registerCatalog}=require('../../shared/i18n');
const {importFleet}=require('../workbench/workbench_model');
const {guardPointerTooltip}=require('./tooltip_pointer_guard');
registerCatalog('ja',{'一键导入':'艦隊を読込','选择要导入的舰队':'読込む艦隊を選択','空舰队':'艦隊なし','舰队资料未同步':'艦隊データ未取得','超过六艘':'6隻を超過','导入舰队当前仅供参考，暂不可应用':'読込んだ艦隊は参考表示です。現在は反映できません'});
registerCatalog('zh-TW',{'一键导入':'一鍵匯入','选择要导入的舰队':'選擇要匯入的艦隊','空舰队':'空艦隊','舰队资料未同步':'艦隊資料未同步','超过六艘':'超過六艘','导入舰队当前仅供参考，暂不可应用':'匯入艦隊目前僅供參考，暫時無法套用'});

module.exports=function createFleetImportPicker(React){
  const h=React.createElement,layoutEffect=React.useLayoutEffect||React.useEffect;
  return function FleetImportPicker({store,disabled=false,hidden=false,onImport}){
    const [open,setOpen]=React.useState(false),anchor=React.useRef(null),menu=React.useRef(null),trigger=React.useRef(null);
    const close=restore=>{setOpen(false);if(restore)trigger.current?.focus?.({preventScroll:true});};
    React.useEffect(()=>{if(disabled||hidden)setOpen(false);},[disabled,hidden]);
    layoutEffect(()=>{
      if(!open||disabled||hidden)return;
      const root=anchor.current,list=menu.current;if(!root||!list)return;
      const doc=root.ownerDocument,win=doc.defaultView;
      const place=()=>{
        const rect=root.getBoundingClientRect(),viewport=doc.documentElement.clientWidth;
        const width=Math.max(0,Math.min(Math.max(rect.width,208),viewport-16));
        list.style.width=`${width}px`;
        list.style.left=`${Math.max(8-rect.left,Math.min(0,viewport-8-rect.left-width))}px`;
        const below=Math.max(0,doc.documentElement.clientHeight-rect.bottom-8),above=Math.max(0,rect.top-8);
        const upwards=below<list.scrollHeight+4&&above>below;
        list.style.top=upwards?'auto':'calc(100% + 4px)';list.style.bottom=upwards?'calc(100% + 4px)':'auto';
        list.style.maxHeight=`${Math.max(0,(upwards?above:below)-4)}px`;
      };
      const outside=event=>{if(!root.contains(event.target))close(false);};
      place();list.querySelector('[role=option]:not(:disabled)')?.focus({preventScroll:true});
      doc.addEventListener('pointerdown',outside,true);doc.addEventListener('focusin',outside,true);
      win.addEventListener('resize',place);doc.addEventListener('scroll',place,true);
      return()=>{doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('focusin',outside,true);
        win.removeEventListener('resize',place);doc.removeEventListener('scroll',place,true);};
    },[open,disabled,hidden]);
    const menuKeys=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      const items=[...menu.current.querySelectorAll('[role=option]:not(:disabled)')];if(!items.length)return;
      event.preventDefault();const index=items.indexOf(event.target);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next].focus({preventScroll:true});
    };
    const descriptions={empty:'空舰队',unsynced:'舰队资料未同步',unsupported:'超过六艘'};
    return h('div',{className:'paa-fleet-import',ref:anchor},
      h('button',{type:'button',className:'paa-wb-quiet',ref:trigger,disabled:disabled||hidden,'aria-haspopup':'listbox','aria-expanded':open&&!disabled&&!hidden,
        onClick:()=>setOpen(previous=>!previous),onKeyDown:event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);}}},t('一键导入')),
      open&&!disabled&&!hidden?h('div',{className:'paa-fleet-import-menu',role:'listbox','aria-label':t('选择要导入的舰队'),ref:menu,onKeyDown:menuKeys},
          ...[1,2,3,4].map(number=>{
            const result=importFleet(store,number);
            return h('button',{key:number,type:'button',role:'option','aria-selected':false,disabled:result.status!=='ready',onClick:event=>{guardPointerTooltip(event);onImport(number);close(true);}},
              h('span',null,t('第 {n} 舰队',{n:number})),h('small',null,result.status==='ready'?t('{n} 艘',{n:result.slots.filter(Boolean).length}):t(descriptions[result.status])));
          })):null);
  };
};
