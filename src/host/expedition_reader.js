'use strict';

// Runs entirely in the game's own frame. Credentials never leave that frame;
// only the mission status fields are returned to the plugin.
async function readMissionList(){
  const params=new URL(location.href).searchParams,token=params.get('api_token');
  if(!token)throw new Error('Mission session unavailable');
  const endpoint=new URL('/kcsapi/api_get_member/mission',location.origin);
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
  try{
    const response=await fetch(endpoint.href,{method:'POST',credentials:'same-origin',signal:abort.signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({api_verno:'1',api_token:token}).toString()});
    if(!response.ok)throw new Error('Mission list unavailable');
    const payload=JSON.parse((await response.text()).replace(/^svdata=/,''));
    if(payload.api_result!==1)throw new Error('Mission list unavailable');
    const data=payload.api_data,list=Array.isArray(data)?data:data?.api_list_items||data?.api_list;
    if(!Array.isArray(list)||!list.length||!list.every(row=>Number.isInteger(row.api_mission_id)&&row.api_mission_id>0))
      throw new Error('Mission list unavailable');
    return {api_limit_time:data?.api_limit_time,api_list_items:list.map(row=>({api_mission_id:row.api_mission_id,api_state:row.api_state}))};
  }finally{clearTimeout(timer);}
}

async function readExpeditionProgress(window,remote){
  const ref=window.getStore('layout.webview.ref');
  const wc=ref&&(typeof ref.getWebContentsId==='function'?remote.webContents.fromId(ref.getWebContentsId()):
    typeof ref.getWebContents==='function'?ref.getWebContents():ref);
  const frame=wc?.mainFrame?.framesInSubtree?.find(frame=>{
    try{const url=new URL(frame.url);return /^https?:$/.test(url.protocol)&&/^\/kcs2\/index\.(php|html)$/.test(url.pathname);}catch(error){return false;}
  });
  if(!frame||typeof frame.executeJavaScript!=='function')throw new Error('Mission frame unavailable');
  return frame.executeJavaScript(`(${readMissionList.toString()})()`);
}
module.exports={readExpeditionProgress};
