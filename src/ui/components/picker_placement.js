'use strict';
const PANEL_BLEED=4;
const panelWidth=(regionWidth,viewportWidth)=>Math.max(0,Math.min(regionWidth,viewportWidth-24));
const panelOffset=(anchorLeft,preferredLeft,width,viewportWidth)=>
  Math.max(12-anchorLeft,Math.min(preferredLeft-anchorLeft,viewportWidth-12-anchorLeft-width));
function pickerPlacement(root,viewportWidth){
  const rect=root.getBoundingClientRect(),region=root.closest('.paa-area-picker')?.getBoundingClientRect();
  const bleed=region?PANEL_BLEED:0;
  const width=panelWidth((region?.width??rect.width)+bleed*2,viewportWidth);
  return {rect,width,left:panelOffset(rect.left,(region?.left??rect.left)-bleed,width,viewportWidth)};
}
module.exports={panelWidth,panelOffset,pickerPlacement};
