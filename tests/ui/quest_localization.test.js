'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const quest=require('../../src/ui/i18n/quest_localization');
test('number display preserves community labels and does not replace internal selection codes',()=>{
  assert.equal(quest.number({id:404,code:'Dw1'}),'Dw1');
  assert.equal(quest.number({id:302,code:'P302',source:{url:'https://wikiwiki.jp/kancolle/任務/演習任務#id-Cw1'}}),'Cw1');
  assert.equal(quest.number({id:99999,code:'P-unknown-99999'}),'#99999');
  assert.equal(quest.number({id:0,code:null}),'');
});
