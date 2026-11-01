'use strict';

// A draft can be prepared for a fleet that is currently away. Keep its real
// members in a separate busy entry so they and their equipment stay excluded
// from planning; this view is never used for game execution.
module.exports=function expeditionPlanningStore(store,fleet){
  const fleets=store?.info?.fleets,target=Number.isInteger(fleet)&&fleet>=1&&fleet<=4?fleets?.[fleet-1]:null;
  const state=Number(target?.api_mission?.[0]);
  if(!target||!Array.isArray(target.api_mission)||!Number.isFinite(state)||state<=0)return store;
  const projected=fleets.slice();
  projected[fleet-1]={...target,api_ship:[],api_mission:[0,0,0]};
  projected.push(target);
  return {...store,info:{...store.info,fleets:projected}};
};
