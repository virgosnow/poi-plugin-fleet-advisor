'use strict';
// Pure plan creation; no host, session or game operation can be created here.
const {resolvePlan}=require('./organize_planner');
const {createEquipmentPlanner,snapshotMemo,hasEquipmentIndexCache}=require('./equipment_planner');

// A unified plan carries the fleet layout AND per-ship equipment in one
// ships array: {id/name, slots?, ex?}. Entries without slots/ex only take
// part in the organization stage; entries with them also get re-equipped
// after the fleet is settled (equipment re-resolves names from the live
// store, so name prefixes written against the pre-run roster still work).
function splitUnifiedScheme(scheme) {
  if (!Array.isArray(scheme.ships) || scheme.ships.length < 1 || scheme.ships.length > 6) throw new Error('Plan requires 1–6 ships');
  const orgShips=[],eqShips=[];
  for (const entry of scheme.ships) {
    if (typeof entry === 'number') { orgShips.push({id: entry}); continue; }
    if (typeof entry === 'string') { orgShips.push({name: entry}); continue; }
    if (!entry || (entry.id === undefined && entry.name === undefined)) throw new Error('舰条目缺id/name');
    const org={};
    if (entry.id !== undefined) org.id=entry.id;
    if (entry.name !== undefined) org.name=entry.name;
    orgShips.push(org);
    if (entry.slots !== undefined || entry.ex !== undefined) {
      const eq={};
      if (entry.id !== undefined) eq.id=entry.id;
      if (entry.name !== undefined) eq.name=entry.name;
      if (entry.slots !== undefined) eq.slots=entry.slots;
      if (entry.ex !== undefined) eq.ex=entry.ex;
      eqShips.push(eq);
    }
  }
  return {org:{fleet:scheme.fleet,ships:orgShips}, eq:{fleet:scheme.fleet,ships:eqShips}};
}


class FleetPlanner {
  constructor(getStore,{resolveOrganization=resolvePlan}={}){
    this.getStore=getStore;this.resolveOrganization=resolveOrganization;
  }
  // Internal immutable-search projection. Partial/name-based requests and live
  // callers retain full planning, including implicit donor-slot compaction.
  project(scheme){
    const store=this.getStore();
    const concrete=hasEquipmentIndexCache(store)&&Array.isArray(scheme.ships)&&scheme.ships.every(entry=>{
      const ship=store.info.ships[entry?.id],master=store.const.$ships[ship?.api_ship_id];
      const count=Number(master?.api_slot_num??ship?.api_slotnum??ship?.api_slot?.length);
      return Number.isInteger(entry?.id)&&entry.name===undefined&&Array.isArray(entry.slots)&&
        entry.slots.length===count&&entry.slots.every(id=>Number.isInteger(id)&&(id===-1||id>0))&&
        Number.isInteger(entry.ex)&&(entry.ex===-1||entry.ex>0);
    });
    if(!concrete)return this.preview('fleet',scheme);
    const {org,eq}=splitUnifiedScheme(scheme),organization=this.preview('organization',org);
    const equipment=createEquipmentPlanner(this.getStore).resolvePlan(eq,
      {fleetShips:organization.targets,projectionOnly:true});
    return {organization,equipment};
  }
  preview(kind,scheme) {
    if(kind==='organization')return snapshotMemo(this.getStore(),'organizationPlans',JSON.stringify(scheme),()=>this.resolveOrganization(this.getStore(),scheme));
    if(kind==='equipment')return createEquipmentPlanner(this.getStore).resolvePlan(scheme);
    if(kind==='fleet'){
      const {org,eq}=splitUnifiedScheme(scheme);
      const organization=this.preview('organization',org);
      const pinnedEq={...eq,ships:scheme.ships.flatMap((entry,i)=>
        entry && typeof entry==='object' && (entry.slots!==undefined||entry.ex!==undefined)
          ? [{...entry,id:organization.targets[i]}] : [])};
      const equipment=pinnedEq.ships.length
        ? createEquipmentPlanner(this.getStore).resolvePlan(pinnedEq,{fleetShips:organization.targets})
        : {fleet:organization.fleet,ships:[],expected:[],done:true,ok:true,changed:0};
      const pinned={org:{fleet:organization.fleet,ships:organization.targets.map(id=>({id}))},
        eq:{fleet:organization.fleet,ships:equipment.expected.filter(e=>pinnedEq.ships.some(s=>s.id===e.shipId))
          .map(e=>({id:e.shipId,slots:e.state.slots,ex:e.state.ex===0?'empty':e.state.ex}))}};
      const orgChanges=organization.targets.reduce((n,id,i)=>n+Number(organization.current[organization.fleet-1].ships[i]!==id),0)
        + Math.max(0,organization.current[organization.fleet-1].ships.length-organization.targets.length);
      return {kind:'fleet',fleet:organization.fleet,organization,equipment,pinned,
        done:organization.done&&equipment.done,changed:orgChanges+equipment.changed};
    }
    throw new Error('Unknown task kind');
  }
}
const createFleetPlanner=(getStore,options)=>new FleetPlanner(getStore,options);
module.exports={FleetPlanner,createFleetPlanner,splitUnifiedScheme};
