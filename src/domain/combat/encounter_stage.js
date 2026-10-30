'use strict';

// These gauges reset monthly; api_cleared is a historical unlock marker.
const MONTHLY=new Set(['1-5','1-6','2-5','3-5','4-5','5-5','5-6','6-5','7-2','7-3','7-4','7-5']);
// Map info retains a historical api_cleared across monthly resets. Only the
// active gauge's own validated counters establish current pre/final/clear.
// For a multi-gauge map, another gauge must not inherit the active counter.
function encounterStage(store,area,phase){
  if(!/^\d-\d$/.test(area||''))return 'unknown';
  const row=store?.info?.maps?.[Number(area.replace('-',''))];
  if(!row)return 'unknown';
  let phases=[],active=-1;
  try{phases=Object.keys(require(`../../../data/normal_routes/${area}.json`).bossPhases||{});}
  catch(_){return 'unknown';}
  if(phases.length){
    const selected=phases.indexOf(phase);active=Number(row.api_gauge_num)-1;
    if(selected<0||!Number.isInteger(active)||active<0||active>=phases.length)return 'unknown';
    // `afterClear` can mean clearing the whole map, not merely an earlier
    // gauge. Active incomplete counters prove only that clear-only variants
    // cannot appear; they do not reveal the selected gauge's final state.
    if(selected!==active){
      const total=row.api_required_defeat_count,done=row.api_defeat_count;
      return Number.isInteger(total)&&total>0&&Number.isInteger(done)&&done>=0&&done<total?'notCleared':'unknown';
    }
  }
  const required=row.api_required_defeat_count,defeated=row.api_defeat_count;
  if(Number.isInteger(required)&&required>0&&Number.isInteger(defeated)&&defeated>=0){
    // Transport points and arrival counters do not imply a last-dance kill.
    if(Number(row.api_gauge_type)!==1)return 'unknown';
    if(defeated>required)return 'unknown';
    if(defeated===required)return 'after';
    return required-defeated===1?'final':'before';
  }
  // Missing one of a pair of counters is not evidence that a gauge is clear.
  if(required!=null||defeated!=null)return 'unknown';
  if(phases.length&&active!==phases.length-1)return 'unknown';
  return row.api_cleared===1&&!MONTHLY.has(area)?'after':'unknown';
}

// `finalForm:null` means unlabelled, not provably unavailable in final form.
// Prefer labelled final formations for the displayed flagship but retain
// unlabelled candidates unless the map's post-clear policy proves otherwise.
function filterFormations(area,node,formations,stage){
  const rows=Array.isArray(formations)?formations:[];
  if(!['before','final','after','notCleared'].includes(stage))return rows.slice();
  const after=row=>row.availability==='afterClear'||row.phase==='afterClear';
  const before=row=>row.availability==='beforeClear'||row.phase==='beforeClear';
  let out=rows.filter(row=>stage==='after'?!before(row):!after(row));
  if(stage==='before')out=out.filter(row=>row.finalForm!==true);
  // 3-5 H's non-final fleets are documented as pre-battle variants. G's
  // final/cleared air requirement is documented as the light-carrier fleet.
  // Keep unlabelled rows at E/F/K: F has a documented low-HQ final exception.
  // https://wikiwiki.jp/kancolle/北方海域/3-5
  // https://m.kcwiki.cn/wiki/3-5
  if(area==='3-5'&&['G','H'].includes(node)&&['final','after'].includes(stage))
    out=out.filter(row=>row.finalForm===true);
  // 4-5 T explicitly changes to the strengthened flagship on the final
  // battle, and restores its earlier formations after gauge destruction.
  // https://wikiwiki.jp/kancolle/西方海域/4-5
  if(area==='4-5'&&node==='T'&&stage==='final')out=out.filter(row=>row.finalForm===true);
  if(stage==='after'){
    const explicit=out.filter(after);
    if(explicit.length)out=explicit;
    // 6-5 explicitly returns to non-final random formations after clear.
    // https://wikiwiki.jp/kancolle/中部海域/6-5
    else if(area==='6-5'||area==='4-5'&&node==='T')out=out.filter(row=>row.finalForm!==true);
  }
  if(stage==='final'||stage==='after'&&area==='3-5')
    out=out.map((row,index)=>({row,index})).sort((a,b)=>Number(b.row.finalForm===true)-Number(a.row.finalForm===true)||a.index-b.index).map(x=>x.row);
  return out;
}

module.exports={encounterStage,filterFormations};
