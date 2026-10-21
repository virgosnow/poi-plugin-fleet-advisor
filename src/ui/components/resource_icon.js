'use strict';
const path=require('path'),{pathToFileURL}=require('url');
const MATERIALS={燃料:1,弹药:2,钢材:3,铝土:4,高速建造材:5,高速修复材:6,开发资材:7,改修资材:8,'家具箱（小）':10,'家具箱（中）':11,'家具箱（大）':12};
function resourceSource(name){
  if(name==='伊良湖')return pathToFileURL(path.join(__dirname,'../../../data/icons/items/59.png')).href;
  const material=MATERIALS[name];
  return material?pathToFileURL(path.join(__dirname,'../../../data/icons/material',`0${material}.png`)).href:null;
}
module.exports=React=>function ResourceIcon({name,size=18}){
  const src=resourceSource(name);
  return React.createElement('span',{className:'paa-resource-icon','data-resource':name,'data-failed':src?undefined:true,'aria-hidden':true,style:{width:size,height:size}},
    React.createElement('span',{className:'paa-resource-icon-fallback'},name.slice(0,1)),
    src?React.createElement('img',{src,alt:'',draggable:false,
      onLoad:e=>{delete e.currentTarget.parentElement.dataset.failed;},
      onError:e=>{e.currentTarget.parentElement.dataset.failed='true';}}):null);
};
module.exports.resourceSource=resourceSource;
