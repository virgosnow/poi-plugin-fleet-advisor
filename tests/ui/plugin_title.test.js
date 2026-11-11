'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
const {syncPluginTitle,PLUGIN_ID}=require('../../src/host/plugin_title');
const {poiPlugin,files}=require('../../package.json');
const shell=require('../../src/ui/i18n/shell');
const React={Fragment:Symbol('fragment'),createElement:(type,props,...children)=>({type,props,children})};

test('poi metadata ships all supported title resources and matches in-panel terminology',()=>{
  assert.equal(poiPlugin.i18nDir,'src/ui/i18n');
  assert(files.includes('src/'));
  const base=path.join(__dirname,'../..',poiPlugin.i18nDir);
  const names={'zh-CN':'舰队参谋','zh-TW':shell.zhTW['舰队参谋'],'ja-JP':shell.ja['舰队参谋'],'en-US':'Fleet Advisor'};
  for(const [locale,name] of Object.entries(names)){
    const data=JSON.parse(fs.readFileSync(path.join(base,locale+'.json'),'utf8'));
    assert.equal(data[poiPlugin.title],name);
    assert.equal(typeof data[poiPlugin.description],'string');
  }
});

test('language switch updates only this plugin and its own external window',()=>{
  const icon={type:'icon'},ours={packageName:PLUGIN_ID,id:PLUGIN_ID,name:'舰队参谋',displayIcon:icon},other={packageName:'poi-plugin-other',id:'poi-plugin-other',name:'Other'};
  const actions=[],mainDocument={title:'poi'},host={document:mainDocument,getStore:key=>key==='plugins'?[ours,other]:null,
    dispatch:action=>{actions.push(action);for(const option of action.payload.option)ours[option.path]=option.status;}};
  const document={title:'舰队参谋',defaultView:{location:{pathname:'/index-plugin.html',search:'?'+PLUGIN_ID}}};
  assert.deepEqual(syncPluginTitle({host,document,React,locale:'ja-JP'}),{name:'艦隊参謀',hostUpdated:true,windowUpdated:true});
  assert.equal(ours.name,'艦隊参謀');assert.equal(document.title,'艦隊参謀');
  assert.equal(ours.displayName.children[0],icon);assert.equal(ours.displayName.children[2],'艦隊参謀');
  assert.equal(other.name,'Other');assert.equal(mainDocument.title,'poi');
  assert.equal(actions[0].type,'@@Plugin/changeStatus');assert.equal(actions[0].payload.packageName,PLUGIN_ID);
  syncPluginTitle({host,document,React,locale:'zh-TW'});
  assert.equal(ours.name,'艦隊參謀');assert.equal(document.title,'艦隊參謀');
  syncPluginTitle({host,document,React,locale:'zh-CN'});
  assert.equal(ours.name,'舰队参谋');assert.equal(document.title,'舰队参谋');
  syncPluginTitle({host,document,React,locale:'zh-CN'});
  assert.equal(actions.length,3,'unchanged locale must not dispatch again');
});

test('main window, other plugin windows and unavailable host are left alone',()=>{
  const main={title:'poi',defaultView:{location:{pathname:'/index.html',search:''}}};
  const other={title:'Other',defaultView:{location:{pathname:'/index-plugin.html',search:'?poi-plugin-other'}}};
  const host={document:main,getStore:()=>[{packageName:'poi-plugin-other',id:'poi-plugin-other'}],dispatch:()=>assert.fail('other plugin must not be updated')};
  assert.deepEqual(syncPluginTitle({host,document:main,React,locale:'ja-JP'}),{name:'艦隊参謀',hostUpdated:false,windowUpdated:false});
  assert.equal(syncPluginTitle({host,document:other,React,locale:'ja-JP'}).windowUpdated,false);
  assert.equal(main.title,'poi');assert.equal(other.title,'Other');
  assert.doesNotThrow(()=>syncPluginTitle({host:{getStore(){throw Error('unavailable')}},document:null,React,locale:'ja-JP'}));
});
