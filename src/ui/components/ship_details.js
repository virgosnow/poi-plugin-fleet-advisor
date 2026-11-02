'use strict';
const fields=[['火力','api_karyoku'],['雷装','api_raisou'],['对空','api_taiku'],['装甲','api_soukou'],
  ['对潜','api_taisen'],['索敌','api_sakuteki'],['回避','api_kaihi'],['运','api_lucky']];
function stats(ship){
  return fields.map(([label,key])=>{
    const raw=ship?.[key],value=Array.isArray(raw)?raw[0]:raw;
    return {label,value:typeof value==='number'&&Number.isFinite(value)?value:null};
  });
}
function toggle(setDetails,id,event){
  const card=event?.currentTarget?.closest?.('.paa-wb-ship'),grid=card?.parentElement;
  const top=card?.getBoundingClientRect().top;
  const peers=grid&&Number.isFinite(top)?Array.from(grid.children).filter(node=>
    node.classList.contains('paa-wb-ship')&&node.querySelector('.paa-fleet-portrait-toggle')&&Math.abs(node.getBoundingClientRect().top-top)<1)
    .map(node=>node.dataset.shipId).filter(Boolean):[];
  setDetails(previous=>{
    const next={...previous},open=!previous[id];
    for(const peer of peers)next[peer]=open;
    next[id]=open;return next;
  });
}
module.exports={stats,toggle};
