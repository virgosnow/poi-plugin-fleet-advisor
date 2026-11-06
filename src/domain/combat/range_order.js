'use strict';
// The game reports a positional bias for equal ranges, but its distribution
// is not established. Uniform shuffling is a reference approximation.
// https://wikiwiki.jp/kancolle/戦闘について
function rangeOrder(actors,rng,start=0){
  const order=actors.map((ship,i)=>({i:i+start,range:ship.range??0})).sort((a,b)=>b.range-a.range);
  for(let begin=0;begin<order.length;){
    let end=begin+1;while(end<order.length&&order[end].range===order[begin].range)end++;
    for(let i=end-1;i>begin;i--){const j=begin+Math.min(i-begin,Math.floor(rng()*(i-begin+1)));[order[i],order[j]]=[order[j],order[i]];}
    begin=end;
  }
  return order;
}
module.exports={rangeOrder};
