'use strict';
const format=value=>JSON.stringify(value,null,2);
function parse(text){
  try {const value=JSON.parse(text);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('方案应为一个 JSON 对象');return {value};}
  catch(error){return {error:error.message};}
}
function shipName(state,id){
  if(!id||id<0)return '空位';
  const ship=state.info?.ships?.[id],master=state.const?.$ships?.[ship?.api_ship_id];
  return master?`${master.api_name} · Lv.${ship.api_lv}`:`舰船 #${id}`;
}
function progressText(p,state){
  if(p.phase==='organization-start')return '正在准备舰队编成';
  if(p.phase==='organized')return `第 ${p.slot} 位 · 已编入 ${shipName(state,p.ship)}`;
  if(p.phase==='organization-ready')return '舰队已编入 · 正在准备换装';
  if(p.phase==='equipment-start')return '正在准备逐舰换装';
  if(p.phase==='equipment-ship')return `${shipName(state,p.ship)} · 正在换装`;
  if(p.phase==='equipment-step')return `${shipName(state,p.ship)} · 已完成 ${p.completed} / ${p.total} 步`;
  if(p.phase==='equipment-done')return `${shipName(state,p.ship)} · 已换装完毕`;
  if(p.phase==='fleet-complete')return '舰队编成与换装已完成';
  if(p.phase==='clear-escorts')return `第 ${p.fleet} 舰队 · 正在解除随伴舰`;
  if(p.phase==='remove-escort')return `第 ${p.fleet} 舰队 · 正在移除第 ${p.slot} 位多余舰娘`;
  if(p.phase==='picker')return `第 ${p.slot} 位 · 正在定位 ${shipName(state,p.target)}`;
  if(p.phase==='equipment')return p.detail||`${shipName(state,p.ship)} · ${p.slot==='all'?'解除普通槽装备':p.slot==='ex'?'调整补强增设':`调整普通槽 ${p.slot}`}`;
  if(p.phase==='return-home')return '正在返回母港';
  return '正在核对游戏状态';
}
module.exports={format,parse,shipName,progressText};
