'use strict';
// Single schema source for HTTP and the generated API reference.
const {SHIP_SORTS,EQUIPMENT_SORTS,SHIP_FIELDS,EQUIPMENT_FIELDS}=require('../application/snapshots');
const {schemeSchema}=require('../application/contract');
const str=(description,extra={})=>({type:'string',description,...extra});
const int=(minimum,maximum,description)=>({type:'integer',minimum,...(maximum===undefined?{}:{maximum}),...(description?{description}:{})});
const bool=description=>({type:'boolean',description});
const enumOf=(values,description)=>str(description,{enum:values});
const object=(properties,required=[])=>({type:'object',properties,...(required.length?{required}:{}),additionalProperties:false});
const uuid=description=>str(description,{format:'uuid'});
const snapshotId=uuid('Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes.');
const fleet=int(1,4,'Observed/destination fleet number, 1-based.');
const ids={type:'array',uniqueItems:true,maxItems:6,items:int(1),description:'Owned ship INSTANCE IDs, not catalog IDs.'};
const schemeName=str('Exact local scheme name.',{minLength:1,maxLength:64});
const source={scheme:schemeSchema,schemeName};
const exactlyOneSource={oneOf:[{required:['scheme']},{required:['schemeName']}]};
const slot={oneOf:[int(0,4),enumOf(['ex'],'Expansion slot.')],description:'Zero-based normal slot 0..4, or ex. Five-slot ships supported.'};
const nullableItem={oneOf:[int(1),{type:'integer',const:-1},{type:'null'}]};
const heldSlots={type:'array',maxItems:6,description:'Position-indexed draft with null holes. pin=true retains this hull position. keep keys retain exact equipment or -1 for empty. Unlocked equipment is refitted from empty.',items:{oneOf:[{type:'null'},object({
  id:int(1),pin:bool('Keep ship at this array position.'),slots:{type:'array',maxItems:5,items:nullableItem},ex:nullableItem,
  keep:object(Object.fromEntries(['0','1','2','3','4','ex'].map(k=>[k,{type:'boolean',const:true}]))),
},['id'])]}};
const mapArgs={area:str('Normal map ID, e.g. 5-2.',{pattern:'^[1-7]-[1-6]$'}),
  target:str('Destination node or boss (default). 1-6 requires target=N.',{pattern:'^(boss|[A-Z][0-9]?)$'}),
  phase:enumOf(['gauge1','gauge2','gauge3','gimmick'],'Optional gauge phase. Route recommendations otherwise include stage quotas; single-map evaluation uses observed stage, or phase 1 planning if unknown.'),
  routeKey:str('Exact query_normal_map.routes[].key, including merged branches and speed strategies.')};
const constraints={fleet,fixedShipIds:ids,excludedShipIds:{type:'array',uniqueItems:true,items:int(1)},heldSlots};
const airGoal=enumOf(['ignore','superiority','supremacy'],'MCP default superiority. Conservative aircraft-loss estimates are not combat guarantees.');
const goal=enumOf(['success','great'],'success: prefer unsparkled automatic hulls, meet dispatch requirements, then optimize net income; spare slots may hold drums that improve great-success probability. great: prioritize estimated great-success probability. Manual hulls/equipment remain fixed.');
const paging={snapshotId,limit:int(1,100,'Default 50.'),cursor:str('Opaque nextCursor; retain all other query arguments when paging.')};
const sorting=(keys,fields)=>({sort:enumOf(keys,'Default instanceId.'),order:enumOf(['asc','desc'],'Default asc.'),
  fields:{type:'array',items:enumOf(fields,'Projected field.'),description:'Optional projection; instanceId/name always returned.'}});
const tool=(suffix,description,properties={},required=[],readOnly=true,extra={})=>({name:'fleet_advisor_'+suffix,description,readOnly,inputSchema:{...object(properties,required),...extra}});
const TOOL_DEFS=Object.freeze([
  tool('get_status','Read data readiness, MCP permission, active job, global recommendation filters and supported capabilities.'),
  tool('get_contract','Read scheme JSON format, ID/slot semantics, workflow, calculation limits and stable error conventions.'),
  tool('create_snapshot','Capture account data already observed by poi. Does not refresh the game. Subsequent queries/recommendations use this immutable snapshot.'),
  tool('query_fleets','List four actual fleets: members, expedition state/return time, supply, aircraft, damage, fatigue and repair summaries.',{snapshotId},['snapshotId']),
  tool('query_fleet_presets','List game presets and synchronization state. Presets store hull membership only; inspecting one uses each ship current equipment.',{snapshotId},['snapshotId']),
  tool('query_fleet_status','Inspect actual fleet (default 1), presetId, or scheme/schemeName. Returns equipment/aircraft, HP/supply, air power, all LoS coefficients, speed, combat+expedition tags and numeric attack/rate details. Read-only; unsynchronized data stays unknown.',
    {snapshotId,fleet,presetId:int(1),...source},['snapshotId']),
  tool('query_ships','Page owned ship instances. Prefer small limit and fields. sort=level, order=desc, limit=1 finds the highest-level ship without scanning the account.',
    {...paging,name:str('Name substring, simplified/traditional matching.'),fleet,shipType:int(1),...sorting(SHIP_SORTS,SHIP_FIELDS)},['snapshotId']),
  tool('query_equipment','Page individual owned equipment instances: owners, stats, stars and proficiency. targetShipId/slot tests equippability. Does not merge instances.',
    {...paging,name:str('Name substring.'),location:enumOf(['free','ship','airbase'],'Current location.'),type:int(1),improvement:int(0,10),targetShipId:int(1),slot,
      availableOnly:bool('Exclude unavailable donors and airbases.'),equipableOnly:bool('Requires targetShipId.'),...sorting(EQUIPMENT_SORTS,EQUIPMENT_FIELDS)},['snapshotId']),
  tool('query_equipment_options','List legal slot replacements grouped by master ID, stars and proficiency, ordered by category. Returns selectable instance, count, stats and current highlight. Optional scheme reserves equipment worn by its other ships.',
    {snapshotId,shipId:int(1),slot,scheme:schemeSchema,search:str('Name/category search.')},['snapshotId','shipId','slot']),
  tool('save_scheme','Cache a full temporary scheme locally, without game changes. Requires settings schemeCache=true (see get_status.schemes.enabled); otherwise SCHEME_CACHE_DISABLED. Shares the disk limit with result/calculation caches; CACHE_CAPACITY_EXCEEDED means no scheme was saved. Cache cleanup may delete it; not permanent storage. Collision requires overwrite=true. Optional snapshot validation adds warnings.',
    {name:schemeName,scheme:schemeSchema,overwrite:bool('Explicitly overwrite this name.'),validateWithSnapshotId:snapshotId},['name','scheme'],false),
  tool('query_schemes','Read temporary scheme cache, separate from game presets. name is exact; search is substring. Returns full schemes and filtered total. After cache cleanup, recreate missing schemes or pass inline scheme JSON.',
    {name:schemeName,search:str('Name substring.'),offset:int(0),limit:int(1,100)}),
  tool('delete_scheme','Delete a temporary cached scheme, not a game preset. Returns the deleted scheme for recovery through save_scheme.',{name:schemeName},['name'],false),
  tool('evaluate_fleet','Validate candidate structure, instance availability, equipment, air-power range, LoS, speed and opening ASW. For routing and route-loss air estimates use evaluate_normal_route.',
    {snapshotId,...source,conditions:object({enemyAirPower:int(0),los:object({coefficient:int(1,4),minimum:{type:'number',minimum:0},maximum:{type:'number',minimum:0}},['coefficient'])})},['snapshotId'],true,exactlyOneSource),
  tool('query_expeditions','Read requirements, rewards, duration, unlock/completion/running state and reference net hourly income. evaluate_expedition returns actual candidate net income.',
    {snapshotId,missionId:int(1),search:str('Number/name/duration/resource search.'),sort:enumOf(['number','short','long','fuel','ammo','steel','bauxite'],'Default number; resources sort by reference net hourly income.')},['snapshotId']),
  tool('evaluate_expedition','Evaluate observed fleet (default 2) or scheme/schemeName: dispatch checks, estimated great-success probability and success/great net rewards after resupply. Does not dispatch.',
    {snapshotId,fleet,missionId:int(1),...source},['snapshotId','missionId']),
  tool('recommend_expedition_fleet','Recommend expedition ships/equipment with independent filters. Returns success/great goals, checks, probability and net income. If no eligible result exists, closestRecommendation is an explicitly ineligible reference with shortfalls; never treat it as dispatch-ready. Honors manual locks; read-only.',
    {snapshotId,missionId:int(1),goal,...constraints,fleet:int(2,4,'Default 2.'),fixedFlagshipId:int(1),limit:int(1,5)},['snapshotId','missionId']),
  tool('recommend_expedition_equipment','Refit equipment only; preserve supplied hulls/order. Returns full scheme, dispatch checks, great-success estimate and net income. Only heldSlots.keep equipment is retained. No game change.',
    {snapshotId,...source,missionId:int(1),goal,heldSlots},['snapshotId','missionId'],true,exactlyOneSource),
  tool('query_normal_maps','List supported map IDs, route rules, Boss/terminal nodes and static air thresholds. For routes/progress/nodes/enemies use query_normal_map.',{snapshotId},['snapshotId']),
  tool('query_normal_map','Read map route keys/names/requirements, nodes/enemies, gauge progress and threat summary before choosing ships. routeKey selects one route; nodeId returns that node threat.',
    {snapshotId,...mapArgs,nodeId:str('profile.mapPreview.nodes[].id.')},['snapshotId','area']),
  tool('evaluate_normal_route','Evaluate fleet (default 1) or scheme/schemeName on a map. routeKey adds selected/merged route arrival probability, blockers, per-node LoS gates and route-specific aircraft-loss air estimates. Probability excludes battle retreat.',
    {snapshotId,...mapArgs,fleet,...source},['snapshotId','area']),
  tool('recommend_normal_fleet','Recommend hulls/equipment with the page search. MCP defaults byRoute=true, airGoal=superiority. routeResults include notFound diagnostics and probabilities. routeKey restricts the exact route. Honors sortie filters/locks. Bounded search, not global optimization or victory guarantee.',
    {snapshotId,...mapArgs,...constraints,byRoute:bool('Default true; false uses preference search and is incompatible with routeKey.'),preference:enumOf(['all','shortest','strongest','lowestConsumption'],'Preference search only; default all.'),airGoal,limit:int(1,5,'Preference candidate count; route count uses global maxRoutes.')},['snapshotId','area']),
  tool('recommend_normal_equipment','Refit only equipment for supplied hulls/order and map/route. Starts unlocked slots empty, retains heldSlots.keep. Returns full scheme and route assessment; can fail if hulls cannot meet the route. No game change.',
    {snapshotId,...source,...mapArgs,heldSlots},['snapshotId','area'],true,exactlyOneSource),
  tool('preview_fleet','Build a read-only executable plan for a complete scheme or schemeName. Pins owned instances, lists donors/changes. Snapshot must still match live account; plan expires after 5 minutes.',
    {snapshotId,...source},['snapshotId'],true,exactlyOneSource),
  tool('execute_plan','GAME WRITE: apply previewed fleet members/order/equipment, possibly changing donor ships. Requires MCP enabled, automatic operations enabled by the player in experimental settings (default OFF), and idle executor. Reuse idempotencyKey after uncertain transport; do not retry partial jobs with a new key.',
    {planId:uuid('From preview_fleet.'),idempotencyKey:str('Caller-generated operation key.',{minLength:1,maxLength:128})},['planId','idempotencyKey'],false),
  tool('get_job','Read job progress/result/verification/partialApplied. Supply jobId or original idempotencyKey. After failure/cancel/interruption, inspect a new snapshot before replanning.',
    {jobId:uuid('Accepted job ID.'),idempotencyKey:str('Original operation key.')},[],true,{anyOf:[{required:['jobId']},{required:['idempotencyKey']}]}),
  tool('cancel_job','Stop subsequent automatic steps. Already sent game requests cannot roll back. Query job and capture new snapshot to inspect partial changes.',
    {jobId:uuid('Job to stop.')},['jobId'],false),
]);
const instructions='Fleet Advisor controls KanColle fleet composition/equipment through poi; it does not dispatch sorties/expeditions. Read status/contract, create a snapshot, then query/evaluate/recommend. IDs are owned instances unless labeled masterId. ships is the COMPLETE fleet, not a patch. Game presets store hulls only. Recommendations never change the game. To apply: preview_fleet -> execute_plan -> get_job, with one idempotency key. On partial failure inspect a new snapshot. Route probability excludes battle retreat. Keep unknown data unknown. Tools use fleet_advisor_ prefix.';
const SERVER_INFO={name:'poi-plugin-fleet-advisor',version:'1.0.2'};
const PROTOCOL_VERSION='2026-07-28';
const SUPPORTED_PROTOCOL_VERSIONS=['2025-03-26','2025-06-18','2025-11-25',PROTOCOL_VERSION];
const toolList=()=>TOOL_DEFS.map(t=>({name:t.name,description:t.description,
  annotations:{readOnlyHint:!!t.readOnly,destructiveHint:!t.readOnly},inputSchema:t.inputSchema}));
module.exports={TOOL_DEFS,instructions,SERVER_INFO,PROTOCOL_VERSION,SUPPORTED_PROTOCOL_VERSIONS,toolList};
