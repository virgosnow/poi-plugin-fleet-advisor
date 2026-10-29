'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {probabilityMarkers,layoutProbabilityLabels,placeProbabilityLabels,edgeAnchor}=require('../../src/ui/maps/route_probabilities');
const h=(type,props,...children)=>({type,props:props||{},children});
const childWithClass=(tree,name)=>(tree.children||[]).find(child=>child?.props?.className===name);
const point=value=>({x:value.x,y:value.y});
const layout={width:400,height:240,nodes:[{id:'start',x:40,y:120},{id:'A',x:150,y:120},
  {id:'B',x:280,y:70},{id:'C',x:280,y:180}],edges:[{from:'start',to:'A'},{from:'A',to:'B'},{from:'A',to:'C'}]};

test('map percentages only label selected random edges once and never infer odds from geometry',()=>{
  const probabilities=[{from:'start',to:'A',probability:1},{from:'A',to:'B',probability:.4},
    {from:'A',to:'C',probability:.6},{from:'A',to:'B',probability:.4}];
  const markers=probabilityMarkers(h,{layout,travels:[['start','A','B'],['start','A','B']],probabilities});
  assert.equal(markers.length,1);assert.equal(markers[0].props['data-edge'],'A>B');
  assert.equal(markers[0].props['data-probability'],.4);assert.equal(markers[0].props['aria-label'],'A→B：40%');
  assert.equal(markers[0].props.style.pointerEvents,'none');
  assert.equal(childWithClass(markers[0],'paa-map-probability-text').children[0],'40%');
  assert.equal(childWithClass(markers[0],'paa-map-probability-text').props.style.fontSize,11);
  assert.equal(childWithClass(markers[0],'paa-map-probability-background').props.height,18);
  assert.equal(childWithClass(markers[0],'paa-map-probability-background').props.width,25.5);
  assert.equal(childWithClass(markers[0],'paa-map-probability-leader').props.style.strokeWidth,1.8);
  assert.equal(childWithClass(markers[0],'paa-map-probability-leader-shadow').props.style.strokeWidth,4);
  assert.equal(childWithClass(markers[0],'paa-map-probability-anchor').props.r,3.2);
  const [large]=probabilityMarkers(h,{layout,travels:[['start','A','B']],probabilities,fixedNodes:true});
  assert.equal(childWithClass(large,'paa-map-probability-text').props.style.fontSize,13);
  const box=childWithClass(large,'paa-map-probability-background');
  assert.equal(box.props.height,20);assert.equal(box.props.y,-10);
  assert.equal(box.props.width,3*6.5*(13/11)+10);
  assert.equal(box.props.style.fill,'#122334f5');assert.equal(box.props.style.stroke,'#9be9edb3');
  assert.equal(box.props.style.strokeWidth,1);
  assert.equal(childWithClass(large,'paa-map-probability-text').props.style.fontWeight,700);
  assert.deepEqual(probabilityMarkers(h,{layout,travels:[['start','A','B']]}),[]);
  for(const probability of [0,1,-.1,1.1,NaN,null])assert.deepEqual(probabilityMarkers(h,{layout,
    travels:[['start','A','B']],probabilities:[{from:'A',to:'B',probability}]}),[]);
  assert.deepEqual(probabilityMarkers(h,{layout,travels:[['start','A','B']],
    probabilities:[{from:'A',to:'B',probability:.4},{from:'A',to:'B',probability:.6}]}),[]);
});

test('separate physical starts map by their real outgoing edge, not by the first travel start',()=>{
  const chart={...layout,nodes:[{id:'start#1',x:10,y:100},{id:'start#2',x:390,y:100},
    {id:'A',x:100,y:50},{id:'B',x:300,y:50}],edges:[{from:'start#1',to:'A'},{from:'start#2',to:'B'}]};
  const markers=probabilityMarkers(h,{layout:chart,travels:[['start#1','A'],['start#1','B']],
    probabilities:[{from:'start',to:'A',probability:.5},{from:'start',to:'B',probability:.5}]});
  assert.deepEqual(markers.map(marker=>marker.props['data-edge']),['start#1>A','start#2>B']);
  assert.equal(markers[1].props['data-probability-from-x'],390);
});

test('curve anchors use visible sprite bounds, with a matching quadratic fallback',()=>{
  const a={x:0,y:0},b={x:0,y:100};
  assert.deepEqual(point(edgeAnchor({sprite:{x:30,y:50,labelGeometry:{x:81,y:91,dx:.8,dy:.6},
    sprite:{spriteSourceSize:{x:4,y:8,w:40,h:60},sourceSize:{w:100,h:100}}}},a,b)),{x:81,y:91});
  assert.deepEqual(point(edgeAnchor({sprite:{x:30,y:50,sprite:{spriteSourceSize:{x:4,y:8,w:40,h:60},
    sourceSize:{w:100,h:100}}}},a,b)),{x:54,y:88});
  assert.deepEqual(point(edgeAnchor({},a,b)),{x:15,y:42});
  assert.deepEqual(point(edgeAnchor({},a,{x:100,y:0})),{x:42,y:0});
});

const circleOverlap=(rect,node,radius)=>Math.hypot(Math.max(Math.abs(rect.x-node.x)-rect.width/2,0),
  Math.max(Math.abs(rect.y-node.y)-rect.height/2,0))<radius;
test('screen-sized labels avoid letters, nearby labels and map borders',()=>{
  const labels=[{x:450,y:360,width:36,fromX:150,fromY:360,toX:750,toY:360},
    {x:462,y:360,width:36,fromX:150,fromY:360,toX:750,toY:360},
    {x:2,y:2,width:43,fromX:0,fromY:0,toX:100,toY:100}];
  const nodes=[{id:'A',x:450,y:360,active:true}];
  for(const scale of [.35,1,1.6]){
    const placed=placeProbabilityLabels({labels,nodes,width:1200,height:720,scale,real:true,compact:true,fixedNodes:true});
    for(const label of placed){
      assert.equal(label.inverseScale,1/scale);const rect=label.screenRect;
      assert(rect.x-rect.width/2>=0);assert(rect.y-rect.height/2>=0);
      assert(rect.x+rect.width/2<=1200*scale);assert(rect.y+rect.height/2<=720*scale);
      assert(!circleOverlap(rect,{x:450*scale,y:360*scale},16),`node overlap at ${scale}`);
    }
    const [a,b]=placed.map(item=>item.screenRect);
    assert(Math.abs(a.x-b.x)>=(a.width+b.width)/2||Math.abs(a.y-b.y)>=(a.height+b.height)/2);
  }
});

test('shared SVG resize callback preserves screen scale across small and expanded label sizes',()=>{
  const makeMarker=fixedNodes=>probabilityMarkers(h,{layout,travels:[['start','A','B']],
    probabilities:[{from:'A',to:'B',probability:.4}],fixedNodes})[0];
  const markerDataset=marker=>Object.fromEntries(Object.entries(marker.props).filter(([key])=>key.startsWith('data-'))
    .map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),String(value)]));
  const dataset=markerDataset(makeMarker(false));
  const attributes={},children=new Map(),element={dataset,style:{},
    setAttribute(name,value){attributes[name]=value;},removeAttribute(name){delete attributes[name];},
    querySelector(selector){
      if(!children.has(selector))children.set(selector,{style:{},attributes:{},
        setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}});
      return children.get(selector);
    }};
  let scale=.4;
  const svg={getScreenCTM:()=>({a:scale,b:0}),querySelectorAll:selector=>
    selector==='.paa-map-probability'?[element]:layout.nodes.map(()=>({classList:{contains:()=>true}}))};
  layoutProbabilityLabels(svg,layout,true,false);
  assert.match(attributes.transform,/scale\(2\.5\)$/);assert.equal(attributes.visibility,'visible');
  assert.equal(attributes['data-mode'],'callout');
  assert.equal(children.get('.paa-map-probability-background').attributes.display,'inline');
  assert.equal(children.get('.paa-map-probability-leader').attributes.display,'inline');
  assert.equal(children.get('.paa-map-probability-leader').attributes.d,
    children.get('.paa-map-probability-leader-shadow').attributes.d);
  Object.assign(dataset,markerDataset(makeMarker(true)));
  scale=1.25;layoutProbabilityLabels(svg,layout,true,true);assert.match(attributes.transform,/scale\(0\.8\)$/);
  assert.equal(attributes['data-mode'],'inline');
  assert.equal(children.get('.paa-map-probability-background').attributes.display,'inline');
  assert.equal(children.get('.paa-map-probability-leader').attributes.display,'none');
  assert.equal(children.get('.paa-map-probability-anchor').attributes.display,'none');
  assert.equal(children.get('.paa-map-probability-text').style.stroke,'none');
  assert.equal(children.get('.paa-map-probability-text').style.strokeWidth,'0');
  assert.equal(children.get('.paa-map-probability-text').attributes.transform,'rotate(0)');
  Object.assign(dataset,markerDataset(makeMarker(false)));
  layoutProbabilityLabels(svg,layout,true,false);
  assert.equal(attributes['data-mode'],'callout');
  assert.equal(children.get('.paa-map-probability-background').attributes.display,'inline');
  scale=0;assert.doesNotThrow(()=>layoutProbabilityLabels(svg,layout,true,true));
});

test('enlarged-map cleanup removes imperative node scaling before React reuses the SVG',()=>{
  const render=require('../../src/ui/maps/route_preview'),{previewForMap}=require('../../src/domain/routes/sortie_profile');
  const profile=previewForMap('2-2');profile.edgeProbabilities=[{from:'G',to:'H',probability:.3}];
  const findSvg=tree=>{
    if(!tree||typeof tree!=='object')return null;
    if(tree.type==='svg'&&tree.props.role==='group')return tree;
    return (tree.children||[]).flat(Infinity).map(findSvg).find(Boolean);
  };
  const expanded=findSvg(render(h,{profile,compact:true,fixedNodes:true}));
  const compact=findSvg(render(h,{profile,compact:true,fixedNodes:false}));
  const attributes=new Map(),marker={dataset:{markerX:'960',markerY:'161',markerRadius:'14',markerPixels:'8'},
    setAttribute(name,value){attributes.set(name,value);},removeAttribute(name){attributes.delete(name);}};
  let disconnected=0;
  const svg={getScreenCTM:()=>({a:.5,b:0}),querySelectorAll:selector=>selector==='[data-marker-radius]'?[marker]:[],
    ownerDocument:{defaultView:{ResizeObserver:class{observe(){}disconnect(){disconnected++;}}}}};
  expanded.props.ref(svg);
  assert.match(attributes.get('transform'),/^translate\(960 161\) scale\(/);
  expanded.props.ref(null);
  assert.equal(attributes.has('transform'),false);assert.equal(disconnected,1);
  compact.props.ref(svg);
  assert.equal(attributes.has('transform'),false,'small-map nodes retain their map coordinates and original radius');
  compact.props.ref(null);
});

const geometryLabel=(extra={})=>({x:200,y:120,dx:1,dy:0,geometry:true,width:29.5,
  fromX:80,fromY:120,toX:320,toY:120,...extra});
const placeOne=(label,extra={})=>placeProbabilityLabels({labels:[label],
  nodes:[{id:'A',x:80,y:120,active:true},{id:'B',x:320,y:120,active:true}],
  width:400,height:240,scale:1,real:true,compact:true,fixedNodes:true,...extra})[0];

test('expanded percentages sit on their real curve anchor instead of the endpoint midpoint',()=>{
  const straight=placeOne(geometryLabel());
  assert.equal(straight.mode,'inline');assert.deepEqual(point(straight),{x:200,y:120});
  assert.equal(straight.angle,0);assert(!straight.connector);
  const curve=placeOne(geometryLabel({x:185,y:92,dx:.8,dy:.6}));
  assert.equal(curve.mode,'inline');assert.deepEqual(point(curve),{x:185,y:92});
  assert.equal(curve.angle,0);
});

test('expanded labels fall back for a short crowded link but remain horizontal on a clear steep link',()=>{
  const crowded=placeOne(geometryLabel({fromX:188,toX:212}),{
    nodes:[{id:'A',x:188,y:120,active:true},{id:'B',x:212,y:120,active:true}]});
  assert.equal(crowded.mode,'callout');assert(crowded.connector);
  for(const x of [188,212])assert(!circleOverlap(crowded.screenRect,{x,y:120},16));
  const steep=placeOne(geometryLabel({dx:.1,dy:1}));
  assert.equal(steep.mode,'inline');assert.equal(steep.angle,0);assert(!steep.connector);
});

test('inline numbers stay horizontal on every local curve direction',()=>{
  for(const [dx,dy] of [[1,0],[-1,0],[.8,.6],[-.8,-.6],[-.8,.6],[0,1],[0,-1],[.1,1]]){
    const placed=placeOne(geometryLabel({dx,dy}));
    assert.equal(placed.mode,'inline');assert.equal(placed.angle,0);
    assert.deepEqual(point(placed),{x:200,y:120});
  }
});

test('callouts connect to the 18px small or 20px expanded label boundary in screen pixels',()=>{
  for(const {scale,fixedNodes} of [...[.217,.25,.33,.83].map(scale=>({scale,fixedNodes:false})),{scale:.83,fixedNodes:true}]){
    const label=geometryLabel(fixedNodes?{width:3*6.5*(13/11)+10,height:20,fromX:188,toX:212}:{height:18}),
      placed=placeOne(label,{scale,fixedNodes,...(fixedNodes?{
        nodes:[{id:'A',x:188,y:120,active:true},{id:'B',x:212,y:120,active:true}]}:{})}),c=placed.connector;
    assert.equal(placed.mode,'callout');assert(c);
    assert.equal(placed.screenRect.height,fixedNodes?20:18);
    assert(Math.abs(c.x-(label.x-placed.x)*scale)<1e-9);
    assert(Math.abs(c.y-(label.y-placed.y)*scale)<1e-9);
    const halfWidth=placed.screenRect.width/2,halfHeight=placed.screenRect.height/2;
    assert(Math.abs(c.endX)<=halfWidth+1e-9&&Math.abs(c.endY)<=halfHeight+1e-9);
    assert(Math.abs(Math.abs(c.endX)-halfWidth)<1e-9||Math.abs(Math.abs(c.endY)-halfHeight)<1e-9);
    assert(Math.abs(c.x*c.endY-c.y*c.endX)<1e-7,'leader meets the near border along the anchor ray');
    assert(Math.hypot(c.endX,c.endY)<=Math.hypot(c.x,c.y));
  }
  const free=placeOne(geometryLabel(),{fixedNodes:false,nodes:[]}),c=free.connector;
  assert(Math.abs(Math.hypot(c.x-c.endX,c.y-c.endY)-6)<1e-9,
    'an unobstructed small-map leader stays close while retaining a visible 6px segment');
  assert.match(c.path,/^M [^LQ]+ L /,'a clear leader stays straight');
});

test('a missing real curve keeps the callout but cannot invent a leader or a probability',()=>{
  const placed=placeOne(geometryLabel({geometry:false}));
  assert.equal(placed.mode,'callout');assert(!placed.connector);
  const chart={...layout,edges:layout.edges.map(edge=>({...edge,
    sprite:{x:10,y:10,labelGeometry:{x:50,y:50,dx:1,dy:0},
      sprite:{sourceSize:{w:100,h:100},spriteSourceSize:{x:0,y:0,w:100,h:100}}}}))};
  assert.deepEqual(probabilityMarkers(h,{layout:chart,travels:[['start','A','B']]}),[]);
  assert.deepEqual(probabilityMarkers(h,{layout:chart,travels:[['start','A','B']],
    probabilities:[{from:'A',to:'B',probability:null}]}),[]);
});

test('real sprite alpha geometry reaches both the label anchor and its local tangent',()=>{
  const chart={...layout,real:true,edges:layout.edges.map(edge=>({...edge,
    sprite:{x:180,y:80,labelGeometry:{x:215,y:92,dx:.8,dy:-.6},
      sprite:{sourceSize:{w:100,h:100},spriteSourceSize:{x:0,y:0,w:100,h:100}}}}))};
  const [marker]=probabilityMarkers(h,{layout:chart,travels:[['start','A','B']],
    probabilities:[{from:'A',to:'B',probability:.4}]});
  assert.equal(marker.props['data-probability-x'],215);assert.equal(marker.props['data-probability-y'],92);
  assert.equal(marker.props['data-probability-dx'],.8);assert.equal(marker.props['data-probability-dy'],-.6);
  assert.equal(marker.props['data-probability-geometry'],true);
  for(const name of ['leader','leader-shadow','anchor','background','text'])
    assert(childWithClass(marker,`paa-map-probability-${name}`));
});

const leaderSamples=placed=>{
  const c=placed.connector,n=c.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  const quadratic=c.path.includes(' Q '),end=n.slice(-2);
  assert.deepEqual(n.slice(0,2),[c.x,c.y]);assert.deepEqual(end,[c.endX,c.endY]);
  return Array.from({length:257},(_,i)=>{
    const t=i/256,u=1-t;
    return {x:placed.screenRect.x+(quadratic?u*u*n[0]+2*u*t*n[2]+t*t*end[0]:u*n[0]+t*end[0]),
      y:placed.screenRect.y+(quadratic?u*u*n[1]+2*u*t*n[3]+t*t*end[1]:u*n[1]+t*end[1])};
  });
};
test('a crowded small-map leader bends around a node without entering its own text box',()=>{
  const nodes=[{id:'A',x:635,y:364,active:false},{id:'B',x:580,y:404,active:false},
    {id:'C',x:676,y:463,active:false},{id:'D',x:571,y:352,active:false}];
  const [placed]=placeProbabilityLabels({labels:[geometryLabel({x:600,y:390})],nodes,
    width:1200,height:720,scale:.33,real:true,compact:true,fixedNodes:false});
  assert.match(placed.connector.path,/ Q /);assert.equal(placed.angle,0);
  const r=placed.screenRect;
  for(const p of leaderSamples(placed)){
    for(const node of nodes)assert(Math.hypot(p.x-node.x*.33,p.y-node.y*.33)>=14*.33,
      `leader intersects ${node.id}`);
    assert(Math.abs(p.x-r.x)>=r.width/2-1e-9||Math.abs(p.y-r.y)>=r.height/2-1e-9);
    assert(p.x>=0&&p.y>=0&&p.x<=1200*.33&&p.y<=720*.33);
  }
});

test('a shortened leader at the map edge stays visible and preserves the real anchor',()=>{
  const nodes=[{id:'A',x:70,y:455,active:false},{id:'B',x:73,y:542,active:false},
    {id:'C',x:10,y:361,active:false}];
  const label=geometryLabel({x:10,y:390}),[placed]=placeProbabilityLabels({labels:[label],nodes,
    width:1200,height:720,scale:.33,real:true,compact:true,fixedNodes:false});
  assert.equal(placed.connector.hard,0);assert(placed.connector.length<15);
  const samples=leaderSamples(placed);assert(Math.abs(samples[0].x-label.x*.33)<1e-9);
  assert(Math.abs(samples[0].y-label.y*.33)<1e-9);
  for(const p of samples){
    assert(p.x>=0&&p.y>=0&&p.x<=1200*.33&&p.y<=720*.33);
    for(const node of nodes)assert(Math.hypot(p.x-node.x*.33,p.y-node.y*.33)>=14*.33);
  }
});

const distanceToRoute=(point,points)=>Math.min(...points.slice(1).map((end,i)=>{
  const start=points[i],dx=end[0]-start[0],dy=end[1]-start[1],squared=dx*dx+dy*dy;
  const t=squared?Math.max(0,Math.min(1,((point.x-start[0])*dx+(point.y-start[1])*dy)/squared)):0;
  return Math.hypot(point.x-start[0]-t*dx,point.y-start[1]-t*dy);
}));

test('small-map leaders move the label away from unselected routes and do not return to their endpoints',()=>{
  const label=geometryLabel({edge:'A>B'}),base={labels:[label],nodes:[],
    width:400,height:240,scale:1,real:true,compact:true,fixedNodes:false};
  const [original]=placeProbabilityLabels(base);
  assert(original.screenRect.y<label.y);
  for(const points of [[[100,108],[300,108]],[[200,105],[200,80]]]){
    const [placed]=placeProbabilityLabels({...base,routes:[{key:'C>D',points}]});
    assert.equal(placed.connector.hard,0);assert.equal(placed.connector.crossings,0);
    for(const p of leaderSamples(placed))assert(distanceToRoute(p,points)>1,
      'a grey route is an obstacle too, including the leader endpoint');
    assert.equal(placed.angle,0);
  }
  const [moved]=placeProbabilityLabels({...base,routes:[{key:'C>D',points:[[100,108],[300,108]]}]});
  assert.equal(moved.connector.crossings,0);assert(moved.connector.length<=6+1e-9);
  assert.match(moved.connector.path,/ L /,'a short clear leader need not move to the opposite side');
});

test('only the target route near the true anchor is exempt from route avoidance',()=>{
  const label=geometryLabel({edge:'A>B'}),base={labels:[label],nodes:[],
    width:400,height:240,scale:1,real:true,compact:true,fixedNodes:false};
  const straight=[[80,120],[320,120]],folded=[[80,120],[320,120],[320,90],[200,90],[200,110]];
  const [touch]=placeProbabilityLabels({...base,routes:[{key:'A>B',points:straight}]});
  assert.equal(touch.connector.crossings,0);assert.match(touch.connector.path,/ L /);
  assert.deepEqual(leaderSamples(touch)[0],{x:label.x,y:label.y});
  const [avoided]=placeProbabilityLabels({...base,routes:[{key:'A>B',points:folded}]});
  assert.equal(avoided.connector.hard,0);assert.equal(avoided.connector.crossings,0);
  for(const p of leaderSamples(avoided))if(Math.hypot(p.x-label.x,p.y-label.y)>4)
    assert(distanceToRoute(p,folded)>1,'the leader must not cross a later part of its own route');
  assert(avoided.connector.length<=6+1e-9);
});

test('an unavoidable route enclosure permits only the minimum crossing without sacrificing text safety',()=>{
  const label=geometryLabel({edge:'A>B'}),ring=[[196,116],[204,116],[204,124],[196,124],[196,116]],
    extra=[[0,108],[400,108]];
  const [placed]=placeProbabilityLabels({labels:[label],nodes:[],
    routes:[{key:'C>D',points:ring},{key:'E>F',points:extra}],
    width:400,height:240,scale:1,real:true,compact:true,fixedNodes:false});
  assert.equal(placed.connector.hard,0);assert.equal(placed.connector.crossings,1);
  assert.match(placed.connector.path,/ L /);
  for(const p of leaderSamples(placed)){
    assert(distanceToRoute(p,extra)>1);
    const r=placed.screenRect;
    assert(Math.abs(p.x-r.x)>=r.width/2-1e-9||Math.abs(p.y-r.y)>=r.height/2-1e-9);
  }
});

function realSmallMap(area,key,types,paths){
  const W=require('../../src/ui/workbench/workbench_model'),fixture=require('../helpers/workbench_fixture'),
    {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes'),{actualMapLayout}=require('../../src/ui/maps/map_assets');
  const state=fixture();
  for(const id of Object.keys(state.info.ships)){
    if(Number(id)>types.length){delete state.info.ships[id];delete state.const.$ships[id];}
    else{state.const.$ships[id].api_stype=types[Number(id)-1];state.info.ships[id].api_sakuteki=[20,20];}
  }
  const overview=W.mapOverview(area,'boss',undefined,{maxRoutes:20});
  overview.options=[{key,nodes:(paths||[key.split('>')])[0],paths:paths||[key.split('>')]}];
  const report=evaluateNormalRoute(state,{area,scheme:{fleet:1,ships:types.map((_,i)=>i+1)}}),
    profile=W.selectedMapProfile(overview,key,null,report),
    chart=actualMapLayout(area,profile.mapPreview,profile.examples[0]),
    travels=(profile.highlightPaths||profile.examples).map(nodes=>[chart.startId,...nodes]),
    active=new Set(travels.flat()),scale=400/chart.width;
  const labels=probabilityMarkers(h,{layout:chart,travels,probabilities:profile.edgeProbabilities}).map(marker=>{
    const p=marker.props;
    return {edge:p['data-edge'],probability:p['data-probability'],x:p['data-probability-x'],y:p['data-probability-y'],
      dx:p['data-probability-dx'],dy:p['data-probability-dy'],geometry:p['data-probability-geometry'],
      width:p['data-probability-width'],height:p['data-probability-height']};
  });
  const routes=chart.backgroundRoutes.map(route=>({key:route.key,points:route.labelGeometry.path}));
  const placed=placeProbabilityLabels({labels,routes,nodes:chart.nodes.map(node=>({...node,active:active.has(node.id)})),
    width:chart.width,height:chart.height,scale,real:true,compact:true,fixedNodes:false});
  for(const label of placed){
    assert.equal(label.connector.hard,0,`${area} ${label.edge} obstructs a node or label`);
    assert.equal(label.connector.crossings,0,`${area} ${label.edge} crosses a route`);
    assert.equal(label.angle,0);assert(label.connector.length>=6-1e-6);
    const samples=leaderSamples(label),anchor=samples[0];
    for(const route of routes){
      const points=route.points.map(p=>p.map(value=>value*scale));
      for(const p of samples){
        if(route.key===label.edge.replace(/^start#/,'')&&Math.hypot(p.x-anchor.x,p.y-anchor.y)<=4)continue;
        assert(distanceToRoute(p,points)>1,`${area} ${label.edge} touches physical route ${route.key}`);
      }
    }
  }
  return placed;
}

test('400px 2-2 uses short leaders without trading away the unselected-route clearance',()=>{
  // Supply both branches explicitly so the geometry check does not depend on
  // whether the guide catalogue has already grouped their common destination.
  const placed=realSmallMap('2-2','C>E>G>H>K',[16,8,2,2,2,2],[[...'CEGHK'],[...'CEGK']]);
  assert.equal(placed.length,3);
  assert(placed.every(label=>label.connector.length<18));
});

test('400px 2-3 merged branches shorten the crowded 65% leader without crossing a route',()=>{
  const placed=realSmallMap('2-3','A>D>G>K>N',[16,3,2,2,2,2],[[...'ADGKN'],[...'ADGIKN']]);
  assert.equal(placed.length,3);
  const branch=placed.find(label=>label.edge==='G>I');
  assert.equal(branch.probability,.65);
  assert(branch.connector.length<31,'a safe nearby bend is available; avoid the previous long detour');
  assert(placed.find(label=>label.edge==='G>K').connector.length<16);
});
