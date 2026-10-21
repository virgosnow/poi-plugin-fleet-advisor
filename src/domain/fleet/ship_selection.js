'use strict';
const {matchingNames}=require('../../shared/name_matching');

// Shared by organization and equipment plans so a portable name resolves to
// the same owned instance regardless of fleet placement or current equipment.
function pickInstance(matches, name) {
  if (matches.some(ship => !Number.isSafeInteger(ship.id) || ship.id < 1 ||
    !Number.isSafeInteger(ship.level) || ship.level < 1)) {
    throw new Error('同名舰的实例或等级数据不完整: ' + name);
  }
  // Numeric level descending, then the oldest instance for deterministic ties.
  matches.sort((a, b) => b.level - a.level || a.id - b.id);
  return matches[0].id;
}

function selectShipByName(roster, name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('舰名不能为空');
  // Original spellings first, then character-equivalent prefix matches.
  // Whoever matches ranks by level descending, then the oldest instance:
  // the highest-level ship wins. Ambiguous prefixes resolve instead of
  // erroring by design.
  const matches = matchingNames(roster,name);
  if (!matches.length) throw new Error('未持有舰娘: ' + name);
  return pickInstance(matches, name);
}

module.exports = {selectShipByName};
