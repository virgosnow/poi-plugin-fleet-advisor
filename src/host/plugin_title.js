'use strict';

// poi reads these same resources while loading plugin metadata. The plugin's
// language is independently configurable, so its currently mounted panel also
// updates only this plugin's host display when the player switches languages.
const resources={
  'zh-CN':require('../ui/i18n/zh-CN.json'),
  'zh-TW':require('../ui/i18n/zh-TW.json'),
  'ja-JP':require('../ui/i18n/ja-JP.json'),
  'en-US':require('../ui/i18n/en-US.json')
};
const PLUGIN_ID='poi-plugin-fleet-advisor',NAME_KEY='舰队参谋';
function syncPluginTitle({host,document,React,locale}){
  const name=(resources[locale]||resources['zh-CN'])[NAME_KEY];
  let hostUpdated=false,windowUpdated=false;
  try{
    const plugins=host?.getStore?.('plugins');
    const plugin=Array.isArray(plugins)?plugins.find(row=>row?.packageName===PLUGIN_ID&&row.id===PLUGIN_ID):null;
    if(plugin&&typeof host.dispatch==='function'&&typeof React?.createElement==='function'){
      if(plugin.name!==name){
        const displayName=React.createElement(React.Fragment,null,plugin.displayIcon,' ',name);
        host.dispatch({type:'@@Plugin/changeStatus',payload:{packageName:PLUGIN_ID,option:[
          {path:'name',status:name},{path:'displayName',status:displayName}
        ]}});
      }
      hostUpdated=true;
    }
  }catch(_){/* Host support is optional; never interrupt the workbench. */}
  try{
    const view=document?.defaultView,location=view?.location;
    // The panel can also be embedded in poi's main document. Never change the
    // main window title, a different plugin window, or the game document.
    if(view&&document!==host?.document&&/\/index-plugin\.html$/i.test(location?.pathname||'')&&
       location.search==='?'+PLUGIN_ID){
      if(document.title!==name)document.title=name;
      windowUpdated=true;
    }
  }catch(_){/* Window might have closed while switching languages. */}
  return {name,hostUpdated,windowUpdated};
}
module.exports={syncPluginTitle,PLUGIN_ID};
