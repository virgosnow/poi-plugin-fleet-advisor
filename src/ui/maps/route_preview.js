'use strict';
const V=require('../models/presentation_model');
const {actualMapLayout,bossSymbol,startSymbol}=require('./map_assets');
const {mapPan}=require('./map_pan');
// Color and shape communicate encounter types independently of route selection.
// Unknown nodes keep their own marker; lack of enemies is not a no-battle proof.
const TYPES={
  battle:{label:'水上战',color:'#ff9a89',background:'#512c32',icon:'battle'},
  nightBattle:{label:'夜战',color:'#d2adff',background:'#3b2d56',icon:'night'},
  asw:{label:'对潜战',color:'#83c9ff',background:'#1d405c',icon:'asw'},
  aerialCombat:{label:'航空战',color:'#ffc879',background:'#523a20',icon:'air'},
  aerialRaid:{label:'空袭',color:'#ffa9d2',background:'#542d46',icon:'raid'},
  airRecon:{label:'航空侦察',color:'#b8d16b',background:'#354329',icon:'air'},
  resources:{label:'资源',color:'#95e0ab',background:'#254a37',icon:'resource'},
  transport:{label:'运输卸载',color:'#95e0ab',background:'#254a37',icon:'resource'},
  whirlpool:{label:'涡潮',color:'#ffe08c',background:'#514424',icon:'whirlpool'},
  noBattle:{label:'无战斗',color:'#c1cbd7',background:'#293a4b',icon:'quiet'},
  activeBranch:{label:'能动分岐',color:'#91e5dc',background:'#234848',icon:'branch'},
  start:{label:'出发',color:'#c1cbd7',background:'#293a4b',icon:'start'},
  unknown:{label:'资料不足',color:'#aebacb',background:'#303b4b',icon:'unknown'}
};
const typeOf=kind=>TYPES[kind]||TYPES[kind==='item'?'resources':'unknown'];
const canonicalKind=kind=>['item','transport'].includes(kind)?'resources':kind;
// Game vocabulary, adapted around a clear central letter: night double rings,
// red incoming / blue outgoing air arrows. All cues fit the same circular bounds.
const compactMarker=(h,{x,y,radius,kind,letter=false})=>{
  const air=['aerialCombat','aerialRaid'].includes(kind);
  const filled=!letter&&!air&&!['nightBattle','asw','activeBranch','whirlpool','airRecon'].includes(kind);
  const arrow=(color,rotation)=>h('g',{className:`paa-map-air-arrow ${color}`,
    transform:`translate(${x} ${y}) scale(${radius}) rotate(${rotation})`},
    // A true 150-degree circular arc; the arrowhead follows its end tangent.
    h('path',{d:'M 0 -.88 A .88 .88 0 0 0 -.44 .762',className:'paa-map-air-arc'}),
    h('path',{d:'M -.17 .918 L -.54 .821 L -.40 .579 Z',className:'paa-map-air-head'}));
  return [
    h('circle',{cx:x,cy:y,r:radius,className:'paa-map-node-halo'}),
    h('circle',{cx:x,cy:y,r:radius,className:`paa-map-node-body${air?' paa-map-air-body':''}${kind==='whirlpool'?' paa-map-whirlpool-body':''}`,
      style:{fill:filled?'var(--paa-node-color)':'var(--paa-node-background)'}}),
    kind==='nightBattle'?h('circle',{cx:x,cy:y,r:radius*.75,className:'paa-map-node-inner'}):null,
    kind==='whirlpool'?h('path',{
      // The labelled version curls along the lower rim, below the text baseline.
      d:letter?'M .78 .40 C 1.10 -.26 .44 -1.08 -.30 -.86 C -1.07 -.65 -1.12 .39 -.52 .78 C -.08 1.08 .63 .86 .51 .57 C .44 .39 .13 .40 .10 .62':
        'M .78 .40 C 1.10 -.26 .44 -1.08 -.30 -.86 C -1.07 -.65 -1.12 .39 -.52 .78 C -.04 1.10 .66 .72 .49 .17 C .37 -.27 -.20 -.37 -.36 -.03 C -.48 .22 -.18 .40 .04 .23',
      transform:`translate(${x} ${y}) scale(${radius})`,className:'paa-map-whirlpool-spiral'}):null,
    kind==='asw'?h('path',{d:`M ${x-radius*.42} ${y+radius*.56} q ${radius*.14} ${-radius*.15} ${radius*.28} 0 t ${radius*.28} 0 t ${radius*.28} 0`,className:'paa-map-asw-wave'}):null,
    kind==='activeBranch'?h('path',{d:'M -.65 0 H .65 M -.37 -.28 L -.65 0 L -.37 .28 M .37 -.28 L .65 0 L .37 .28',
      transform:letter?`translate(${x} ${y+radius*.64}) scale(${radius*.56} ${radius*.36})`:
        `translate(${x} ${y}) scale(${radius})`,className:'paa-map-branch-fork'}):null,
    kind==='airRecon'?h('path',{
      d:'M 0 -.88 Q .13 -.88 .13 -.65 V -.25 L .80 .16 V .38 L .13 .12 V .60 L .35 .76 V .90 L 0 .80 L -.35 .90 V .76 L -.13 .60 V .12 L -.80 .38 V .16 L -.13 -.25 V -.65 Q -.13 -.88 0 -.88 Z',
      transform:letter?`translate(${x} ${y+radius*.64}) scale(${radius*.35}) rotate(90)`:
        `translate(${x} ${y}) scale(${radius*.83})`,className:'paa-map-recon-plane'}):null,
    ...(air?[arrow('incoming',0),...(kind==='aerialCombat'?[arrow('outgoing',180)]:[])]:[])
  ];
};
const compactRadius=(onRoute,real,largeSymbol=false)=>onRoute?(real?44:16):largeSymbol?(real?30.5:11):(real?14:6);
const selectionMarker=(h,node,radius,real)=>{
  const r=radius+(real?12:5),length=r*.42,x=node.x,y=node.y;
  // Corner brackets describe selection, independently of circular encounter cues.
  const d=[[-1,-1],[1,-1],[-1,1],[1,1]].map(([dx,dy])=>
    `M ${x+dx*r} ${y+dy*(r-length)} V ${y+dy*r} H ${x+dx*(r-length)}`).join(' ');
  return h('g',{className:'paa-map-selection','data-node-id':node.id,'aria-hidden':true},
    h('path',{d,className:'paa-map-selection-shadow'}),h('path',{d,className:'paa-map-selection-frame'}));
};
// Enlarged maps use screen-sized markers, while positions and route sprites
// still follow the map's viewBox. Never scale a node around the map origin.
const fixedMarkerRef=()=>{
  let observer;
  return svg=>{
    observer?.disconnect();if(!svg)return;
    const resize=()=>{
      const matrix=svg.getScreenCTM(),scale=matrix&&Math.hypot(matrix.a,matrix.b);
      if(!scale)return;
      for(const marker of svg.querySelectorAll('[data-marker-radius]')){
        const {markerX:x,markerY:y,markerRadius:radius,markerPixels:pixels}=marker.dataset;
        marker.setAttribute('transform',`translate(${x} ${y}) scale(${pixels/(radius*scale)}) translate(${-x} ${-y})`);
      }
    };
    const ResizeObserver=svg.ownerDocument.defaultView.ResizeObserver;
    if(ResizeObserver){observer=new ResizeObserver(resize);observer.observe(svg);}
    resize();
  };
};
const ICONS={
  battle:'M3 3L15 15M11 15L15 11M2 6L6 2M15 3L3 15M3 11L7 15M12 2L16 6',
  night:'M12 2A7 7 0 1 0 16 12A7 7 0 0 1 12 2',
  asw:'M3 7H12A3 3 0 0 1 12 13H3A3 3 0 0 1 3 7ZM7 7V4H10V7M15 9L17 7M15 11L17 13M2 16H16',
  air:'M9 2V16M2 9L9 6L16 9M5 15L9 13L13 15',
  raid:'M9 1V10M2 7L9 4L16 7M6 14L9 17L12 14M9 12V17',
  resource:'M3 5H15V16H3ZM3 8H15M9 5V16M6 5L4 2M12 5L14 2',
  whirlpool:'M16 10A7 7 0 1 1 9 2A5 5 0 0 1 14 7A4 4 0 0 1 10 12A2 2 0 0 1 8 8H10',
  quiet:'M4 9H14',branch:'M9 16V9M9 9L3 3M9 9L15 3M3 7V3H7M11 3H15V7',
  start:'M9 16V2M3 8L9 2L15 8',unknown:'M5 5A4 4 0 1 1 9 9V11M9 15V16'
};
const icon=(h,type,props={})=>h('svg',{viewBox:'0 0 18 18',...props,'aria-hidden':true},
  h('path',{d:ICONS[type.icon],fill:'none',stroke:'currentColor',strokeWidth:1.7,
    strokeLinecap:'round',strokeLinejoin:'round'}));
const gameIcon=(h,symbol,className,{clipId,...props}={})=>h('svg',{viewBox:`${symbol.frame.x} ${symbol.frame.y} ${symbol.frame.w} ${symbol.frame.h}`,
  ...props,className,overflow:'hidden','aria-hidden':true},
  clipId?h('defs',null,h('clipPath',{id:clipId,clipPathUnits:'userSpaceOnUse'},
    h('rect',{x:symbol.frame.x,y:symbol.frame.y,width:symbol.frame.w,height:symbol.frame.h}))):null,
  h('image',{href:symbol.image,width:symbol.width,height:symbol.height,clipPath:clipId?`url(#${clipId})`:undefined}));
const bossIcon=(h,props)=>gameIcon(h,bossSymbol,'paa-map-boss-icon',props);
const startIcon=(h,props)=>gameIcon(h,startSymbol,'paa-map-start-icon',props);

// Use the SVG transform rather than click coordinates, so keyboard selection,
// resized dialogs and letterboxed maps keep the detail next to the same node.
const nodePopoverRef=focus=>{
  let observer,scroll;
  const place=element=>{
    const frame=element.parentElement,svg=frame.querySelector('svg[role="group"]'),matrix=svg?.getScreenCTM();
    if(!matrix)return;
    const point=svg.createSVGPoint();point.x=focus.x;point.y=focus.y;
    const anchor=point.matrixTransform(matrix),bounds=frame.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    const x=(anchor.x-bounds.left)*frame.clientWidth/bounds.width,y=(anchor.y-bounds.top)*frame.clientHeight/bounds.height;
    const gap=20,pad=8,w=element.offsetWidth,h=element.offsetHeight;
    const left=x+gap+w<=frame.clientWidth-pad?x+gap:x-gap-w;
    element.style.left=`${Math.max(pad,Math.min(frame.clientWidth-w-pad,left))}px`;
    element.style.top=`${Math.max(pad,Math.min(frame.clientHeight-h-pad,y-h/2))}px`;
    element.style.visibility='visible';
  };
  let onScroll;
  return element=>{
    observer?.disconnect();scroll?.removeEventListener('scroll',onScroll);
    if(!element)return;
    onScroll=()=>place(element);scroll=element.parentElement.querySelector('.paa-map-scroll');
    scroll?.addEventListener('scroll',onScroll,{passive:true});
    const ResizeObserver=element.ownerDocument.defaultView.ResizeObserver;
    if(ResizeObserver){observer=new ResizeObserver(onScroll);observer.observe(element.parentElement);observer.observe(element);}
    place(element);
  };
};

module.exports=function routePreview(h,{profile,pathIndex,nodeId,onPath,onNode,disabled,
  mapMode='actual',zoomed=false,onMode,onZoom,onExpand,idSuffix='',onAssetError,assetError,mapAsset,compact=false,fixedNodes=false,showDetails=true,nodePopup=false,enemyPortrait,showPaths=true,onBackground}){
  const compactColors={battle:'#ff767b',nightBattle:'#b180ed',asw:'#ff767b',aerialCombat:'#ff767b',aerialRaid:'#ff767b',airRecon:'#b8d16b',resources:'#9bd65c',whirlpool:'#d2baff',noBattle:'#53c9ee',activeBranch:'#53c9ee',start:'#53c9ee',unknown:'#d9e1ea'};
  const compactBackgrounds={battle:'#482d38',asw:'#482d38',nightBattle:'#3e2d5c',whirlpool:'#443c5b',aerialCombat:'#253646',aerialRaid:'#3f2d38',resources:'#30472e',airRecon:'#354329',noBattle:'#203e50',activeBranch:'#203e50',start:'#203e50'};
  const nodeColor=(kind,type)=>compact?(compactColors[canonicalKind(kind)]||type.color):type.color;
  const paths=profile?.routePaths||[],path=paths[pathIndex]?.nodes||profile?.examples?.[0]||[];
  const actual=mapMode==='actual'?actualMapLayout(profile?.area,profile?.mapPreview,path,mapAsset):null;
  const layout=actual||V.mapLayout(profile?.mapPreview);
  if(!layout)return h('div',{className:'paa-map-empty'},'路线地图待确认');
  const travels=(profile.highlightPaths||[path]).filter(nodes=>nodes.length).map(nodes=>[layout.startId||'start',...nodes]);
  const active=new Set(travels.flat()),activeEdges=new Set(travels.flatMap(travel=>travel.slice(1).map((to,i)=>`${travel[i]}>${to}`)));
  const positions=new Map(layout.nodes.map(n=>[n.id,n]));
  const threat=profile.highlightPaths?.length>1?profile.threat:paths[pathIndex]?.threat||profile.threat;
  const focus=positions.get(nodeId)||(showDetails?(positions.get(threat?.node)||positions.get(path.at(-1))):null);
  const focusEnemies=focus?.enemyFamilies||focus?.enemies||[];
  const tint=`paa-route-tint-${profile.area||'schematic'}${idSuffix}`;
  const mutedTint=`${tint}-muted`;
  const nodeMask=`${tint}-node-mask`;
  const markerSize=node=>compact&&fixedNodes?{'data-marker-x':node.x,'data-marker-y':node.y,
    'data-marker-radius':compactRadius(active.has(node.id),layout.real,node.boss||node.id.startsWith('start')),
    'data-marker-pixels':active.has(node.id)?16:node.boss||node.id.startsWith('start')?12:8}:{};
  let spriteIndex=0;
  const sprite=(frame,x=0,y=0,highlight=false)=>{
    const part=layout.images?.find(image=>frame.frame.y>=image.offsetY&&frame.frame.y+frame.frame.h<=image.offsetY+image.height);
    const clip=`${tint}-clip-${spriteIndex++}`;
    return h('g',{transform:`translate(${x} ${y})`},
      h('defs',null,h('clipPath',{id:clip,clipPathUnits:'userSpaceOnUse'},
        h('rect',{x:0,y:0,width:frame.sourceSize.w,height:frame.sourceSize.h}))),
      h('g',{clipPath:`url(#${clip})`},h('image',{href:part?.image||layout.image,
      x:frame.spriteSourceSize.x-frame.frame.x,y:frame.spriteSourceSize.y-frame.frame.y+(part?.offsetY||0),
      width:part?.width||layout.spriteWidth,height:part?.height||layout.spriteHeight,
      filter:highlight?`url(#${highlight==='muted'?mutedTint:tint})`:undefined,onError:onAssetError})));
  };
  const approximate=layout.real&&layout.edges.some(e=>activeEdges.has(`${e.from}>${e.to}`)&&!e.sprite);
  const detail=showDetails&&focus?[
    h('strong',{key:'name'},focus.id.startsWith('start')?'出发':`${focus.id} 点 · ${V.nodeKind[focus.kind]||'资料不足'}${focus.target?' · 目标点':''}`),
    nodePopup&&enemyPortrait&&focusEnemies.length?h('div',{key:'enemies',className:'paa-map-enemies','aria-label':'可能遇到的敌舰'},
      ...focusEnemies.map((enemy,i)=>h('div',{key:`${enemy.apiId||enemy.name}-${i}`},enemyPortrait(enemy),h('span',null,enemy.name)))):
    h('span',{key:'enemies',className:'paa-muted'},focusEnemies.length?
      `可能遇到：${focusEnemies.slice(0,4).map(e=>e.name).join('、')}${focusEnemies.length>4?'等':''}`:
      focus.threatStatus==='unknown'?'该点敌情资料不足':'无敌舰记录'),
    focus.dataWarnings?.length?h('span',{key:'warnings',className:'paa-result-warning'},focus.dataWarnings.join('；')):null]:null;
  return h('div',{className:'paa-route-preview'},
    (showPaths&&paths.length>1||onMode||layout.real&&onZoom)?h('div',{className:'paa-route-toolbar'},
      showPaths&&paths.length>1?h('select',{'aria-label':'预览路线',value:pathIndex,disabled,
        onChange:e=>onPath(Number(e.target.value))},...paths.map((p,i)=>h('option',{key:i,value:i},
          `路线 ${i+1} · ${p.nodes.join(' → ')}`))):null,
      onMode?h('button',{type:'button',disabled,onClick:()=>onMode(mapMode==='actual'?'schematic':'actual')},
        mapMode==='actual'?'示意图':'实际地图'):null,
      layout.real&&onZoom?h('button',{type:'button',disabled,'aria-pressed':zoomed,onClick:()=>onZoom(!zoomed)},
        zoomed?'适应宽度':'放大'):null):null,
    h('div',{className:'paa-map-viewport','aria-busy':layout.real&&mapAsset?.status==='loading'||undefined},
    h('div',{className:`paa-map-scroll${layout.real?' paa-map-real-scroll':''}${layout.real&&zoomed?' paa-map-pannable':''}`,
      ...mapPan(layout.real&&zoomed)},h('svg',{viewBox:`0 0 ${layout.width} ${layout.height}`,
      width:layout.width,height:layout.height,className:layout.real?`paa-map-real${zoomed?' zoomed':''}`:undefined,
      ref:compact&&fixedNodes?fixedMarkerRef():undefined,
      role:'group','aria-label':layout.real?'实际地图上的推荐路线':'编成路线示意图',onClick:()=>!disabled&&onBackground?.()},
      layout.real?h('defs',null,h('filter',{id:mutedTint,x:'-10%',y:'-10%',width:'120%',height:'120%',colorInterpolationFilters:'sRGB'},
        h('feColorMatrix',{type:'matrix',values:'0 0 0 0 0.20 0 0 0 0 0.27 0 0 0 0 0.36 0 0 0 1 0'})),
        h('filter',{id:tint,x:'-10%',y:'-10%',width:'120%',height:'120%'},
        h('feColorMatrix',{type:'matrix',values:'0 0 0 0 0.1 0 0 0 0 0.9 0 0 0 0 1 0 0 0 1 0'}),
        h('feDropShadow',{dx:0,dy:0,stdDeviation:2,floodColor:'#00384a',floodOpacity:1}))):null,
      compact&&layout.real?h('defs',null,h('mask',{id:nodeMask,maskUnits:'userSpaceOnUse',x:0,y:0,width:layout.width,height:layout.height},
        h('rect',{width:layout.width,height:layout.height,fill:'white'}),
        ...layout.nodes.map(node=>h('circle',{key:node.id,cx:node.x,cy:node.y,r:node.id.startsWith('start')?50:34,fill:'black'})))):null,
      // The transparent chart layer contains native circles and labels, except
      // at some aerial nodes. Remove those marks before drawing uniform nodes.
      // Keep the base terrain intact; route sprites are drawn after this mask.
      ...(layout.backgrounds||[]).map((frame,i)=>h('g',{key:`bg-${i}`,mask:compact&&layout.real&&i>0?`url(#${nodeMask})`:undefined},sprite(frame))),
      ...(layout.backgroundRoutes||[]).map(route=>h('g',{key:`muted-${route.key}`,className:'paa-real-route-muted'},
        sprite(route.sprite,route.x,route.y,'muted'))),
      ...layout.edges.filter(e=>!layout.real||activeEdges.has(`${e.from}>${e.to}`)).map(edge=>{
        const a=positions.get(edge.from),b=positions.get(edge.to),selected=activeEdges.has(`${edge.from}>${edge.to}`);
        if(layout.real&&edge.sprite)return h('g',{key:`${edge.from}>${edge.to}`,className:'paa-real-route'},
          sprite(edge.sprite.sprite,edge.sprite.x,edge.sprite.y,true));
        const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
        const end={x:b.x-dx/length*16,y:b.y-dy/length*16};
        const curve=Math.abs(dx)<5?30:0;
        return h('g',{key:`${edge.from}>${edge.to}`,className:`paa-map-edge${selected?' active':''}${layout.real?' approximate':''}`},
          h('path',{d:`M ${a.x} ${a.y} Q ${(a.x+end.x)/2+curve} ${(a.y+end.y)/2} ${end.x} ${end.y}`}),
          h('path',{d:`M ${end.x-dx/length*6-dy/length*3} ${end.y-dy/length*6+dx/length*3} L ${end.x} ${end.y} L ${end.x-dx/length*6+dy/length*3} ${end.y-dy/length*6-dx/length*3}`,
            className:'paa-map-arrow'}));
      }),
      ...layout.nodes.map(node=>{const type=typeOf(node.kind),onRoute=active.has(node.id),boss=!!node.boss,
        start=node.id.startsWith('start'),smallStart=compact&&start&&!onRoute,smallBoss=compact&&boss&&!onRoute,
        radius=compact?compactRadius(onRoute,layout.real,boss||start):layout.real?19:14,
        symbol=smallStart?startSymbol:bossSymbol,symbolWidth=radius*2*symbol.frame.w/symbol.frame.h;
        return h('g',{key:node.id,role:'button',tabIndex:disabled?-1:0,
        ...markerSize(node),
        'data-kind':node.kind||'unknown','data-boss':boss||undefined,
        style:{'--paa-node-color':compact?nodeColor(node.kind,type):!onRoute?'#8593a5':boss?'#ff7f90':type.color,
          '--paa-node-background':compact?(compactBackgrounds[canonicalKind(node.kind)]||'#303b4b'):!onRoute?'#253345':boss?'#293a4b':type.background},
        'aria-label':`${node.id.startsWith('start')?'出发':node.id+' 点'} · ${V.nodeKind[node.kind]||'资料不足'}${boss?' · Boss':''}${node.target?' · 目标点':''}`,
        'aria-pressed':focus?.id===node.id,'data-tooltip':`${node.id} · ${V.nodeKind[node.kind]||'资料不足'}`,
        className:`paa-map-node${onRoute?' active':' inactive'}${node.target?' target':''}${focus?.id===node.id?' focused':''}`,
        onClick:e=>{e.stopPropagation();if(!disabled)onNode(node.id);},onKeyDown:e=>{if(!disabled&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onNode(node.id);}}},
        node.target&&!compact?h('circle',{cx:node.x,cy:node.y,r:radius+3,className:'paa-map-target-ring'}):null,
        active.has(node.id)&&!compact?h('circle',{cx:node.x,cy:node.y,r:radius+7,className:'paa-map-route-ring'}):null,
        ...(smallBoss||smallStart?[
          h('circle',{cx:node.x,cy:node.y,r:radius,style:{fill:'transparent',stroke:'none'},className:smallStart?'paa-map-start-hit':'paa-map-boss-hit'}),
          (smallStart?startIcon:bossIcon)(h,{x:node.x-symbolWidth/2,y:node.y-radius,width:symbolWidth,height:radius*2,
            clipId:`${tint}-${smallStart?'start':'boss'}-${node.id.replace(/[^a-zA-Z0-9_-]/g,'-')}`,style:{width:symbolWidth,height:radius*2,overflow:'hidden'}})
        ]:compact?compactMarker(h,{x:node.x,y:node.y,radius,kind:node.kind,letter:onRoute}):
          [h('circle',{cx:node.x,cy:node.y,r:radius,className:'paa-map-node-body'})]),
        (!compact||onRoute)?h('text',{x:node.x,y:node.y+(layout.real?(compact?13:7):4),textAnchor:'middle',className:'paa-map-node-label',style:compact?{fontSize:layout.real?38:14}:undefined},
          node.label||(node.id==='start'?'起':node.id)):null,
        onRoute&&!compact?h('g',{className:'paa-map-type-badge',transform:`translate(${node.x+radius-3} ${node.y+radius-3})`},
          h('circle',{r:layout.real?11:8}),
          (boss?bossIcon(h,{x:layout.real?-8:-6,y:layout.real?-8:-6,width:layout.real?16:12,height:layout.real?16:12}):
            icon(h,type,{x:layout.real?-8:-6,y:layout.real?-8:-6,width:layout.real?16:12,height:layout.real?16:12}))):null,
        onRoute&&!compact?h('text',{x:node.x,y:node.y+(layout.real?42:30),textAnchor:'middle',className:'paa-map-kind'},
          node.target?`${boss?'Boss':'目标'} · ${type.label}`:type.label):null);}),
      compact&&focus?h('g',{...markerSize(focus)},selectionMarker(h,focus,compactRadius(active.has(focus.id),layout.real,focus.boss||focus.id.startsWith('start')),layout.real)):null)),
      layout.real&&mapAsset&&mapAsset.status!=='ready'?h('div',{className:'paa-map-loading',role:'status'},
        h('span',null,mapAsset.status==='error'?mapAsset.message:'海图加载中…'),
        mapAsset.status==='error'?h('button',{type:'button',disabled,onClick:mapAsset.retry},'重试'):null):null,
      layout.real&&mapAsset?.warning?h('span',{className:'paa-map-cache-warning','data-tooltip':mapAsset.warning},'缓存未保存'):null,
      onExpand?h('button',{type:'button',className:'paa-map-expand',disabled,onClick:onExpand,
        'data-tooltip':'放大海域地图','aria-label':'放大海域地图','aria-haspopup':'dialog'},
        h('svg',{viewBox:'0 0 24 24',width:18,height:18,'aria-hidden':true,fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round'},
          h('circle',{cx:10,cy:10,r:6.5}),h('path',{d:'m15 15 5 5 M7 10h6 M10 7v6'}))):null,
      nodePopup&&detail?h('div',{className:'paa-map-node-popover',ref:nodePopoverRef(focus),role:'region','aria-label':'节点详情','aria-live':'polite'},
        h('button',{type:'button',className:'paa-map-popover-close','aria-label':'关闭节点详情',onClick:()=>onBackground?.()},'×'),...detail):null),
    h('div',{className:'paa-map-legend','aria-label':'地图节点图例'},
      ...Object.entries(TYPES).filter(([kind])=>!['start','unknown'].includes(kind)&&
        layout.nodes.some(node=>(!path.length||active.has(node.id))&&typeOf(node.kind)===TYPES[kind])).map(([kind,type])=>
        h('span',{key:kind,'data-kind':kind,style:{'--paa-node-color':nodeColor(kind,type),
          '--paa-node-background':compactBackgrounds[kind]||'#303b4b'}},compact?
          h('svg',{viewBox:'-20 -20 40 40',className:'paa-map-legend-marker','aria-hidden':true},
            ...compactMarker(h,{x:0,y:0,radius:14,kind})):icon(h,type),type.label)),
      layout.nodes.some(node=>active.has(node.id)&&typeOf(node.kind)===TYPES.unknown)?h('span',
        {style:{'--paa-node-color':TYPES.unknown.color}},icon(h,TYPES.unknown),'资料不足'):null,
      !compact&&layout.nodes.some(node=>active.has(node.id)&&node.boss)?h('span',null,bossIcon(h),'Boss'):null),
    h('div',{className:'paa-map-caption'},h('span',null,'青色路线与亮色节点：当前路线 · 灰色节点：其他点'),
      layout.real&&zoomed?h('span',null,'按住鼠标左键拖动地图'):null,
      h('span',null,assetError||(layout.real?approximate?'部分连线按节点位置标示':'底图与点位：游戏地图资源':
        mapMode==='actual'?'实际地图暂不可用，显示路线示意':'路线示意，非游戏地图坐标'))),
    !nodePopup&&detail?h('div',{className:'paa-node-detail'},...detail):null);
};
module.exports.bossIcon=bossIcon;
