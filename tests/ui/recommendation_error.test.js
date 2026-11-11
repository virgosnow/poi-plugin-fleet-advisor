'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setLocale}=require('../../src/shared/i18n');
const {recommendationError,practiceError,formatError}=require('../../src/ui/models/recommendation_error');

test('recommendation failure and dynamic exclusions follow the selected language',()=>{
  const failure=recommendationError({reasonBase:'本轮未找到同时满足攻略舰种、练度、关键装备和可达路线的编成；可调整固定舰娘、装备或制空目标',
    selectionFilters:{details:[{code:'minimumLevel',minimum:30,count:140},{code:'expedition',count:15},{code:'unlocked',count:51}]}},'');
  try{
    setLocale('ja');let text=formatError(failure);
    assert.match(text,/練度 30 未満 140隻/);assert.match(text,/遠征中 15隻/);assert.match(text,/未ロック 51隻/);assert.doesNotMatch(text,/本轮|等级|全局|舰娘/);
    setLocale('zh-TW');text=formatError(failure);assert.match(text,/等級低於 30/);assert.match(text,/全域排除/);assert.doesNotMatch(text,/本轮|等级|全局/);
    setLocale('zh-CN');text=formatError(failure);assert.match(text,/等级低于 30 140 艘/);
  }finally{setLocale('zh-CN');}
});

test('practice failures keep numeric details when translated',()=>{
  const failure=practiceError({code:'PRACTICE_TARGETS_OVER_CAPACITY',details:{count:7,capacity:6}},'');
  try{
    setLocale('ja');assert.match(formatError(failure),/計7隻で、6隻を超えています/);
    setLocale('zh-TW');assert.match(formatError(failure),/共 7 艘，超過 6 艘/);
    setLocale('zh-CN');assert.match(formatError(failure),/共 7 艘，超过 6 艘/);
  }finally{setLocale('zh-CN');}
});

test('practice failure details survive the real recommendation worker boundary',async()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
  const worker=new RecommendationWorker({getDiagnostics:()=>null});
  try{
    await assert.rejects(worker.run('recommendPracticeFleet',store,{fleet:1,capacity:6,
      slots:[1,2,3,4,5,6].map(id=>({...W.entry(store,id),pin:true})),trainingShipIds:[7]}),
    error=>error.code==='PRACTICE_TARGETS_OVER_CAPACITY'&&error.details.count===7&&error.details.capacity===6);
  }finally{await worker.dispose();}
});
