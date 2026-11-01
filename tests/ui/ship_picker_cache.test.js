'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const W=require('../../src/ui/workbench/workbench_model');
const {createShipPickerCache}=require('../../src/ui/workbench/ship_picker_cache');

test('prepared candidates preserve selection rules and rebuild after in-place roster changes',()=>{
  const store=fixture(),cache=createShipPickerCache(),selection={kind:'normal',filters:{minLevel:90,excludeUnremodeled:true}};
  const before=JSON.stringify(store),first=cache.get(store,selection);
  assert.equal(cache.get(store,selection),first,'unchanged roster is reused');
  const slots=[W.entry(store,2),W.entry(store,3)];
  for(const [index,search,scope] of [[0,'','all'],[1,'测试','similar'],[0,'不存在','all']])
    assert.deepEqual(W.replacementCandidates(store,slots,index,search,scope,selection,first),
      W.replacementCandidates(store,slots,index,search,scope,selection));
  assert.equal(JSON.stringify(store),before);
  store.info.ships[2].api_lv=1;store.info.ships[2].api_cond=12;
  const changed=cache.get(store,selection);assert.notEqual(changed,first);
  assert.equal(changed.find(row=>row.id===2).level,1);assert.equal(changed.find(row=>row.id===2).cond,12);
  assert(changed.find(row=>row.id===2).preferenceReasons.some(reason=>reason.includes('等级')));
  store.info.fleets[1].api_ship=[2];store.info.fleets[1].api_mission=[1,1];
  const away=cache.get(store,selection);assert.notEqual(away,changed);assert.equal(away.find(row=>row.id===2).unavailable,'远征中');
  store.info.fleets[1].api_mission=[0,0];store.info.repairs.push({api_ship_id:2});
  const repair=cache.get(store,selection);assert.notEqual(repair,away);assert.equal(repair.find(row=>row.id===2).unavailable,'修理中');
  store.const.$ships[2].api_name='更改舰名';
  assert.notEqual(cache.get(store,selection),repair,'in-place master updates also invalidate the roster');
  const other=cache.get(store,{kind:'expedition',filters:{minLevel:0}});
  assert(!other.find(row=>row.id===2).preferenceReasons.some(reason=>reason.includes('等级')));
});

test('prepared roster responds to draft duplicates without rebuilding the roster',()=>{
  const store=fixture(),cache=createShipPickerCache(),selection={kind:'normal'},rows=cache.get(store,selection);
  store.const.$ships[3].api_yomi=store.const.$ships[2].api_yomi='same-family';
  const updated=cache.get(store,selection),slots=[W.entry(store,2),null];assert.notEqual(updated,rows);
  const blocked=W.replacementCandidates(store,slots,1,'','all',selection,updated).find(row=>row.id===3);
  const replace=W.replacementCandidates(store,slots,0,'','all',selection,updated).find(row=>row.id===3);
  assert.equal(blocked.unavailable,'同舰已编入');assert.notEqual(replace.unavailable,'同舰已编入');
  assert.equal(cache.get(store,selection),updated);
});

test('ship picker entry animation respects reduced motion and defers offscreen rendering',()=>{
  const styles=require('../../src/ui/workbench/workbench_styles');
  assert.match(styles,/@media\(prefers-reduced-motion:no-preference\)\{\.paa-wb-popup-shade\[data-picker=ship\]/);
  assert.match(styles,/\.paa-wb-popup\[data-picker=ship\] \.paa-wb-popup-list>button\{content-visibility:auto/);
});
