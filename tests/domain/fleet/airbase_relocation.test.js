'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {unverifiedRelocation}=require('../../../src/domain/fleet/airbase_relocation');

test('unknown relocation list excludes warehouse aircraft but not ship-owned equipment or guns',()=>{
  const store={airbaseSync:{relocationsComplete:false},info:{equips:{1:{api_slotitem_id:1},2:{api_slotitem_id:2}}},
    const:{$equips:{1:{api_type:[0,0,6]},2:{api_type:[0,0,1]}}}};
  assert.equal(unverifiedRelocation(store,1,null),true);
  assert.equal(unverifiedRelocation(store,1,42),false);
  assert.equal(unverifiedRelocation(store,2,null),false);
  store.airbaseSync.relocationsComplete=true;
  assert.equal(unverifiedRelocation(store,1,null),false);
});
