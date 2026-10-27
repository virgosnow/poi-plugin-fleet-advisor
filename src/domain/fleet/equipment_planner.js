'use strict';
const {selectShipByName}=require('./ship_selection');
const {matchingNames,matchesName}=require('../../shared/name_matching');
const R=require('./equipment_rules');

// Opt-in synchronous scope for immutable recommendation snapshots only.
// Live preview/execution never retain indexes, even if poi mutates a store in
// place. Every new search gets fresh indexes; exceptions also release them.
const indexScopes=new WeakMap();
function withEquipmentIndexCache(snapshot,calculate,scope=new Map()){
  const previous=indexScopes.get(snapshot);
  indexScopes.set(snapshot,scope);
  try{return calculate();}finally{
    if(previous)indexScopes.set(snapshot,previous);else indexScopes.delete(snapshot);
  }
}
// Shares the existing immutable, synchronous search lifetime. Outside that
// scope live validation always executes again. Failed checks are never retained.
function snapshotMemo(snapshot,namespace,key,calculate){
  const scope=indexScopes.get(snapshot);if(!scope)return calculate();
  let cache=scope.get(namespace);if(!cache){cache=new Map();scope.set(namespace,cache);}
  if(cache.has(key))return cache.get(key);
  const value=calculate();
  if(cache.size>=2048)cache.delete(cache.keys().next().value);
  cache.set(key,value);return value;
}
function createEquipmentPlanner(getStore) {
  const store = () => getStore();
  const info = () => store().info;
  const groupDefs = () => R.tables(store()).equipFilterCategories.map(c=>({...c,primary:c.icon??0}));
  const mstEquip = () => store().const.$equips || {};
  const masterOf = iid => { const e = info().equips[iid]; return e ? mstEquip()[e.api_slotitem_id] : null; };
  const itemName = iid => (masterOf(iid) || {}).api_name || ('?' + iid);
  const t3of = iid => { const m = masterOf(iid); return m && m.api_type ? Number(m.api_type[3]) : 0; };
  const t2of = iid => { const m = masterOf(iid); return m && m.api_type ? Number(m.api_type[2]) : 0; };
  const shipName = sid => { const s = info().ships[sid]; const m = s ? (store().const.$ships || {})[s.api_ship_id] : null; return (m || {}).api_name || ('?' + sid); };
  const fleetShipIds = f => ((info().fleets[f - 1] || {}).api_ship || []).filter(x => x > 0);

  function occupiedMap() {
    const occ = {};
    Object.keys(info().ships || {}).forEach(sid => {
      const state = currentState(sid);
      state.slots.forEach(x => { if (x > 0) occ[x] = true; });
      if (state.ex > 0) occ[state.ex] = true;
    });
    (info().airbase || []).forEach(ab => (ab.api_plane_info || []).forEach(p => {
      if (p && Number(p.api_slotid) > 0) occ[Number(p.api_slotid)] = true;
    }));
    return occ;
  }
  function sourceMap() {
    const sources={};
    for(const key of Object.keys(info().ships)) {
      const shipId=Number(key),state=currentState(shipId);
      state.slots.forEach((id,j)=>{if(id>0)sources[id]={shipId,j};});
      if(state.ex>0)sources[state.ex]={shipId,j:'ex'};
    }
    return sources;
  }
  function availableShip(sid) {
    return !info().fleets.some(f=>f.api_ship.includes(sid)&&f.api_mission[0]!==0)
      && info().ships[sid].api_situation!==2
      && !(info().repairs||[]).some(d=>Number(typeof d==='object'?d.api_ship_id:d)===sid);
  }
  function otherPickerList(category,sid,slot) {
    const sources=sourceMap(),rules=R.tables(store());
    return Object.entries(sources).filter(([,source])=>source.shipId!==sid).map(([key,source])=>{
      const id=Number(key),master=Number(info().equips[id].api_slotitem_id),m={...masterOf(id),api_id:master};
      return {id,master,t2:R.specialType(m,rules),t3:t3of(id),source};
    }).filter(e=>R.acceptsCategory({...masterOf(e.id),api_id:e.master},category,rules)
      &&canEquip(sid,e.id,slot)&&R.acceptsOtherSlot(store(),sid,e.id,slot))
      .sort((a,b)=>a.t2-b.t2||a.master-b.master||a.id-b.id);
  }
  function freeListAll() { // 全局序: t2 asc → master asc → id asc
    const occ = occupiedMap(), out = [];
    Object.keys(info().equips || {}).forEach(idStr => {
      const id = Number(idStr), e = info().equips[idStr];
      if (!e || occ[id]) return;
      const m = mstEquip()[e.api_slotitem_id];
      if (!m || !Array.isArray(m.api_type) || m.api_type.length < 4) throw new Error('装备master数据缺失: '+id);
      out.push({ id, t2: R.specialType({...m,api_id:e.api_slotitem_id},R.tables(store())), t3: Number(m.api_type[3]), master: Number(e.api_slotitem_id) });
    });
    out.sort((a, b) => a.t2 - b.t2 || a.master - b.master || a.id - b.id);
    return out;
  }
  const canEquip=(sid,iid,slot)=>R.canEquip(store(),sid,iid,slot);
  function freePickerList(category,sid,slot) {
    return freeListAll().filter(x=>R.acceptsCategory({...masterOf(x.id),api_id:x.master},category,R.tables(store()))&&canEquip(sid,x.id,slot));
  }
  function categoryFor(iid) {
    const m={...masterOf(iid),api_id:info().equips[iid].api_slotitem_id};
    return groupDefs().find(c=>c.id!==0&&R.acceptsCategory(m,c.id,R.tables(store())))||groupDefs().find(c=>c.id===0);
  }
  const categoryAccepts=(category,iid)=>R.acceptsCategory({...masterOf(iid),api_id:info().equips[iid].api_slotitem_id},category,R.tables(store()));

  // ================= 规划 =================
  // ============ kc-org/1 方案解析 (docs/scheme_format.md) ============
  function shipByName(name) {
    const masters=store().const.$ships||{};
    const roster=Object.entries(info().ships).map(([id,ship])=>({
      id:Number(id),name:masters[ship.api_ship_id]?.api_name||'',level:Number(ship.api_lv)
    }));
    return selectShipByName(roster,name);
  }
  function currentState(sid) {
    const sh = info().ships[sid];
    if (!sh) throw new Error('舰不存在: ' + sid);
    const master = (store().const.$ships || {})[sh.api_ship_id] || {};
    const count = Number(master.api_slot_num ?? sh.api_slotnum ?? (sh.api_slot || []).length);
    if (!Number.isInteger(count) || count < 0 || count > 5) throw new Error('未知舰船槽数: ' + sid);
    if (!Array.isArray(sh.api_slot) || sh.api_slot.length < count) throw new Error('舰船装备数据不完整: ' + sid);
    if (!Number.isInteger(sh.api_slot_ex) || sh.api_slot_ex < -1 || sh.api_slot.slice(0,count).some(id=>!Number.isInteger(id)||id===0||id < -1)) throw new Error('舰船装备实例数据不完整: '+sid);
    return { slots: (sh.api_slot || []).slice(0, count).map(Number), ex: Number(sh.api_slot_ex ?? 0) };
  }
  function sameState(a, b) {
    return a.ex === b.ex && a.slots.length === b.slots.length && a.slots.every((id,j) => id === b.slots[j]);
  }
  function resolvePlan(scheme, options={}) {
    const fleet = Number(scheme.fleet);
    if (!Number.isInteger(fleet) || fleet < 1 || fleet > 4) throw new Error('舰队编号需1-4');
    if (!Array.isArray(scheme.ships) || !scheme.ships.length || scheme.ships.length > 6) throw new Error('ships需1-6项');
    if (!info().fleets[fleet-1] || !Array.isArray(info().fleets[fleet-1].api_mission)) throw new Error('舰队数据不完整');
    if (info().fleets[fleet-1].api_mission[0] !== 0) throw new Error('目标舰队远征中');
    const plan = {fleet, fleetShips:options.fleetShips||fleetShipIds(fleet), ships:[], expected:[], notes:[]};
    const sources=sourceMap();
    const free = snapshotMemo(store(),'equipmentPlanningFree','all',()=>new Set(freeListAll().map(x => x.id))), seenShips = new Set(), requests = [];
    const concreteIds=options.projectionOnly?new Set():null;
    const drafts = scheme.ships.map(raw => {
      const sh = typeof raw === 'number' ? {id:raw} : typeof raw === 'string' ? {name:raw} : raw;
      if (!sh || (sh.id === undefined && sh.name === undefined)) throw new Error('舰条目缺id/name');
      const sid = sh.id === undefined ? shipByName(sh.name) : Number(sh.id);
      if (!Number.isInteger(sid) || !info().ships[sid]) throw new Error('舰不存在: '+sid);
      if (sh.name !== undefined && !matchesName(shipName(sid),sh.name)) throw new Error('舰名与实例ID不一致');
      if (!availableShip(sid)) throw new Error('目标舰远征或修理中: '+sid);
      if (seenShips.has(sid)) throw new Error('重复舰条目: '+sid);
      seenShips.add(sid);
      if (!plan.fleetShips.includes(sid)) throw new Error('目标舰不在方案舰队: '+sid);
      if (sh.slots !== undefined && !Array.isArray(sh.slots)) throw new Error('slots必须是数组');
      const before = currentState(sid), want = {slots:sh.slots === undefined ? before.slots.slice() : before.slots.map(()=>-1), ex:before.ex};
      if ((sh.slots || []).length > before.slots.length) throw new Error('方案超过实际槽数: '+sid);
      const draft = {shipId:sid, name:shipName(sid), before, want, ops:[]};
      const owned = new Set(before.slots.concat([before.ex]).filter(x => x > 0));
      function request(spec, j) {
        const current = j === 'ex' ? before.ex : before.slots[j];
        if (spec === undefined || spec === null || spec === 'any') {
          if(j==='ex')want.ex=current;else want.slots[j]=current;
          return;
        }
        if (spec === 'empty' || spec === -1) {
          if (j === 'ex') want.ex = before.ex === 0 ? 0 : -1; else want.slots[j] = -1;
          return;
        }
        if (j === 'ex' && before.ex === 0) throw new Error('未开放増設孔: '+sid);
        let candidates;
        if (typeof spec === 'number') {
          if (!Number.isInteger(spec) || spec <= 0 || !info().equips[spec]) throw new Error('装备实例不存在: '+spec);
          if(concreteIds){
            // Every slot is explicit in a search projection: there is no name
            // choice or implicit retained slot to solve by bipartite matching.
            if(!(free.has(spec)||owned.has(spec)||sources[spec]&&availableShip(sources[spec].shipId))||
              !canEquip(sid,spec,j)||!(owned.has(spec)||!sources[spec]||R.acceptsOtherSlot(store(),sid,spec,j)))
              throw new Error('无可用装备(排除基地、远征和修理中来源): '+spec);
            if(concreteIds.has(spec))throw new Error('装备数量不足或实例重复，无法一对一分配');
            concreteIds.add(spec);
            if(j==='ex')want.ex=spec;else want.slots[j]=spec;
            return;
          }
          candidates = [spec];
        } else {
          const obj = typeof spec === 'string' ? {name:spec} : spec;
          if (!obj || typeof obj.name !== 'string') throw new Error('非法装备条目');
          for (const [key,max] of [['star',10],['alv',7]]) if (obj[key] !== undefined && (!Number.isInteger(obj[key]) || obj[key]<0 || obj[key]>max)) throw new Error('非法 '+key);
          candidates = matchingNames(Object.keys(info().equips).map(Number),obj.name,itemName).filter(id => {
            const e = info().equips[id];
            return (obj.star === undefined || Number(e.api_level || 0) === obj.star) &&
              (obj.alv === undefined || Number(e.api_alv || 0) === obj.alv);
          });
        }
        candidates = candidates.filter(id => (free.has(id) || owned.has(id) || sources[id]&&availableShip(sources[id].shipId))
          &&canEquip(sid,id,j)&&(owned.has(id)||!sources[id]||R.acceptsOtherSlot(store(),sid,id,j)));
        candidates.sort((a,b) => (b===current)-(a===current) || Number(free.has(b))-Number(free.has(a)) || Number(owned.has(b))-Number(owned.has(a)) || Number(info().equips[a].api_level || 0)-Number(info().equips[b].api_level || 0) || Number(info().equips[a].api_alv || 0)-Number(info().equips[b].api_alv || 0) || a-b);
        if (!candidates.length) throw new Error('无可用装备(排除基地、远征和修理中来源): '+JSON.stringify(spec));
        requests.push({draft,j,candidates});
      }
      (sh.slots || []).forEach((spec,j) => request(spec,j)); request(sh.ex,'ex');
      return draft;
    });
    if(concreteIds){
      // Refuse accidental use with partial/flexible requests. FleetPlanner
      // falls back to full preview for those schemes, including donor effects.
      if(scheme.ships.some((entry,i)=>!Number.isInteger(entry.id)||entry.name!==undefined||
        !Array.isArray(entry.slots)||entry.slots.length!==drafts[i].before.slots.length||
        !entry.slots.concat(entry.ex).every(id=>Number.isInteger(id)&&(id===-1||id>0))))
        throw new Error('搜索投影需要完整的装备实例');
      for(const d of drafts)for(const state of [d.before,d.want]){
        const firstEmpty=state.slots.indexOf(-1);
        if(firstEmpty>=0&&state.slots.slice(firstEmpty+1).some(id=>id>0))throw new Error('普通装备槽不能在空槽后指定装备: '+d.shipId);
      }
      const initial=snapshotMemo(store(),'equipmentPlanningStates','all',()=>Object.keys(info().ships).map(id=>[Number(id),currentState(id)]));
      const unique=snapshotMemo(store(),'equipmentProjectionOwnership','unique',()=>{
        const seen=new Set();
        for(const [,state]of initial)for(const id of state.slots.concat(state.ex))if(id>0){
          if(seen.has(id))return false;seen.add(id);
        }
        return true;
      });
      if(!unique)return resolvePlan(scheme,{...options,projectionOnly:false});
      return {fleet,expected:drafts.map(d=>({shipId:d.shipId,state:{slots:d.want.slots.slice(),ex:d.want.ex}}))};
    }
    // Bipartite assignment: explicit IDs and constrained requests cannot be
    // consumed twice by earlier unconstrained name requests.
    const owners = new Map(), assigned = new Map();
    function assign(r, visited) {
      // Use an unallocated candidate before moving a previously satisfied slot.
      for (const id of r.candidates) {
        if (!visited.has(id) && !owners.has(id)) {
          visited.add(id); owners.set(id,r); assigned.set(r,id); return true;
        }
      }
      for (const id of r.candidates) {
        if (visited.has(id)) continue;
        visited.add(id);
        const prior = owners.get(id);
        if (!prior || assign(prior, visited)) { owners.set(id,r); assigned.set(r,id); return true; }
      }
      return false;
    }
    requests.slice().sort((a,b)=>a.candidates.length-b.candidates.length).forEach(r => {
      if (!assign(r,new Set())) throw new Error('装备数量不足或实例重复，无法一对一分配');
    });
    for (const r of requests) {
      const id = assigned.get(r);
      if (r.j === 'ex') r.draft.want.ex = id; else r.draft.want.slots[r.j] = id;
    }
    // Remove implicit source references when an instance was explicitly
    // assigned elsewhere. Explicit requests remain globally exclusive.
    for(const d of drafts) {
      d.want.slots.forEach((id,j)=>{
        const r=owners.get(id);
        if(r&&(r.draft!==d||r.j!==j)&&!requests.some(q=>q.draft===d&&q.j===j))d.want.slots[j]=-1;
      });
      const r=owners.get(d.want.ex);
      if(r&&(r.draft!==d||r.j!=='ex')&&!requests.some(q=>q.draft===d&&q.j==='ex'))d.want.ex=-1;
      // Cross-ship removal compacts a donor's normal slots. Do not shift
      // explicitly addressed destination slots, which must reject gaps.
      if(!requests.some(q=>q.draft===d&&typeof q.j==='number')) {
        const ids=d.want.slots.filter(id=>id>0);d.want.slots=ids.concat(Array(d.want.slots.length-ids.length).fill(-1));
      }
      for(const state of [d.before,d.want]) {
        const firstEmpty=state.slots.indexOf(-1);
        if(firstEmpty>=0&&state.slots.slice(firstEmpty+1).some(id=>id>0))throw new Error('普通装备槽不能在空槽后指定装备: '+d.shipId);
      }
    }
    const copy=s=>({slots:s.slots.slice(),ex:s.ex});
    // Every candidate sees the same immutable starting equipment. Revalidate
    // outside search scopes, and copy only ships actually changed by this plan.
    const initial=snapshotMemo(store(),'equipmentPlanningStates','all',()=>
      Object.keys(info().ships).map(id=>[Number(id),currentState(id)]));
    const states=new Map(initial),changedStates=new Set();
    // Search snapshots are immutable: index the initial owner once, then track
    // only moves made by this trial. Live execution keeps the original scan.
    const ownerIndex=indexScopes.has(store())?snapshotMemo(store(),'equipmentPlanningOwners','all',()=>{
      const owners=new Map();
      for(const [sid,state]of initial)for(const id of state.slots.concat(state.ex))if(id>0){
        if(owners.has(id))return null; // Preserve scan semantics for corrupt snapshots.
        owners.set(id,sid);
      }
      return owners;
    }):null;
    const movedOwners=new Map();
    const ownerRows=id=>{
      if(!ownerIndex)return states;
      const sid=movedOwners.has(id)?movedOwners.get(id):ownerIndex.get(id);
      return sid==null?[]:[[sid,states.get(sid)]];
    };
    const writable=sid=>{
      if(!changedStates.has(sid)){states.set(sid,copy(states.get(sid)));changedStates.add(sid);}
      return states.get(sid);
    };
    const steps=[],donors=new Set();
    function push(d,kind,j,id) {
      const now=writable(d.shipId),before=copy(now);
      const op={kind,...(j==='ex'||j===undefined?{}:{j}),...(id===undefined?{}:{id}),before};
      if(kind==='clear')now.slots.fill(-1);
      else {
        if(id>0) {
          if(!canEquip(d.shipId,id,j))throw new Error('目标槽装备无法重新安装: '+id);
          for(const [sid,state] of ownerRows(id)) {
            const at=state.slots.indexOf(id),ex=state.ex===id;
            if(at<0&&!ex)continue;
            if(sid===d.shipId)throw new Error('内部规划未先卸下本舰装备: '+id);
            if(!availableShip(sid))throw new Error('来源舰不可借用: '+sid);
            const source={shipId:sid,j:ex?'ex':at,before:copy(state)};
            const changed=writable(sid);
            if(ex)changed.ex=-1;else{changed.slots.splice(at,1);changed.slots.push(-1);}
            source.after=copy(changed);op.source=source;donors.add(sid);
            if(ownerIndex)movedOwners.set(id,null);
            break;
          }
        }
        if(j==='ex')now.ex=id;else now.slots[j]=id;
      }
      if(ownerIndex){
        for(const old of before.slots.concat(before.ex))if(old>0&&!now.slots.includes(old)&&now.ex!==old)movedOwners.set(old,null);
        if(id>0)movedOwners.set(id,d.shipId);
      }
      op.after=copy(now);d.ops.push(op);steps.push({shipId:d.shipId,op});
    }
    // Finish each ship before moving on. Borrowing may compact a later
    // target's slots, so derive its removal/install steps from the evolving
    // states rather than the original loadout. Exclusive final assignments
    // ensure a later target never borrows from an already completed ship.
    for(const d of drafts) {
      const now=states.get(d.shipId);
      const normalChanged=now.slots.some((id,j)=>id!==d.want.slots[j]);
      const additive=now.slots.every((id,j)=>id<0||id===d.want.slots[j])&&
        d.want.slots.every((id,j)=>id===now.slots[j]||id>0&&(free.has(id)||sources[id]?.shipId!==d.shipId));
      if(normalChanged&&!additive&&now.slots.some(id=>id>0))push(d,'clear');
      if(now.ex!==d.want.ex&&now.ex>0)push(d,'ex','ex',-1);
      d.want.slots.forEach((id,j)=>{if(id>0&&states.get(d.shipId).slots[j]!==id)push(d,'slot',j,id);});
      if(d.want.ex>0&&states.get(d.shipId).ex!==d.want.ex)push(d,'ex','ex',d.want.ex);
    }
    for(const d of drafts) {
      if(!sameState(states.get(d.shipId),d.want))throw new Error('内部规划状态不一致');
      plan.expected.push({shipId:d.shipId,state:copy(d.want)});
      if(d.ops.length)plan.ships.push(d);
    }
    plan.donors=[...donors].map(shipId=>({shipId,before:currentState(shipId),state:copy(states.get(shipId))}));
    for(const d of plan.donors)if(!plan.expected.some(e=>e.shipId===d.shipId))plan.expected.push({shipId:d.shipId,state:d.state});
    plan.steps=steps;
    return {...plan, done: plan.ships.length === 0, changed:plan.ships.reduce((n,s)=>n+s.ops.length,0), ok: true};
  }
  const indexed=(name,build)=>()=>{
    const cache=indexScopes.get(store());
    if(!cache)return build();
    if(!cache.has(name))cache.set(name,build());
    return cache.get(name);
  };
  occupiedMap=indexed('occupied',occupiedMap);
  sourceMap=indexed('sources',sourceMap);
  freeListAll=indexed('free',freeListAll);
  return {resolvePlan,currentState,sameState,occupiedMap,sourceMap,availableShip,otherPickerList,freeListAll,freePickerList,t3of,canEquip,categoryFor,categoryAccepts,get groupDefs(){return groupDefs();}};
}
module.exports={createEquipmentPlanner,withEquipmentIndexCache,snapshotMemo,
  hasEquipmentIndexCache:snapshot=>indexScopes.has(snapshot)};
