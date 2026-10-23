'use strict';

const FONT_SIZE=11,EXPANDED_FONT_SIZE=13,HEIGHT=18,EXPANDED_HEIGHT=20,GAP=4;
const isStart=id=>id==='start'||String(id).startsWith('start#');
const edgeKey=edge=>`${edge.from}>${edge.to}`;
const sameFrom=(a,b)=>a===b||isStart(a)&&isStart(b);

// Start sprites belong to physical departure points. Resolve each first exit
// independently rather than borrowing the first highlighted path's start ID.
function selectedEdges(layout,travels){
  const selected=new Set();
  for(const path of travels||[])for(let i=1;i<path.length;i++){
    const from=path[i-1],to=path[i];
    const candidates=(layout.edges||[]).filter(edge=>edge.to===to&&sameFrom(edge.from,from));
    const edge=candidates.length===1?candidates[0]:candidates.find(item=>item.from===from);
    if(edge)selected.add(edgeKey(edge));
  }
  return selected;
}

function edgeAnchor(edge,a,b){
  const geometry=edge.sprite?.labelGeometry;
  if(geometry&&[geometry.x,geometry.y,geometry.dx,geometry.dy].every(Number.isFinite))
    return {x:geometry.x,y:geometry.y};
  const route=edge.sprite,frame=route?.sprite;
  const visible=frame?.spriteSourceSize,size=frame?.sourceSize;
  if(route&&Number.isFinite(route.x)&&Number.isFinite(route.y)&&
    (visible?.w>0&&visible?.h>0||size?.w>0&&size?.h>0)){
    return {x:route.x+(visible?.x||0)+(visible?.w||size.w)/2,
      y:route.y+(visible?.y||0)+(visible?.h||size.h)/2};
  }
  // Match the fallback renderer's shortened quadratic curve, including its
  // horizontal bend on vertical edges. Geometry never supplies route odds.
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
  return {x:(a.x+b.x-dx/length*16)/2+(Math.abs(dx)<5?15:0),
    y:(a.y+b.y-dy/length*16)/2};
}

function probabilityMarkers(h,{layout,travels,probabilities=[],fixedNodes=false}={}){
  if(!layout||!Array.isArray(probabilities))return [];
  const selected=selectedEdges(layout,travels),positions=new Map(layout.nodes.map(node=>[node.id,node]));
  const markers=[],seen=new Set();
  for(const edge of layout.edges||[]){
    const key=edgeKey(edge);if(!selected.has(key)||seen.has(key))continue;
    const matching=probabilities.filter(row=>row.to===edge.to&&sameFrom(row.from,edge.from));
    const value=matching[0]?.probability;
    // A single displayed percentage must describe this exit under every
    // selected history. Fixed, impossible and unresolved exits need no badge.
    if(!(value>0&&value<1)||!Number.isFinite(value)||matching.some(row=>row.probability!==value))continue;
    const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)continue;
    seen.add(key);
    const anchor=edgeAnchor(edge,a,b),geometry=edge.sprite?.labelGeometry;
    const verified=geometry&&[geometry.x,geometry.y,geometry.dx,geometry.dy].every(Number.isFinite)&&Math.hypot(geometry.dx,geometry.dy)>0;
    const fontSize=fixedNodes?EXPANDED_FONT_SIZE:FONT_SIZE,height=fixedNodes?EXPANDED_HEIGHT:HEIGHT;
    const text=`${Math.round(value*1000)/10}%`,width=text.length*6.5*(fontSize/FONT_SIZE)+(fixedNodes?10:6);
    const label=`${isStart(edge.from)?'出发':edge.from}→${edge.to}：${text}`;
    markers.push(h('g',{key:`probability-${key}`,className:'paa-map-probability',
      role:'img','aria-label':label,'data-edge':key,'data-probability':value,
      'data-probability-x':anchor.x,'data-probability-y':anchor.y,
      'data-probability-from-x':a.x,'data-probability-from-y':a.y,
      'data-probability-to-x':b.x,'data-probability-to-y':b.y,
      'data-probability-dx':verified?geometry.dx:b.x-a.x,'data-probability-dy':verified?geometry.dy:b.y-a.y,
      'data-probability-geometry':!!verified||!layout.real,
      'data-probability-width':width,'data-probability-height':height,'data-probability-font-size':fontSize,visibility:'hidden',
      style:{pointerEvents:'none',userSelect:'none'},
      transform:`translate(${anchor.x} ${anchor.y})`},
    h('path',{className:'paa-map-probability-leader-shadow',
      style:{fill:'none',stroke:'#102332',strokeWidth:fixedNodes?3:4,strokeLinecap:'round',pointerEvents:'none'}}),
    h('path',{className:'paa-map-probability-leader',
      style:{fill:'none',stroke:fixedNodes?'#8ce9ed':'#b4faff',strokeWidth:fixedNodes?1:1.8,strokeLinecap:'round',pointerEvents:'none'}}),
    h('circle',{className:'paa-map-probability-anchor',r:fixedNodes?2:3.2,
      style:{fill:fixedNodes?'#9df5f6':'#c7ffff',stroke:'#102332',strokeWidth:1,pointerEvents:'none'}}),
    h('rect',{className:'paa-map-probability-background',x:-width/2,y:-height/2,width,height,rx:4,
      style:{fill:fixedNodes?'#122334f5':'#152334e8',stroke:fixedNodes?'#9be9edb3':'#83e0e56b',strokeWidth:fixedNodes?1:.7,pointerEvents:'none'}}),
    h('text',{className:'paa-map-probability-text',x:0,y:0,textAnchor:'middle',dominantBaseline:'central',
      style:{fill:fixedNodes?'#f0fdff':'#d5f8fb',fontSize,fontWeight:fixedNodes?700:600,fontFamily:'sans-serif',
        fontVariantNumeric:'tabular-nums',stroke:'none',paintOrder:'stroke',strokeLinejoin:'round',pointerEvents:'none'}},text)));
  }
  return markers;
}

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function nodeRadius(node,real,compact,fixedNodes,scale){
  const large=node.boss||isStart(node.id);
  if(compact&&fixedNodes)return node.active?16:large?12:8;
  if(compact)return (node.active?(real?44:16):large?(real?30.5:11):(real?14:6))*scale;
  return (real?25:14)*scale;
}
function overlapPenalty(rect,nodes,placed){
  let penalty=0;
  for(const node of nodes){
    const dx=Math.max(Math.abs(rect.x-node.x)-rect.width/2,0),
      dy=Math.max(Math.abs(rect.y-node.y)-rect.height/2,0);
    const overlap=node.radius+GAP-Math.hypot(dx,dy);
    if(overlap>0)penalty+=overlap*overlap;
  }
  for(const other of placed){
    const w=(rect.width+other.width)/2+GAP-Math.abs(rect.x-other.x),
      h=(rect.height+other.height)/2+GAP-Math.abs(rect.y-other.y);
    if(w>0&&h>0)penalty+=w*h;
  }
  return penalty;
}

const segmentDistance=(x,y,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length?clamp(((x-a[0])*dx+(y-a[1])*dy)/length,0,1):0;
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
};
const routeDistance=(a,b,c,d)=>{
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  if(Math.max(a[0],b[0])>=Math.min(c[0],d[0])&&Math.max(c[0],d[0])>=Math.min(a[0],b[0])&&
    Math.max(a[1],b[1])>=Math.min(c[1],d[1])&&Math.max(c[1],d[1])>=Math.min(a[1],b[1])&&
    cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return 0;
  return Math.min(segmentDistance(...a,c,d),segmentDistance(...b,c,d),segmentDistance(...c,a,b),segmentDistance(...d,a,b));
};
// Only the intended line may touch the leader inside its 4px landing dot.
const outsideAnchor=(a,b,anchor)=>{
  const inside=p=>Math.hypot(p[0]-anchor[0],p[1]-anchor[1])<4;
  if(inside(a)&&inside(b))return null;
  const trim=(p,q)=>{
    const dx=q[0]-p[0],dy=q[1]-p[1],x=p[0]-anchor[0],y=p[1]-anchor[1],aa=dx*dx+dy*dy,bb=2*(x*dx+y*dy);
    const t=(-bb+Math.sqrt(Math.max(0,bb*bb-4*aa*(x*x+y*y-16))))/(2*aa);
    return [p[0]+t*dx,p[1]+t*dy];
  };
  return [inside(a)?trim(a,b):a,inside(b)?trim(b,a):b];
};
const routeKey=key=>String(key||'').replace(/^start#/,'');
function routeObstacles(layout){
  const rows=layout.backgroundRoutes||layout.edges.map(edge=>({key:edgeKey(edge),...edge.sprite}));
  return rows.flatMap(row=>{
    const points=row.labelGeometry?.path;
    return Array.isArray(points)&&points.length>1&&points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))?
      [{key:routeKey(row.key),points}]:[];
  });
}

// Nodes and text take priority. Among safe leaders, avoid every physical
// route corridor, including gaps between dashes and unselected grey routes.
function probabilityLeader(connector,rect,nodes,others,width,height,routes=[],ownEdge=''){
  const {x,y,endX,endY}=connector,dx=endX-x,dy=endY-y,length=Math.hypot(dx,dy)||1;
  const circles=nodes.filter(node=>Math.hypot(rect.x+x-node.x,rect.y+y-node.y)>node.radius+2);
  const boxes=others.filter(box=>Math.abs(rect.x+x-box.x)>box.width/2||Math.abs(rect.y+y-box.y)>box.height/2).concat(rect);
  const steps=Math.min(48,Math.max(12,Math.ceil(length/3)));
  const penalty=control=>{
    let total=0,previous=[rect.x+x,rect.y+y];const hits=new Set(),anchor=previous;
    for(let i=1;i<=steps;i++){
      const t=i/steps,u=1-t,px=rect.x+u*u*x+2*u*t*control.x+t*t*endX,
        py=rect.y+u*u*y+2*u*t*control.y+t*t*endY;
      total+=Math.max(0,2-px,px-width+2)**2+Math.max(0,2-py,py-height+2)**2;
      for(const node of circles)total+=Math.max(0,node.radius+2-Math.hypot(px-node.x,py-node.y))**2;
      for(const box of boxes){
        const padding=box===rect?0:3,w=box.width/2+padding-Math.abs(px-box.x),h=box.height/2+padding-Math.abs(py-box.y);
        if(w>1e-6&&h>1e-6)total+=Math.min(w,h)**2;
      }
      if(total)return {hard:total,crossings:hits.size};
      const point=[px,py];
      for(const route of routes){
        if(hits.has(route.key))continue;
        const segment=route.key===ownEdge?outsideAnchor(previous,point,anchor):[previous,point];
        if(segment&&route.points.some((p,j)=>j&&
          Math.max(segment[0][0],segment[1][0])+3>=Math.min(route.points[j-1][0],p[0])&&
          Math.min(segment[0][0],segment[1][0])-3<=Math.max(route.points[j-1][0],p[0])&&
          Math.max(segment[0][1],segment[1][1])+3>=Math.min(route.points[j-1][1],p[1])&&
          Math.min(segment[0][1],segment[1][1])-3<=Math.max(route.points[j-1][1],p[1])&&
          routeDistance(...segment,route.points[j-1],p)<3))hits.add(route.key);
      }
      previous=point;
    }
    return {hard:total,crossings:hits.size};
  };
  const middle={x:(x+endX)/2,y:(y+endY)/2};
  let control=null,best=penalty(middle),bendCost=0;
  if(best.hard||best.crossings)for(const bend of [12,-12,24,-24,40,-40,56,-56]){
    const candidate={x:middle.x-dy/length*bend,y:middle.y+dx/length*bend},value=penalty(candidate);
    if(value.hard||best.hard===0&&value.crossings>=best.crossings)continue;
    control=candidate;best=value;bendCost=Math.abs(bend);
    if(!best.crossings)break;
  }
  let pathLength=length;
  if(control){
    let previous=[x,y];pathLength=0;
    for(let i=1;i<=24;i++){
      const t=i/24,u=1-t,point=[u*u*x+2*u*t*control.x+t*t*endX,u*u*y+2*u*t*control.y+t*t*endY];
      pathLength+=Math.hypot(point[0]-previous[0],point[1]-previous[1]);previous=point;
    }
  }
  return {...connector,...best,length:pathLength,bend:bendCost,path:control?
    `M ${x} ${y} Q ${control.x} ${control.y} ${endX} ${endY}`:
    `M ${x} ${y} L ${endX} ${endY}`};
}

// Screen-space placement keeps type legible at both map sizes. Candidate
// offsets stay beside the same line and avoid node circles and earlier labels.
function placeProbabilityLabels({labels,nodes,routes=[],width,height,scale=1,real=false,compact=false,fixedNodes=false}){
  if(!(scale>0))return [];
  const circles=nodes.map(node=>({x:node.x*scale,y:node.y*scale,
    radius:nodeRadius(node,real,compact,fixedNodes,scale)}));
  const screenRoutes=routes.map(route=>({...route,key:routeKey(route.key),points:route.points.map(p=>p.map(n=>n*scale))}));
  const placed=[],choices=[];
  for(const label of labels){
    const labelHeight=label.height??HEIGHT;
    const ax=label.x*scale,ay=label.y*scale,dx=label.dx??label.toX-label.fromX,dy=label.dy??label.toY-label.fromY,
      length=Math.hypot(dx,dy)||1,tx=dx/length,ty=dy/length;
    let nx=-ty,ny=tx;if(ny>0||ny===0&&nx<0){nx=-nx;ny=-ny;}
    const inline={x:ax,y:ay,width:label.width,height:labelHeight,mode:'inline',angle:0};
    const inside=rect=>rect.x-rect.width/2>=3&&rect.y-rect.height/2>=3&&
      rect.x+rect.width/2<=width*scale-3&&rect.y+rect.height/2<=height*scale-3;
    if(fixedNodes&&label.geometry&&inside(inline)&&!overlapPenalty(inline,circles,placed)){
      placed.push(inline);choices.push([]);continue;
    }
    let best;const candidates=[];
    const offsets=fixedNodes?[18,-18,27,-27,36,-36,48,-48]:[24,-24,33,-33,42,-42,54,-54];
    const positions=offsets.flatMap(distance=>[0,-14,14,-28,28].map(along=>[nx*distance+tx*along,ny*distance+ty*along]));
    if(!fixedNodes)for(let i=0;i<24;i++){
      const angle=i*Math.PI/12,ux=Math.cos(angle),uy=Math.sin(angle),
        border=Math.min(label.width/2/Math.abs(ux||1e-9),labelHeight/2/Math.abs(uy||1e-9));
      for(const gap of [6,9,12,18,24,30,36])positions.push([ux*(border+gap),uy*(border+gap)]);
    }
    for(const [offsetX,offsetY] of positions){
      const x=clamp(ax+offsetX,label.width/2+3,Math.max(label.width/2+3,width*scale-label.width/2-3)),
        y=clamp(ay+offsetY,labelHeight/2+3,Math.max(labelHeight/2+3,height*scale-labelHeight/2-3));
      const rect={x,y,width:label.width,height:labelHeight,mode:'callout',angle:0};
      const gap=Math.max(Math.abs(x-ax)/(label.width/2),Math.abs(y-ay)/(labelHeight/2));
      if(gap<=1||Math.hypot(x-ax,y-ay)*(1-1/gap)<6-1e-6)continue;
      candidates.push(rect);
      const score=overlapPenalty(rect,circles,placed)*10000+
        (x-ax)**2+(y-ay)**2+(offsetY>0?1:0);
      if(!best||score<best.score)best={...rect,score};
    }
    if(!best){best={...inline,mode:'callout'};candidates.push(best);}
    placed.push(best);choices.push(candidates);
  }
  const connect=(rect,label,others)=>{
    const x=label.x*scale-rect.x,y=label.y*scale-rect.y;
    const edge=Math.max(Math.abs(x)/(label.width/2),Math.abs(y)/(rect.height/2));
    return rect.mode==='callout'&&label.geometry&&edge>1?
      probabilityLeader({x,y,endX:x/edge,endY:y/edge},rect,circles,others,width*scale,height*scale,screenRoutes,routeKey(label.edge)):null;
  };
  const better=(a,b)=>{
    for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>.01)return a[i]<b[i];
    return false;
  };
  const arrangement=rects=>{
    const leaders=rects.map((rect,i)=>connect(rect,labels[i],rects.filter((_,j)=>i!==j)));
    return [rects.reduce((n,rect,i)=>n+overlapPenalty(rect,circles,rects.filter((_,j)=>i!==j))+(leaders[i]?.hard||0),0),
      leaders.reduce((n,leader)=>n+(leader?.crossings||0),0),Math.max(0,...leaders.map(leader=>leader?.length||0)),
      leaders.reduce((n,leader)=>n+(leader?.length||0),0),
      rects.reduce((n,rect,i)=>n+(rect.x-labels[i].x*scale)**2+(rect.y-labels[i].y*scale)**2,0)];
  };
  // Repositioning a later label must not force an earlier leader across a
  // route. Two bounded passes improve the whole arrangement together.
  let quality=screenRoutes.length?arrangement(placed):null;
  if(screenRoutes.length)for(let pass=0;pass<2;pass++)for(let i=0;i<placed.length;i++){
    const label=labels[i],current=placed[i],others=placed.filter((_,j)=>i!==j),leader=connect(current,label,others);
    if(!leader)continue;
    const centerDistance=rect=>(rect.x-label.x*scale)**2+(rect.y-label.y*scale)**2;
    let best={rect:current,leader,overlap:overlapPenalty(current,circles,others),distance:centerDistance(current)};
    const candidates=choices[i].slice();
    for(const dx of [-4,-2,0,2,4])for(const dy of [-4,-2,0,2,4]){
      const rect={...current,x:current.x+dx,y:current.y+dy};
      if(rect.x-rect.width/2>=3&&rect.y-rect.height/2>=3&&
        rect.x+rect.width/2<=width*scale-3&&rect.y+rect.height/2<=height*scale-3)candidates.push(rect);
    }
    for(const rect of candidates){
      const overlap=overlapPenalty(rect,circles,others);if(overlap>best.overlap)continue;
      const x=label.x*scale-rect.x,y=label.y*scale-rect.y,
        edge=Math.max(Math.abs(x)/(label.width/2),Math.abs(y)/(rect.height/2)),
        directLength=Math.hypot(x,y)*(1-1/edge);
      if(directLength<6-1e-6||best.leader.hard===0&&best.leader.crossings===0&&directLength>best.leader.length+.01)continue;
      const candidate=connect(rect,label,others);if(!candidate)continue;
      const distance=centerDistance(rect);
      if(overlap<best.overlap||candidate.hard<best.leader.hard||candidate.hard===best.leader.hard&&
        (candidate.crossings<best.leader.crossings||candidate.crossings===best.leader.crossings&&
          (candidate.length<best.leader.length-.01||Math.abs(candidate.length-best.leader.length)<=.01&&distance<best.distance))){
        const trial=placed.slice();trial[i]=rect;const score=arrangement(trial);
        if(better(score,quality)){best={rect,leader:candidate,overlap,distance};quality=score;}
      }
    }
    placed[i]=best.rect;
  }
  return placed.map((rect,i)=>{
    const label=labels[i],connector=connect(rect,label,placed.filter((_,j)=>i!==j));
    return {...label,x:rect.x/scale,y:rect.y/scale,inverseScale:1/scale,mode:rect.mode,angle:rect.angle,connector,
      screenRect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  });
}

function layoutProbabilityLabels(svg,layout,compact=false,fixedNodes=false){
  const elements=Array.from(svg.querySelectorAll('.paa-map-probability'));if(!elements.length)return;
  const matrix=svg.getScreenCTM(),scale=matrix&&Math.hypot(matrix.a,matrix.b);if(!(scale>0))return;
  const rendered=Array.from(svg.querySelectorAll('.paa-map-node'));
  const nodes=layout.nodes.map((node,i)=>({...node,active:rendered[i]?
    rendered[i].classList.contains('active'):true}));
  const labels=elements.map(element=>{
    const d=element.dataset;
    return {edge:d.edge,x:Number(d.probabilityX),y:Number(d.probabilityY),width:Number(d.probabilityWidth),
      height:Number(d.probabilityHeight)||HEIGHT,fontSize:Number(d.probabilityFontSize)||FONT_SIZE,
      dx:Number(d.probabilityDx),dy:Number(d.probabilityDy),geometry:d.probabilityGeometry==='true',
      fromX:Number(d.probabilityFromX),fromY:Number(d.probabilityFromY),
      toX:Number(d.probabilityToX),toY:Number(d.probabilityToY)};
  });
  const placed=placeProbabilityLabels({labels,nodes,routes:routeObstacles(layout),width:layout.width,height:layout.height,
    scale,real:layout.real,compact,fixedNodes});
  placed.forEach((label,i)=>{
    elements[i].setAttribute('transform',`translate(${label.x} ${label.y}) scale(${label.inverseScale})`);
    elements[i].setAttribute('data-mode',label.mode);
    const element=elements[i];
    element.querySelector('.paa-map-probability-background')?.setAttribute('display','inline');
    const text=element.querySelector('.paa-map-probability-text');
    if(text){
      text.style.stroke='none';text.style.strokeWidth='0';
      text.setAttribute('transform',`rotate(${label.angle})`);
    }
    for(const selector of ['.paa-map-probability-leader-shadow','.paa-map-probability-leader']){
      const line=element.querySelector(selector);if(!line)continue;
      line.setAttribute('display',label.connector?'inline':'none');
      if(label.connector)line.setAttribute('d',label.connector.path);
    }
    const dot=element.querySelector('.paa-map-probability-anchor');
    if(dot){dot.setAttribute('display',label.connector?'inline':'none');
      if(label.connector){dot.setAttribute('cx',label.connector.x);dot.setAttribute('cy',label.connector.y);}}
    elements[i].setAttribute('visibility','visible');
  });
}

module.exports={probabilityMarkers,layoutProbabilityLabels,placeProbabilityLabels,edgeAnchor};
