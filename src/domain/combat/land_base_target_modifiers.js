'use strict';
// Enemy-specific post-cap modifiers for ordinary LBAS airstrikes. Enemy IDs
// and provisional probabilities follow https://en.kancollewiki.net/Land_Base.
// Unknown values are intentionally absent; these are references, not promises.
const rules=[
  {ids:[1637,1638,1639,1640,2192,2193,2194],low:.4,high:.7,lowChance:.6},
  {ids:[1557],low:1.7,high:3,lowChance:.65},
  {ids:[1696,1697,1698],low:1.5,high:1.8,lowChance:.5,assumedChance:true},
  {ids:[1586],low:1.7,high:3,lowChance:.5,assumedChance:true},
  {ids:[1751],low:1.3,high:1.7,lowChance:.5,assumedChance:true,provisional:true},
  {ids:[1665,1666,1667],low:1.6,high:2.5,lowChance:.5,installation:true},
  {ids:[2178,2179,2196,2197],low:1.5,high:2.2,lowChance:.5,installation:true},
  {ids:[2180,2181],low:1.3,high:1.6,lowChance:.5,installation:true,assumedChance:true},
  {ids:[2188,2189,2190,2191],low:1.4,high:1.8,lowChance:.5,installation:true,assumedChance:true},
  {ids:[1653,1654,1655,1656,1657,1658],low:1.7,high:3.5,lowChance:.5,installation:true},
  {ids:[1699,1700,1701,1702,1703,1704,2023,2024,2025,2026,2027,2028,2243,2244,2245],
    low:1.2,high:1.5,lowChance:.5,installation:true,assumedChance:true},
  {ids:[1671,1672],low:1.5,high:2,lowChance:.5,installation:true,assumedChance:true,provisional:true},
];
const byId=new Map(rules.flatMap(rule=>rule.ids.map(id=>[id,rule])));
function forTarget(id,installation){
  const rule=byId.get(Number(id));
  return rule&&!!rule.installation===!!installation?rule:null;
}
function sample(id,installation,rng){
  const rule=forTarget(id,installation);
  return rule?(rng()<rule.lowChance?rule.low:rule.high):1;
}
module.exports={forTarget,sample};
