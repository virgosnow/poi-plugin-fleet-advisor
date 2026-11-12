'use strict';
const panelWidth=(regionWidth,viewportWidth)=>Math.max(0,Math.min(regionWidth,viewportWidth-24));
const panelOffset=(anchorLeft,preferredLeft,width,viewportWidth)=>
  Math.max(12-anchorLeft,Math.min(preferredLeft-anchorLeft,viewportWidth-12-anchorLeft-width));
function pickerPlacement(root,viewportWidth){
  const rect=root.getBoundingClientRect();
  const width=panelWidth(rect.width,viewportWidth);
  return {rect,width,left:panelOffset(rect.left,rect.left,width,viewportWidth)};
}
module.exports={panelWidth,panelOffset,pickerPlacement};
