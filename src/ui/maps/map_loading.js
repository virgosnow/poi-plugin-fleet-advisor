'use strict';
const manifest=require('../../../data/sortie/maps/index.json');

module.exports=function createMapLoading(React,{getStore,createCache=()=>require('../../host/map_resources').createPoiMapResources()}){
  let cache;
  return function useMapLoading(area,active){
    const [state,setState]=React.useState(null),[attempt,setAttempt]=React.useState(0);
    const ip=area?getStore()?.info?.server?.ip:undefined;
    React.useEffect(()=>{
      if(!area||!active||state?.area===area&&state.status==='ready')return;
      let alive=true;setState({area,status:'loading'});
      Promise.resolve().then(()=>{
        cache=cache||createCache();return cache.loadMap(manifest.maps[area],ip);
      }).then(result=>{if(alive)setState({area,...result});},error=>{
        if(alive)setState({area,status:'error',message:error.message?.startsWith('海图暂未加载')?error.message:'海图暂未加载，请检查网络后重试'});
      });
      return ()=>{alive=false;};
    },[area,active,ip,attempt]);
    return {...(state?.area===area?state:{area,status:'loading'}),retry:()=>setAttempt(n=>n+1)};
  };
};
