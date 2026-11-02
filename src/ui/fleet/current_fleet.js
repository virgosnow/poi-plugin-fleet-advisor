'use strict';
const F=require('./current_fleet_model'),V=require('../models/presentation_model');
const T=require('../models/metric_tooltips');
const {retain,hiddenPage}=require('../components/retained_view');
const collapse=require('../components/collapse');
const show=n=>Number.isFinite(n)?n:'—';
const fraction=p=>`${show(p?.current)} / ${show(p?.max)}`;
module.exports=(React,{getStore,setQuestPageActive,getController,subscribe})=>{
  const h=React.createElement,EquipmentIcon=require('../components/equipment_icon')(React),badges=require('../components/mechanism_badges')(React);
  const OverviewQuests=require('./overview_quests')(React,{getController,subscribe});
  return function CurrentFleet({hidden=false,busy=false,stopping=false,onStop,stopButtonRef,operationFeedback,onNavigateQuest}){
    const [sourceFleet,setSourceFleet]=React.useState(1);
    const [revision,setRevision]=React.useState(0),[now,setNow]=React.useState(()=>Date.now());
    const [shipDetails,setShipDetails]=React.useState({}),[questState,setQuestState]=React.useState(()=>getStore().questState);
    const content=React.useRef(null),selectionScroll=React.useRef(null);
    const view=React.useRef(null),headingView=React.useRef(null),page=React.useRef(null);
    const paused=hidden||busy;
    const selectSource=update=>{
      if(busy)return;
      const node=content.current,positions=[];
      if(node){
        const window=node.ownerDocument.defaultView,height=node.getBoundingClientRect().height;
        let floor=0;
        for(let parent=node.parentElement;parent;parent=parent.parentElement){
          if(parent!==node.ownerDocument.scrollingElement&&!/(auto|scroll|overlay)/.test(window.getComputedStyle(parent).overflowY))continue;
          positions.push({node:parent,top:parent.scrollTop,left:parent.scrollLeft});
          if(parent.scrollTop>0)floor=Math.max(floor,height-Math.max(0,parent.scrollHeight-parent.clientHeight-parent.scrollTop));
        }
        // Keep only the height needed by the current viewport when switching fleets.
        node.style.minHeight=floor>0?`${Math.ceil(floor)}px`:'';
      }
      selectionScroll.current=positions;
      update();
    };
    React.useEffect(()=>{
      if(paused)return;
      let previous=getStore();
      setQuestState(previous.questState);
      setNow(Date.now());
      const timer=setInterval(()=>{
        const next=getStore();
        setQuestState(value=>value===next.questState?value:next.questState);
        if(['ships','equips','fleets','repairs','basic','useitems'].some(k=>next.info?.[k]!==previous.info?.[k])||next.const!==previous.const){previous=next;setRevision(n=>n+1);}
        const time=Date.now();setNow(current=>F.countdownNeedsTick(next,current,time)?time:current);
      },1000);
      return()=>clearInterval(timer);
    },[paused]);
    React.useEffect(()=>{setQuestPageActive?.('manual',!paused);return()=>setQuestPageActive?.('manual',false);},[paused]);
    (React.useLayoutEffect||React.useEffect)(()=>{
      if(hidden&&content.current)content.current.style.minHeight='';
      const positions=selectionScroll.current||[];
      const missing=Math.max(0,...positions.map(({node,top})=>top-Math.max(0,node.scrollHeight-node.clientHeight)));
      // Collapsed margins can also change when the shorter content gains a height floor.
      if(!hidden&&missing>0&&content.current)content.current.style.minHeight=`${Math.ceil(content.current.getBoundingClientRect().height+missing+1)}px`;
      for(const {node,top,left} of positions){node.scrollTop=top;node.scrollLeft=left;}
      selectionScroll.current=null;
    },[sourceFleet,hidden]);
    const live=paused?null:getStore(),data=retain(view,paused,[sourceFleet,revision,live?.info?.ships,live?.info?.equips,live?.info?.fleets,live?.info?.repairs,live?.info?.basic,live?.info?.useitems,live?.const],()=>({
      store:live,reading:F.inspect(live,sourceFleet)}));
    const headings=retain(headingView,paused,[sourceFleet,revision,now,live?.info?.fleets,live?.const],()=>{
      const fleets=[1,2,3,4].map(n=>F.fleetHeading(live,n,now));return {fleets,current:fleets[sourceFleet-1]};
    });
    if(hidden)return hiddenPage(h,page.current,{className:'paa-workbench paa-current-status','data-kind':'manual',hidden,ref:content});
    if(!data)return h('div',{className:'paa-workbench paa-current-status','data-kind':'manual',ref:content},operationFeedback,
      busy?h('button',{type:'button',ref:stopButtonRef,disabled:stopping,onClick:event=>{if(!stopping)onStop?.(event);}},stopping?'正在停止…':'停止操作'):null);
    const {store,reading}=data,{fleets,current}=headings,air=reading.metrics.airPower,los=reading.metrics.lineOfSight;
    const losValue=c=>Number.isFinite(los?.scoresByCoefficient?.[c])?los.scoresByCoefficient[c].toFixed(1):'—';
    const losDetail=T.los(los,null,{current:true});
    const portrait=row=>h('div',{className:'paa-wb-portrait'},h('span',null,row.name.slice(0,2)),row.portrait?h('img',{src:row.portrait,alt:'',draggable:false,onError:e=>{e.currentTarget.style.display='none';}}):null);
    const chevron=open=>h('svg',{className:'paa-fleet-chevron','data-open':!!open,viewBox:'0 0 16 16',width:12,height:12,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'m6 3 5 5-5 5'}));
    const fold=(label,open,toggle,controls,ariaLabel)=>h('button',{type:'button',className:'paa-fleet-fold',disabled:busy,'aria-expanded':!!open,'aria-controls':controls,'aria-label':ariaLabel||label,onClick:toggle},label,chevron(open));
    const part=(label,value,cls,detail,tier)=>h('div',{className:'paa-fleet-metric-part '+cls,...typeof detail==='object'?T.attributes(detail):{'data-tooltip':detail},'data-tier':tier,tabIndex:0},h('span',null,label),h('strong',null,value));
    const rendered=h('div',{className:'paa-workbench paa-current-status','data-kind':'manual',hidden,ref:content},h('div',{className:'paa-wb-columns'},
      h('section',{className:'paa-wb-left'},h('div',{className:'paa-fleet-section-heading'},h('h3',null,'舰队总览')),
        h('div',{className:'paa-fleet-selector-body'},
        h('div',{className:'paa-scheme-library paa-current-fleets'},h('div',{className:'paa-source-list'},...[1,2,3,4].map(n=>{
          const fleet=fleets[n-1];
          return h('button',{key:n,type:'button','data-source-fleet':n,'aria-pressed':sourceFleet===n,'data-selected':sourceFleet===n,disabled:busy,onClick:()=>selectSource(()=>setSourceFleet(n))},
            h('span',{className:'paa-source-title'},h('strong',null,`第 ${n} 舰队`),fleet.name?h('span',{className:'paa-fleet-choice-name','data-tooltip':fleet.name},fleet.name):null,h('small',null,`${fleet.ids.length} 艘`)),
            h('span',{className:'paa-source-ships'},...fleet.ids.slice(0,6).map(id=>{const ship=store.info?.ships?.[id],master=store.const?.$ships?.[ship?.api_ship_id],name=master?.api_name||`#${id}`,url=ship?V.portraitUrl(store,ship.api_ship_id):null;
              return h('span',{key:id,className:'paa-source-portrait','data-tooltip':name},h('span',null,name.slice(0,2)),url?h('img',{src:url,alt:'',draggable:false,onError:e=>{e.currentTarget.style.display='none';}}):null);
            })),h('span',{className:'paa-fleet-choice-state','data-state':fleet.state},h('span',{'data-tooltip':fleet.mission||undefined},fleet.mission||fleet.status),fleet.remaining?h('time',null,fleet.remaining):null));
        }))),
        h(OverviewQuests,{state:store,questState,onNavigate:onNavigateQuest,disabled:busy}))),
      h('section',{className:'paa-wb-right'},
        h('div',{className:'paa-fleet-heading'},h('div',null,h('h3',null,`第 ${sourceFleet} 舰队`),current.name?h('span',{className:'paa-muted'},current.name):null),
          h('div',{className:'paa-fleet-duty','data-state':current.state},h('span',null,current.status),current.mission?h('span',null,current.mission):null,current.remaining?h('time',{'data-tooltip':current.returnAt?new Date(current.returnAt).toLocaleString('zh-CN'):undefined},current.remaining):null)),
        h('div',{className:'paa-fleet-status-body'},
        busy?h('div',{className:'paa-fleet-running'},h('span',null,'正在执行编成'),h('button',{type:'button',className:'paa-wb-apply',ref:stopButtonRef,disabled:stopping,onClick:event=>{if(!stopping)onStop?.(event);}},stopping?'正在停止…':'停止操作')):null,
        operationFeedback,
        h('div',{className:'paa-fleet-metrics','aria-label':'舰队状态指标'},
          h('div',{className:'paa-fleet-metric combat'},h('div',{className:'paa-fleet-metric-heading'},h('span',null,'战斗')),
            h('div',{className:'paa-fleet-metric-parts'},part('速力',reading.speed.valueLabel||'—','speed',T.speed(reading.speed),reading.speed.tier||0),
              part('索敌',losValue(4),'los',losDetail),
              part('制空值',air?.status==='range'?(air.min===air.max?air.min:`${air.min}–${air.max}`):'—','air',T.air(store,air,null,{current:true})))),
          h('div',{className:'paa-fleet-metric expedition'},h('span',null,'远征'),h('div',{className:'paa-fleet-metric-parts'},
            part('有闪',`${reading.expedition.sparkled}/${reading.ships.length}`,'morale',reading.expedition.unknownMorale?'部分舰娘士气待同步':'士气 ≥ 50 计入有闪。'),
            part('运输桶',reading.expedition.drums,'',`载桶舰：${reading.expedition.carriers} 艘`),
            part('收益',reading.bonusPercent!==null?`+${Number(reading.bonusPercent.toFixed(2))}%`:'—','income',reading.bonus?`基础：+${Number((reading.bonus.baseRate*100).toFixed(2))}%\n改修：+${Number((reading.bonus.improvementRate*100).toFixed(2))}%\n特大发组合：+${Number((reading.bonus.synergyRate*100).toFixed(2))}%`:'装备资料待同步')))),
        ...reading.warnings.map(text=>h('p',{key:text,className:'paa-fleet-warning'},text)),
        !current.exists?h('div',{className:'paa-fleet-empty'},'舰队数据待同步'):!reading.ships.length?h('div',{className:'paa-fleet-empty'},'空舰队'):
          h('div',{className:'paa-wb-ships'},...reading.ships.map((ship,i)=>h('article',{key:ship.id,className:'paa-wb-ship','data-ship-id':ship.id},
            h('div',{className:'paa-fleet-ship-heading'},h('div',{className:'paa-wb-ship-head'},portrait(ship),h('div',{className:'paa-wb-identity'},h('strong',{'data-tooltip':ship.name},ship.name),h('small',null,`${i===0?'旗舰':`第 ${i+1} 位`}${ship.unknown?' · 资料待同步':` · ${ship.type} · Lv.${show(ship.level)}`}`)),
              !ship.unknown?h('div',{className:'paa-fleet-ship-actions'},h('div',{className:'paa-fleet-health','data-health':ship.health,'data-tooltip':`耐久：${fraction(ship.hp)}\n燃料：${fraction(ship.fuel)}\n弹药：${fraction(ship.ammo)}`,tabIndex:0},h('span',null,ship.repair?'入渠中':ship.health),
                  ship.hp.current!==null&&ship.hp.max>0?h('progress',{value:ship.hp.current,max:ship.hp.max,'aria-label':`耐久：${fraction(ship.hp)}`}):h('span',null,'—'),ship.repair?.api_complete_time>0?h('time',null,F.countdown(ship.repair.api_complete_time,now)):null),
                  fold('属性',shipDetails[ship.id],()=>setShipDetails(v=>({...v,[ship.id]:!v[ship.id]})),`paa-fleet-stats-${ship.id}`,`${ship.name}：属性`)):null),
              !ship.unknown?h('div',{className:'paa-fleet-ship-state'},
                [ship.fuel,ship.ammo].some(p=>p.current!==null&&p.max!==null&&p.current<p.max)?h('span',{className:'paa-fleet-supply-warning','data-tooltip':`燃料：${fraction(ship.fuel)}\n弹药：${fraction(ship.ammo)}`,tabIndex:0},'补给不足'):
                  [ship.fuel,ship.ammo].some(p=>p.current===null||p.max===null)?h('span',{className:'paa-muted'},'补给待同步'):null,
                collapse(h,{open:shipDetails[ship.id],id:`paa-fleet-stats-${ship.id}`},h('dl',{className:'paa-fleet-ship-stats','aria-label':'当前面板属性'},...ship.stats.map(s=>h('div',{key:s.label},h('dt',null,s.label),h('dd',null,show(s.value))))))):null),
            h('div',{className:'paa-wb-mechanisms','aria-label':'战斗与远征机制'},...badges(ship.badges)),
            h('div',{className:'paa-wb-gears'},...(ship.equipment||[]).map(eq=>h('div',{key:eq.slot,className:'paa-wb-gear',...eq.id>0&&!eq.item?{'data-tooltip':'装备资料待同步'}:V.equipmentTooltipProps(eq.item),tabIndex:0},
              h('span',{className:'paa-wb-slot-label'},eq.slot==='ex'?'增':eq.slot+1),eq.item?h(EquipmentIcon,{item:eq.item}):h('span',{className:'paa-wb-gear-empty'},eq.id>0?'?':'＋'),
              h('span',{className:'paa-wb-gear-name'},eq.item?eq.item.tooltip.replace(/^.*? · /,''):eq.id>0?`装备 #${eq.id}`:'空槽'),
              eq.capacity!==undefined?h('span',{className:'paa-wb-aircraft-count','data-tooltip':'当前搭载 / 最大搭载'},`${show(eq.planes)} / ${show(eq.capacity)} 架`):null)),!ship.unknown&&!ship.expansion?h('div',{className:'paa-wb-gear-unopened'},'增 · 未开启'):null))))))));
    page.current=rendered;return rendered;
  };
};
