'use strict';
// Count each alternative formation separately. Variants in different patterns
// must never be added together as if they appeared in one encounter.
const order=(a,b)=>b.priority-a.priority||b.variantRank-a.variantRank||a.name.localeCompare(b.name);
function groupNodeEnemies(patterns,summarize){
  const groups=new Map(),counts=[];
  for(const pattern of patterns){
    const count=new Map();
    for(const enemy of [...(pattern.enemyShips||[]),...(pattern.escortFleet?.enemyShips||[])]){
      const item=summarize(enemy),key=item.familyKey;
      count.set(key,(count.get(key)||0)+1);
      let group=groups.get(key);
      if(!group){group={...item,name:item.familyName,variants:new Map()};groups.set(key,group);}
      group.variants.set(item.apiId||item.originalName,{apiId:item.apiId,name:item.name});
      if(item.variantRank>group.variantRank||!group.apiId&&item.apiId){
        group.apiId=item.apiId;group.identityVerified=item.identityVerified;group.variantRank=item.variantRank;
      }
      group.priority=Math.max(group.priority,item.priority);
      if(item.familyName.length<group.name.length)group.name=item.familyName;
    }
    counts.push(count);
  }
  return [...groups].map(([key,group])=>({...group,variants:[...group.variants.values()],
    variantCount:group.variants.size,
    countRange:{minimum:Math.min(...counts.map(c=>c.get(key)||0)),
      maximum:Math.max(...counts.map(c=>c.get(key)||0))}})).sort(order);
}
function routeThreat(nodes,paths,{incomplete=false,truncated=false}={}){
  const byId=new Map(nodes.map(node=>[node.id,node])),groups=new Map();
  const countRanges=[];let unknown=incomplete||truncated;
  for(const path of paths){
    const counts=new Map();
    for(const id of path.nodes.slice(0,-1)){
      const node=byId.get(id);
      if(!node||node.threatStatus==='unknown'||node.compositionUncertain)unknown=true;
      for(const enemy of node?.enemyFamilies||[]){
        const key=enemy.familyKey;
        let group=groups.get(key);
        if(!group){group={...enemy,nodes:new Set(),variants:new Map()};groups.set(key,group);}
        group.nodes.add(id);
        for(const variant of enemy.variants)group.variants.set(variant.apiId||variant.name,variant);
        if(enemy.variantRank>group.variantRank||!group.apiId&&enemy.apiId){
          group.apiId=enemy.apiId;group.identityVerified=enemy.identityVerified;group.variantRank=enemy.variantRank;
        }
        group.priority=Math.max(group.priority,enemy.priority);
        if(enemy.name.length<group.name.length)group.name=enemy.name;
        const count=counts.get(key)||{minimum:0,maximum:0};
        count.minimum+=enemy.countRange.minimum;count.maximum+=enemy.countRange.maximum;counts.set(key,count);
      }
    }
    countRanges.push(counts);
  }
  const enemies=[...groups].map(([key,group])=>({...group,nodes:[...group.nodes],
    variants:[...group.variants.values()],variantCount:group.variants.size,
    encounterCount:{minimum:Math.min(...countRanges.map(c=>c.get(key)?.minimum||0)),
      maximum:Math.max(...countRanges.map(c=>c.get(key)?.maximum||0))}})).sort(order).slice(0,3);
  return {status:unknown?'incomplete':enemies.length?'qualitative':'none',
    node:enemies[0]?.nodes[0]||null,enemies,
    basis:'按当前预览路线的敌舰类别展示主要威胁；同类版本合并，数量按单个随机编队分别计算。头像为代表版本，名单不表示各随机版本同时出现；含不同司令部等级与血条阶段，非大破概率预测'};
}
module.exports={groupNodeEnemies,routeThreat};
