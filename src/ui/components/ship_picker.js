'use strict';
require('../shared_catalog');
const i18n=require('../../shared/i18n');
const SHIP_GROUPS=[['small','驱逐／海防',[1,2]],['cruiser','巡洋舰',[3,4,5,6,21]],['battleship','战舰',[8,9,10,12]],['carrier','空母',[7,11,18]],['submarine','潜艇',[13,14]],['other','辅助舰',[16,17,19,20,22]]];
const ROW_STEP=57,WINDOW_SIZE=20,OVERSCAN=4;
const shipGroup=type=>SHIP_GROUPS.find(group=>group[2].includes(Number(type)))?.[0]||'other';
const matchesLock=(store,id,filter)=>filter==='all'||(store?.info?.ships?.[id]?.api_locked!=null&&
  Number(store.info.ships[id].api_locked)===(filter==='locked'?1:filter==='unlocked'?0:-1));
function nextRemodel(master,ship){
  const next=Number(master?.api_aftershipid),level=Number(master?.api_afterlv);
  return master?.api_aftershipid==null?'改造等级待确认':next<=0?'无后续改造':Number.isFinite(level)&&level>0?
    `下一改造 Lv.${level}${Number(ship?.api_lv)>=level?'（已达）':''}`:'改造等级待确认';
}
function currentStatus(ship,row){
  if(row.unavailable)return row.unavailable;
  const hp=Number(ship?.api_nowhp),max=Number(ship?.api_maxhp);
  if(Number.isFinite(hp)&&max>0&&hp<max){const ratio=hp/max;return ratio<=.25?'大破':ratio<=.5?'中破':ratio<=.75?'小破':'轻伤';}
  if(Number.isFinite(Number(ship?.api_cond))&&Number(ship.api_cond)<40)return '疲劳';
  return row.fleet?`第 ${row.fleet} 舰队`:'待命';
}

// Shared by normal sorties, expeditions and practice. State, candidate
// selection and the action applied to a pick stay with the owning page.
function createShipPicker(React){
  const h=React.createElement;
  return function ShipPicker({index,rows=[],search,setSearch,shipLock,setShipLock,shipType,setShipType,
    shipSort,setShipSort,replacementType,replacementTypeLabel,disabled,onClose,onPick,listRef,store,kind,windowScroll=0,onWindowScroll=()=>{}}){
    const t=i18n.t,knownTypes=require('../workbench/workbench_model').TYPES;
    const displayType=(id,label)=>Object.hasOwn(knownTypes,Number(id))?t(label):store?.const?.$shipTypes?.[id]?.api_name===label?label:t(label);
    const localStatus=value=>{
      const fleet=/^第 (\d+) 舰队$/.exec(value||'');
      if(fleet)return t('第 {n} 舰队',{n:fleet[1]});
      const remodel=/^下一改造 Lv\.(\d+)(（已达）)?$/.exec(value||'');
      if(remodel)return t('下一改造 Lv.{level}{achieved}',{level:remodel[1],achieved:remodel[2]?t('（已达）'):''});
      return t(value);
    };
    const graphs=store?.const?.$shipgraph,graphIndex=Array.isArray(graphs)?new Map(graphs.filter(Boolean).map(g=>[Number(g.api_id),g])):null;
    const urls=new Map(),portraitUrl=require('../models/presentation_model').portraitUrl;
    const portrait=row=>{const id=store?.info?.ships?.[row.id]?.api_ship_id;
      if(!urls.has(id))urls.set(id,row.portrait||portraitUrl(store,id,undefined,graphIndex));
      const url=urls.get(id);return h('div',{className:'paa-wb-portrait'},h('span',null,row.name.slice(0,2)),
      url?h('img',{src:url,alt:'',draggable:false,loading:'lazy',decoding:'async',
        onError:e=>{e.currentTarget.style.display='none';}}):null);};
    const visible=rows,start=Math.min(Math.max(0,Math.floor(windowScroll/ROW_STEP)-OVERSCAN),Math.max(0,visible.length-WINDOW_SIZE)),end=Math.min(visible.length,start+WINDOW_SIZE);
    const keys=e=>{if(e.key!=='Tab')return;const current=e.target.closest?.('button[data-ship-index]');if(!current)return;
      let next=Number(current.dataset.shipIndex)+(e.shiftKey?-1:1);
      while(next>=0&&next<visible.length&&(disabled||visible[next].unavailable))next+=e.shiftKey?-1:1;
      if(next<0||next>=visible.length||next>=start&&next<end)return;
      e.preventDefault();const list=e.currentTarget,top=Math.max(0,(next-(e.shiftKey?0:4))*ROW_STEP);list.scrollTop=top;onWindowScroll(top);
      list.ownerDocument.defaultView.requestAnimationFrame(()=>list.querySelector(`button[data-ship-index="${next}"]`)?.focus());
    };
    return h('div',{className:'paa-wb-popup-shade','data-picker':'ship',onClick:onClose},
      h('section',{className:'paa-wb-popup','data-picker':'ship',role:'dialog','aria-modal':true,'aria-label':t('替换舰娘'),onClick:e=>e.stopPropagation()},
        h('div',{className:'paa-wb-section-head'},h('h3',null,t('第 {n} 位 · 选择舰娘',{n:index+1})),h('span',{className:'paa-ship-picker-count'},t('{n} 艘',{n:rows.length})),h('button',{type:'button',onClick:onClose},t('关闭'))),
        h('div',{className:'paa-wb-popup-filters'},
          h('input',{autoFocus:true,type:'search',value:search,'aria-label':t('搜索候选'),placeholder:t('舰名 / 舰种 / ID'),onChange:e=>setSearch(e.target.value)}),
          h('select',{'aria-label':t('排序方式'),value:shipSort,onChange:e=>setShipSort(e.target.value)},
            h('option',{value:'level-desc'},t('等级从高到低')),h('option',{value:'level-asc'},t('等级从低到高')),
            h('option',{value:'morale-desc'},t('士气从高到低')),h('option',{value:'name'},t('舰名排序')))),
        h('div',{className:'paa-wb-ship-filters'},
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':t('舰种筛选')},h('span',null,t('舰种')),
            h('div',{className:'paa-wb-ship-filter-options'},...[['all','全部'],...(replacementType!=null?[[`type:${replacementType}`,t('同舰种：{type}',{type:displayType(replacementType,replacementTypeLabel)})]]:[]),...SHIP_GROUPS].map(([key,label])=>
              h('button',{key,type:'button','aria-pressed':shipType===key,onClick:()=>setShipType(key)},t(label))))),
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':t('锁定筛选')},h('span',null,t('锁定')),
            h('div',{className:'paa-wb-ship-filter-options'},...[['all','全部'],['locked','已锁定'],['unlocked','未锁定']].map(([key,label])=>
              h('button',{key,type:'button','aria-pressed':shipLock===key,onClick:()=>setShipLock(key)},t(label)))))),
        h('div',{className:'paa-wb-popup-list','aria-label':t('舰娘列表'),ref:listRef,onScroll:e=>onWindowScroll(e.currentTarget.scrollTop),onKeyDown:keys},
          start?h('div',{'aria-hidden':true,style:{height:start*ROW_STEP}}):null,...visible.slice(start,end).map((row,offset)=>{
          const ship=store?.info?.ships?.[row.id],master=store?.const?.$ships?.[ship?.api_ship_id];
          const detail=row.unavailable||(kind==='practice'?nextRemodel(master,ship):currentStatus(ship,row));
          return h('button',{key:row.id,type:'button','data-ship-index':start+offset,disabled:disabled||!!row.unavailable,onClick:()=>onPick(row),style:{height:53,minHeight:53,boxSizing:'border-box',overflow:'hidden'}},
            portrait(row),h('span',{style:{minWidth:0,overflow:'hidden'}},h('strong',{style:{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},row.name),h('small',{style:{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},`${displayType(master?.api_stype,row.type)} · Lv.${row.level} · ${localStatus(detail)}`)));
        }),
          end<visible.length?h('div',{'aria-hidden':true,style:{height:(visible.length-end)*ROW_STEP}}):null,
          !rows.length?h('p',{className:'paa-muted'},t('没有匹配舰娘，请调整筛选或搜索。')):null)));
  };
}
module.exports=createShipPicker;
module.exports.SHIP_GROUPS=SHIP_GROUPS;
module.exports.shipGroup=shipGroup;
module.exports.matchesLock=matchesLock;
module.exports.nextRemodel=nextRemodel;
module.exports.currentStatus=currentStatus;
