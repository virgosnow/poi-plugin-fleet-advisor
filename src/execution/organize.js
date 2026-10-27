'use strict';
const {enterScreen}=require('./navigation');
const {navigatePages}=require('./picker_navigation');

const P = require('../domain/fleet/organize_planner');
const {resolvePlan,fleets}=P;
const G = Object.freeze({filters: [632,697,761,825,889,953,1017,1081], filterY: 166,
  sort: [1160,199], first: [663,677], next: [1025,677]});

function simulateChange(current, fleet, slot, target) {
  if (!Number.isInteger(fleet) || fleet < 1 || fleet > current.length) throw new Error('Invalid fleet');
  const result = current.map(f => ({ships: f.ships.slice(), mission: f.mission}));
  const dest = result[fleet-1].ships;
  if (target === -2) {
    // The game's clear-escorts button sends index 0 and ship ID -2.
    if (slot !== 0 || dest.length < 2) throw new Error('No escorts to clear or invalid bulk slot');
    dest.splice(1);
    return result;
  }
  if (!Number.isInteger(slot) || slot < 0 || slot > 5) throw new Error('Invalid fleet slot');
  target = P.instanceId(target);
  if (slot > dest.length) throw new Error('Cannot create a gap in fleet');
  const old = dest[slot];
  for (const source of result) {
    const at = source.ships.indexOf(target);
    if (at >= 0) {
      if (old) source.ships[at] = old;
      else source.ships.splice(at, 1);
      break;
    }
  }
  dest[slot] = target;
  return result;
}

async function restoreOrganization(session, scheme) {
  const host = session.host, plan = resolvePlan(host.getStore(), scheme);
  if (plan.done) return {ok: true, done: true, changed: 0};
  let expected = plan.current, changing = false, changes = 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const assertState = () => {
    if (P.rosterRevision(P.rosterFromStore(host.getStore())) !== plan.revision) throw new Error('Roster changed during run');
    if (!changing && !same(fleets(host.getStore()), expected)) throw new Error('Fleet state changed outside this run');
  };
  session.validate = assertState;
  const commit = async (slot, ship, point) => {
    assertState();
    const after = simulateChange(expected, plan.fleet, slot, ship);
    changing = true;
    await session.input(point.x,point.y,{path: 'api_req_hensei/change', fleet: plan.fleet, j: slot, ship});
    const deadline = session.now()+30000;
    while (!same(fleets(host.getStore()), after)) {
      if (session.now() >= deadline) throw new Error('Store did not confirm change; submission will not be repeated');
      await session.wait(50);
    }
    expected = after; changing = false; changes++;
    await session.until('screen', {}, r => r.valid && r.mode === 'organization');
  };
  await enterScreen(session,'organization');
  let tab = await session.observe('orgtab', {fleet: plan.fleet});
  if (!tab.valid) {
    await session.input(202 + (plan.fleet-1)*45,178);
    await session.until('orgtab', {fleet: plan.fleet});
  }
  if (expected[plan.fleet-1].ships.length > 1) {
    session.onProgress({phase: 'clear-escorts', fleet: plan.fleet});
    await session.input(625,178,undefined,'hover');
    const button = await session.until('orgclear', {fleet: plan.fleet});
    if (!button.tab || !button.tab.valid || !button.commit) throw new Error('Clear-escorts button or destination tab not confirmed');
    await commit(0, -2, button.commit);
  }
  // All slots share the union of the scheme's ship groups, including an
  // unchanged flagship. Keep verifying the actual selection on every open.
  const desired = plan.filter;
  const isNew = r => r.valid && r.sort.mode === 'new' && r.sort.direction === 'desc';
  const validList = r => isNew(r) && same(r.filter.states, desired.mask) && r.page.valid;
  // During setup the old filter may have a different page count. Once NEW
  // and the final filter match, require the page in these same stable frames.
  const readyPicker = r => r.valid && (!isNew(r) || !same(r.filter.states, desired.mask) || r.page.valid);
  for (let i = 0; i < plan.targets.length; i++) {
    session.check(); assertState();
    const target = plan.targets[i];
    if (expected[plan.fleet-1].ships[i] === target) {
      session.onProgress({phase:'organized',fleet:plan.fleet,slot:i+1,ship:target});
      continue;
    }
    const pos = P.locate(plan.roster, target, desired.mask);
    const pickerArg = {fleet: plan.fleet, total: pos.total};
    session.onProgress({phase: 'picker', fleet:plan.fleet, slot: i+1, target});
    await session.input(612+(i%2)*487,324+Math.floor(i/2)*172);
    let read = await session.until('picker', pickerArg, readyPicker);
    if (!read.tab || !read.tab.valid) throw new Error('Destination tab not confirmed in picker');
    const seenSorts=new Set();
    for (let count = 0; !(read.sort.mode === 'new' && read.sort.direction === 'desc'); count++) {
      if (count >= 5 || !read.sort.valid || read.sort.mode === 'unknown') throw new Error('NEW descending sort unavailable');
      const previous = JSON.stringify(read.sort);
      if(seenSorts.has(previous))throw new Error('Ship sorting repeated a state; stopping without retry');
      seenSorts.add(previous);
      await session.input(...G.sort);
      read = await session.until('picker', pickerArg, r => readyPicker(r) && JSON.stringify(r.sort) !== previous);
    }
    for (let count = 0; ; count++) {
      if (count > 8) throw new Error('Filter change limit exceeded');
      const next = P.nextFilter(read.filter.states, desired.mask);
      if (next < 0) break;
      const previous = read.filter.states.slice(); previous[next] ^= 1;
      await session.input(G.filters[next],G.filterY);
      read = await session.until('picker', pickerArg, r => readyPicker(r) && isNew(r) && same(r.filter.states, previous));
    }
    if (!validList(read)) throw new Error('Filtered NEW list not confirmed');
    await navigatePages(session,read.page,pos.page,{total:pos.total,first:G.first,forward:G.next,
      read:async predicate=>{
        read=await session.until('picker',pickerArg,r=>validList(r)&&predicate(r.page));
        return read.page;
      }});
    const arg = {row: pos.row, checkLevel:false, ...pickerArg, mask: desired.mask, page: pos.page};
    // No input occurred since this stable picker read. The former level-free
    // rowidentity only repeated its sort/filter/page checks on another image.
    // Validate that proof directly; keep the fresh confirmation-card gate and
    // exact request/store checks after the row click.
    if(!Number.isInteger(pos.row)||pos.row<0||pos.row>9||!validList(read)||read.page.activePage!==pos.page)
      throw new Error('Filtered NEW list not confirmed');
    await session.input(870,259+43*pos.row);
    const card = await session.until('cardidentity', arg);
    if (!card.commit) throw new Error('Confirmation button not confirmed');
    await commit(i, target, card.commit);
    session.onProgress({phase:'organized',fleet:plan.fleet,slot:i+1,ship:target});
  }
  assertState();
  if (!same(fleets(host.getStore())[plan.fleet-1].ships, plan.targets)) throw new Error('Final fleet mismatch');
  return {ok: true, done: true, changed: changes};
}

module.exports = {resolvePlan, simulateChange, restoreOrganization};
