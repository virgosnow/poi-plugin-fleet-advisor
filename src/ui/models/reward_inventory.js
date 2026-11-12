'use strict';

// api_kind=13 identifies a use item; the first four are stored by poi as
// materials rather than in useitems. Names cover reviewed, name-only rewards.
const aliases={
  '高速修复材':1,'高速修復材':1,'高速建造材':2,'开发资材':3,'開發資材':3,'開発資材':3,
  '改修资材':4,'改修資材':4,'家具箱（小）':10,'家具箱（中）':11,'家具箱（大）':12,
  '间宫':54,'間宮':54,'伊良湖':59,'勋章':57,'勲章':57,'勳章':57,'改装设计图':58,'改装設計図':58,
  '新型航空兵装资材':77,'新型航空兵装資材':77,'战斗详报':78,'戦闘詳報':78,'戰鬥詳報':78,
  '南瓜':96,'海外舰最新技术':100,'海外艦最新技術':100
};
const materialIndex={1:5,2:4,3:6,4:7,31:0,32:1,33:2,34:3};
function rewardItemId(item,store){
  if(item?.kind!=null){const id=Number(item.id);return Number(item.kind)===13&&Number.isSafeInteger(id)&&id>0?id:null;}
  const name=typeof item?.name==='string'?item.name.trim():'';
  if(!name)return null;
  if(aliases[name])return aliases[name];
  // Exact master-data names are safe; ambiguous matches are not guessed.
  const matches=Object.entries(store?.const?.$useitems||{}).filter(([,value])=>value?.api_name===name)
    .map(([key])=>Number(key)).filter(id=>Number.isSafeInteger(id)&&id>0);
  return matches.length===1?matches[0]:null;
}
function rewardOwnedCount(store,id){
  if(!Number.isSafeInteger(id)||id<1)return null;
  if(id===44){const value=store?.info?.basic?.api_fcoin;return Number.isSafeInteger(value)&&value>=0?value:null;}
  if(Object.hasOwn(materialIndex,id)){
    const resources=store?.info?.resources,value=Array.isArray(resources)?resources[materialIndex[id]]:undefined;
    return Number.isSafeInteger(value)&&value>=0?value:null;
  }
  const items=store?.info?.useitems;
  if(!items||typeof items!=='object'||Array.isArray(items))return null;
  const row=items[id];if(row==null)return 0;
  const value=row?.api_count;
  return Number.isSafeInteger(value)&&value>=0?value:null;
}
module.exports={rewardItemId,rewardOwnedCount};
