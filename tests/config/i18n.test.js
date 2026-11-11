'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const i18n=require('../../src/shared/i18n');
const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
const store=require('../helpers/workbench_fixture');

test('poi language normalization, display-only catalogs, parameters and fallback',()=>{
  assert.equal(i18n.normalizeLocale('ja-JP'),'ja-JP');
  assert.equal(i18n.normalizeLocale('zh-Hant-HK'),'zh-TW');
  assert.equal(i18n.normalizeLocale('zh_CN'),'zh-CN');
  assert.equal(i18n.normalizeLocale('en-US'),'zh-CN');
  i18n.registerCatalog('ja',{'test:welcome':'艦隊 {name}'});
  i18n.registerCatalog('zh-TW',{'test:welcome':'艦隊 {name}'});
  const changes=[],stop=i18n.subscribe(value=>changes.push(value));
  try{
    i18n.setLocale('ja-JP');
    assert.equal(i18n.t('test:welcome',{name:'大和'}),'艦隊 大和');
    assert.equal(i18n.t('未收录'),'未收录');
    i18n.setLocale('zh-TW');
    assert.equal(i18n.t('test:welcome',{name:'大和'}),'艦隊 大和');
    assert.deepEqual(changes,['ja-JP','zh-TW']);
  }finally{stop();i18n.setLocale('zh-CN');}
});

test('first launch detects poi language, persists it, and explicit choice survives restart and settings reset',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-language-'));
  const options={storageDir:directory,getStore:store,controller:{dispose(){}}};
  let first,second;
  try{
    first=new FleetAdvisorService({...options,hostLocale:'ja-JP'});
    assert.equal(first.getLanguage(),'ja-JP');
    assert.equal(JSON.parse(fs.readFileSync(first.stateFile,'utf8')).language,'ja-JP');
    assert.equal(first.setLanguage('zh-TW'),'zh-TW');
    await first.resetRecommendationSettings();
    assert.equal(first.getLanguage(),'zh-TW');
    await first.dispose();first=null;
    second=new FleetAdvisorService({...options,hostLocale:'zh-CN'});
    assert.equal(second.getLanguage(),'zh-TW');
    assert.throws(()=>second.setLanguage('en-US'),/语言设置无效/);
    second.persist=()=>{throw Error('readonly')};
    assert.throws(()=>second.setLanguage('ja-JP'),/语言设置保存失败/);
    assert.equal(second.getLanguage(),'zh-TW');
  }finally{
    if(first)await first.dispose();
    if(second)await second.dispose();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('legacy settings detect and persist poi language without overwriting corrupt settings',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-language-migrate-'));
  const stateFile=path.join(directory,'mcp-state.json');
  const options={storageDir:directory,getStore:store,controller:{dispose(){}}};
  let service;
  try{
    fs.writeFileSync(stateFile,JSON.stringify({httpPort:48765,recommendationFilters:{normal:{minLevel:70}}}));
    service=new FleetAdvisorService({...options,hostLocale:'ja-JP'});
    const migrated=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    assert.equal(migrated.language,'ja-JP');assert.equal(migrated.httpPort,48765);
    assert.equal(migrated.recommendationFilters.normal.minLevel,70);
    await service.dispose();service=null;
    fs.writeFileSync(stateFile,'{corrupt');
    service=new FleetAdvisorService({...options,hostLocale:'zh-TW'});
    assert.equal(service.getLanguage(),'zh-TW');
    assert.equal(fs.readFileSync(stateFile,'utf8'),'{corrupt');
  }finally{if(service)await service.dispose();fs.rmSync(directory,{recursive:true,force:true});}
});
