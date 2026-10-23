'use strict';
const {TTL_MS,SHIP_SORTS,EQUIPMENT_SORTS,SHIP_FIELDS,EQUIPMENT_FIELDS}=require('./snapshots');

const positiveId={type:'integer',minimum:1};
const equipmentSpec={oneOf:[positiveId,{type:'integer',const:-1},{type:'string',minLength:1},
  {type:'null'},{type:'object',required:['name'],properties:{name:{type:'string',minLength:1},
    star:{type:'integer',minimum:0,maximum:10},alv:{type:'integer',minimum:0,maximum:7}},additionalProperties:false}]};
const shipObject={type:'object',properties:{id:positiveId,name:{type:'string',minLength:1},
  slots:{type:'array',maxItems:5,items:equipmentSpec},ex:equipmentSpec},
  anyOf:[{required:['id']},{required:['name']}],additionalProperties:false};
const schemeSchema={type:'object',required:['fleet','ships'],properties:{
  fleet:{type:'integer',minimum:1,maximum:4},ships:{type:'array',minItems:1,maxItems:6,
    items:{oneOf:[positiveId,{type:'string',minLength:1},shipObject]}},
  name:{type:'string'},format:{type:'string'},note:{type:'string'}},additionalProperties:false};

function contract(){return {
  version:'2',name:'Fleet Advisor',transport:{type:'streamable-http',endpoint:'/mcp',authentication:'none; connect using the HTTP URL only',
    scope:'127.0.0.1 only; no browser Origin; no stdio or legacy /v1/tool endpoint'},
  schemeSchema,
  example:{fleet:2,ships:[{id:1234,slots:[20101,20102,-1],ex:20103},{id:5678}]},
  semantics:{ships:'COMPLETE target fleet in final order, maximum 6. Not an incremental patch.',
    slots:'Omitted: keep observed equipment. Present: complete normal-slot target; omitted trailing slots are emptied. Zero-based slots, maximum 5.',
    ex:'Omitted: keep expansion equipment. -1/null/empty: remove equipment. Expansion must already be open.',
    id:'Owned INSTANCE IDs for ships and equipment; masterId is a catalog identifier and cannot select an instance.',
    name:'Names allow simplified/traditional matching but can be ambiguous. Prefer instance IDs returned by queries.',
    borrowedEquipment:'Moving equipment from another ship changes that donor ship; inspect preview donor lists.',
    source:'scheme and schemeName are mutually exclusive. If neither is supplied to an evaluation/status tool, use its observed fleet default.',
    presets:'Game presets contain ship membership only; query_fleet_status uses their current observed equipment. They are separate from the local scheme library.',
    execution:'Only execute_plan changes fleet/equipment. No sortie, battle, expedition dispatch or resource-purchase tool is provided.'},
  workflow:{observe:['fleet_advisor_get_status','fleet_advisor_create_snapshot','fleet_advisor_query_fleets','fleet_advisor_query_fleet_status'],
    normal:['fleet_advisor_query_normal_map','fleet_advisor_recommend_normal_fleet','fleet_advisor_recommend_normal_equipment','fleet_advisor_evaluate_normal_route'],
    expedition:['fleet_advisor_query_expeditions','fleet_advisor_recommend_expedition_fleet','fleet_advisor_recommend_expedition_equipment','fleet_advisor_evaluate_expedition'],
    apply:['fleet_advisor_preview_fleet','fleet_advisor_execute_plan','fleet_advisor_get_job'],
    recovery:'After failure/cancel/interruption inspect job.partialApplied, capture a new snapshot, and replan. Never repeat partial operations with a new idempotency key.'},
  snapshot:{ttlMinutes:Math.round(TTL_MS/60000),renewal:'Sliding on access; maximum 5 retained snapshots. Does not actively refresh the game.',
    consistency:'Queries are immutable. Preview and execution separately validate live account fingerprint. Preset/map-progress-only changes do not invalidate equipment plans.'},
  queries:{sortKeys:{ships:SHIP_SORTS,equipment:EQUIPMENT_SORTS},fieldKeys:{ships:SHIP_FIELDS,equipment:EQUIPMENT_FIELDS},
    paging:'limit 1..100, default 50. Keep snapshot/filter/sort/order/fields unchanged with nextCursor.',
    sort:'Default instanceId ascending; ties use instanceId ascending; unknown values sort last.',
    projection:'fields always includes instanceId and name; unavailable fields are null.',
    equipmentOptions:'Grouped legal replacements by masterId/stars/proficiency. One representative instance and available count, not multiple copies of the same ID.'},
  recommendation:{defaults:{normal:{byRoute:true,airGoal:'superiority'},expedition:{fleet:2,goal:'plugin expedition defaultGoal setting'}},
    constraints:'fixedShipIds are required hulls, not fixed positions. heldSlots is position-indexed with null holes; pin or keep retains the hull and its position. keep keys retain exact equipment instances or an empty -1 slot. All other equipment is refitted from empty.',
    filters:'Uses separate persisted sortie/expedition filters. Fixed manual hulls override soft automatic preferences but not busy/repair/duplicate/slot/inventory validation. planningOnly is not executable approval.',
    routes:'Use routeKey from query_normal_map. byRoute uses the same recommended route/stage quotas as the page; routeKey searches only that route. A merged route is one strategy with several physical paths.',
    probability:'Route arrival probability excludes retreat/battle outcome. Distinguish selected-path probability from overall Boss probability. Unknown random exits use the data reference policy, not guaranteed arrival.',
    quality:'Bounded heuristics; globalOptimal=false. notFound is not proof that no possible fleet exists.',
    equipment:'recommend_*_equipment preserves supplied hulls/order. Returns a complete scheme for preview_fleet, not a direct game operation.'},
  evaluation:{generic:'evaluate_fleet validates structure, instance/equipment allocation, air-power range, LoS, speed and opening ASW. It does not select map conditions.',
    normal:'evaluate_normal_route with routeKey returns planning/arrival and fleetSummary: route-specific per-node LoS coefficients/thresholds and aircraft-loss air estimates. Never use current-fleet default coefficient 4 to judge another node.',
    air:'Route aircraft losses and proficiency uncertainty are conservative estimates, not combat guarantees. Aircraft supply assumptions accompany returned metrics.',
    expedition:'Dispatch eligibility and estimated great-success probability are separate. income deducts fuel/ammo resupply. Reference catalog income is not candidate income.',
    mechanisms:'query_fleet_status includes speed, combat, special attack, ground attack and expedition badges with structured numeric details when known; unknown conditions stay unknown.',
    limits:['Normal six-ship fleets only; no combined/guerrilla fleets.','No battle damage/supply simulation or victory guarantee.','Incomplete mechanism data remains uncertain.']},
  schemes:{limit:200,name:'Trimmed nonempty 1..64 characters, globally unique; overwrite=true required to replace.',
    storage:'Temporary scheme cache in local private schemes.json; no game requests. Settings scheme/all-cache cleanup deletes these records, including in-memory references. Not permanent storage. delete_scheme returns the deleted record.',
    cacheMiss:'SCHEME_NOT_FOUND after cache cleanup is expected. Query current names, recreate the scheme or pass inline scheme JSON.',
    cachePolicy:'All three cache categories share cacheLimitMiB, with no separate byte quotas. New scheme saves reclaim older computation files first; an oversized/blocked save fails with CACHE_CAPACITY_EXCEEDED and preserves the previous scheme. On limit reduction, schemes may also be cleared if they cannot fit.',
    disabled:'get_status.schemes.enabled=false prohibits save_scheme with SCHEME_CACHE_DISABLED. Existing schemes remain readable/deletable and still consume the shared budget. Inline schemes and recommendation tools remain available.',
    validate:'Optional snapshot validation returns warnings without blocking save. Execute still requires fresh preview.'},
  execution:{planTtlMinutes:5,idempotency:'Persisted per operation key; do not generate a new key after uncertain response.',
    permission:'Automatic operations default OFF, including settings migrated from older versions. The player must enable Settings > Experimental features > Automatic operations. get_status.experimentalSettings.automaticOperations and capabilities.execute expose this permission. MCP cannot enable it. Queries, recommendations, evaluation and preview remain available while OFF.',
    concurrency:'All HTTP clients share the same execution lock. Queries/recommendations do not authorize execution.',
    stopping:'cancel_job stops future steps only; completed game changes cannot roll back.'},
  errorShape:{code:'Stable machine-readable code.',message:'Diagnostic text; do not parse it as a code.',details:'Optional structured detail.',
    retryable:'May refresh query/preview; does not authorize replaying game changes.',nextAction:'Suggested recovery action or null.'}
};}
module.exports={contract,schemeSchema};
