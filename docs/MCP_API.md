# Fleet Advisor 1.0 — MCP Agent Reference

Package: `poi-plugin-fleet-advisor`. Tool namespace: `fleet_advisor_`. Product version, MCP protocol version and contract version are independent identifiers.

Use this reference to query the account, evaluate and recommend fleets, manage temporary calculation schemes, preview changes and execute an approved fleet plan. The sections below define the current transport, constraints, result semantics and recovery workflow. The complete tool catalog is generated from runtime definitions. Game names and game-facing output may be localized; tool instructions and parameter definitions are in English.

## Connection

Connect to the running poi plugin using **Streamable HTTP**. The default URL is `http://127.0.0.1:47615/mcp`. The player must enable MCP in plugin settings and allow poi to observe game data first. If the player changes the port, use the URL displayed in settings; port conflicts fail explicitly rather than selecting another port.

Only the HTTP URL is required. No authentication header, access token, separately installed Node.js runtime or stdio adapter is needed by the client. The service listens only on `127.0.0.1`, validates Host and rejects browser requests carrying Origin. Disabling MCP stops the service. The only service endpoint is `/mcp`; clients must use Streamable HTTP. A container, remote host or cloud agent cannot use its own loopback address to reach the player's computer.

## API reference

### Transport and protocol

Implementation reference: [MCP Streamable HTTP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx). Default protocol: `2026-07-28`; negotiated compatibility: `2025-03-26`, `2025-06-18`, `2025-11-25`.

Use stateless POST requests containing one JSON-RPC 2.0 message each. Responses are JSON; accepted notifications return HTTP 202. GET/DELETE return 405. No protocol sessions, GET/SSE stream or JSON-RPC batches are provided.

The following are protocol headers sent by the client implementation. Players do not need to configure them manually. No Authorization header or access token is required.

```http
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
```

Call `initialize`, send `notifications/initialized`, then use `tools/list` and `tools/call`. Allow several minutes for long recommendation requests. A disconnected client does not cancel an accepted execution job. All clients share one execution lock.

### Common input semantics

- `snapshotId`: UUID from `fleet_advisor_create_snapshot`. Immutable capture, sliding 15-minute TTL, at most five retained snapshots. Does not force a game refresh. Capture a new snapshot after account changes. `capturedAt` is capture time, not a claimed last game response timestamp.
- Ship/equipment IDs are **owned instance IDs**, never catalog/master IDs. Query results label catalog IDs `masterId`.
- `fleet`: 1-based fleet number. Expedition recommendation/equipment fitting targets fleets 2–4. Only normal fleets of up to six ships are supported.
- `scheme` / `schemeName`: mutually exclusive. Required-source tools need exactly one. Optional-source evaluations use the observed fleet when both are absent. The candidate scheme's `fleet` is its destination; do not pass a conflicting `fleet` argument.
- Game presets and the temporary scheme cache are different. Presets contain hull membership, not historical equipment. Unsynchronized/missing presets remain explicitly unknown; the tool never assumes they are empty saved loadouts.
- Saved schemes are disposable calculation cache (up to 200 records), not permanent configurations. Settings shows their actual disk usage, including recognized staging/corrupt files. Clearing schemes or all caches deletes records on disk and in memory. On `SCHEME_NOT_FOUND`, query names, recreate the scheme or supply inline JSON. Game presets, game state and execution/idempotency records are unaffected.
- The three categories share one `cacheLimitMiB` pool, without per-category byte quotas. Scheme writes first reclaim older computation files. `CACHE_CAPACITY_EXCEEDED` means the write did not fit (or files could not be reclaimed); the previous scheme remains committed. Reducing the shared limit can also evict schemes that cannot fit. Result, calculation and scheme caches are always enabled; legacy disabled preferences migrate to enabled. The player can adjust the shared capacity or clear individual categories. `get_status.schemes.enabled` remains true.
- Queries/recommendations/evaluations are read-only. The service has no tool to launch a sortie, dispatch an expedition, fight or buy resources.

#### Complete fleet scheme

```json
{
  "fleet": 2,
  "ships": [
    {"id": 1234, "slots": [20101, 20102, -1], "ex": 20103},
    {"id": 5678}
  ]
}
```

`ships` is the complete target fleet, in order. Items may be positive ship instance IDs, ship names, or objects with `id` / `name`. An equipment spec may be a positive instance ID, `-1`, `null`, `"empty"`, an equipment name, or `{"name":"…","star":4,"alv":7}`. Prefer exact IDs for reproducibility. Optional scheme metadata: `name`, `format`, `note`.

Omitting `slots` keeps the observed normal equipment. Providing `slots` defines the entire normal loadout: omitted trailing slots are emptied. Maximum five normal slots; their indices are **0–4**. `ex` is the already-open expansion slot; omit it to keep its item. `-1` / `null` / `"empty"` empties a slot. Borrowing equipment can change donor ships; preview reports affected IDs and transfers.

#### Manual constraints

`fixedShipIds` requires those hulls to be included; it does not specify positions. `excludedShipIds` prevents inclusion. They cannot overlap. Automatic filters come from the independent sortie/expedition settings; manual hulls override soft filters, while actual availability and legal equipment allocation are still checked. `planningOnly` means the result is not currently executable merely because recommendation succeeded.

`heldSlots` is a position-indexed array of up to six entries. Preserve holes with `null`. A row has `id`, optional `pin`, `slots` (up to five instance IDs / `-1` / `null`), `ex`, and `keep`. `pin:true` retains the hull in this position. `keep` keys are `"0"`–`"4"` or `"ex"`, with value `true`; these also retain the hull/position. A retained value `-1` deliberately leaves that slot empty. Retained equipment must exist, be equippable, and must not be claimed twice. Rows without pin/keep are not manual constraints.

```json
{
  "heldSlots": [
    {"id": 1234, "pin": true, "slots": [20101, null, null], "keep": {"0": true}},
    null,
    {"id": 5678, "pin": true}
  ]
}
```

Full recommendation may add other hulls. Equipment-only recommendation keeps exactly the supplied hulls and order. Both refit unlocked equipment from empty, so currently worn transport equipment does not bias sortie fitting. Final results are checked against manual constraints; invalid constraints are errors, never silently ignored.

#### Numeric conditions and paging

`evaluate_fleet.conditions` supports `enemyAirPower` (nonnegative integer), and `los:{coefficient:1..4,minimum?:number,maximum?:number}`. Bounds are nonnegative, minimum must not exceed maximum. For actual map routing, use `evaluate_normal_route`: node coefficients/thresholds come from that map. Current-fleet display coefficient 4 is not a substitute for a route's coefficient.

`query_ships` and `query_equipment`: default `limit=50` (1–100), `sort=instanceId`, `order=asc`. Ties break by instanceId ascending; unknown values sort last. Optional `fields` always retains `instanceId` and `name`; unavailable projected values are null. When using `nextCursor`, keep the same snapshot, filters, sort, order and fields. All sort/field allowlists are in the generated tables below. Equipment inventory lists individual instances; `query_equipment_options` instead groups legal replacements by master ID + improvement + proficiency.

### Output map

All successful tool calls return data in MCP `result.structuredContent`; `content` also supplies JSON text. Large ship/equipment pages use a compact text summary to avoid duplicating a large structured payload; text-only clients should request small `limit` and `fields`.

| Tool suffix | Important result fields |
| --- | --- |
| `get_status` | dataReady, mcpEnabled, activeJobId, recommendationFilters, capabilities, mcpHttp |
| `get_contract` | version=2, schemeSchema, semantics, workflow, limits and recovery rules |
| `create_snapshot` | snapshotId, capturedAt, expiresAt, shipCount, equipmentCount, fleets, resources |
| `query_fleets` | items: number, exists, ids, state, mission, remaining/returnAt, composition, totals, signals, issues, unknown |
| `query_fleet_presets` | synced, items: id, name, ids |
| `query_fleet_status` | source, heading, scheme, ships (equipment, aircraft, stats, badges), metrics, speed, expedition, bonusPercent, warnings; candidate statsSource labels observed raw stats |
| `query_ships` / `query_equipment` | snapshotId, total, items, nextCursor |
| `query_equipment_options` | shipId, slot, currentItemId, items: instanceId/id, masterId, count, category, stars/improvement, proficiency, current, statsText; use another owned instance when equipping multiple copies |
| `save_scheme` / `query_schemes` / `delete_scheme` | saved record + warnings / filtered total and records / deleted=true + removed record |
| `evaluate_fleet` | valid, supportedChecks, unsupportedChecks, metrics, donorShipIds, reason when invalid |
| `query_expeditions` | missions: requirements, rewards, minutes, unlocked, completion, status, unlocks, income reference |
| `evaluate_expedition` | eligible, checks, greatSuccess, fleetBusy, ships, income |
| `recommend_expedition_fleet` | recommendations, optional closestRecommendation, goals.success, goals.great, selectionFilters, search; each candidate has scheme, evaluation, income |
| `recommend_expedition_equipment` | scheme, evaluation, warnings, drumTarget, income |
| `query_normal_maps` | maps: area, Boss/terminal nodes, branch catalog, source and static airControl |
| `query_normal_map` | routes, selectedRoute, progress, profile.mapPreview (nodes/enemies/edges), threat |
| `evaluate_normal_route` | verdict, probability, pointAssessments, selectedRoute, planning.chance, planning.losRequirements, arrival, fleetSummary.air (route losses), fleetSummary.los (node thresholds/current values) |
| `recommend_normal_fleet` | routeResults (including notFound), recommendations (scheme, routeKey, selectedPath, pathChance, scores, route, donorShipIds), selectionFilters, airGoalSummary, search |
| `recommend_normal_equipment` | scheme, variants, selectedPath, pathChance, evaluation (same selected-route metrics as evaluate_normal_route) |
| `preview_fleet` | planId, expiresAt, pinnedScheme, changed, done, targets, affectedShipIds, equipmentSteps |
| `execute_plan` / `get_job` / `cancel_job` | jobId, state, progress, result, error, verified, partialApplied; repeated idempotency key returns the same job |

Mechanism badges retain their structured numeric fields and multiline detail: combat speed, opening air/torpedo/ASW, anti-air, day/night attacks, night CI, contact, ground and ship-specific special attacks, smoke/illumination, and expedition morale/drums/income where applicable. No tag means its detector did not establish eligibility, not that the ship can never activate it. For candidate status, raw ship attributes/plane counts remain observed values; `metrics` and mechanisms evaluate before/after equipment changes explicitly.

Normal search always uses route requirements and a single combat score; default `airGoal=superiority`. `routeKey` narrows full search to that route; otherwise the global route limit and phase quotas match the page. Without explicit phase, map preview/evaluation uses observed progress (phase 1 planning if unknown); route catalogs/recommendations can include other phases. A route key itself identifies its phase.

Arrival excludes retreat/battle outcomes. `arrival` describes selected/merged route or overall Boss arrival according to the strategy; do not add probabilities from different recommended fleets. `fleetSummary.air.reference/estimate` contains selected-route per-node thresholds and aircraft-loss estimates. The map catalog field `airControl` contains static reference information; use route evaluation for loss-adjusted results. LoS gates may have different coefficients: read `planning.losRequirements` / `fleetSummary.los`, not just coefficient 4. Missing data remains unknown. Search is bounded; `notFound` does not prove a solution is impossible.

Expedition `eligible` and `greatSuccess` are separate. `income.rows[].net/greatNet` deduct fuel/ammo supply; catalog reference income is not the proposed fleet's income. Recommendation defaults to the plugin expedition goal setting; supply assumptions and uncertain probabilities remain explicit.

### Workflows

Monthly expedition fitting adjusts unlocked equipment against firepower, anti-air, ASW and LoS deficits, including bounded joint exchanges of scarce items. It reserves mandatory drums and manual slots, allocates owned available instances, and checks dispatch attributes again after reward fitting. Evaluation removes original raw/blue bonuses before adding the candidate outfit, uses expedition-specific improvement rules, and uses full aircraft capacity. Unresolved aircraft contributions use a conservative lower bound: a total check with `estimated=true` reports that bound in `left`, explains it in `detail`, and is satisfied only when the bound itself meets `right`. These are dispatch stats, not combat power or formula-33 LoS.

If the initial attribute-fitting shortlist fails, an additional bounded search ranks bare hull stats and compatible equipment-slot potential, without current-panel dominance pruning. Potential is only a ranking heuristic; every returned outfit is allocated and evaluated again. `search.rescue` indicates that this retry ran; `search.fitted` counts distinct hull sets that completed fitting and preview validation. Shortlists deduplicate hull sets, retain at most 64 alternatives per ranking, and try a small beam before widening. Fitting also expands stalled raw-stat equipment shortlists to include known blue-bonus enablers. When extra great-success drums prevent eligibility, it retries with mandatory drums before returning a closest reference. Manual gear, empty slots, filters and availability remain binding.

When expedition `recommendations` is empty, `closestRecommendation` may contain the nearest previewable reference found by the bounded search. It has `status="closest"`, `departureReady=false`, `evaluation.eligible=false`, and `shortfalls` (numeric entries include `actual`, `required`, `missing`). The same fields may appear under each goal. It respects filters, inventory and manual constraints; it is not an eligible recommendation or a proof that no feasible outfit exists. Adjust and re-evaluate before treating a reference as dispatch-ready. If no usable reference can be assembled, this field is absent. `planningOnly` has the same meaning as on ordinary recommendations.

1. Observe: `get_status` → `create_snapshot` → `query_fleets` / `query_fleet_presets` → `query_fleet_status`. A returned scheme can be copied into a different destination fleet by changing its `fleet`, then evaluated/previewed.
2. Normal map: `query_normal_map` → choose exact `routes[].key` → `recommend_normal_fleet` with routeKey + optional locks → use returned scheme → optionally `query_equipment_options` / edit scheme / `recommend_normal_equipment` → `evaluate_normal_route`.
3. Expedition: `query_expeditions` → `recommend_expedition_fleet` → select success/great result → optionally `recommend_expedition_equipment` → `evaluate_expedition`.
4. Apply: first check `get_status.experimentalSettings.automaticOperations` / `capabilities.execute`. Automatic operations default **OFF**, including migrated older settings. Only the player can enable Settings → Experimental features → Automatic operations; MCP cannot grant this permission. Then `preview_fleet` on the full scheme → inspect affected ships/transfers → `execute_plan` using its planId and one unique idempotencyKey → poll `get_job` → capture a new snapshot. Only this flow changes the game. Turning the permission OFF blocks new executions and stops subsequent steps of an accepted job; queries, recommendations, evaluation, preview and job inspection remain available. Already sent game changes cannot be undone.

`get_status.experimentalSettings.performanceDebug` reports the player's optional local performance logging switch (default OFF). It does not grant execution permission, bypass caches, alter recommendations, or expose account snapshots in diagnostic logs. Players manage these files in Settings → Cache files → Log cache. MCP cannot change experimental settings.

Example read-only tool call:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "fleet_advisor_evaluate_normal_route",
    "arguments": {
      "snapshotId": "<UUID returned by create_snapshot>",
      "area": "5-2",
      "routeKey": "<key returned by query_normal_map>",
      "fleet": 1
    }
  }
}
```

Plans expire in five minutes and are invalidated by relevant live account changes. One active execution across all clients. `cancel_job` stops subsequent operations; no rollback of already-applied changes. After uncertain network response, look up the same idempotencyKey before considering any new operation.

### Errors, resources and verification

Tool errors use `result.isError=true`, with `structuredContent.error:{code,message,details,retryable,nextAction}`. Invalid arguments, unknown keys, impossible/duplicate manual locks and contradictory sources fail explicitly. `INVALID_QUERY`, `INVALID_SCHEME`, `SNAPSHOT_EXPIRED`, `STATE_CHANGED`, `PLAN_EXPIRED`, `BUSY`, `PERMISSION_DENIED`, `JOB_NOT_FOUND` and scheme-cache errors are stable codes. `retryable` never authorizes replaying a partially applied game operation. Origin/Host rejection uses HTTP 403, oversized input 413; unknown methods/tools use JSON-RPC errors.

`AUTOMATIC_OPERATIONS_DISABLED` is non-retryable: ask the player to enable automatic operations in experimental settings. Enabling MCP alone does not grant execution permission. Reusing a previously accepted idempotency key may still return that same historical job; it never starts another operation.

`resources/list` exposes `poi-plugin-fleet-advisor://contract/v2`; `resources/read` returns the same JSON contract as `get_contract`. Tool schemas reject unknown parameters without coercion or silent stripping.

Offline protocol/page/constraint/loopback-boundary tests are part of root `npm test`; there is no separate MCP dependency installation. Optional **read-only** live check (no compilation, fitting or game changes): set `POI_FLEET_ADVISOR_MCP_URL` if needed, then run `node tools/live/smoke-mcp.mjs`. It reports counts, not account details. Offline tests do not count as actual game-operation acceptance.

Regenerate the parameter catalog after changing tools: `node tools/dev/generate-mcp-reference.js`. The regression suite checks that documentation matches the tool definitions.

### Complete tool catalog

<!-- BEGIN GENERATED TOOL REFERENCE -->

#### `fleet_advisor_get_status`

Read data readiness, MCP permission, active job, global recommendation filters and supported capabilities.

Effect: **read-only**.

Parameters: `{}`.

#### `fleet_advisor_get_contract`

Read scheme JSON format, ID/slot semantics, workflow, calculation limits and stable error conventions.

Effect: **read-only**.

Parameters: `{}`.

#### `fleet_advisor_create_snapshot`

Capture account data already observed by poi. Does not refresh the game. Subsequent queries/recommendations use this immutable snapshot.

Effect: **read-only**.

Parameters: `{}`.

#### `fleet_advisor_query_fleets`

List four actual fleets: members, expedition state/return time, supply, aircraft, damage, fatigue and repair summaries.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |

#### `fleet_advisor_query_fleet_presets`

List game presets and synchronization state. Presets store hull membership only; inspecting one uses each ship current equipment.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |

#### `fleet_advisor_query_fleet_status`

Inspect actual fleet (default 1), presetId, or scheme/schemeName. Returns equipment/aircraft, HP/supply, air power, all LoS coefficients, speed, combat+expedition tags and numeric attack/rate details. Read-only; unsynchronized data stays unknown.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `fleet` | integer | no | Observed/destination fleet number, 1-based. minimum=1; maximum=4 |
| `presetId` | integer | no | minimum=1 |
| `scheme` | object | no | — |
| `schemeName` | string | no | Exact local scheme name. minLength=1; maxLength=64 |

#### `fleet_advisor_query_ships`

Page owned ship instances. Prefer small limit and fields. sort=level, order=desc, limit=1 finds the highest-level ship without scanning the account.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `limit` | integer | no | Default 50. minimum=1; maximum=100 |
| `cursor` | string | no | Opaque nextCursor; retain all other query arguments when paging. |
| `name` | string | no | Name substring, simplified/traditional matching. |
| `fleet` | integer | no | Observed/destination fleet number, 1-based. minimum=1; maximum=4 |
| `shipType` | integer | no | minimum=1 |
| `sort` | `instanceId` / `masterId` / `name` / `shipType` / `level` / `condition` | no | Default instanceId. |
| `order` | `asc` / `desc` | no | Default asc. |
| `fields` | array<`instanceId` / `masterId` / `name` / `shipType` / `level` / `fleet` / `position` / `expedition` / `repairing` / `locked` / `hp` / `maxHp` / `condition` / `fuel` / `ammo` / `speed` / `firepower` / `torpedo` / `antiAir` / `armor` / `evasion` / `antiSubmarine` / `lineOfSight` / `luck` / `slots` / `slotCapacity` / `expansionOpen` / `expansionItemId` / `attributeSource`> | no | Optional projection; instanceId/name always returned. |

#### `fleet_advisor_query_equipment`

Page individual owned equipment instances: owners, stats, stars and proficiency. targetShipId/slot tests equippability. Does not merge instances.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `limit` | integer | no | Default 50. minimum=1; maximum=100 |
| `cursor` | string | no | Opaque nextCursor; retain all other query arguments when paging. |
| `name` | string | no | Name substring. |
| `location` | `free` / `ship` / `airbase` | no | Current location. |
| `type` | integer | no | minimum=1 |
| `improvement` | integer | no | minimum=0; maximum=10 |
| `targetShipId` | integer | no | minimum=1 |
| `slot` | integer or `ex` | no | Zero-based normal slot 0..4, or ex. Five-slot ships supported. |
| `availableOnly` | boolean | no | Exclude unavailable donors and airbases. |
| `equipableOnly` | boolean | no | Requires targetShipId. |
| `sort` | `instanceId` / `masterId` / `name` / `type` / `improvement` / `proficiency` | no | Default instanceId. |
| `order` | `asc` / `desc` | no | Default asc. |
| `fields` | array<`instanceId` / `masterId` / `name` / `type` / `iconType` / `improvement` / `proficiency` / `locked` / `location` / `sourceShipId` / `sourceSlot` / `baseIndex` / `sourceAvailable` / `equipable` / `equipableReason` / `baseStats`> | no | Optional projection; instanceId/name always returned. |

#### `fleet_advisor_query_equipment_options`

List legal slot replacements grouped by master ID, stars and proficiency, ordered by category. Returns selectable instance, count, stats and current highlight. Optional scheme reserves equipment worn by its other ships.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `shipId` | integer | yes | minimum=1 |
| `slot` | integer or `ex` | yes | Zero-based normal slot 0..4, or ex. Five-slot ships supported. |
| `scheme` | object | no | — |
| `search` | string | no | Name/category search. |

#### `fleet_advisor_save_scheme`

Cache a full temporary scheme locally, without game changes. Scheme cache is always enabled (get_status.schemes.enabled=true). Shares the disk limit with result/calculation caches; CACHE_CAPACITY_EXCEEDED means no scheme was saved. Cache cleanup may delete it; not permanent storage. Collision requires overwrite=true. Optional snapshot validation adds warnings.

Effect: **temporary local scheme cache write**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `name` | string | yes | Exact local scheme name. minLength=1; maxLength=64 |
| `scheme` | object | yes | — |
| `overwrite` | boolean | no | Explicitly overwrite this name. |
| `validateWithSnapshotId` | uuid | no | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |

#### `fleet_advisor_query_schemes`

Read temporary scheme cache, separate from game presets. name is exact; search is substring. Returns full schemes and filtered total. After cache cleanup, recreate missing schemes or pass inline scheme JSON.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `name` | string | no | Exact local scheme name. minLength=1; maxLength=64 |
| `search` | string | no | Name substring. |
| `offset` | integer | no | minimum=0 |
| `limit` | integer | no | minimum=1; maximum=100 |

#### `fleet_advisor_delete_scheme`

Delete a temporary cached scheme, not a game preset. Returns the deleted scheme for recovery through save_scheme.

Effect: **temporary local scheme cache write**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `name` | string | yes | Exact local scheme name. minLength=1; maxLength=64 |

#### `fleet_advisor_evaluate_fleet`

Validate candidate structure, instance availability, equipment, air-power range, LoS, speed and opening ASW. For routing and route-loss air estimates use evaluate_normal_route.

Effect: **read-only**.

Exactly one of `scheme` / `schemeName` is required.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `scheme` | object | no | — |
| `schemeName` | string | no | Exact local scheme name. minLength=1; maxLength=64 |
| `conditions` | object | no | — |

#### `fleet_advisor_query_expeditions`

Read requirements, rewards, duration, unlock/completion/running state and reference net hourly income. evaluate_expedition returns actual candidate net income.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `missionId` | integer | no | minimum=1 |
| `search` | string | no | Number/name/duration/resource search. |
| `sort` | `number` / `short` / `long` / `fuel` / `ammo` / `steel` / `bauxite` | no | Default number; resources sort by reference net hourly income. |

#### `fleet_advisor_evaluate_expedition`

Evaluate observed fleet (default 2) or scheme/schemeName: dispatch checks, estimated great-success probability and success/great net rewards after resupply. Does not dispatch.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `fleet` | integer | no | Observed/destination fleet number, 1-based. minimum=1; maximum=4 |
| `missionId` | integer | yes | minimum=1 |
| `scheme` | object | no | — |
| `schemeName` | string | no | Exact local scheme name. minLength=1; maxLength=64 |

#### `fleet_advisor_recommend_expedition_fleet`

Recommend expedition ships/equipment with independent filters. Returns success/great goals, checks, probability and net income. If no eligible result exists, closestRecommendation is an explicitly ineligible reference with shortfalls; never treat it as dispatch-ready. Honors manual locks; read-only.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `missionId` | integer | yes | minimum=1 |
| `goal` | `success` / `great` | no | success: prefer unsparkled automatic hulls, meet dispatch requirements, then optimize net income; spare slots may hold drums that improve great-success probability. great: prioritize estimated great-success probability. Manual hulls/equipment remain fixed. |
| `fleet` | integer | no | Default 2. minimum=2; maximum=4 |
| `fixedShipIds` | array<integer> | no | Owned ship INSTANCE IDs, not catalog IDs. maxItems=6 |
| `excludedShipIds` | array<integer> | no | — |
| `heldSlots` | array<null or object> | no | Position-indexed draft with null holes. pin or keep retains the hull and, by default, its position. Set holdPosition=false to allow fleet sorting. keep keys retain exact equipment or -1 for empty. Unlocked equipment is refitted from empty. maxItems=6 |
| `fixedFlagshipId` | integer | no | minimum=1 |
| `limit` | integer | no | minimum=1; maximum=5 |

#### `fleet_advisor_recommend_expedition_equipment`

Refit equipment only; preserve supplied hulls/order. Returns full scheme, dispatch checks, great-success estimate and net income. Only heldSlots.keep equipment is retained. No game change.

Effect: **read-only**.

Exactly one of `scheme` / `schemeName` is required.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `scheme` | object | no | — |
| `schemeName` | string | no | Exact local scheme name. minLength=1; maxLength=64 |
| `missionId` | integer | yes | minimum=1 |
| `goal` | `success` / `great` | no | success: prefer unsparkled automatic hulls, meet dispatch requirements, then optimize net income; spare slots may hold drums that improve great-success probability. great: prioritize estimated great-success probability. Manual hulls/equipment remain fixed. |
| `heldSlots` | array<null or object> | no | Position-indexed draft with null holes. pin or keep retains the hull and, by default, its position. Set holdPosition=false to allow fleet sorting. keep keys retain exact equipment or -1 for empty. Unlocked equipment is refitted from empty. maxItems=6 |

#### `fleet_advisor_query_normal_maps`

List supported map IDs, route rules, Boss/terminal nodes and static air thresholds. For routes/progress/nodes/enemies use query_normal_map.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |

#### `fleet_advisor_query_normal_map`

Read map route keys/names/requirements, nodes/enemies, gauge progress and threat summary before choosing ships. routeKey selects one route; nodeId returns that node threat.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `area` | string | yes | Normal map ID, e.g. 5-2. pattern=^[1-7]-[1-6]$ |
| `target` | string | no | Destination node or boss (default). 1-6 requires target=N. pattern=^(boss\|[A-Z][0-9]?)$ |
| `phase` | `gauge1` / `gauge2` / `gauge3` / `gimmick` | no | Optional gauge phase. Route recommendations otherwise include stage quotas; single-map evaluation uses observed stage, or phase 1 planning if unknown. |
| `routeKey` | string | no | Exact query_normal_map.routes[].key, including merged branches and speed strategies. |
| `nodeId` | string | no | profile.mapPreview.nodes[].id. |

#### `fleet_advisor_evaluate_normal_route`

Evaluate fleet (default 1) or scheme/schemeName on a map. routeKey adds selected/merged route arrival probability, blockers, per-node LoS gates and route-specific aircraft-loss air estimates. Probability excludes battle retreat.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `area` | string | yes | Normal map ID, e.g. 5-2. pattern=^[1-7]-[1-6]$ |
| `target` | string | no | Destination node or boss (default). 1-6 requires target=N. pattern=^(boss\|[A-Z][0-9]?)$ |
| `phase` | `gauge1` / `gauge2` / `gauge3` / `gimmick` | no | Optional gauge phase. Route recommendations otherwise include stage quotas; single-map evaluation uses observed stage, or phase 1 planning if unknown. |
| `routeKey` | string | no | Exact query_normal_map.routes[].key, including merged branches and speed strategies. |
| `fleet` | integer | no | Observed/destination fleet number, 1-based. minimum=1; maximum=4 |
| `scheme` | object | no | — |
| `schemeName` | string | no | Exact local scheme name. minLength=1; maxLength=64 |

#### `fleet_advisor_recommend_normal_fleet`

Recommend hulls/equipment with the page search. Defaults to route-based search and airGoal=superiority. routeResults include notFound diagnostics and probabilities. routeKey restricts the exact route. Honors sortie filters/locks. Bounded search, not global optimization or victory guarantee.

Effect: **read-only**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `area` | string | yes | Normal map ID, e.g. 5-2. pattern=^[1-7]-[1-6]$ |
| `target` | string | no | Destination node or boss (default). 1-6 requires target=N. pattern=^(boss\|[A-Z][0-9]?)$ |
| `phase` | `gauge1` / `gauge2` / `gauge3` / `gimmick` | no | Optional gauge phase. Route recommendations otherwise include stage quotas; single-map evaluation uses observed stage, or phase 1 planning if unknown. |
| `routeKey` | string | no | Exact query_normal_map.routes[].key, including merged branches and speed strategies. |
| `fleet` | integer | no | Observed/destination fleet number, 1-based. minimum=1; maximum=4 |
| `fixedShipIds` | array<integer> | no | Owned ship INSTANCE IDs, not catalog IDs. maxItems=6 |
| `excludedShipIds` | array<integer> | no | — |
| `heldSlots` | array<null or object> | no | Position-indexed draft with null holes. pin or keep retains the hull and, by default, its position. Set holdPosition=false to allow fleet sorting. keep keys retain exact equipment or -1 for empty. Unlocked equipment is refitted from empty. maxItems=6 |
| `airGoal` | `ignore` / `superiority` / `supremacy` | no | MCP default superiority. Conservative aircraft-loss estimates are not combat guarantees. |

#### `fleet_advisor_recommend_normal_equipment`

Refit only equipment for supplied hulls/order and map/route. Starts unlocked slots empty, retains heldSlots.keep. Returns full scheme and route assessment; can fail if hulls cannot meet the route. No game change.

Effect: **read-only**.

Exactly one of `scheme` / `schemeName` is required.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `scheme` | object | no | — |
| `schemeName` | string | no | Exact local scheme name. minLength=1; maxLength=64 |
| `area` | string | yes | Normal map ID, e.g. 5-2. pattern=^[1-7]-[1-6]$ |
| `target` | string | no | Destination node or boss (default). 1-6 requires target=N. pattern=^(boss\|[A-Z][0-9]?)$ |
| `phase` | `gauge1` / `gauge2` / `gauge3` / `gimmick` | no | Optional gauge phase. Route recommendations otherwise include stage quotas; single-map evaluation uses observed stage, or phase 1 planning if unknown. |
| `routeKey` | string | no | Exact query_normal_map.routes[].key, including merged branches and speed strategies. |
| `heldSlots` | array<null or object> | no | Position-indexed draft with null holes. pin or keep retains the hull and, by default, its position. Set holdPosition=false to allow fleet sorting. keep keys retain exact equipment or -1 for empty. Unlocked equipment is refitted from empty. maxItems=6 |

#### `fleet_advisor_preview_fleet`

Build a read-only executable plan for a complete scheme or schemeName. Pins owned instances, lists donors/changes. Snapshot must still match live account; plan expires after 5 minutes.

Effect: **read-only**.

Exactly one of `scheme` / `schemeName` is required.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `snapshotId` | uuid | yes | Immutable snapshot ID from create_snapshot. Sliding TTL: 15 minutes. |
| `scheme` | object | no | — |
| `schemeName` | string | no | Exact local scheme name. minLength=1; maxLength=64 |

#### `fleet_advisor_execute_plan`

GAME WRITE: apply previewed fleet members/order/equipment, possibly changing donor ships. Requires MCP enabled, automatic operations enabled by the player in experimental settings (default OFF), and idle executor. Reuse idempotencyKey after uncertain transport; do not retry partial jobs with a new key.

Effect: **game write**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `planId` | uuid | yes | From preview_fleet. |
| `idempotencyKey` | string | yes | Caller-generated operation key. minLength=1; maxLength=128 |

#### `fleet_advisor_get_job`

Read job progress/result/verification/partialApplied. Supply jobId or original idempotencyKey. After failure/cancel/interruption, inspect a new snapshot before replanning.

Effect: **read-only**.

Provide `jobId` or `idempotencyKey`.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `jobId` | uuid | no | Accepted job ID. |
| `idempotencyKey` | string | no | Original operation key. |

#### `fleet_advisor_cancel_job`

Stop subsequent automatic steps. Already sent game requests cannot roll back. Query job and capture new snapshot to inspect partial changes.

Effect: **stop subsequent game steps**.

| Parameter | Type / allowed values | Required | Meaning / constraints |
| --- | --- | --- | --- |
| `jobId` | uuid | yes | Job to stop. |

<!-- END GENERATED TOOL REFERENCE -->
