'use strict';
const {snapshotMemo}=require('./equipment_planner');
const {matchesName}=require('../../shared/name_matching');
const {selectShipByName}=require('./ship_selection');

const FILTER_GROUPS = Object.freeze(['戦艦級', '航空母艦', '重巡級', '軽巡級', '駆逐艦', '海防艦', '潜水艦', '補助艦艇']);
const STYPE_GROUP = Object.freeze({
  1: 5, 2: 4, 3: 3, 4: 3, 5: 2, 6: 2, 7: 1, 8: 0, 9: 0, 10: 0,
  11: 1, 12: 0, 13: 6, 14: 6, 15: 7, 16: 7, 17: 7, 18: 1, 19: 7,
  20: 7, 21: 3, 22: 7
});
function instanceId(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error('Invalid ship instance ID');
  return Number(value);
}
function rosterFromStore(state) {
  if (!state || !state.info || !state.info.ships || !state.const) throw new Error('Ship store unavailable');
  const masters = state.const.$ships || {};
  return Object.entries(state.info.ships).map(([key, ship]) => {
    const id = instanceId(key);
    if (!ship || (ship.api_id !== undefined && instanceId(ship.api_id) !== id)) throw new Error('Ship ID mismatch');
    const master = masters[ship.api_ship_id] || {};
    const stype = Number(master.api_stype);
    return { id, masterId: ship.api_ship_id, stype, group: Object.prototype.hasOwnProperty.call(STYPE_GROUP, stype) ? STYPE_GROUP[stype] : -1,
      name: master.api_name || '', level: Number(ship.api_lv), situation: ship.api_situation };
  }).sort((a, b) => b.id - a.id);
}
function rosterRevision(roster) { return JSON.stringify(roster.map(s => [s.id, s.masterId, s.stype, s.name, s.level, s.situation])); }
function validateMask(mask) {
  if (!Array.isArray(mask) || mask.length !== 8 || mask.some(v => v !== 0 && v !== 1) || !mask.includes(1)) throw new Error('Invalid ship filter observation');
  return mask.slice();
}
function desiredMask(roster, targetIds) {
  if (!Array.isArray(targetIds) || !targetIds.length) throw new Error('Filter requires target ships');
  const groups = new Set(targetIds.map(id => {
    const target = roster.find(s => s.id === instanceId(id));
    if (!target) throw new Error('Target ship missing');
    return target.group;
  }));
  const fallback = roster.some(s => s.group < 0);
  return { fallback, mask: Array.from({length: 8}, (_, i) => fallback || groups.has(i) ? 1 : 0) };
}
function nextFilter(observed, desired) {
  validateMask(observed); validateMask(desired);
  const enable = desired.findIndex((v, i) => v === 1 && observed[i] === 0);
  return enable >= 0 ? enable : desired.findIndex((v, i) => v !== observed[i]);
}
function locate(roster, targetId, observedMask) {
  const mask = validateMask(observedMask);
  if (roster.some(s => s.group < 0) && mask.some(v => !v)) throw new Error('Unknown ship type requires all filters');
  const ids = roster.filter(s => s.group < 0 || mask[s.group]).map(s => instanceId(s.id)).sort((a, b) => b - a);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate instance ID');
  const rank = ids.indexOf(instanceId(targetId));
  if (rank < 0) throw new Error('Target ship outside observed filter');
  return {ids, page: Math.floor(rank / 10) + 1, row: rank % 10, total: Math.max(1, Math.ceil(ids.length / 10))};
}
function fleets(state) {
  if (!Array.isArray(state.info.fleets) || !state.info.fleets.length) throw new Error('Fleet data unavailable');
  return state.info.fleets.map(f => {
    if (!f || !Array.isArray(f.api_ship) || !Array.isArray(f.api_mission)) throw new Error('Fleet data incomplete');
    return {ships: f.api_ship.filter(id => id > 0).map(Number), mission: Number(f.api_mission[0])};
  });
}
function resolvePlan(state, scheme) {
  const roster=snapshotMemo(state,'organizationContext','roster',()=>rosterFromStore(state));
  const current=snapshotMemo(state,'organizationContext','fleets',()=>fleets(state));
  const fleet = Number(scheme && scheme.fleet);
  if (!Number.isInteger(fleet) || fleet < 1 || fleet > Math.min(4, current.length)) throw new Error('Fleet must be 1–4');
  if (!Array.isArray(scheme.ships) || scheme.ships.length < 1 || scheme.ships.length > 6) throw new Error('Plan requires 1–6 ships');
  const targets = scheme.ships.map(entry => {
    let id, name;
    if (typeof entry === 'number') id = entry;
    else if (typeof entry === 'string') name = entry;
    else if (entry) { id = entry.id; name = entry.name; }
    if (id !== undefined) {
      id = instanceId(id);
      const ship = roster.find(s => s.id === id);
      if (!ship) throw new Error('Ship ID/name mismatch');
      // The name is a readability hint, not a second lock: it only has to be
      // consistent with the instance (exact or prefix), so a shortened name
      // like 翔鶴改二 for 翔鶴改二甲 stays valid.
      if (name !== undefined && !matchesName(ship.name,name)) throw new Error('Ship ID/name mismatch');
      return id;
    }
    return selectShipByName(roster, name);
  });
  if (new Set(targets).size !== targets.length) throw new Error('Duplicate target ship');
  if (current[fleet-1].mission !== 0) throw new Error('Destination fleet on expedition');
  for (const id of targets) {
    if (current.some(f => f.mission !== 0 && f.ships.includes(id))) throw new Error('Target ship on expedition');
    const docks = state.info.repairs || [];
    if (state.info.ships[id].api_situation === 2 || docks.some(d => Number(typeof d === 'object' ? d.api_ship_id : d) === id)) throw new Error('Target ship in repair');
  }
  return {fleet, targets, roster, filter: desiredMask(roster, targets),
    revision: snapshotMemo(state,'organizationContext','revision',()=>rosterRevision(roster)), current,
    done: current[fleet-1].ships.length === targets.length && targets.every((id, i) => current[fleet-1].ships[i] === id)};
}

module.exports = { fleets, resolvePlan, FILTER_GROUPS, STYPE_GROUP, instanceId, rosterFromStore, rosterRevision, validateMask, desiredMask, nextFilter, locate };
