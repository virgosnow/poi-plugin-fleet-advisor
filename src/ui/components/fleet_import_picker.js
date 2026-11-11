'use strict';
const {t,registerCatalog}=require('../../shared/i18n');
const {importFleet}=require('../workbench/workbench_model');
registerCatalog('ja',{'一键导入':'艦隊を読込','选择要导入的舰队':'読込む艦隊を選択','空舰队':'艦隊なし','舰队资料未同步':'艦隊データ未取得','超过六艘':'6隻を超過','导入舰队当前仅供参考，暂不可应用':'読込んだ艦隊は参考表示です。現在は反映できません'});
registerCatalog('zh-TW',{'一键导入':'一鍵匯入','选择要导入的舰队':'選擇要匯入的艦隊','空舰队':'空艦隊','舰队资料未同步':'艦隊資料未同步','超过六艘':'超過六艘','导入舰队当前仅供参考，暂不可应用':'匯入艦隊目前僅供參考，暫時無法套用'});

module.exports=function createFleetImportPicker(React){
  const h=React.createElement;
  return function FleetImportPicker({store,disabled=false,hidden=false,onImport}){
    const [open,setOpen]=React.useState(false),dialog=React.useRef(null),trigger=React.useRef(null);
    const close=()=>{setOpen(false);trigger.current?.focus?.({preventScroll:true});};
    React.useEffect(()=>{if(disabled||hidden)setOpen(false);},[disabled,hidden]);
    React.useEffect(()=>{
      if(!open||disabled||hidden)return;
      const doc=dialog.current?.ownerDocument;if(!doc)return;
      const escape=event=>{if(event.key==='Escape'){event.preventDefault();close();}};
      doc.addEventListener('keydown',escape);dialog.current.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
      return()=>doc.removeEventListener('keydown',escape);
    },[open,disabled,hidden]);
    const descriptions={empty:'空舰队',unsynced:'舰队资料未同步',unsupported:'超过六艘'};
    return h(React.Fragment,null,
      h('button',{type:'button',className:'paa-wb-quiet',ref:trigger,disabled:disabled||hidden,'aria-haspopup':'dialog','aria-expanded':open,onClick:()=>setOpen(true)},t('一键导入')),
      open&&!disabled&&!hidden?h('div',{className:'paa-wb-popup-shade','data-picker':'fleet-import',onClick:close},
        h('section',{className:'paa-wb-popup paa-fleet-import-dialog',role:'dialog','aria-modal':true,'aria-label':t('选择要导入的舰队'),ref:dialog,onClick:event=>event.stopPropagation()},
          h('div',{className:'paa-wb-section-head'},h('h3',null,t('选择要导入的舰队')),h('button',{type:'button',onClick:close},t('关闭'))),
          h('div',{className:'paa-fleet-import-list'},...[1,2,3,4].map(number=>{
            const result=importFleet(store,number);
            return h('button',{key:number,type:'button',disabled:result.status!=='ready',onClick:()=>{onImport(number);close();}},
              h('span',null,t('第 {n} 舰队',{n:number})),h('small',null,result.status==='ready'?t('{n} 艘',{n:result.slots.filter(Boolean).length}):t(descriptions[result.status])));
          })))):null);
  };
};
