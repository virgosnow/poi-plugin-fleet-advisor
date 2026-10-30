'use strict';
const path=require('path'),{pathToFileURL}=require('url');
const manifest=require('../../../data/sortie/maps/index.json');
const common=require('../../../data/sortie/maps/map_common.json');
const commonSource=require('../../../data/sortie/maps/map_common.source.json');
const bossSymbol={image:pathToFileURL(path.join(__dirname,'../../../data/sortie/maps/map_common.png')).href,
  frame:common.frames[commonSource.bossFrame].frame,width:common.meta.size.w,height:common.meta.size.h};
const startSymbol={...bossSymbol,frame:common.frames[commonSource.startFrame].frame};
const bossDisplaySymbol={image:pathToFileURL(path.join(__dirname,'../../../data/sortie/maps/boss_marker.png')).href,
  frame:{x:0,y:0,w:62,h:65},width:62,height:65};

// Coordinates and route sprites are display data only. Never use this module
// to add exits to the navigation engine or promote an uncertain route.
function actualMapLayout(area,preview,selectedPath=[],asset){
  const map=manifest.maps[area];if(!map||!preview?.nodes?.length)return null;
  if(selectedPath.some(id=>!map.spots[id]))return null;
  const startsFor=to=>map.starts.filter(start=>map.lines[`${start}>${to}`]);
  const initial=startsFor(selectedPath[0]);
  if(selectedPath.length&&initial.length!==1)return null;
  const previewNodes=new Map(preview.nodes.map(n=>[n.id,n]));
  const nodes=Object.entries(map.spots).map(([id,spot])=>{
    const start=map.starts.includes(id),key=start?`start#${id}`:id;
    return {...(previewNodes.get(start?'start':id)||{kind:'unknown',enemies:[],threatStatus:'unknown',
      dataWarnings:['该点未纳入已校订的带路图，不能据此判断可达性']}),
      id:key,label:start?map.starts.length>1?`起${id}`:'起':id,x:spot[0],y:spot[1]};
  });
  const edges=(preview.edges||[]).flatMap(edge=>{
    if(edge.from==='start')return startsFor(edge.to).map(start=>({...edge,from:`start#${start}`,
      sprite:map.lines[`${start}>${edge.to}`]}));
    return map.spots[edge.from]&&map.spots[edge.to]?[{...edge,sprite:map.lines[`${edge.from}>${edge.to}`]||null}]:[];
  });
  return {width:map.width,height:map.height,nodes,edges,
    startId:initial.length===1?`start#${initial[0]}`:nodes.find(n=>n.id.startsWith('start#'))?.id,
    // Always display the fully expanded chart. Route/gauge phase only affects
    // highlight and navigation evaluation, never which physical lines exist.
    displayStage:'final',backgrounds:map.backgrounds,spriteWidth:map.spriteWidth,spriteHeight:map.spriteHeight,
    // Physical route sprites only mute lines already present on the game map.
    // They are display data, not additional navigable edges.
    backgroundRoutes:Object.entries(map.lines).map(([key,route])=>({key,...route})),
    // Without a loading state, expose geometry only. Runtime images always
    // come from the verified persistent cache, never the development atlases.
    image:asset?.parts?.[0]?.image,images:asset?.parts||[],
    source:map.source.kind==='gamePhasedAtlas'?map.source.url:manifest.source.repository,real:true};
}
module.exports={actualMapLayout,bossSymbol,startSymbol,bossDisplaySymbol};
