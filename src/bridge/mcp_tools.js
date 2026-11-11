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
const source={scheme:schemeSchema};
const slot={oneOf:[int(0,4),enumOf(['ex'],'Expansion slot.')],description:'Zero-based normal slot 0..4, or ex. Five-slot ships supported.'};
const nullableItem={oneOf:[int(1),{type:'integer',const:-1},{type:'null'}]};
const heldSlots={type:'array',maxItems:6,description:'Position-indexed draft with null holes. pin or keep retains the hull and, by default, its position. Set holdPosition=false to allow fleet sorting. keep keys retain exact equipment or -1 for empty. Unlocked equipment is refitted from empty.',items:{oneOf:[{type:'null'},object({
  id:int(1),pin:bool('Retain this hull. Its array position is held unless holdPosition=false.'),holdPosition:bool('Default true. Set false to retain the hull/equipment while allowing fleet sorting.'),slots:{type:'array',maxItems:5,items:nullableItem},ex:nullableItem,
  keep:object(Object.fromEntries(['0','1','2','3','4','ex'].map(k=>[k,{type:'boolean',const:true}]))),
},['id'])]}};
const mapArgs={area:str('Normal map ID, e.g. 5-2.',{pattern:'^[1-7]-[1-6]$'}),
  target:str('Destination node or boss (default). 1-6 requires target=N.',{pattern:'^(boss|[A-Z][0-9]?)$'}),
    phase:enumOf(['gauge1','gauge2','gauge3','gimmick'],'Optional gauge phase. Evaluation and fleet recommendations default to the observed stage, or phase 1 planning if unknown. Set phase to plan another stage; fleet recommendations search only that stage. An explicit routeKey can identify its own stage.'),
  routeKey:str('Exact query_normal_map.routes[].key, including merged branches and speed strategies.')};
const constraints={fleet,fixedShipIds:ids,excludedShipIds:{type:'array',uniqueItems:true,items:int(1)},heldSlots};
const airGoal=enumOf(['ignore','superiority','supremacy'],'MCP default superiority. A six-submarine 2-3 fleet prioritizes torpedo combat over the default superiority preference; its actual air status is still reported. Explicit supremacy remains prioritized. Conservative aircraft-loss estimates are not combat guarantees.');
const goal=enumOf(['success','great'],'success: meet dispatch requirements, prefer unsparkled automatic hulls while considering resource cost, and optimize net income; spare slots may hold drums that improve great-success probability. great: prioritize estimated great-success probability. Manual hulls/equipment remain fixed.');
const paging={snapshotId,limit:int(1,100,'Default 50.'),cursor:str('Opaque nextCursor; retain all other query arguments when paging.')};
const sorting=(keys,fields)=>({sort:enumOf(keys,'Default instanceId.'),order:enumOf(['asc','desc'],'Default asc.'),
  fields:{type:'array',items:enumOf(fields,'Projected field.'),description:'Optional projection; instanceId/name always returned.'}});
const tool=(suffix,description,properties={},required=[],readOnly=true,extra={})=>({name:'fleet_advisor_'+suffix,description,readOnly,inputSchema:{...object(properties,required),...extra}});
const TOOL_DEFS=Object.freeze([
  tool('get_status','Read data readiness, MCP permission, active job, global recommendation filters and supported capabilities.'),
  tool('get_contract','Read scheme JSON format, ID/slot semantics, workflow, calculation limits and stable error conventions.'),
  tool('create_snapshot','Capture account data already observed by poi. Does not refresh the game. Subsequent queries/recommendations use this immutable snapshot.'),
  tool('query_quests','Read all currently available quests in the background without opening the game quest screen. Guarded game requests collect the full list; if interrupted or incomplete, status is not ready and no partial list is returned. Period uses catalog or game label; unknown values remain null.',
    {category:enumOf(['sortie','expedition','practice','other'],'Game quest category.'),period:enumOf(['daily','weekly','monthly','quarterly','yearly','once','limited'],'Catalog period; unmatched quests are excluded and counted as unknown.'),state:enumOf(['available','active','complete'],'Game quest state.'),search:str('Title or description substring.'),offset:int(0),limit:int(1,100,'Default 50.')}),
  tool('query_fleets','List four actual fleets: members, expedition state/return time, supply, aircraft, damage, fatigue and repair summaries.',{snapshotId},['snapshotId']),
  tool('query_fleet_presets','List game presets and synchronization state. Presets store hull membership only; inspecting one uses each ship current equipment.',{snapshotId},['snapshotId']),
  tool('query_fleet_status','Inspect actual fleet (default 1), presetId, or an inline scheme. Returns equipment/aircraft, HP/supply, air power, all LoS coefficients, speed, combat+expedition tags and numeric attack/rate details. Read-only; unsynchronized data stays unknown.',
    {snapshotId,fleet,presetId:int(1),...source},['snapshotId']),
  tool('query_ships','Page owned ship instances. Prefer small limit and fields. sort=level, order=desc, limit=1 finds the highest-level ship without scanning the account.',
    {...paging,name:str('Name substring, simplified/traditional matching.'),fleet,shipType:int(1),...sorting(SHIP_SORTS,SHIP_FIELDS)},['snapshotId']),
  tool('query_equipment','Page individual owned equipment instances: owners, stats, stars and proficiency. sourceAvailable includes equipment worn by repairing ships; expedition and airbase equipment remain unavailable. targetShipId/slot tests equippability. This is item availability, not permission to deploy a repairing hull or override the recommendation borrowing preference. Does not merge instances.',
    {...paging,name:str('Name substring.'),location:enumOf(['free','ship','airbase'],'Current location.'),type:int(1),improvement:int(0,10),targetShipId:int(1),slot,
      availableOnly:bool('Exclude unavailable donors and airbases.'),equipableOnly:bool('Requires targetShipId.'),...sorting(EQUIPMENT_SORTS,EQUIPMENT_FIELDS)},['snapshotId']),
  tool('query_equipment_options','List legal slot replacements grouped by master ID, stars and proficiency, ordered by category. Returns selectable instance, count, stats and current highlight. Optional scheme reserves equipment worn by its other ships.',
    {snapshotId,shipId:int(1),slot,scheme:schemeSchema,search:str('Name/category search.')},['snapshotId','shipId','slot']),
  tool('evaluate_fleet','Validate candidate structure, instance availability, equipment, air-power range, LoS, speed and opening ASW. For routing and route-loss air estimates use evaluate_normal_route.',
    {snapshotId,...source,conditions:object({enemyAirPower:int(0),los:object({coefficient:int(1,4),minimum:{type:'number',minimum:0},maximum:{type:'number',minimum:0}},['coefficient'])})},['snapshotId','scheme']),
  tool('query_expeditions','Read requirements, rewards, duration, unlock/completion/running state and reference net hourly income. evaluate_expedition calculates candidate income and identifies reference repair costs.',
    {snapshotId,missionId:int(1),search:str('Number/name/duration/resource search.'),sort:enumOf(['number','short','long','fuel','ammo','steel','bauxite'],'Default number; resources sort by reference net hourly income.')},['snapshotId']),
  tool('evaluate_expedition','Evaluate observed fleet (default 2) or an inline scheme: dispatch checks, estimated great-success probability and success/great net rewards after resupply. For combat expeditions income.repair describes a reference damage scenario, not an expected loss; net rows subtract its fuel/steel cost when known. Does not dispatch.',
    {snapshotId,fleet,missionId:int(1),...source},['snapshotId','missionId']),
  tool('recommend_expedition_fleet','Recommend expedition ships/equipment with independent filters. Honors the saved expedition borrowing setting: when disabled, use only unequipped inventory and equipment owned by ships in each proposed fleet. Returns success/great goals, checks, probability and net income. Combat expedition net income includes the explicitly labeled repair reference, not an observed or expected loss. If no eligible result exists, closestRecommendation is an explicitly ineligible reference with shortfalls; never treat it as dispatch-ready. Honors manual locks; read-only.',
    {snapshotId,missionId:int(1),goal,...constraints,fleet:int(2,4,'Default 2.'),fixedFlagshipId:int(1),limit:int(1,5)},['snapshotId','missionId']),
  tool('recommend_expedition_equipment','Refit equipment only; preserve supplied hulls/order. Honors the saved expedition borrowing setting: when disabled, use only unequipped inventory and equipment owned by the supplied hulls. A held item from another ship is a conflict. Returns full scheme, dispatch checks, great-success estimate and net income. Combat expedition net income includes the explicitly labeled repair reference, not an observed or expected loss. Only heldSlots.keep equipment is retained. No game change.',
    {snapshotId,...source,missionId:int(1),goal,heldSlots},['snapshotId','missionId','scheme']),
  tool('query_normal_maps','List supported map IDs, route rules, Boss/terminal nodes and static air thresholds. For routes/progress/nodes/enemies use query_normal_map.',{snapshotId},['snapshotId']),
  tool('query_normal_map','Read map route keys/names/requirements, nodes/enemies, gauge progress and threat summary before choosing ships. routeKey selects one route; nodeId returns that node threat.',
    {snapshotId,...mapArgs,nodeId:str('profile.mapPreview.nodes[].id.')},['snapshotId','area']),
  tool('evaluate_normal_route','Evaluate fleet (default 1) or an inline scheme on a map. routeKey adds selected/merged route arrival probability, blockers, per-node LoS gates and route-specific aircraft-loss air estimates. Probability excludes battle retreat.',
    {snapshotId,...mapArgs,fleet,...source},['snapshotId','area']),
  tool('recommend_normal_fleet','Recommend hulls/equipment for every curated route in the requested map/stage; no route-count cap. When all curated routes fail, automatically search a broad adaptive route. Adaptive routes cannot be requested directly. airGoal defaults to superiority. routeResults include notFound diagnostics and probabilities. routeKey restricts the exact non-adaptive route. Honors saved sortie filters/locks and equipment borrowing: when disabled, use only unequipped inventory and equipment owned by ships in each proposed fleet, including expansion slots. Clients cannot override this setting. Bounded search, not global optimization or victory guarantee.',
    {snapshotId,...mapArgs,...constraints,airGoal},['snapshotId','area']),
  tool('recommend_normal_equipment','Refit only equipment for supplied hulls/order and map/route. Starts unlocked slots empty, retains heldSlots.keep. On 2-3 a six-submarine fleet prioritizes torpedo combat over air superiority. Honors the saved sortie equipment-borrowing setting: when disabled, only unequipped inventory and equipment owned by the supplied hulls can be used. A held item from another ship is a conflict; do not silently discard it. Returns full scheme and route assessment; can fail if hulls cannot meet the route. No game change.',
    {snapshotId,...source,...mapArgs,heldSlots},['snapshotId','area','scheme']),

]);
const instructions='Fleet Advisor MCP is read-only. Read status/contract, create a snapshot, then query, evaluate or recommend using inline schemes. IDs are owned instances unless labeled masterId. ships is the COMPLETE fleet, not a patch. Game presets store hulls only. Recommendations do not change the game. Route probability excludes battle retreat. Keep unknown data unknown. Tools use fleet_advisor_ prefix.';
const SERVER_INFO={name:'poi-plugin-fleet-advisor',version:require('../../package.json').version};
const PROTOCOL_VERSION='2026-07-28';
const SUPPORTED_PROTOCOL_VERSIONS=['2025-03-26','2025-06-18','2025-11-25',PROTOCOL_VERSION];
const toolList=()=>TOOL_DEFS.map(t=>({name:t.name,description:t.description,
  annotations:{readOnlyHint:!!t.readOnly,destructiveHint:!t.readOnly},inputSchema:t.inputSchema}));
module.exports={TOOL_DEFS,instructions,SERVER_INFO,PROTOCOL_VERSION,SUPPORTED_PROTOCOL_VERSIONS,toolList};
