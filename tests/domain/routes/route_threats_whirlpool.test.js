'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {previewForMap,consumption}=require('../../../src/domain/routes/sortie_profile');
const {recommendedOptions,optionPaths}=require('../../../src/domain/routes/route_plans');
const {routeThreat}=require('../../../src/domain/routes/route_threats');
test('5-5 whirlpool has no enemy threat and keeps its separate consumption uncertainty',()=>{
  const option=recommendedOptions('5-5').find(row=>row.name==='中路大船流');
  const profile=previewForMap('5-5',{paths:optionPaths(option)});
  const whirlpool=profile.mapPreview.nodes.find(node=>node.id==='D');
  assert.equal(whirlpool.kind,'whirlpool');assert.equal(whirlpool.threatStatus,'none');
  const threat=routeThreat(profile.mapPreview.nodes,profile.routePaths);
  assert.equal(threat.status,'qualitative');
  assert(threat.enemies.some(enemy=>enemy.nodes.includes('H')));
  const data=require('../../../data/sortie/encounters/5-5.json').nodes.D;
  assert.equal(consumption(data,'5-5').estimated,true);
  assert([consumption(data,'5-5').fuel,consumption(data,'5-5').ammo].includes(null));
});
test('5-5 path evidence keeps P-point threats only on routes that actually traverse P',()=>{
  const options=recommendedOptions('5-5');
  const pathOf=name=>previewForMap('5-5',{paths:optionPaths(options.find(row=>row.name===name))});
  const upper=pathOf('上路大船流'),middle=pathOf('中路大船流');
  assert(upper.routePaths.some(path=>path.nodes.includes('P')));
  assert(upper.threat.enemies.some(enemy=>enemy.nodes.includes('P')&&enemy.name.includes('RE')));
  assert(middle.routePaths.every(path=>!path.nodes.includes('P')));
  assert(middle.threat.enemies.every(enemy=>!enemy.nodes.includes('P')));
});
