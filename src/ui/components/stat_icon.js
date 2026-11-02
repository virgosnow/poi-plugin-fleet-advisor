'use strict';
// Redrawn as solid vectors from the game's stat-icon silhouettes, keeping the
// game motifs legible at 14px. Reference: https://en.kancollewiki.net/Stats
const paths={
  '火力':'M1 7h6V5l1-2h4l1 1h2v6H7V9H1z M6 11h9v2H6z',
  '雷装':'M1 2h11l3 1.5L12 5H1z M1 6.5h11l3 1.5-3 1.5H1z M1 11h11l3 1.5-3 1.5H1z',
  '爆装':'M5 14C1 12 2 9 4 7c1-1 1-3 0-5 4 2 5 5 4 7 2-1 3-3 2-5 4 3 5 7 2 10-1-1-1-3-2-4 0 2-1 3-2 4-1-2-1-3-2-4-1 2-1 3-1 4z',
  '对空':'M3 14h10v-2H3z M5 12l1-3-1-2 2-1 2 1 1-2 2 1-1 3 1 3z M6 6 1 3l1-1 6 3z M10 5l1-3 2 1-1 3z',
  '对潜':'M1 6 5 3c1-.7 2-.5 3 1l1 2c.5 1 .3 2-1 3L4 12c-1 .7-2 .5-3-1L0 9C-.5 8 0 7 1 6z M7 8l4-3c1-.7 2-.5 3 1l1 2c.5 1 .3 2-1 3l-4 3c-1 .7-2 .5-3-1l-1-2c-.5-1 0-2 1-3z M3 7v2h1V7z M9 9v2h1V9z',
  '索敌':'M8 1h2v12h3v2H5v-2h3V9L1 7V4l7 2V1z M10 2l5 1v2l-5 1z M10 8h3v2h-3z',
  '装甲':'M2 1h12v14H2z M4 3v2h2V3z M10 3v2h2V3z M4 7v2h2V7z M10 7v2h2V7z M4 11v2h2v-2z M10 11v2h2v-2z',
  '回避':'M2 2h12v2H2z M12 4h2v6h-2z M1 6h8l1 6-1 2H2z M12 10h2v5h-2z M10 10h5v2h-5z M11 8h3v5h-3z',
  '运':'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1z M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M6.5 1h3l-.4 3.3H6.9z M6.5 11.7h3L9.5 15h-3z M1 6.5h3.3v3H1z M11.7 6.5H15v3h-3.3z',
  '命中':'M7 1h2v4l1 .5L13 3l1 1-2.5 3 0 1 2.5 3-1 1-3-2.5-1 .5v4H7v-4l-1-.5L3 12l-1-1 2.5-3v-1L2 4l1-1 3 2.5L7 5z',
  '射程':'M1 6 8 2l5 1-2 4-7 4z M2 8l1 2 1-1-1-2z M5 6l1 2 1-1-1-2z M2 14l10-5-1-1 4-1-1 4-1-1-10 5z',
  '航程':'M3 1h2v2H3z M0 5h2v2H0z M1 9h2v2H1z M4 12h2v2H4z M9 3l2-1 1 1-1 3 3 3-1 1-3-2-2 3 1 2-1 1-2-2-2 1-1-1 2-2-2-2 1-1 2 1 3-2-2-3 1-1z',
  '制空值':'M9 2l2-1 1 1-1 4 4 3-1 2-4-2-2 4 1 2-1 1-3-3-2 1-1-1 2-2-3-3 1-1 3 2 3-3-2-4 1-1z',
  '对爆':'M7 1h2v4l1 .5L13 3l1 1-2.5 3v1l2.5 3-1 1-3-2.5-1 .5v4H7v-4l-1-.5L3 12l-1-1 2.5-3V7L2 4l1-1 3 2.5L7 5z',
  '迎击':'M6 1 1 6h3v3a5 5 0 1 0 3-4.6V7a2.5 2.5 0 1 1-1 2V6h3z M9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
};
const attributes={viewBox:'0 0 16 16',fill:'currentColor','fill-rule':'evenodd','clip-rule':'evenodd','aria-hidden':'true',focusable:'false'};
function react(React,label){
  const d=paths[label];if(!d)return null;
  return React.createElement('svg',{className:'paa-stat-icon',viewBox:attributes.viewBox,fill:'currentColor',fillRule:'evenodd',clipRule:'evenodd',
    'aria-hidden':true,focusable:false},React.createElement('path',{d}));
}
function dom(doc,label){
  const d=paths[label];if(!d)return null;
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','paa-stat-icon');for(const [key,value] of Object.entries(attributes))svg.setAttribute(key,value);
  const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.appendChild(path);return svg;
}
module.exports={react,dom};
