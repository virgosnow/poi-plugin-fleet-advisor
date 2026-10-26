'use strict';
const {equipmentIconUrl}=require('../models/presentation_model');
const jetIcon=require('url').pathToFileURL(require('path').join(__dirname,'../../../data/icons/material/jet-assault.svg')).href;
// Visible bounds in the existing game equipment sprites, without their transparent margins.
const frames={
  2:[5,7,36,30,45],3:[10,12,37,29,54],5:[11,16,32,22,54],
  12:[11,12,33,31,54],17:[9,10,36,34,54],
  18:[12,12,32,32,54],20:[9,19,35,16,54],25:[18,15,19,27,54],27:[10,12,30,32,54],
  31:[11,12,34,35,54],52:[10,18,34,17,54],54:[19,11,18,33,54]
};
// Alpha contour of data/icons/t3/高角砲-16.png, extracted with the same
// threshold and simplification as barrage below; keep the original gun profile.
const antiAirPath='M15 30 16 30 16 28 18 28 20 25 23 24 19 12 24 12 25 15 26 15 26 17 27 17 27 21 28 21 28 22 39 23 39 24 42 26 42 29 43 29 43 30 42 30 43 36 42 36 40 39 36 39 36 40 16 39 16 38 15 38Z';
// Alpha contour of data/icons/t3/対空機銃-15.png (threshold 128,
// 0.65px simplification). Preserve the game's barrel and turret proportions.
const barragePath='M10 11 11 11 11 12 15 11 18 15 20 15 21 17 26 18 26 19 28 19 30 16 31 16 31 17 35 16 35 17 39 18 39 19 37 20 37 29 36 29 35 34 32 35 32 36 18 35 18 34 16 33 16 31 15 31 15 24 16 24 16 23 21 23 21 21 19 20 19 18 17 18 17 17 14 16 12 13 10 13Z';
// Alpha contour of data/icons/t3/水上偵察機-10.png (threshold 128,
// 0.65px simplification), shared by night contact and night Zuiun.
const seaplanePath='M4 24 12 23 12 22 9 22 9 21 8 21 8 19 10 19 10 17 9 17 8 15 12 15 12 16 15 16 15 17 17 17 17 16 23 16 23 15 24 15 24 16 30 16 30 14 33 13 33 17 35 17 35 18 37 18 37 19 30 18 30 19 27 19 27 20 25 20 25 21 26 21 26 22 29 22 29 23 31 23 31 24 33 24 33 25 38 26 40 29 35 29 35 28 32 28 32 27 29 27 29 26 28 26 27 28 22 29 22 30 19 30 19 31 9 31 9 29 11 29 11 28 16 28 16 27 18 27 18 26 25 26 25 25 20 24 20 25 16 25 16 26 8 26 8 27 7 27 7 26 4 26Z';
const types={asw:18,'asw-synergy':17,torpedo:5,spotting:2,
  'special-shelling':3,'special-night':3,'special-submarine':5,smoke:54,illumination:27,'expedition-drums':25,'expedition-income':20};
// AI redraw from the game aircraft, then alpha-traced from the generated silhouette.
// Evidence: ../exports/aircraft-ai-20261016/provenance.json (outside the runtime package).
const aircraftPath='M476 345 503 363 537 354 584 300 607 286 640 275 670 270 701 270 729 275 754 285 874 257 894 248 906 240 846 186 840 176 843 161 862 154 885 155 988 187 996 186 1011 176 1055 69 1080 23 1103 3 1119 0 1131 4 1143 18 1149 41 1156 208 1166 224 1165 235 1158 244 1278 291 1296 304 1300 312 1298 321 1279 332 1235 333 1062 300 827 454 810 469 807 479 1066 615 1195 692 1238 724 1259 745 1271 769 1267 788 1241 807 1194 816 1149 814 1094 803 997 770 511 579 352 620 316 623 290 618 313 644 341 686 352 713 350 723 342 723 329 716 297 686 267 647 234 588 231 584 225 586 220 636 209 676 189 711 183 715 176 714 172 703 176 655 190 614 204 587 181 580 170 567 169 554 174 542 192 526 150 473 125 430 110 387 108 352 112 348 122 351 153 390 179 442 205 514 207 490 216 470 231 454 260 436 129 313 28 211 2 175 0 159 3 152 27 139 63 138 105 146 165 167 315 243Z';
function createMechanismIcon(React){
  const h=React.createElement;
  return function mechanismIcon(badge){
    if(badge.key==='speed'||badge.key==='expedition-morale'&&String(badge.label).startsWith('✦'))return null;
    if(badge.key==='ground'&&badge.categories?.length>1){
      const categories=[...new Map(badge.categories.map(c=>[c.id,c])).values()];
      return h('span',{className:'paa-wb-mechanism-icons','aria-hidden':true},
        ...categories.map(c=>h('span',{key:c.id},mechanismIcon({...badge,categories:undefined,variant:c.id}))));
    }
    const props={className:'paa-wb-mechanism-icon',width:14,height:14,'aria-hidden':true,focusable:false};
    if(badge.key==='jet-assault')return h('span',{className:props.className,'aria-hidden':true,'data-mechanism-art':'jet',
      style:{width:16,height:14,backgroundColor:'currentColor',maskImage:`url("${jetIcon}")`,maskSize:'contain',maskPosition:'center',maskRepeat:'no-repeat'}});
    // Morale has no equipment category; retain its flag and the existing sparkle above.
    if(badge.key==='expedition-morale')return h('svg',{...props,viewBox:'0 0 16 16',fill:'none',stroke:'currentColor',strokeWidth:1.35,strokeLinecap:'round',strokeLinejoin:'round'},
      h('path',{d:'M4 14V2l8 1v6L4 8M2 14h4'}));
    if(badge.key==='opening-air'&&badge.variant==='seaplane')return h('svg',{...props,width:18,viewBox:'3 12 38 20',fill:'currentColor','data-equipment-icon':10,'data-mechanism-art':'seaplane'},h('path',{d:seaplanePath}));
    if(['opening-air','carrier-ci','night-air','night-carrier-ci'].includes(badge.key)||badge.key==='ground'&&badge.variant==='aircraft'||badge.key==='asw'&&badge.effect==='aviation')
      return h('svg',{...props,width:18,viewBox:'-8 -8 1316 832',fill:'currentColor','data-mechanism-art':'aircraft'},
        h('path',{d:aircraftPath}));
    if(['night-contact','night-zuiun'].includes(badge.key))return h('svg',{...props,width:18,viewBox:'3 12 38 20',fill:'currentColor','data-equipment-icon':10,'data-mechanism-art':'seaplane'},h('path',{d:seaplanePath}));
    if(badge.key==='aaci')return h('svg',{...props,viewBox:'13 10 32 32',fill:'currentColor','data-equipment-icon':16,'data-mechanism-art':'anti-air'},h('path',{d:antiAirPath}));
    if(badge.key==='barrage')return h('svg',{...props,viewBox:'9 10 31 27',fill:'currentColor','data-equipment-icon':15,'data-mechanism-art':'barrage'},h('path',{d:barragePath}));
    let type=types[badge.key];
    if(badge.key==='ground')type=({rocket:31,landing:20,beaching:52})[badge.variant]||12;
    else if(badge.key==='night')type=badge.effect==='torpedo'||/雷击|鱼雷|主鱼|驱逐|潜水/.test(badge.label)?5:2;
    const frame=frames[type],src=equipmentIconUrl(type);
    if(!frame||!src)return null;
    const [x,y,w,height,size]=frame,edge=['asw','asw-synergy'].includes(badge.key)?13:16,scale=Math.min(edge/w,Math.min(edge,14)/height);
    // Use only the game's alpha silhouette; currentColor also follows theme and badge state.
    return h('span',{className:props.className,'aria-hidden':true,'data-equipment-icon':type,
      style:{width:16,height:14,backgroundColor:'currentColor',maskMode:'alpha',maskImage:`url("${src}")`,maskRepeat:'no-repeat',
        maskSize:`${size*scale}px ${size*scale}px`,maskPosition:`${(16-w*scale)/2-x*scale}px ${(14-height*scale)/2-y*scale}px`}});
  };
};

const groups={ground:'ground',aaci:'air',barrage:'air',asw:'asw','asw-synergy':'asw',torpedo:'torpedo',spotting:'day','opening-air':'aviation','jet-assault':'jet','carrier-ci':'day',night:'night','night-contact':'night','night-air':'night','night-carrier-ci':'night','night-zuiun':'night','special-shelling':'special','special-night':'special','special-submarine':'special',smoke:'support',illumination:'support',speed:'speed'};
// Shared by editable drafts and current fleets. Keep identity and all special
// attacks first, followed by opening, daytime and nighttime abilities.
const order={speed:0,'expedition-morale':1,'special-shelling':2,'special-submarine':2,'special-night':2,
  'jet-assault':9,torpedo:10,'opening-air':11,asw:12,'asw-synergy':13,aaci:14,barrage:15,smoke:16,
  ground:20,spotting:21,'carrier-ci':22,illumination:30,'night-contact':31,
  'night-air':33,'night-carrier-ci':33,'night-zuiun':34,night:35};
module.exports=React=>{
  const h=React.createElement,icon=createMechanismIcon(React);
  const priority=badge=>order[badge.key]??40;
  return badges=>(badges||[]).slice().sort((a,b)=>priority(a)-priority(b)).map(b=>{
    const state={estimate:'预计',unknown:'待确认',blocked:'未就绪'}[b.state],detail=b.detail||b.label;
    return h('span',{key:b.variant?`${b.key}:${b.variant}`:b.key,className:'paa-wb-mechanism','data-mechanism':b.key,'data-category':b.category||groups[b.key]||'support','data-state':b.state,'data-tier':b.key==='speed'?b.tier:undefined,'data-tooltip':detail,tabIndex:0,'aria-label':detail},
      b.key==='speed'?h('svg',{className:'paa-wb-speed-gauge',viewBox:'0 0 19 14',width:19,height:14,'aria-hidden':true,'data-tier':b.tier},
        ...[1,2,3,4].map(t=>h('rect',{key:t,x:(t-1)*5,y:14-t*3,width:3,height:t*3,rx:0.6,fill:t<=b.tier?'currentColor':'none',stroke:'currentColor',strokeWidth:0.6,opacity:t<=b.tier?1:0.28}))):null,
      icon(b),b.label,state&&!(b.key==='speed'&&b.state==='unknown')?h('small',null,state):null);
  });
};

module.exports.createIcon=createMechanismIcon;
