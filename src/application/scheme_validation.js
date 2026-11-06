'use strict';
const {error}=require('../shared/errors');
const positive=value=>Number.isSafeInteger(value)&&value>0;

// Shape-only validation mirrors contract.js; inventory resolution follows
// against the selected snapshot in the calling service.
function validateSchemeShape(scheme) {
  if(!scheme||typeof scheme!=='object'||Array.isArray(scheme))
    throw error('INVALID_SCHEME','方案须为对象');
  if(!positive(scheme.fleet)||scheme.fleet>4)throw error('INVALID_SCHEME','fleet 须为 1–4');
  if(!Array.isArray(scheme.ships)||scheme.ships.length<1||scheme.ships.length>6)
    throw error('INVALID_SCHEME','ships 须为 1–6 个条目的数组');
  const equipment=spec=>{
    if(spec===null||positive(spec)||spec===-1)return;
    if(typeof spec==='string'&&spec.length>0)return;
    if(typeof spec==='object'&&!Array.isArray(spec)&&typeof spec.name==='string'&&spec.name.length>0
      &&(spec.star===undefined||Number.isSafeInteger(spec.star)&&spec.star>=0&&spec.star<=10)
      &&(spec.alv===undefined||Number.isSafeInteger(spec.alv)&&spec.alv>=0&&spec.alv<=7))return;
    throw error('INVALID_SCHEME','装备规格须为正实例 id、-1、名称字符串、null 或 {name, star?, alv?}');
  };
  for(const [index,entry] of scheme.ships.entries()){
    const at=`ships[${index}] `;
    if(positive(entry))continue;
    if(typeof entry==='string'&&entry.length>0)continue;
    if(!entry||typeof entry!=='object'||Array.isArray(entry))
      throw error('INVALID_SCHEME',at+'须为实例 id、名称字符串或 {id?, name?, slots?, ex?}');
    if(entry.id===undefined&&entry.name===undefined)throw error('INVALID_SCHEME',at+'缺 id/name');
    if(entry.id!==undefined&&!positive(entry.id))throw error('INVALID_SCHEME',at+'id 须为正整数');
    if(entry.name!==undefined&&!(typeof entry.name==='string'&&entry.name.length>0))
      throw error('INVALID_SCHEME',at+'name 须为非空字符串');
    if(entry.slots!==undefined){
      if(!Array.isArray(entry.slots)||entry.slots.length>5)throw error('INVALID_SCHEME',at+'slots 最多 5 个');
      entry.slots.forEach(equipment);
    }
    if(entry.ex!==undefined)equipment(entry.ex);
  }
  for(const key of Object.keys(scheme))
    if(!['fleet','ships','name','format','note'].includes(key))
      throw error('INVALID_SCHEME',`未知顶层字段: ${key}`);
}

module.exports={validateSchemeShape};
