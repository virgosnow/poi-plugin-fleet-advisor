'use strict';

function fields(expected) {
  if (!expected) return null;
  if (expected.path === 'api_req_hensei/change') return {api_id: expected.fleet, api_ship_idx: expected.j, api_ship_id: expected.ship};
  if (expected.path === 'api_req_kaisou/slot_deprive') return {api_set_ship:expected.ship,api_set_idx:expected.j,api_set_slot_kind:expected.slotKind,
    api_unset_ship:expected.sourceShip,api_unset_idx:expected.sourceJ,api_unset_slot_kind:expected.sourceKind};
  if (expected.path === 'api_req_kaisou/slotset') return {api_id: expected.ship, api_slot_idx: expected.j, api_item_id: expected.item};
  if (expected.path === 'api_req_kaisou/slotset_ex') return {api_id: expected.ship, api_item_id: expected.item};
  if (expected.path === 'api_req_kaisou/unsetslot_all') return {api_id: expected.ship};
  return null;
}

function matches(request, expected) {
  const required = fields(expected);
  if (!required || !request || request.method !== 'POST') return false;
  try {
    if (new URL(request.url).pathname !== '/kcsapi/' + expected.path) return false;
    const data = new URLSearchParams(request.postData || '');
    return Object.entries(required).every(([key, value]) => Number.isSafeInteger(value) &&
      data.getAll(key).length === 1 && data.get(key) === String(value));
  } catch (_) { return false; }
}

// This only observes requests that the browser has already sent. It never
// authorizes, pauses, alters or rejects game traffic.
class RequestMonitor {
  constructor(now) { this.now = now; this.expected = null; this.closed = false; this.matchedAction = null; }
  expect(expected, actionId) {
    if (this.closed || this.expected) throw new Error('Request monitor unavailable or busy');
    const required=fields(expected);
    if (!required || Object.values(required).some(v=>!Number.isSafeInteger(v)) || !Number.isSafeInteger(actionId) || actionId<1) throw new Error('Invalid expected operation');
    this.expected = {...expected}; this.actionId = actionId; this.deadline = this.now() + 10000; this.matchedAction = null;
  }
  observe(request) {
    if (this.closed || !request) return;
    let path;
    try { path = new URL(request.url).pathname; } catch (_) { return; }
    if (!path.startsWith('/kcsapi/') || !fields({path:path.slice('/kcsapi/'.length)})) return;
    const expected=this.expected;
    const matched=expected && this.now()<=this.deadline && matches(request,expected);
    this.expected = null;
    if (!matched) {
      this.closed=true;
      const data=new URLSearchParams(request.postData||'');
      const actual=Object.fromEntries(['api_id','api_ship_idx','api_ship_id','api_slot_idx','api_item_id','api_set_ship','api_set_idx','api_set_slot_kind','api_unset_ship','api_unset_idx','api_unset_slot_kind'].filter(k=>data.has(k)).map(k=>[k,data.get(k)]));
      throw new Error('Unexpected fleet/equipment request observed; stopping automation only: '+path+' '+JSON.stringify({expected,actual}));
    }
    this.matchedAction=this.actionId;
  }
  cancel() { this.expected = null; this.closed = true; }
}

module.exports = {matches, RequestMonitor};
