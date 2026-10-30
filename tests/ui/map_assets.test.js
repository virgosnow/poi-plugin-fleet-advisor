'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const data=require('../../data/sortie/maps/index.json');
const {actualMapLayout}=require('../../src/ui/maps/map_assets');
const commonSource=require('../../data/sortie/maps/map_common.source.json');
function losslessImageSize(image){
  assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return [image.readUInt32BE(16),image.readUInt32BE(20)];
}

test('the game Boss and departure icons keep their pinned atlas and valid unrotated frames',()=>{
  for(const [file,hash] of [[commonSource.image,commonSource.imageEncoding.sha256],['map_common.json',commonSource.atlasSha256]])
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../../data/sortie/maps',file))).digest('hex'),hash);
  const atlas=require('../../data/sortie/maps/map_common.json'),sprite=atlas.frames[commonSource.bossFrame];
  const size=commonSource.runtimeAtlas.size;
  assert.deepEqual(losslessImageSize(fs.readFileSync(path.join(__dirname,'../../data/sortie/maps',commonSource.image))),[size.w,size.h]);
  assert.equal(commonSource.imageEncoding.exact,true);assert.match(commonSource.imageEncoding.rgbaSha256,/^[a-f0-9]{64}$/);
  assert.equal(sprite.rotated,false);assert.equal(sprite.frame.w,58);assert.equal(sprite.frame.h,61);
  assert(sprite.frame.x+sprite.frame.w<=atlas.meta.size.w&&sprite.frame.y+sprite.frame.h<=atlas.meta.size.h);
  const start=atlas.frames[commonSource.startFrame];
  assert.equal(start.rotated,false);assert.deepEqual(start.frame,{x:1401,y:2542,w:90,h:90});
  assert(start.frame.x+start.frame.w<=atlas.meta.size.w&&start.frame.y+start.frame.h<=atlas.meta.size.h);
  const {startSymbol,bossSymbol}=require('../../src/ui/maps/map_assets');assert.equal(startSymbol.image,bossSymbol.image);
  assert.deepEqual([bossSymbol.frame.w,bossSymbol.frame.h],[sprite.frame.w,sprite.frame.h]);
  assert.deepEqual([startSymbol.frame.w,startSymbol.frame.h],[start.frame.w,start.frame.h]);
  for(const symbol of [startSymbol,bossSymbol]){
    assert(symbol.frame.x+symbol.frame.w<=symbol.width);assert(symbol.frame.y+symbol.frame.h<=symbol.height);
  }
});
test('only the selected route shows node symbols, and a resource target must not receive a Boss bull head',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const render=require('../../src/ui/maps/route_preview');
  const collect=(tree,predicate)=>!tree||typeof tree!=='object'?[]:
    [...(predicate(tree)?[tree]:[]),...(tree.children||[]).flatMap(child=>collect(child,predicate))];
  const props={onPath:()=>{},onNode:()=>{},mapMode:'actual'};
  const profile=profileForRoute('1-1',{targetNodes:['C'],pointAssessments:[fixed('A','C')]});
  const tree=render(h,{...props,profile});
  const offRoute=collect(tree,n=>n.props?.className?.includes('paa-map-node inactive'));
  assert(offRoute.length>0);
  for(const node of offRoute)assert.equal(collect(node,n=>['paa-map-type-badge','paa-map-boss-icon'].includes(n.props?.className)).length,0);
  const boss=collect(tree,n=>n.props?.['data-boss']===true&&n.props.className.includes(' active'));
  assert.equal(boss.length,1);assert.equal(collect(boss[0],n=>n.props?.className==='paa-map-boss-icon').length,1);
  const resource=profileForRoute('1-6',{targetNodes:['N'],pointAssessments:[
    fixed('start','A'),fixed('A','E'),fixed('G','F'),fixed('B','N')]});
  const resourceTree=render(h,{...props,profile:resource});
  assert.equal(collect(resourceTree,n=>n.props?.className==='paa-map-boss-icon').length,0);
});
const {profileForRoute}=require('../../src/domain/routes/sortie_profile');
const fixed=(from,to)=>({from,assessment:{status:'fixed',destinations:[to]}});

test('compact maps mask baked-in markers and use equal circles for aerial and surface nodes',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(tree,predicate)=>!tree||typeof tree!=='object'?[]:
    [...(predicate(tree)?[tree]:[]),...(tree.children||[]).flatMap(child=>collect(child,predicate))];
  const profile=profileForRoute('1-6',{targetNodes:['N'],pointAssessments:[fixed('start','A'),fixed('A','E'),fixed('G','F'),fixed('B','N')]});
  const tree=require('../../src/ui/maps/route_preview')(h,{profile,compact:true,onNode:()=>{},showDetails:false,showPaths:false});
  const nodes=collect(tree,n=>n.props.className?.includes('paa-map-node '));
  assert(nodes.some(n=>n.props['data-kind']==='aerialCombat'));
  for(const active of [true,false]){
    const radii=nodes.filter(n=>n.props.className.includes(active?' active':' inactive'))
      .flatMap(n=>collect(n,c=>c.props.className?.split(' ').includes('paa-map-node-body')).map(c=>c.props.r));
    assert.equal(new Set(radii).size,1);
  }
  const mask=collect(tree,n=>n.type==='mask')[0];assert(mask);
  assert.equal(collect(mask,n=>n.type==='circle').length,nodes.length);
  const backgrounds=collect(tree,n=>String(n.props.key).startsWith('bg-'));
  assert(!backgrounds[0].props.mask);assert(backgrounds.slice(1).every(n=>n.props.mask));
  const boss=require('../../src/ui/maps/route_preview')(h,{profile:profileForRoute('1-1',{targetNodes:['C'],pointAssessments:[fixed('A','C')]}),compact:true,onNode:()=>{}});
  assert(collect(boss,n=>n.props.className==='paa-map-node-label').every(n=>!n.props.style?.fill));
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  assert(!text(boss).includes('字母红色'));assert(!text(collect(boss,n=>n.props.className==='paa-map-legend')[0]).includes('Boss'));
});

test('compact off-route Boss nodes use the cropped game symbol and keep selection accessible',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(tree,p)=>!tree||typeof tree!=='object'?[]:
    [...(p(tree)?[tree]:[]),...(tree.children||[]).flatMap(n=>collect(n,p))];
  const render=require('../../src/ui/maps/route_preview'),{previewForMap}=require('../../src/domain/routes/sortie_profile');
  const profile=previewForMap('5-5');profile.routePaths=[];profile.examples=[];
  let nodeId;
  const draw=()=>render(h,{profile,pathIndex:0,nodeId,compact:true,showDetails:false,onNode:id=>{nodeId=id;}});
  let tree=draw();
  const boss=collect(tree,n=>n.props['data-boss'])[0];assert(boss);
  const symbol=collect(boss,n=>n.props.className==='paa-map-boss-icon')[0];assert(symbol);
  const clip=collect(symbol,n=>n.type==='clipPath')[0];assert(clip);
  assert.equal(collect(symbol,n=>n.type==='image')[0].props.clipPath,`url(#${clip.props.id})`);
  assert.equal(collect(boss,n=>n.props.className==='paa-map-node-label').length,0);
  boss.props.onClick({stopPropagation(){}});tree=draw();
  assert.equal(collect(tree,n=>n.props.className==='paa-map-selection')[0].props['data-node-id'],nodeId);
  profile.routePaths=[{nodes:[nodeId]}];tree=draw();
  const active=collect(tree,n=>n.props['data-boss'])[0];
  assert.equal(collect(active,n=>n.props.className==='paa-map-boss-icon').length,0);
  assert.equal(collect(active,n=>n.props.className==='paa-map-node-label').length,1);
  const resource=previewForMap('1-6');resource.routePaths=[];resource.examples=[];
  assert.equal(collect(render(h,{profile:resource,compact:true}),n=>n.props.className==='paa-map-boss-icon').length,0);
});

test('unselected departure wheels stay cropped and clickable while the selected start keeps its large circle',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(tree,p)=>!tree||typeof tree!=='object'?[]:
    [...(p(tree)?[tree]:[]),...(tree.children||[]).flatMap(n=>collect(n,p))];
  const render=require('../../src/ui/maps/route_preview'),{previewForMap}=require('../../src/domain/routes/sortie_profile');
  const profile=previewForMap('6-4');profile.routePaths=[];profile.examples=[];
  let nodeId;
  const draw=(extra={})=>render(h,{profile,pathIndex:0,nodeId,compact:true,showDetails:false,onNode:id=>{nodeId=id;},...extra});
  let tree=draw();
  const starts=collect(tree,n=>n.props.className?.includes('paa-map-node ')&&n.props['aria-label']?.startsWith('出发'));
  assert.equal(starts.length,2);
  for(const start of starts){
    assert(start.props.className.includes(' inactive'));
    assert.equal(collect(start,n=>n.props.className==='paa-map-node-label').length,0);
    const icon=collect(start,n=>n.props.className==='paa-map-start-icon')[0];assert(icon);
    assert.equal(icon.props.viewBox,'1401 2542 90 90');
    const clip=collect(icon,n=>n.type==='clipPath')[0];
    assert.equal(collect(icon,n=>n.type==='image')[0].props.clipPath,`url(#${clip.props.id})`);
  }
  starts[1].props.onKeyDown({key:'Enter',preventDefault(){}});tree=draw({fixedNodes:true,idSuffix:'-expanded'});
  assert.equal(collect(tree,n=>n.props.className==='paa-map-selection')[0].props['data-node-id'],nodeId);
  const largeStarts=collect(tree,n=>n.props.role==='button'&&n.props['aria-label']?.startsWith('出发'));
  assert.equal(largeStarts.length,2);assert(largeStarts.every(n=>n.props['data-marker-pixels']===22.5));
  const largeBoss=collect(tree,n=>n.props.role==='button'&&n.props['data-boss'])[0];
  assert.equal(largeBoss.props['data-marker-pixels'],18);
  const regular=collect(tree,n=>n.props.role==='button'&&!n.props['data-boss']&&!n.props['aria-label']?.startsWith('出发'))[0];
  assert.equal(regular.props['data-marker-pixels'],8);
  const departure=Object.keys(data.maps['6-4'].lines).find(key=>key.startsWith('1>')).split('>')[1];
  profile.routePaths=[{nodes:[departure]}];tree=draw();
  const active=collect(tree,n=>n.props.className?.includes('paa-map-node active')&&n.props['aria-label']?.startsWith('出发'));
  assert.equal(active.length,1);
  assert.equal(collect(active[0],n=>n.props.className==='paa-map-start-icon').length,0);
  assert.equal(collect(active[0],n=>n.props.className==='paa-map-node-label').length,1);
  assert.equal(collect(active[0],n=>n.props.className?.split(' ').includes('paa-map-node-body'))[0].props.r,44);
  assert.equal(collect(tree,n=>n.props.className==='paa-map-start-icon').length,1);
  tree=draw({fixedNodes:true,idSuffix:'-expanded'});
  const largeActive=collect(tree,n=>n.props.className?.includes('paa-map-node active')&&n.props['aria-label']?.startsWith('出发'))[0];
  assert.equal(largeActive.props['data-marker-pixels'],24,'selected start is 50% larger');
});

test('enlarged map highlights Boss markers 50% larger without affecting ordinary nodes',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(tree,p)=>!tree||typeof tree!=='object'?[]:[...(p(tree)?[tree]:[]),...(tree.children||[]).flatMap(n=>collect(n,p))];
  const profile=require('../../src/domain/routes/sortie_profile').previewForMap('1-1');
  const tree=require('../../src/ui/maps/route_preview')(h,{profile:{...profile,routePaths:[{nodes:['A','C']}],highlightPaths:[['A','C']]},compact:true,fixedNodes:true,showDetails:false,onNode(){}});
  const boss=collect(tree,n=>n.props.role==='button'&&n.props['data-boss'])[0];
  assert(boss.props.className.includes('active'));assert.equal(boss.props['data-marker-pixels'],24);
  const node=collect(tree,n=>n.props.role==='button'&&n.props['aria-label']?.startsWith('A 点'))[0];assert.equal(node.props['data-marker-pixels'],16);
});

test('air reconnaissance remains noncombat in the map legend and markers',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(tree,predicate)=>!tree||typeof tree!=='object'?[]:
    [...(predicate(tree)?[tree]:[]),...(tree.children||[]).flatMap(child=>collect(child,predicate))];
  const profile={area:'sample',routePaths:[{nodes:['A','B','C']}],mapPreview:{
    nodes:[{id:'start',kind:'start'},{id:'A',kind:'airRecon'},{id:'B',kind:'aerialCombat'},
      {id:'C',kind:'aerialRaid'},{id:'D',kind:'airRecon'}],
    edges:[{from:'start',to:'A'},{from:'A',to:'B'},{from:'B',to:'C'},{from:'A',to:'D'}]}};
  const tree=require('../../src/ui/maps/route_preview')(h,{profile,pathIndex:0,compact:true,onNode:()=>{}});
  const nodes=collect(tree,n=>n.props.className?.includes('paa-map-node '));
  const arrows=n=>collect(n,c=>c.props.className?.includes('paa-map-air-arrow'));
  for(const n of nodes.filter(n=>n.props['data-kind']==='airRecon')){
    assert.equal(arrows(n).length,0);
    assert.equal(collect(n,c=>c.props.className==='paa-map-recon-plane').length,1);
  }
  assert.equal(arrows(nodes.find(n=>n.props['data-kind']==='aerialCombat')).length,2);
  assert.equal(arrows(nodes.find(n=>n.props['data-kind']==='aerialRaid')).length,1);
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const legend=text(collect(tree,n=>n.props.className==='paa-map-legend')[0]);
  assert(legend.includes('航空侦察'));assert(legend.includes('航空战'));assert(legend.includes('空袭'));
  assert.equal(collect(collect(tree,n=>n.props.className==='paa-map-legend')[0],
    n=>n.props.className==='paa-map-recon-plane').length,1);
  for(const n of nodes.filter(n=>n.props.className.includes(' inactive')))
    assert.equal(collect(n,c=>c.props.className==='paa-map-node-label').length,0);
});

test('5-5 legend matches unlabelled nodes and selection follows node and background actions',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(tree,predicate)=>!tree||typeof tree!=='object'?[]:
    [...(predicate(tree)?[tree]:[]),...(tree.children||[]).flatMap(child=>collect(child,predicate))];
  const render=require('../../src/ui/maps/route_preview'),profile=require('../../src/domain/routes/sortie_profile').previewForMap('5-5');
  profile.routePaths=[];profile.examples=[];
  let nodeId=null;
  const draw=(disabled=false)=>render(h,{profile,nodeId,disabled,compact:true,showDetails:false,showPaths:false,
    onNode:id=>{nodeId=id;},onBackground:()=>{nodeId=null;}});
  const nodes=tree=>collect(tree,n=>n.props.className?.includes('paa-map-node '));
  const has=cls=>n=>n.props.className?.split(' ').includes(cls);
  let tree=draw();
  const legend=collect(tree,n=>n.props.className==='paa-map-legend')[0];
  for(const entry of legend.children){
    if(!entry?.props?.['data-kind'])continue;
    const kind=entry.props['data-kind'],node=nodes(tree).find(n=>
      (n.props['data-kind']==='item'?'resources':n.props['data-kind'])===kind);
    assert(node,kind);
    assert.equal(entry.props.style['--paa-node-color'],node.props.style['--paa-node-color'],kind);
    assert.equal(entry.props.style['--paa-node-background'],node.props.style['--paa-node-background'],kind);
    assert.deepEqual(collect(entry,has('paa-map-node-body'))[0].props.style,
      collect(node,has('paa-map-node-body'))[0].props.style,kind);
  }
  const branch=nodes(tree).find(n=>n.props['data-kind']==='activeBranch');
  assert.equal(collect(branch,has('paa-map-branch-fork')).length,1);
  assert.equal(collect(nodes(tree).find(n=>n.props['data-kind']==='noBattle'),has('paa-map-branch-fork')).length,0);
  assert.equal(collect(tree,has('paa-map-selection')).length,0);
  branch.props.onClick({stopPropagation(){}});tree=draw();
  assert.equal(collect(tree,has('paa-map-selection'))[0].props['data-node-id'],'F');
  assert.equal(nodes(tree).filter(n=>n.props['aria-pressed']).length,1);
  const night=nodes(tree).find(n=>n.props['data-kind']==='nightBattle');
  night.props.onKeyDown({key:'Enter',preventDefault(){}});tree=draw();
  assert.notEqual(collect(tree,has('paa-map-selection'))[0].props['data-node-id'],'F');
  const selected=nodeId;
  nodes(draw(true)).find(n=>n.props['data-kind']==='activeBranch').props.onClick({stopPropagation(){}});
  assert.equal(nodeId,selected);
  collect(tree,n=>n.type==='svg'&&n.props.role==='group')[0].props.onClick();
  assert.equal(collect(draw(),has('paa-map-selection')).length,0);
});

test('all 37 map resource indexes retain pinned identities, valid bounds and complete node coordinates without development atlases',()=>{
  const areas=fs.readdirSync(path.join(__dirname,'../../data/normal_routes')).filter(n=>/^\d-\d\.json$/.test(n)).map(n=>n.slice(0,-5)).sort();
  assert.deepEqual(Object.keys(data.maps).sort(),areas);assert.equal(areas.length,37);
  for(const [area,map] of Object.entries(data.maps)){
    assert.equal(map.image,`${area}.png`);assert.match(map.imageEncoding.sha256,/^[a-f0-9]{64}$/);
    assert.equal(map.imageEncoding.exact,true,area);
    assert(map.imageEncoding.bytes<map.imageEncoding.sourceBytes,area);assert.match(map.imageEncoding.rgbaSha256,/^[a-f0-9]{64}$/);
    assert(map.spriteWidth>0&&map.spriteHeight>0,area);
    assert.equal(map.spriteWidth,Math.max(...map.resources.map(r=>r.width)),area);
    let offset=0;
    for(const resource of map.resources){
      assert.equal(resource.offsetY,offset,area);offset+=resource.height;
      assert.match(resource.sha256,/^[a-f0-9]{64}$/);assert.match(resource.path,/^\/kcs2\/resources\/map\/\d{3}\/\d{2}_image\d*\.png$/);
    }
    assert.equal(map.spriteHeight,offset,area);
    assert.deepEqual(map.missingCoordinates,[],area);
    assert(map.starts.length>=1,area);
    for(const spot of Object.values(map.spots))assert(spot[0]>=0&&spot[0]<=map.width&&spot[1]>=0&&spot[1]<=map.height,area);
    for(const sprite of [...map.backgrounds,...Object.values(map.lines).map(l=>l.sprite)]){
      const f=sprite.frame;assert(!sprite.rotated,area);
      assert(f.x>=0&&f.y>=0&&f.x+f.w<=map.spriteWidth&&f.y+f.h<=map.spriteHeight,area);
    }
  }
});

test('every map line has a finite on-chart display anchor and a unit local tangent',()=>{
  let lines=0;
  for(const [area,map] of Object.entries(data.maps))for(const [key,line] of Object.entries(map.lines)){
    const g=line.labelGeometry,message=`${area} ${key}`;lines++;
    assert(g&&[g.x,g.y,g.dx,g.dy].every(Number.isFinite),message);
    assert(g.x>=0&&g.x<=map.width&&g.y>=0&&g.y<=map.height,message);
    assert(Math.abs(Math.hypot(g.dx,g.dy)-1)<.000002,message);
  }
  assert.equal(lines,674);
});

test('3-5 upper and lower routes are placed on actual game coordinates without mutating navigation',()=>{
  const profile=profileForRoute('3-5',{targetNodes:['K'],pointAssessments:[
    fixed('start','B'),fixed('B','D'),fixed('H','K')]});
  const before=JSON.stringify(profile.mapPreview);
  const upper=actualMapLayout('3-5',profile.mapPreview,['B','D','H','K']);
  const lower=actualMapLayout('3-5',profile.mapPreview,['F','G','K']);
  assert.equal(upper.width,1200);assert.equal(upper.height,720);
  assert.equal(upper.startId,'start#1');assert.equal(lower.startId,'start#1');
  assert.deepEqual(upper.nodes.find(n=>n.id==='H').x,834);
  for(const edge of [['start#1','B'],['B','D'],['D','H'],['H','K'],['start#1','F'],['F','G'],['G','K']])
    assert(upper.edges.find(e=>e.from===edge[0]&&e.to===edge[1])?.sprite,edge.join('>'));
  assert.equal(JSON.stringify(profile.mapPreview),before);
  assert.equal(actualMapLayout('3-5',profile.mapPreview,['not-a-node']),null);
});

test('6-4 left and right fleets select their corresponding physical departure points',()=>{
  const preview={nodes:[{id:'start',kind:'start'},{id:'A',kind:'battle'},{id:'M',kind:'battle'}],
    edges:[{from:'start',to:'A'},{from:'start',to:'M'}]};
  const left=actualMapLayout('6-4',preview,['A']);
  const right=actualMapLayout('6-4',preview,['M']);
  assert(left&&right);assert.notEqual(left.startId,right.startId);
  assert(left.nodes.find(n=>n.id===left.startId).x<right.nodes.find(n=>n.id===right.startId).x);
});

test('multi-stage charts always include final-stage physical lines while route evaluation retains its phase',()=>{
  const {previewForMap}=require('../../src/domain/routes/sortie_profile');
  for(const [area,parts,late] of [['7-2',2,'I>M'],['7-3',2,'M>P'],['7-5',3,'P>T'],['5-6',4,'X>Z']]){
    const phases=Object.keys(require(`../../data/normal_routes/${area}.json`).bossPhases);
    const before=JSON.stringify(require(`../../data/normal_routes/${area}.json`));
    const first=actualMapLayout(area,previewForMap(area,{phase:phases[0]}).mapPreview);
    const last=actualMapLayout(area,previewForMap(area,{phase:phases.at(-1)}).mapPreview);
    assert.equal(first.displayStage,'final',area);assert.equal(last.displayStage,'final',area);
    assert.deepEqual(first.backgroundRoutes,last.backgroundRoutes,area);
    assert(first.backgroundRoutes.some(line=>line.key===late),area+' late-stage line');
    assert.equal(data.maps[area].resources.length,parts,area);
    assert.deepEqual(data.maps[area].missingLineSprites,[],area);
    assert.equal(JSON.stringify(require(`../../data/normal_routes/${area}.json`)),before,area);
  }
});

test('actual-map preview can be switched, enlarged and reports line-shape fallback honestly',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children});
  const preview={nodes:[{id:'start',kind:'start'},{id:'C',kind:'battle'},{id:'E',kind:'battle'},
    {id:'D',kind:'battle'},{id:'F',kind:'battle'}],edges:[{from:'start',to:'C'},
    {from:'C',to:'E'},{from:'E',to:'D'},{from:'D',to:'F'}]};
  const profile={area:'3-2',mapPreview:preview,examples:[['C','E','D','F']]};
  const render=require('../../src/ui/maps/route_preview'),switched=[],zoom=[];
  const tree=render(h,{profile,onMode:value=>switched.push(value),onZoom:value=>zoom.push(value),
    onPath:()=>{},onNode:()=>{}});
  const walk=(n,p)=>!n||typeof n!=='object'?null:p(n)?n:(n.children||[]).map(c=>walk(c,p)).find(Boolean);
  assert(walk(tree,n=>n.type==='svg'&&n.props['aria-label']==='实际地图上的推荐路线'));
  assert(walk(tree,n=>n.type==='span'&&n.children.includes('部分连线按节点位置标示')));
  walk(tree,n=>n.type==='button'&&n.children.includes('示意图')).props.onClick();
  walk(tree,n=>n.type==='button'&&n.children.includes('放大')).props.onClick();
  assert.deepEqual(switched,['schematic']);assert.deepEqual(zoom,[true]);
  const clips=new Set(),images=[];
  const inspect=(node,clip)=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='clipPath')clips.add(node.props.id);
    if(node.type==='image')images.push({node,clip});
    for(const child of node.children||[])inspect(child,node.props.clipPath||clip);
  };
  inspect(tree);
  assert(images.length>2);
  for(const {node,clip} of images){
    assert(clip&&clips.has(clip.slice(5,-1)),'atlas images must be cropped, including filtered route overlays');
    assert(node.props.width>1200,'full atlas needs explicit clipping');
  }
  assert.doesNotThrow(()=>render(h,{profile:null}));
});

test('5-6 phased route sprites stay beside both endpoints, including the two approaches to X and Q2',()=>{
  const map=data.maps['5-6'];
  for(const [edge,line] of Object.entries(map.lines)){
    const [from,to]=edge.split('>');
    if(map.starts.includes(from))continue;
    const {w,h}=line.sprite.sourceSize;
    for(const node of [from,to]){
      const [x,y]=map.spots[node];
      // Native dashes stop before each node circle, but cannot start at a different node.
      const gap=Math.hypot(Math.max(line.x-x,0,x-line.x-w),Math.max(line.y-y,0,y-line.y-h));
      assert(gap<=40,`${edge}: sprite is ${gap.toFixed(1)}px from ${node}`);
    }
  }
  for(const [edge,origin] of [['U>X',[862,317]],['W>X',[855,384]],['Q>Q2',[802,225]],['Q1>Q2',[832,155]]])
    assert.deepEqual([map.lines[edge].x,map.lines[edge].y],origin,edge);
});

test('5-6 third-stage U-X highlight uses the same diagonal sprite as its physical background',()=>{
  const profile=require('../../src/domain/routes/sortie_profile').previewForMap('5-6',{phase:'gauge3'});
  profile.routePaths=[{nodes:['I','O','Q','U','X','Z']}];
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...(n.children||[]).flatMap(c=>collect(c,p))];
  const tree=require('../../src/ui/maps/route_preview')(h,{profile,compact:true,onNode:()=>{}});
  const active=collect(tree,n=>n.props.className==='paa-real-route');
  const highlight=active.find(n=>n.props.key==='U>X');
  const background=collect(tree,n=>n.props.key==='muted-U>X')[0];
  assert(highlight);assert(background);assert(!active.some(n=>n.props.key==='W>X'));
  for(const line of [highlight,background]){
    assert.equal(line.children[0].props.transform,'translate(862 317)');
    const clip=collect(line,n=>n.type==='clipPath')[0].children[0].props;
    assert.deepEqual([clip.width,clip.height],[81,75]);
  }
});
