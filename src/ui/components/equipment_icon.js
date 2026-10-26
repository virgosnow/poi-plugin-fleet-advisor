'use strict';
const {equipmentTooltip,equipmentTooltipProps}=require('../models/presentation_model');
// The panel owns the delayed tooltip for all equipment icons and controls.
module.exports=function createEquipmentIcon(React){
  const h=React.createElement;
  return function EquipmentIcon({item}){
    const tooltip=equipmentTooltip(item);
    return h('span',{className:'paa-equipment-icon'+(item.extra?' is-expansion':''),
      ...equipmentTooltipProps(item),'aria-label':tooltip,tabIndex:0},
      h('span',{'aria-hidden':true},item.name.slice(0,2)),
      item.icon?h('img',{src:item.icon,alt:'',onError:e=>{e.currentTarget.style.display='none';}}):null,
      item.extra?h('small',{'aria-hidden':true},'增'):null);
  };
};
