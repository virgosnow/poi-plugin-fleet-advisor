'use strict';
// Preserve each documented formation and ship order; never merge alternatives.
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
function nodeFormations(area,id,encounterStage='unknown'){
  if(!/^\d-\d$/.test(area||'')||!/^[A-Z][0-9]?$/.test(id||''))return [];
  let data;try{data=require(`../../../data/sortie/encounters/${area}.json`);}catch(e){if(e.code==='MODULE_NOT_FOUND')return [];throw e;}
  const node=data.nodes?.[id];if(!node)return [];
  const formations=Object.entries(node.phases||{}).flatMap(([phase,value])=>{
    const rows=value.patterns||[];
    const resolve=(row,seen=new Set())=>{
      if(!row||seen.has(row))return null;seen.add(row);
      const parent=row.sameAsPattern?resolve(rows.find(p=>p.pattern===row.sameAsPattern),seen):null;
      return {...parent,...row,enemyShips:row.enemyShips||parent?.enemyShips,escortFleet:row.escortFleet||parent?.escortFleet};
    };
    return rows.map(row=>{
      const source=resolve(row),ship=e=>{
        const known=/^verified/.test(e.apiIdStatus||'')?catalog.get(e.apiId):null;
        return {name:known?.kcwikiNameZh||e.name||'敌舰待确认',apiId:known?.apiId||null};
      };
      return {phase,pattern:row.pattern,finalForm:row.finalForm,formation:source?.formation||[],hqLevelRange:row.hqLevelRange,
        availability:row.availability,ships:(source?.enemyShips||[]).map(ship),escort:(source?.escortFleet?.enemyShips||[]).map(ship)};
    });
  });
  return require('../../domain/combat/encounter_stage').filterFormations(area,id,formations,encounterStage);
}
module.exports={nodeFormations};
