'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('practice reward import requires reviewed community code, game ID and Japanese title',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-reward-import-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const definitions=require('../../../data/quests/requirements.json').quests;
  const weekly=definitions.find(q=>q.code==='P302'),daily=definitions.find(q=>q.code==='P303');
  const input=path.join(dir,'input.json'),output=path.join(dir,'output.json');
  fs.writeFileSync(input,JSON.stringify({meta:{generatedAt:'fixture'},quests:{
    [weekly.ids[0]]:{id:weekly.ids[0],wikiId:'Cw1',nameJa:weekly.title,fixedReward:[{api_kind:13,api_mst_id:3,api_count:2}]},
    [daily.ids[0]]:{id:daily.ids[0],wikiId:'wrong-code',nameJa:daily.title,fixedReward:[{api_kind:13,api_mst_id:3,api_count:2}]}
  }}));
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../../tools/data/import-quest-rewards.js'),input,output],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const generated=JSON.parse(fs.readFileSync(output,'utf8')).quests;
  assert.deepEqual(generated.P302,{id:weekly.ids[0],fixed:[{kind:13,id:3,count:2}],choices:[]});assert.equal(generated.P303,undefined);
});

test('import matches full-width titles and distinguishes confirmed empty from unknown rewards',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-reward-known-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const definitions=require('../../../data/quests/requirements.json').quests;
  const one=definitions.find(q=>q.code==='Dd1'),empty=definitions.find(q=>q.code==='Dd2'),unknown=definitions.find(q=>q.code==='B3');
  const input=path.join(dir,'input.json'),output=path.join(dir,'output.json');
  fs.writeFileSync(input,JSON.stringify({meta:{generatedAt:'fixture'},quests:{
    [one.ids[0]]:{id:one.ids[0],wikiId:'Dd1',nameJa:one.title.replace('3','３'),fixedReward:[{api_kind:13,api_mst_id:3,api_count:1}],choiceReward:null},
    [empty.ids[0]]:{id:empty.ids[0],wikiId:'Dd2',nameJa:empty.title,fixedReward:[],choiceReward:[]},
    [unknown.ids[0]]:{id:unknown.ids[0],wikiId:'B3',nameJa:unknown.title,fixedReward:null,choiceReward:null}
  }}));
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../../tools/data/import-quest-rewards.js'),input,output],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const generated=JSON.parse(fs.readFileSync(output,'utf8')).quests;
  assert.deepEqual(generated.Dd1.fixed,[{kind:13,id:3,count:1}]);
  assert.deepEqual(generated.Dd2,{id:empty.ids[0],fixed:[],choices:[]});
  assert.equal(generated.B3,undefined);
});
