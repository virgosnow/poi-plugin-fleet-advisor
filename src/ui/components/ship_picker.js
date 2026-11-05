'use strict';
const SHIP_GROUPS=[['small','驱逐／海防',[1,2]],['cruiser','巡洋舰',[3,4,5,6,21]],['battleship','战舰',[8,9,10,12]],['carrier','空母',[7,11,18]],['submarine','潜艇',[13,14]],['other','辅助舰',[16,17,19,20,22]]];
const ROW_STEP=57,WINDOW_SIZE=20,OVERSCAN=4;
const shipGroup=type=>SHIP_GROUPS.find(group=>group[2].includes(Number(type)))?.[0]||'other';
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
  return function ShipPicker({index,rows=[],search,setSearch,shipFleet,setShipFleet,shipType,setShipType,
    shipSort,setShipSort,replacementType,replacementTypeLabel,disabled,onClose,onPick,hint,listRef,store,kind,windowScroll=0,onWindowScroll=()=>{}}){
    const graphs=store?.const?.$shipgraph,graphIndex=Array.isArray(graphs)?new Map(graphs.filter(Boolean).map(g=>[Number(g.api_id),g])):null;
    const urls=new Map(),portraitUrl=require('../models/presentation_model').portraitUrl;
    const portrait=row=>{const id=store?.info?.ships?.[row.id]?.api_ship_id;
      if(!urls.has(id))urls.set(id,row.portrait||portraitUrl(store,id,undefined,graphIndex));
      const url=urls.get(id);return h('div',{className:'paa-wb-portrait'},h('span',null,row.name.slice(0,2)),
      url?h('img',{src:url,alt:'',draggable:false,loading:'lazy',decoding:'async',
        onError:e=>{e.currentTarget.style.display='none';}}):null);};
    const visible=rows.slice(0,80),start=Math.min(Math.max(0,Math.floor(windowScroll/ROW_STEP)-OVERSCAN),Math.max(0,visible.length-WINDOW_SIZE)),end=Math.min(visible.length,start+WINDOW_SIZE);
    const keys=e=>{if(e.key!=='Tab')return;const current=e.target.closest?.('button[data-ship-index]');if(!current)return;
      let next=Number(current.dataset.shipIndex)+(e.shiftKey?-1:1);
      while(next>=0&&next<visible.length&&(disabled||visible[next].unavailable))next+=e.shiftKey?-1:1;
      if(next<0||next>=visible.length||next>=start&&next<end)return;
      e.preventDefault();const list=e.currentTarget,top=Math.max(0,(next-(e.shiftKey?0:4))*ROW_STEP);list.scrollTop=top;onWindowScroll(top);
      list.ownerDocument.defaultView.requestAnimationFrame(()=>list.querySelector(`button[data-ship-index="${next}"]`)?.focus());
    };
    return h('div',{className:'paa-wb-popup-shade','data-picker':'ship',onClick:onClose},
      h('section',{className:'paa-wb-popup','data-picker':'ship',role:'dialog','aria-modal':true,'aria-label':'替换舰娘',onClick:e=>e.stopPropagation()},
        h('div',{className:'paa-wb-section-head'},h('h3',null,`第 ${index+1} 位 · 选择舰娘`),h('button',{type:'button',onClick:onClose},'关闭')),
        h('div',{className:'paa-wb-popup-filters'},
          h('input',{autoFocus:true,type:'search',value:search,'aria-label':'搜索候选',placeholder:'舰名 / 舰种 / ID',onChange:e=>setSearch(e.target.value)}),
          h('select',{'aria-label':'排序方式',value:shipSort,onChange:e=>setShipSort(e.target.value)},
            h('option',{value:'level-desc'},'等级从高到低'),h('option',{value:'level-asc'},'等级从低到高'),
            h('option',{value:'morale-desc'},'士气从高到低'),h('option',{value:'name'},'舰名排序'))),
        h('div',{className:'paa-wb-ship-filters'},
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':'舰队筛选'},h('span',null,'舰队'),
            h('div',{className:'paa-wb-ship-filter-options'},...[['all','全部'],['1','第一舰队'],['2','第二舰队'],['3','第三舰队'],['4','第四舰队']].map(([key,label])=>
              h('button',{key,type:'button','aria-pressed':shipFleet===key,onClick:()=>setShipFleet(key)},label)))),
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':'舰种筛选'},h('span',null,'舰种'),
            h('div',{className:'paa-wb-ship-filter-options'},...[['all','全部'],...(replacementType!=null?[[`type:${replacementType}`,`同舰种：${replacementTypeLabel}`]]:[]),...SHIP_GROUPS].map(([key,label])=>
              h('button',{key,type:'button','aria-pressed':shipType===key,onClick:()=>setShipType(key)},label))))),
        hint?h('p',{className:'paa-muted'},hint):null,
        h('div',{className:'paa-wb-popup-list',ref:listRef,onScroll:e=>onWindowScroll(e.currentTarget.scrollTop),onKeyDown:keys},
          start?h('div',{'aria-hidden':true,style:{height:start*ROW_STEP}}):null,...visible.slice(start,end).map((row,offset)=>{
          const ship=store?.info?.ships?.[row.id],master=store?.const?.$ships?.[ship?.api_ship_id];
          const detail=row.unavailable||(kind==='practice'?nextRemodel(master,ship):currentStatus(ship,row));
          return h('button',{key:row.id,type:'button','data-ship-index':start+offset,disabled:disabled||!!row.unavailable,onClick:()=>onPick(row),style:{height:53,minHeight:53,boxSizing:'border-box',overflow:'hidden'}},
            portrait(row),h('span',{style:{minWidth:0,overflow:'hidden'}},h('strong',{style:{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},row.name),h('small',{style:{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},`${row.type} · Lv.${row.level} · ${detail}`)));
        }),
          end<visible.length?h('div',{'aria-hidden':true,style:{height:(visible.length-end)*ROW_STEP}}):null,
          !rows.length?h('p',{className:'paa-muted'},'没有匹配舰娘，请调整筛选或搜索。'):null),
        h('div',{className:'paa-wb-popup-bottom'},h('span',{className:'paa-muted'},`${rows.length} 项${rows.length>80?' · 输入名称缩小范围':''}`))));
  };
}
module.exports=createShipPicker;
module.exports.SHIP_GROUPS=SHIP_GROUPS;
module.exports.shipGroup=shipGroup;
module.exports.nextRemodel=nextRemodel;
module.exports.currentStatus=currentStatus;
