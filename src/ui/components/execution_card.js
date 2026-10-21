'use strict';
const waiting=()=>({state:'waiting',label:'等待编入',value:0});
function initial(store,fleet,index,ship){
  return store.info?.fleets?.[fleet-1]?.api_ship?.[index]===ship?
    {state:'organized',label:'已编入 · 等待换装',value:30}:waiting();
}
function advance(previous,event,{fleet,index,ship}){
  if(event.fleet!==undefined&&event.fleet!==fleet)return previous;
  if(event.phase==='clear-escorts'&&index>0)return waiting();
  if(event.phase==='picker'&&event.target===ship)return {state:'active',label:'正在编入',value:15};
  if((event.phase==='organized'&&event.ship===ship)||event.phase==='organization-ready')
    return {state:'organized',label:'已编入 · 等待换装',value:30};
  if(event.phase==='equipment-start')return event.completed?.includes(ship)?
    {state:'done',label:'已换装完毕',value:100}:{state:'organized',label:'等待换装',value:30};
  if((event.phase==='equipment-done'&&event.ship===ship)||event.phase==='fleet-complete')
    return {state:'done',label:'已换装完毕',value:100};
  if(event.ship===ship&&['equipment-ship','equipment','equipment-step'].includes(event.phase)){
    const value=35+Math.round(60*Math.min(1,(event.completed||0)/Math.max(1,event.total||1)));
    return {state:'active',label:event.operation==='clear'?'正在卸下装备':'正在换装',value};
  }
  return previous;
}
module.exports=(React,{subscribe,getStore})=>{
  const h=React.createElement;
  return function ExecutionCard({running,stopping,fleet,index,ship}){
    const [progress,setProgress]=React.useState(null);
    React.useEffect(()=>{
      if(!running){setProgress(null);return;}
      setProgress(initial(getStore(),fleet,index,ship));
      return subscribe?.(event=>setProgress(previous=>advance(previous||waiting(),event,{fleet,index,ship})));
    },[running,fleet,index,ship]);
    if(!running)return null;
    const current=progress||initial(getStore(),fleet,index,ship);
    return h('div',{className:'paa-wb-execution-card','data-state':current.state,role:'progressbar',
      'aria-label':'编成进度','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':current.value,
      'aria-valuetext':current.label,style:{'--paa-execution-progress':`${current.value}%`}},
      h('span',{className:'paa-wb-execution-label'},current.state==='active'?
        h('span',{className:'paa-wb-calculation-spinner','aria-hidden':true}):
        current.state==='done'?h('span',{'aria-hidden':true},'✓'):null,
        stopping&&current.state==='active'?'正在停止…':current.label));
  };
};
module.exports.initial=initial;
module.exports.advance=advance;
