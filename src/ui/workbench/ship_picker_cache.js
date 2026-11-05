'use strict';
const {prepareReplacementCandidates}=require('./workbench_model');

// poi may replace store tables or mutate them in place. Only include fields
// that affect the displayed roster, portrait, availability and filter reasons.
function rosterSignature(store,selection){
  const info=store.info||{},constants=store.const||{};
  const ships=Object.entries(info.ships||{}).map(([id,s])=>[id,s.api_ship_id,s.api_lv,s.api_cond,s.api_locked,
    s.api_situation,s.api_nowhp,s.api_maxhp]);
  const masters=Object.entries(constants.$ships||{}).map(([id,m])=>[id,m.api_name,m.api_yomi,m.api_stype,m.api_aftershipid]);
  const graphs=Object.entries(constants.$shipgraph||{}).map(([id,g])=>[id,g?.api_id,g?.api_version?.[0]]);
  const types=Object.entries(constants.$shipTypes||{}).map(([id,t])=>[id,t.api_name]);
  const fleets=(info.fleets||[]).map(f=>[f?.api_ship,f?.api_mission?.[0]]);
  const repairs=(info.repairs||[]).map(row=>typeof row==='object'?row.api_ship_id:row);
  return JSON.stringify([selection,ships,masters,graphs,types,fleets,repairs,info.server?.ip]);
}
function createShipPickerCache(){
  let cached=null;
  return {
    get(store,selection){
      const signature=rosterSignature(store,selection);
      if(!cached||cached.signature!==signature)cached={signature,rows:prepareReplacementCandidates(store,selection,{deferPortraits:true})};
      return cached.rows;
    },
    clear(){cached=null;}
  };
}
module.exports={rosterSignature,createShipPickerCache};
