'use strict';
// Preserve each documented formation and ship order; never merge alternatives.
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function formationAir(source){
  const ships=[...(source?.enemyShips||[]),...(source?.escortFleet?.enemyShips||[])];
  const known=ships.map(ship=>catalog.get(ship.apiId));
  const air=valid(source?.enemyAirPower)?source.enemyAirPower:
    known.length&&known.every(ship=>ship?.stats?.['搭載']===0)?0:null;
  // Some formations have additional reconnaissance AA against land bases.
  const land=String(source?.enemyAirPowerNote||'').match(/^基地航空隊に対しては(\d+)$/);
  return {enemyAirPower:air,landBaseAirPower:land?Number(land[1]):air};
}
function landBaseAirState(air,formation){
  const power=air?.power,enemy=formation?.landBaseAirPower;
  if(!valid(power?.min)||!valid(power?.max)||power.min>power.max||!valid(enemy))return '制空待确认';
  const state=own=>enemy===0?'空确':own>=enemy*3?'空确':own>=enemy*1.5?'空优':
    own>enemy*2/3?'空均':own>enemy/3?'空劣':'丧失';
  const low=state(power.min),high=state(power.max);
  return `预计${low===high?low:`${low}～${high}`}`;
}
function nodeFormations(area,id,encounterStage='unknown'){
  if(!/^\d-\d$/.test(area||'')||!/^[A-Z][0-9]?$/.test(id||''))return [];
  let data;try{data=require(`../../../data/sortie/encounters/${area}.json`);}catch(e){if(e.code==='MODULE_NOT_FOUND')return [];throw e;}
  const node=data.nodes?.[id];if(!node)return [];
  const formations=Object.entries(node.phases||{}).flatMap(([phase,value])=>{
    const rows=value.patterns||[];
    const resolve=(row,seen=new Set())=>{
      if(!row||seen.has(row))return null;seen.add(row);
      const parent=row.sameAsPattern?resolve(rows.find(p=>p.pattern===row.sameAsPattern),seen):null;
      return {...parent,...row,enemyShips:row.enemyShips||parent?.enemyShips,escortFleet:row.escortFleet||parent?.escortFleet,
        enemyAirPower:row.enemyAirPower??parent?.enemyAirPower,enemyAirPowerNote:row.enemyAirPowerNote??parent?.enemyAirPowerNote};
    };
    return rows.map(row=>{
      const source=resolve(row),ship=e=>{
        const known=/^verified/.test(e.apiIdStatus||'')?catalog.get(e.apiId):null;
        const hp=known?.stats?.['耐久'];
        return {name:known?.kcwikiNameZh||e.name||'敌舰待确认',apiId:known?.apiId||null,
          hp:typeof hp==='number'&&Number.isFinite(hp)&&hp>0?hp:null};
      };
      return {...formationAir(source),phase,pattern:row.pattern,finalForm:row.finalForm,formation:source?.formation||[],hqLevelRange:row.hqLevelRange,
        availability:row.availability,ships:(source?.enemyShips||[]).map(ship),escort:(source?.escortFleet?.enemyShips||[]).map(ship)};
    });
  });
  return require('../../domain/combat/encounter_stage').filterFormations(area,id,formations,encounterStage);
}
module.exports={nodeFormations,landBaseAirState};
