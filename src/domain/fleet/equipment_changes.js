'use strict';

// Normal removal compacts subsequent slots. Installation replaces exactly
// the selected slot; occupied targets need not be emptied first.
function planNormalChanges(slots,wanted,{ex=-1,installCost=()=>8,canInstall=()=>true}={}){
  const current=slots.slice(),steps=[],seen=new Set();
  const equal=()=>current.every((id,j)=>id===wanted[j]);
  while(!equal()){
    const key=current.join(',');
    if(seen.has(key)||steps.length>=40)return null;
    seen.add(key);
    const empty=current.indexOf(-1);
    const j=wanted.findIndex((id,j)=>id>0&&id!==current[j]&&id!==ex&&!current.includes(id)&&canInstall(id,j)&&
      (current[j]>0||j===empty));
    if(j>=0){steps.push({kind:'slot',j,id:wanted[j]});current[j]=wanted[j];continue;}
    const removals=current.flatMap((id,j)=>{
      if(id<0||id===wanted[j])return [];
      const after=current.slice();after.splice(j,1);after.push(-1);
      return [{j,after,matches:after.filter((id,k)=>id===wanted[k]).length,unwanted:!wanted.includes(id)}];
    }).sort((a,b)=>b.matches-a.matches||Number(b.unwanted)-Number(a.unwanted)||b.j-a.j);
    if(!removals.length)return null;
    const choice=removals[0];steps.push({kind:'remove',j:choice.j,id:-1});current.splice(0,current.length,...choice.after);
  }
  const full=[...(slots.some(id=>id>0)?[{kind:'clear'}]:[]),
    ...wanted.flatMap((id,j)=>id>0?[{kind:'slot',j,id}]:[])];
  // Include per-operation readiness checks, not only mouse clicks: four
  // separately confirmed removals can cost more than clearing + one install.
  const cost=ops=>ops.reduce((n,op)=>n+(op.kind==='clear'?6:op.kind==='remove'?5:installCost(op.id,op.j)),0);
  // Prefer retaining correct instances at equal cost. Bulk clear remains
  // useful when genuinely cheaper, e.g. discarding most of a five-slot loadout.
  const correct=slots.some((id,j)=>id>0&&id===wanted[j]);
  const fullCost=full.every(op=>op.kind!=='slot'||canInstall(op.id,op.j))?cost(full):Infinity,localCost=cost(steps);
  return fullCost<localCost||!correct&&fullCost===localCost&&full.length<steps.length?full:steps;
}
module.exports={planNormalChanges};
