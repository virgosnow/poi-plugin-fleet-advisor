'use strict';

// Display-only localization. Business keys, game names, IDs and the MCP
// contract are deliberately never passed through this module.
const SUPPORTED=Object.freeze(['zh-CN','zh-TW','ja-JP']);
const catalogs=new Map(SUPPORTED.map(locale=>[locale,new Map()]));
const listeners=new Set();
let locale='zh-CN';

function normalizeLocale(value){
  if(typeof value!=='string')return 'zh-CN';
  const tag=value.trim().replace(/_/g,'-').toLowerCase();
  if(tag==='ja'||tag.startsWith('ja-'))return 'ja-JP';
  if(tag==='zh-tw'||tag==='zh-hk'||tag==='zh-mo'||tag.startsWith('zh-hant'))return 'zh-TW';
  return 'zh-CN';
}
function registerCatalog(language,entries){
  const target=catalogs.get(normalizeLocale(language));
  if(!target||!entries||typeof entries!=='object')return;
  for(const [key,value] of Object.entries(entries)){
    if(typeof value==='string'&&!target.has(key))target.set(key,value);
  }
}
function getLocale(){return locale;}
function setLocale(value){
  const next=normalizeLocale(value);
  if(next===locale)return locale;
  locale=next;
  for(const listener of [...listeners])try{listener(locale);}catch(_){/* one listener must not block others */}
  return locale;
}
function subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
function t(source,params){
  const key=String(source??''),translation=catalogs.get(locale)?.get(key)??key;
  if(!params||typeof params!=='object')return translation;
  return translation.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g,(all,name)=>
    Object.prototype.hasOwnProperty.call(params,name)?String(params[name]??''):all);
}
function useLocale(React){
  if(typeof React?.useState!=='function'||typeof React?.useEffect!=='function')return locale;
  const [current,setCurrent]=React.useState(getLocale);
  React.useEffect(()=>{
    const stop=subscribe(setCurrent);
    setCurrent(getLocale());
    return stop;
  },[]);
  return current;
}
module.exports={SUPPORTED,normalizeLocale,registerCatalog,getLocale,setLocale,subscribe,t,useLocale};
