'use strict';
const path=require('path'),{pathToFileURL}=require('url');
const {rewardItemId}=require('../models/reward_inventory');
const MATERIALS={燃料:1,弹药:2,钢材:3,铝土:4,高速建造材:5,高速修复材:6,开发资材:7,改修资材:8,'家具箱（小）':10,'家具箱（中）':11,'家具箱（大）':12};
// Four master-data entries have no standalone game card. Keep the fallback
// rather than borrowing an unrelated icon for those IDs.
const NO_CARD=new Set([50,53,76,103]);
const ITEM_MATERIALS={1:6,2:5,3:7,4:8,10:10,11:11,12:12,31:1,32:2,33:3,34:4};
function resourceSource(name,itemId){
  const id=Number(itemId)||rewardItemId({name});
  if(id===44||id>=49&&id<=105&&!NO_CARD.has(id))return pathToFileURL(path.join(__dirname,'../../../data/icons/items',`${id}.png`)).href;
  const material=ITEM_MATERIALS[id]||MATERIALS[name];
  return material?pathToFileURL(path.join(__dirname,'../../../data/icons/material',`0${material}.png`)).href:null;
}
module.exports=React=>function ResourceIcon({name,size=18,itemId}){
  const src=resourceSource(name,itemId);
  return React.createElement('span',{className:'paa-resource-icon','data-resource':name,'data-failed':src?undefined:true,'aria-hidden':true,style:{width:size,height:size}},
    React.createElement('span',{className:'paa-resource-icon-fallback'},name.slice(0,1)),
    src?React.createElement('img',{src,alt:'',draggable:false,
      onLoad:e=>{delete e.currentTarget.parentElement.dataset.failed;},
      onError:e=>{e.currentTarget.parentElement.dataset.failed='true';}}):null);
};
module.exports.resourceSource=resourceSource;
