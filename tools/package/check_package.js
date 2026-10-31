'use strict';
// Portable build-time artifact check. No shell, game connection, or downloads.
const fs=require('fs'),zlib=require('zlib'),assert=require('assert');
const file=process.argv[2]||`poi-plugin-fleet-advisor-${require('../../package.json').version}.tgz`;
const tar=zlib.gunzipSync(fs.readFileSync(file)),names=[];let metadata;
for(let offset=0;offset+512<=tar.length;) {
  const header=tar.subarray(offset,offset+512);
  const str=(a,b)=>header.subarray(a,b).toString().split('\0')[0];
  const name=str(0,100);if(!name)break;
  const size=parseInt(str(124,136).trim(),8)||0,prefix=str(345,500);
  names.push((prefix?prefix+'/':'')+name);
  if(name==='package/package.json')metadata=JSON.parse(tar.subarray(offset+512,offset+512+size).toString('utf8'));
  offset+=512+Math.ceil(size/512)*512;
}
assert.equal(metadata?.name,'poi-plugin-fleet-advisor','Incorrect published package identity');
assert.equal(metadata.poiPlugin.id,metadata.name,'poi identity differs from package name');
assert.equal(metadata.poiPlugin.title,'舰队参谋','Incorrect Chinese title');
for(const name of ['data/quests/requirements.json','src/domain/quests/quest_requirements.js','src/domain/quests/fleet_requirements.js','src/infrastructure/quests/quest_observer.js','src/infrastructure/quests/quest_auto_read.js','src/host/quest_reader.js','src/ui/components/quest_section.js','src/ui/components/quest_section_styles.js'])
  assert(names.includes('package/'+name),'Missing related task runtime '+name);
for(const name of ['data/quests/limited/index.js','data/quests/limited/2026-halloween.json'])
  assert(names.includes('package/'+name),'Missing limited task catalog '+name);
assert.notEqual(metadata.private,true,'Private packages cannot be published');
assert(!names.some(n=>/normal_routes_source_nga\.json|\/fixtures\/sources\/|\/logs\/|\/\.cache\/|mcp-state\.json|\/\.npmrc$|\/\.env(?:\.|$)/.test(n)),'Private or captured source material in package');
for(const required of ['package/index.js','package/src/vision/worker.js','package/src/execution/request_monitor.js','package/data/org_sort_new.json','package/data/org_sort_level.json','package/data/org_clear_escorts.json','package/data/equip_borrow.json','package/data/equip_categories.json','package/data/equip_clear_all.json','package/data/equipment_rules.json','package/data/expedition_requirements.json','package/data/normal_routes/1-1.json','package/data/normal_routes/7-5.json','package/data/level_digits.json'])assert(names.includes(required),'Missing '+required);
for(const name of ["src/ui/shell/panel.js","src/ui/shell/model.js","src/ui/shell/styles.js","src/ui/maps/route_preview.js","src/ui/maps/map_assets.js","src/ui/maps/map_pan.js","src/ui/components/equipment_icon.js","src/ui/workbench/workbench.js","src/ui/workbench/workbench_model.js","src/ui/workbench/workbench_styles.js","src/ui/components/ship_drag.js","src/ui/fleet/current_fleet.js","src/ui/fleet/current_fleet_model.js","src/ui/fleet/current_fleet_styles.js","src/ui/components/mechanism_badges.js","src/ui/settings/recommendation_settings.js"])assert(names.includes('package/'+name),'Missing UI '+name);
assert(names.includes('package/data/sortie/adjudications.json'),'Missing enemy uncertainty ledger');
for(const name of ["src/ui/fleet/current_fleet.js","src/ui/fleet/current_fleet_model.js","src/ui/fleet/current_fleet_styles.js","src/ui/components/mechanism_badges.js"])assert(names.includes('package/'+name),'Missing UI '+name);
for(const name of ['index.json','map_common.json','map_common.png','map_common.source.json','SOURCE_LICENSE'])
  assert(names.includes('package/data/sortie/maps/'+name),'Missing actual map '+name);
assert(!names.some(name=>/^package\/data\/sortie\/maps\/.*\.webp$/.test(name)),'Experimental WebP duplicates in package');
assert(!names.some(name=>/^package\/data\/sortie\/maps\/\d+-\d+\.png$/.test(name)),'Development map atlases must not ship');
for(const name of ['src/infrastructure/cache/map_resource_cache.js','src/host/map_resources.js','src/ui/maps/map_loading.js'])assert(names.includes('package/'+name),'Missing on-demand maps '+name);
assert(names.includes('package/src/execution/navigation.js'),'Missing shared navigation');
for(const id of [1,2,3,4,5,6,7,8,10,11,12])assert(names.includes(`package/data/icons/material/0${id}.png`),'Missing bundled material icon '+id);
assert(names.includes('package/data/icons/items/59.png'),'Missing bundled Irako icon');
assert(names.includes('package/src/domain/routes/route_air.js'),'Missing route-local air thresholds');
for(const name of ['src/domain/combat/jet_aviation.js','src/recommendation/loadout/jet_fitting.js','data/icons/material/jet-assault.svg'])
  assert(names.includes('package/'+name),'Missing ship-borne jet mechanism '+name);
for(const file of ['src/config/computation_settings.js','src/ui/settings/computation_settings.js'])assert(names.includes('package/'+file),'Missing resource settings '+file);
assert(names.includes('package/src/shared/name_matching.js'),'Missing shared name matching');
for(const name of ['src/application/fleet_advisor_service.js','src/application/page_queries.js','src/application/contract.js','src/application/snapshots.js','src/domain/fleet/fleet_metrics.js','src/domain/routes/normal_routes.js','src/domain/routes/route_threats.js','src/recommendation/loadout/night_equipment.js','src/bridge/http_server.js','src/bridge/mcp_http.js','src/bridge/mcp_tools.js','src/bridge/tool_validation.js','src/bridge/service_api.js','docs/MCP_API.md'])
  assert(names.includes('package/'+name),'Missing MCP runtime '+name);
assert(!names.some(name=>name.startsWith('package/mcp/')||/node_modules\/(zod|@modelcontextprotocol)\//.test(name)),'Retired MCP adapter or SDK dependencies in package');
assert(names.includes('package/data/resample_variants.json'),'Missing resample calibration variants');
assert(!names.some(n=>/tesseract/i.test(n)),'OCR leftovers in package');
assert(!names.some(n=>/\.(py|ps1)$/.test(n)),'Legacy OS tool in package');
assert(!names.some(n=>/ship_sort\.json|ship_types\.json|request_guard\.js|tests\/fixtures/.test(n)),'Obsolete or development resource in package');

for(const name of ['src/domain/expeditions/expedition_income.js','src/infrastructure/persistence/expedition_progress.js','src/host/expedition_reader.js','data/expedition_rewards.json'])assert(names.includes('package/'+name),'Missing expedition runtime '+name);

for(const name of ['src/domain/fleet/fleet_plan.js','src/recommendation/context.js','src/recommendation/normal.js','src/recommendation/expedition.js','src/recommendation/fitting.js','src/recommendation/scoring.js','src/recommendation/strategies.js','src/recommendation/loadout/asw_fitting.js','src/ui/models/presentation_model.js','docs/ARCHITECTURE.md','src/domain/routes/route_plans.js','src/domain/routes/route_speed.js','src/config/recommendation_filters.js','src/infrastructure/workers/recommendation_worker.js','src/infrastructure/cache/recommendation_cache.js','data/normal_route_guides.json'])assert(names.includes('package/'+name),'Missing route recommendation '+name);
assert(names.includes('package/src/shared/calculation_cache.js'),'Missing pure calculation cache');
for(const name of ['src/domain/combat/opening_asw.js','data/asw_bonuses.json'])assert(names.includes('package/'+name),'Missing ASW calculation '+name);
for(const name of ['src/domain/combat/installation_attack.js','src/recommendation/loadout/ground_fitting.js','src/domain/combat/anti_air_cutin.js','data/installation_effects.json'])assert(names.includes('package/'+name),'Missing combat effect calculation '+name);

console.log(JSON.stringify({ok:true,files:names.length,bytes:fs.statSync(file).size}));
