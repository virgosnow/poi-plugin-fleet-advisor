'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {queryQuests}=require('../../src/application/quest_queries');
const now=Date.parse('2026-11-03T03:00:00Z');
test('quest query matches catalog period and goals while preserving unknown tasks',()=>{
  const data={status:'ready',pages:2,tasks:[
    {api_no:442,api_category:4,api_state:2,api_title:'西方連絡作戦準備を実施せよ！',api_progress_flag:2},
    {api_no:443,api_category:4,api_state:1,api_title:'西方連絡作戦による航空技術獲得'},
    {api_no:999999,api_category:4,api_state:1,api_title:'unknown'},
    {api_no:999998,api_category:4,api_state:1,api_title:'unlisted annual',api_label_type:102}]};
  const result=queryQuests(data,{category:'expedition',period:'yearly'},now);
  assert.equal(result.complete,true);assert.equal(result.total,2);assert.equal(result.unknownPeriodCount,1);
  assert.equal(result.items[0].code,'Dy7');assert.equal(result.items[0].progressFlag,2);
  assert.deepEqual(result.items[0].goals.map(x=>x.missionId),['D1','29','30','D3']);
  assert.equal(queryQuests(data,{limit:1,offset:1},now).items[0].code,'D39');
  assert.equal(queryQuests({status:'incomplete'},{}).total,null);
});

test('Dy1 contains the five required expeditions, not the source link typo',()=>{
  const result=queryQuests({status:'ready',pages:1,tasks:[{api_no:434,api_category:4,api_state:1}]},{},now);
  assert.deepEqual(result.items[0].goals.map(goal=>goal.missionId),['3','5','A1','A2','9']);
});

test('MCP dispatch exposes and validates quest filters',async()=>{
  const {handleMcpPost}=require('../../src/bridge/mcp_http');
  const dispatch=async(service,message)=>JSON.parse((await handleMcpPost(service,JSON.stringify({jsonrpc:'2.0',...message}))).body);
  const catalog=await dispatch({}, {id:1,method:'tools/list'});
  assert(catalog.result.tools.some(tool=>tool.name==='fleet_advisor_query_quests'));
  const service={queryQuests:async args=>queryQuests({status:'ready',pages:1,tasks:[
    {api_no:442,api_category:4,api_state:2,api_title:'西方連絡作戦準備を実施せよ！'}]},args,now)};
  const request=args=>dispatch(service,{id:2,method:'tools/call',params:{name:'fleet_advisor_query_quests',arguments:args}});
  const good=await request({category:'expedition',period:'yearly'});
  assert.equal(good.result.structuredContent.items[0].code,'Dy7');
  const bad=await request({period:'typo'});assert.equal(bad.result.isError,true);
});
