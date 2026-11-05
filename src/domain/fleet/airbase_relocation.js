'use strict';

// Until a complete port response is observed, an apparently unowned plane can
// still be in relocation. Known ship equipment remains a valid source.
const types=new Set([6,7,8,9,10,11,25,26,41,45,47,48,49,53,56,57,58,59,91,94]);
const eligiblePlane=master=>!!master&&Array.isArray(master.api_type)&&types.has(Number(master.api_type[2]));
function unverifiedRelocation(store,itemId,sourceShipId){
  if(store?.airbaseSync?.relocationsComplete!==false||sourceShipId)return false;
  const item=store?.info?.equips?.[itemId];
  const master=store?.const?.$equips?.[item?.api_slotitem_id];
  return eligiblePlane(master);
}
module.exports={eligiblePlane,unverifiedRelocation};
