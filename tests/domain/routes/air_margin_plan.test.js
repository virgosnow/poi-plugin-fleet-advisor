'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {simulateAirPath,estimateRouteAirMinimum,estimateRouteAirMargins,routeAirMeets}=require('../../../src/domain/routes/route_air');
test('compiled minimum and early rejection match complete phase simulation including jets and branched paths',()=>{
  let state=70823;const next=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  for(let i=0;i<600;i++){
    const steel=[0,1,50,200,10000,null][i%6];
    const slots=Array.from({length:next(10)},(_,slot)=>{
      const type=[6,7,8,11,45,56,57,57][next(8)],mid=type===56?548:type===57?[199,200][next(2)]:6;
      const low=next(45),high=low+next(15),aa=next(18),prof=next(20);
      return {shipId:1,slot,aircraftType:type,masterId:mid,jetSteel:steel,bomb:15,
        planes:[low,high],effectiveAntiAir:[aa,aa+1],proficiencyBonus:[prof,prof+1]};
    });
    const air={status:'range',slots};
    const nodes=Array.from({length:5},(_,k)=>({id:String(k),kind:['battle','aerialCombat','aerialRaid','asw'][next(4)],
      enemyAirPower:next(300),boss:k===4,antiAir:{status:'known',proportion:0.2,fixed:8,
        profiles:[{weighted:80,defense:40,combinedFactor:1},{weighted:42,defense:52,combinedFactor:.8}]}}));
    if(i%13===0)nodes[2].antiAir={status:'unknown'};
    if(i%17===0)nodes[3].noAirBattle=true;
    if(i%19===0)nodes[1].enemyJets=true;
    if(i%23===0&&slots.length)slots[0].aircraftType=58;
    if(i%29===0&&slots.length)slots[0].masterId=99999;
    const paths=[['0','1','4'],['0','2','4'],['3','4'],...(i%11===0?[[]]:[])];
    const ref={status:'known',nodes,paths};
    const reports=paths.map(path=>simulateAirPath(air,path.map(id=>nodes[Number(id)])));
    const expected=reports.some(r=>r.status!=='estimated')?null:Object.fromEntries(['superiority','supremacy'].map(goal=>[goal,{
      min:Math.min(...reports.map(r=>r.margins[goal].min)),max:Math.min(...reports.map(r=>r.margins[goal].max))}]));
    const before=JSON.stringify({air,ref});
    // Boolean queries run first, so partial failures cannot poison exact margins.
    for(const goal of ['superiority','supremacy'])for(const threshold of [-100,0,25])assert.equal(routeAirMeets(air,ref,goal,threshold),expected?expected[goal].min>=threshold:null,`boolean ${i} ${goal} ${threshold}`);
    const minimum=estimateRouteAirMinimum(air,ref);
    for(const goal of ['superiority','supremacy'])assert.equal(minimum?.[goal]?.min,expected?.[goal]?.min,`minimum ${i}`);
    assert.deepEqual(estimateRouteAirMargins(air,ref),expected,`full margins ${i}`);
    assert.equal(JSON.stringify({air,ref}),before);
  }
});
