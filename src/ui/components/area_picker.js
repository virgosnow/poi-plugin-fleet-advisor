'use strict';
const REGIONS=['','镇守府海域','南西诸岛海域','北方海域','西方海域','南方海域','中部海域','南西海域'];
const REGION_ORDER=new Map([1,2,3,7,4,5,6].map((world,index)=>[world,index]));
const {missionSummary,referenceIncome}=require('../expedition/expedition_model');
const {normalizeName}=require('../../shared/name_matching');
const usePickerToggle=require('./picker_hover');
const {panelWidth,panelOffset,pickerPlacement}=require('./picker_placement');
const INCOME_ORDERS={fuel:'燃料',ammo:'弹药',steel:'钢材',bauxite:'铝土'};
const MISSION_REGIONS={1:'镇守府',2:'南西诸岛',3:'北方',4:'西方',5:'南方',6:'中部',7:'南西'};
function missionRegion(m,masters={}){
  const world=Number(m.world??masters[m.missionId]?.api_maparea_id);
  return Number.isInteger(world)&&world>0&&MISSION_REGIONS[world]?String(world):'other';
}
function missionRegions(missions,masters={}){
  const keys=new Set(missions.map(m=>missionRegion(m,masters)));
  return ['1','2','3','7','4','5','6','other'].filter(key=>keys.has(key))
    .map(key=>{
      const numbers=key==='other'?[]:missions.filter(m=>missionRegion(m,masters)===key).map(m=>{
        // Lettered expeditions have internal numeric IDs; use the displayed
        // number so A/B/D/E missions are not mistaken for 100+ entries.
        const display=masters[m.missionId]?.api_disp_no??m.number??(m.missionId<100?m.missionId:'');
        return /^\d+$/.test(String(display))?Number(display):null;
      }).filter(number=>Number.isInteger(number)&&number>0);
      return {key,name:key==='other'?'其他':MISSION_REGIONS[key],start:numbers.length?Math.min(...numbers):null};
    });
}
function filterMissions(missions,summary,{query='',region='all',masters={}}={}){
  const words=normalizeName(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  const aliases={燃料:'油 fuel',弹药:'弹 ammo',钢材:'钢 steel',铝土:'铝 bauxite',高速修复材:'桶 修复',高速建造材:'建造',开发资材:'钉子 开发',改修资材:'螺丝'};
  return missions.filter(m=>{
    if(region!=='all'&&missionRegion(m,masters)!==region)return false;
    const row=summary(m);
    const text=normalizeName([m.missionId,row.number,row.name,row.time,...row.rewards.map(r=>r.name+' '+(aliases[r.name]||''))].join(' ')).toLowerCase();
    return words.every(word=>text.includes(word));
  });
}
function sortMissions(missions,summary,order='number'){
  return missions.slice().sort((a,b)=>{
    const left=summary(a),right=summary(b);let difference=0;
    if(INCOME_ORDERS[order]){
      const av=left.income?.hourly?.[INCOME_ORDERS[order]],bv=right.income?.hourly?.[INCOME_ORDERS[order]];
      difference=Number(Number.isFinite(bv))-Number(Number.isFinite(av));
      if(!difference&&Number.isFinite(av))difference=bv-av;
    }else if(order==='short'||order==='long'){
      const knownLeft=Number.isFinite(left.minutes)&&left.minutes>0,knownRight=Number.isFinite(right.minutes)&&right.minutes>0;
      difference=Number(knownRight)-Number(knownLeft);
      if(!difference&&knownLeft)difference=(left.minutes-right.minutes)*(order==='long'?-1:1);
    }
    return difference||a.missionId-b.missionId;
  });
}
function groups(maps){
  const rows=new Map();
  for(const map of maps){
    const match=/^(\d+)-(\d+)$/.exec(map.area);if(!match)continue;
    const world=Number(match[1]);if(!rows.has(world))rows.set(world,[]);
    rows.get(world).push(map);
  }
  return [...rows].sort(([a],[b])=>(REGION_ORDER.get(a)??REGION_ORDER.size)-(REGION_ORDER.get(b)??REGION_ORDER.size)||a-b).map(([world,maps])=>({world,name:REGIONS[world]||`第 ${world} 海域`,
    maps:maps.slice().sort((a,b)=>Number(a.area.split('-')[1])-Number(b.area.split('-')[1]))}));
}
module.exports=function createAreaPicker(React){
  const h=React.createElement,placementEffect=React.useLayoutEffect||React.useEffect,ResourceIcon=require('./resource_icon')(React);
  const rewardIcon=name=>h('span',{key:name,className:'paa-mission-reward-icon','data-tooltip':name,'aria-label':name},h(ResourceIcon,{name,size:14}));
  return function AreaPicker({maps=[],missions=[],kind='normal',value,onChange,mapMasters={},missionMasters={},missionProgress={},fleets=[],useItems={},disabled=false,hidden=false}){
    const expedition=kind==='expedition',label=expedition?'远征':'海域';
    const [open,setOpen]=React.useState(false),trigger=React.useRef(null),dialog=React.useRef(null),anchor=React.useRef(null),pointerInside=React.useRef(false);
    const [query,setQuery]=React.useState(''),[order,setOrder]=React.useState('number'),[region,setRegion]=React.useState('all');
    const editingSearch=React.useRef(false);
    const netResource=INCOME_ORDERS[order];
    const picker=usePickerToggle(React,{enabled:!disabled&&!hidden,open,anchor,onOpen:()=>setOpen(true),
      onClose:()=>{editingSearch.current=false;setOpen(false);},
      shouldHoldOpen:()=>editingSearch.current&&anchor.current?.ownerDocument?.activeElement===dialog.current?.querySelector('input[type=search]')});
    const close=()=>{editingSearch.current=false;picker.dismiss();setOpen(false);trigger.current?.focus();};
    React.useEffect(()=>{if(disabled||hidden){editingSearch.current=false;picker.dismiss();setOpen(false);}},[disabled,hidden]);
    placementEffect(()=>{
      if(!open||disabled||hidden)return;
      const panel=dialog.current,root=anchor.current,doc=root.ownerDocument,win=doc.defaultView;
      // Stay below the trigger, but shift horizontally and scroll inside on small hosts.
      const place=()=>{
        const {rect:r,width,left}=pickerPlacement(root,doc.documentElement.clientWidth);
        panel.style.width=`${width}px`;
        panel.style.left=`${left}px`;
        panel.style.maxHeight=`${Math.max(100,Math.min(expedition?400:320,doc.documentElement.clientHeight-r.bottom-18))}px`;
      };
      const outside=e=>{if(e.type==='focusin'&&pointerInside.current)return;if(!root.contains(e.target)){picker.dismiss();setOpen(false);}};
      const pointerDown=e=>{pointerInside.current=root.contains(e.target);outside(e);};
      const pointerEnd=()=>{pointerInside.current=false;};
      const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
      place();
      const selected=panel.querySelector('[aria-current=true]')||panel.querySelector('.paa-area-maps button');
      if(!picker.isHover())(expedition?panel.querySelector('input[type=search]'):selected)?.focus({preventScroll:true});
      const list=panel.querySelector('.paa-area-regions');
      if(selected&&list)list.scrollTop+=selected.getBoundingClientRect().top-list.getBoundingClientRect().top-30;
      const tabs=panel.querySelector('.paa-mission-area-tabs');
      const wheel=e=>{
        if(e.defaultPrevented||e.ctrlKey||e.shiftKey||e.deltaX||!e.deltaY||tabs.scrollWidth<=tabs.clientWidth)return;
        const step=e.deltaMode===1?16:e.deltaMode===2?tabs.clientWidth:1;
        const left=Math.max(0,Math.min(tabs.scrollWidth-tabs.clientWidth,tabs.scrollLeft+e.deltaY*step));
        if(left===tabs.scrollLeft)return;
        e.preventDefault();tabs.scrollLeft=left;
      };
      // A native non-passive listener lets the strip consume vertical wheel input.
      tabs?.addEventListener('wheel',wheel,{passive:false});
      doc.addEventListener('pointerdown',pointerDown,true);doc.addEventListener('pointerup',pointerEnd,true);doc.addEventListener('pointercancel',pointerEnd,true);doc.addEventListener('focusin',outside,true);doc.addEventListener('keydown',escape);win.addEventListener('resize',place);doc.addEventListener('scroll',place,true);
      return ()=>{tabs?.removeEventListener('wheel',wheel);pointerInside.current=false;doc.removeEventListener('pointerdown',pointerDown,true);doc.removeEventListener('pointerup',pointerEnd,true);doc.removeEventListener('pointercancel',pointerEnd,true);doc.removeEventListener('focusin',outside,true);doc.removeEventListener('keydown',escape);win.removeEventListener('resize',place);doc.removeEventListener('scroll',place,true);};
    },[open,disabled,hidden]);
    React.useEffect(()=>{const list=dialog.current?.querySelector('.paa-area-regions');if(list)list.scrollTop=0;},[query,order,region]);
    const keys=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    };
    const catalog=expedition?missions:maps.map(map=>({...map,name:map.name||mapMasters?.[Number(map.area.replace('-',''))]?.api_name||''}));
    const id=entry=>expedition?entry.missionId:entry.area,selected=catalog.find(m=>id(m)===value);
    const summaries=new Map();
    const brief=entry=>{
      if(!summaries.has(entry.missionId)){
        const summary=missionSummary(entry,missionMasters[entry.missionId],useItems,missionProgress,fleets);
        summary.income=referenceIncome(entry.missionId);
        summaries.set(entry.missionId,summary);
      }
      return summaries.get(entry.missionId);
    };
    const visible=expedition?sortMissions(filterMissions(catalog,brief,{query,region,masters:missionMasters}),brief,order):catalog;
    const statusIcon=(summary,showFleet=false)=>summary.status==='running'&&showFleet?
      h('span',{className:'paa-mission-running-fleet','data-state':'running','aria-label':summary.statusText},`${summary.runningFleets.join('/')}队`):
      h('span',{className:'paa-mission-state','data-state':summary.status,'aria-label':summary.statusText},
      h('svg',{viewBox:'0 0 16 16',width:12,height:12,'aria-hidden':true,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round'},
        summary.status==='locked'?[h('rect',{key:'lock',x:3.5,y:7,width:9,height:6.5,rx:1.5}),h('path',{key:'shackle',d:'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'})]:
        summary.status==='completed'?h('path',{d:'m3 8 3 3 7-7'}):summary.status==='running'?[h('circle',{key:'circle',cx:8,cy:8,r:5.5}),h('path',{key:'hands',d:'M8 4v4l3 2'})]:
          summary.status==='incomplete'?h('circle',{cx:8,cy:8,r:4.5}):h('path',{d:'M4 8h8'})));
    const monthBadge=summary=>summary.monthly?h('span',{className:'paa-mission-monthly','aria-label':'月度远征'},'月'):null;
    const rewardIcons=summary=>h('span',{className:'paa-mission-rewards','aria-label':summary.rewards.map(r=>r.name).join('、')},
      ...summary.rewards.map(r=>rewardIcon(r.name)),!summary.rewards.length?h('span',null,'—'):null);
    const selectedBrief=expedition&&selected?brief(selected):null;
    const option=entry=>{
      const summary=expedition?brief(entry):null;
      return h('button',{key:id(entry),type:'button',
        'aria-current':id(entry)===value?'true':undefined,'aria-label':`${id(entry)}${entry.name?' '+entry.name:''}${summary?.status==='running'?'，'+summary.statusText:''}`,
        'data-monthly':summary?.monthly||undefined,'data-completion':summary?.completion,
        onClick:()=>{if(disabled||hidden)return;if(id(entry)!==value)onChange(id(entry));close();}},
        ...(summary?[h('strong',{className:'paa-mission-option-number'},summary.number),
          h('span',{className:'paa-mission-option-name'},summary.name),
          netResource?h('span',{className:'paa-mission-hourly','data-negative':summary.income?.hourly?.[netResource]<0||undefined},
            rewardIcon(netResource),h('span',null,Number.isFinite(summary.income?.hourly?.[netResource])?
              `${Math.round(summary.income.hourly[netResource]*10)/10}/时`:'—')):rewardIcons(summary),
          h('span',{className:'paa-mission-duration'},summary.time),
          h('span',{className:'paa-mission-option-state'},monthBadge(summary),statusIcon(summary,true),
            summary.completion==='locked'?h('small',{className:'paa-mission-locked-label'},'未解锁'):null)]:
          [h('strong',null,id(entry)),entry.name?h('small',null,entry.name):null]));
    };
    return h('div',{className:'paa-area-picker','data-kind':kind},h('span',{className:'paa-area-label'},label),
      h('div',{className:'paa-area-anchor',ref:anchor,onKeyDown:keys,onClickCapture:picker.guardClick,onPointerEnter:picker.enter,onPointerLeave:picker.leave},
      h('button',{type:'button',ref:trigger,className:'paa-area-trigger',disabled,
        'aria-label':label,'aria-description':selectedBrief?.statusText,'aria-haspopup':'dialog','aria-expanded':open&&!disabled&&!hidden,onClick:()=>{if(!disabled&&!hidden)picker.click();}},
        h('strong',null,selectedBrief?.number||value),h('span',{className:'paa-area-name'},selectedBrief?.name||selected?.name||`选择${label}`),
        selectedBrief?h('span',{className:'paa-mission-option-state paa-mission-selected-state'},monthBadge(selectedBrief),statusIcon(selectedBrief)):null,
        h('span',{className:'paa-area-chevron','aria-hidden':true})),
      open&&!disabled&&!hidden?h('section',{ref:dialog,className:'paa-area-panel',role:'dialog','aria-label':`选择${label}`,onKeyDown:keys,
          onKeyDownCapture:picker.engageKeyboard,onPointerDownCapture:picker.engageSelect,'data-kind':kind},
          h('div',{className:'paa-area-panel-head'},h('span',null,`选择${label}`),
            expedition&&!Object.keys(missionProgress?.records||{}).length?h('span',null,'待同步'):null,
            expedition? h('span',{className:'paa-mission-count'},`${visible.length} / ${catalog.length}${netResource?' · 参考净时薪（预设补给）':''}`):null,
            expedition&&query?h('button',{type:'button',className:'paa-mission-search-reset',onClick:()=>setQuery('')},'清空搜索'):null,
            h('button',{type:'button','aria-label':`关闭${label}选择`,onClick:close},'×')),
          expedition?h('div',{className:'paa-mission-controls'},h('input',{type:'search','aria-label':'搜索远征',placeholder:'编号 / 名称 / 资源',value:query,
            onPointerDown:()=>{editingSearch.current=true;},onCompositionStart:()=>{editingSearch.current=true;},
            onBlur:()=>{editingSearch.current=false;},onChange:e=>{editingSearch.current=true;setQuery(e.target.value);}}),
            h('select',{'aria-label':'远征排序',value:order,onChange:e=>setOrder(e.target.value)},
              ...[['number','编号顺序'],['short','时长：短到长'],['long','时长：长到短'],
                ...Object.entries(INCOME_ORDERS).map(([id,name])=>[id,`${name}净收益/时`])].map(([id,name])=>h('option',{key:id,value:id},name)))):null,
          expedition?h('div',{className:'paa-mission-area-tabs',role:'group','aria-label':'筛选远征海域'},
            ...[{key:'all',name:'全海域'},...missionRegions(catalog,missionMasters)].map(item=>h('button',{
              type:'button',key:item.key,'aria-pressed':region===item.key,'aria-label':item.key==='all'?'全海域':`${item.name}海域${item.start?`，远征从 ${item.start} 号开始`:''}`,
              onClick:()=>setRegion(item.key)},item.name,item.start?h('span',{className:'paa-mission-area-number','aria-hidden':true},`（${item.start}~）`):null))):null,
          h('div',{className:'paa-area-regions'},expedition?h('div',{className:'paa-area-maps paa-mission-list'},...visible.map(option)):groups(visible).map(group=>h('section',{key:group.world,className:'paa-area-region','aria-label':group.name},
            h('h4',null,h('span',null,group.world),group.name),
            h('div',{className:'paa-area-maps'},...group.maps.map(option)))),
            !catalog.length?h('p',{className:'paa-muted'},`${label}资料正在载入，请稍后重试。`):!visible.length?h('p',{className:'paa-muted'},'没有符合条件的远征'):null)):null));
  };
};
module.exports.groups=groups;
module.exports.sortMissions=sortMissions;
module.exports.missionSummary=missionSummary;
module.exports.filterMissions=filterMissions;
module.exports.missionRegions=missionRegions;
module.exports.panelWidth=panelWidth;
module.exports.panelOffset=panelOffset;
