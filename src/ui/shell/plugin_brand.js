'use strict';

// Fleet Advisor: a naval anchor with a command star, drawn for small toolbar sizes.
// One filled contour string keeps poi's native Font Awesome renderer monochrome.
const title='舰队参谋',englishTitle='Fleet Advisor';
const glyphPath="M32 13A6 6 0 1 1 20 13A6 6 0 1 1 32 13ZM29 13A3 3 0 1 0 23 13A3 3 0 1 0 29 13ZM23 18H29V23H35A3 3 0 0 1 35 29H29V45.8C36.4 44.7 42 40 44.2 33.5L38.8 35L46.5 25.7Q47.4 24.6 47.7 26C50 39 43.9 48.6 29 51.6L26 56L23 51.6C8.1 48.6 2 39 4.3 26Q4.6 24.6 5.5 25.7L13.2 35L7.8 33.5C10 40 15.6 44.7 23 45.8V29H17A3 3 0 0 1 17 23H23ZM48 1L50.6 7.3L57.4 7.8L52.2 12.2L53.8 18.8L48 15.3L42.2 18.8L43.8 12.2L38.6 7.8L45.4 7.3Z";
const icon=Object.freeze({prefix:'fas',iconName:'paa-fleet-advisor',icon:Object.freeze([60,60,[],'e900',glyphPath])});
const sourceSvg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="64" height="64" fill="currentColor"><path d="${glyphPath}"/></svg>`;
// Optical enlargement for the compact badge; keep poi's layout slots unchanged.
const styleId='paa-plugin-icon-style';
const style='svg.svg-inline--fa[data-prefix="fas"][data-icon="paa-fleet-advisor"]{transform:scale(1.3);transform-origin:center;overflow:visible}';
const register=(library,document)=>{
  library.add(icon);
  if(!document?.head)return;
  let node=document.getElementById(styleId);
  if(!node){node=document.createElement('style');node.id=styleId;document.head.appendChild(node);}
  node.textContent=style;
};
const unregister=document=>document?.getElementById(styleId)?.remove();
module.exports={title,englishTitle,icon,sourceSvg,style,register,unregister};
