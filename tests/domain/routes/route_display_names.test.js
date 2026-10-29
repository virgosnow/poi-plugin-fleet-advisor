'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../../../src/domain/routes/route_plans');
function facts(area,types,{speed='fast',radar=false,unknown=false,phase}={}){
  const ships=types.map((stype,i)=>({instanceId:i+1,stype,name:'测试舰',radarEquipped:radar}));
  const map=require(`../../../data/normal_routes/${area}.json`);
  return {area,phase,ships,targetNodes:map.bossPhases?.[phase]||map.bossNodes,
    lineOfSight:{status:'computed',rawScoresByCoefficient:{1:100,2:100,3:100,4:100}},
    speed:{status:unknown?'unknown':'computed',fleetSpeed:unknown?undefined:speed,
      ships:ships.map(s=>({shipId:s.instanceId,status:unknown?'unknown':'computed',speed:unknown?undefined:speed}))}};
}
const option=(area,id)=>P.recommendedOptions(area).find(o=>o.id===id);

test('2-2 fast water-tender composition is named for its fixed lower path and reverts when the fleet changes',()=>{
  const base=option('2-2','2-2-04'),before=JSON.stringify(base),types=[16,3,6,2,2,2];
  const fast=facts('2-2',types),fixed=P.fleetPathOption(fast,base);
  assert.equal(P.planningPath(fast,[...'CEK']).chance.probability,1);
  assert.equal(fixed.name,'下路水母流');assert.equal(fixed.label,'下路水母流（C→E→K）');
  assert.equal(fixed.key,base.key);assert.deepEqual(fixed.paths,base.paths);
  const slow=P.fleetPathOption(facts('2-2',types,{speed:'slow'}),fixed);
  assert.equal(slow.name,'上下随机水母流');assert.equal(slow.displayPaths.length,2);
  assert.equal(P.fleetPathOption(facts('2-2',types,{unknown:true}),fixed).name,base.name);
  assert.equal(JSON.stringify(base),before,'renaming must not change the preset or constrain its search');
  assert.equal(P.fleetPathOption(null,base),base);
});

test('3-2 fixed detour and 3-4 fast-plus direct path drop random wording without hiding genuine forks',()=>{
  for(const [area,id,types,speed,nodes,name]of [
    ['3-2','3-2-03',[3,2,2,2,2,2],'fast','CGHFL','绕路水雷流'],
    ['3-4','3-4-06',[11,18,7,3,2,2],'fastPlus','ACFJP','上路直达洗地流']]){
    const base=option(area,id),route=facts(area,types,{speed}),display=P.fleetPathOption(route,base);
    assert.equal(P.planningPath(route,[...nodes]).chance.probability,1);
    assert.equal(display.name,name);assert.equal(display.displayPaths.length,1);
    const random=P.fleetPathOption(facts(area,types,{speed:'fast',radar:true}),display);
    assert.equal(random.name,base.name);assert(random.name.includes('随机'));
  }
  const base=option('2-2','2-2-02'),route=facts('2-2',[16,4,4,2,2,2]);
  assert.equal(P.fleetPathOption(route,base).name,'上下随机雷巡流');
});

test('randomly named presets across all maps stay honest for every template, speed tier and radar state',()=>{
  const catalog=require('../../../data/normal_route_guides.json').maps;
  let presets=0,cases=0,fixed=0,random=0;
  for(const key of Object.keys(catalog)){
    const [area,phase]=key.split(':');
    for(const base of P.routeOptions(area,'boss',phase).filter(o=>o.recommend!==false&&o.name.includes('随机'))){
      presets++;
      for(const template of base.templates||[]){
        let combinations=[[]];for(const choices of template)combinations=combinations.flatMap(p=>choices.map(t=>[...p,t]));
        for(const types of combinations)for(const speed of ['slow','fast','fastPlus','fastest'])for(const radar of [false,true]){
          const route=facts(area,types,{speed,radar,phase});if(!P.fleetRequirementAssessment(route,base).eligible)continue;
          const before=JSON.stringify({route,base}),display=P.fleetPathOption(route,base),paths=P.fleetPaths(route,base);
          const certain=paths.length===1&&P.planningPath(route,paths[0],{allowTentative:false}).chance.probability===1;
          if(certain){fixed++;assert(!display.name.includes('随机'),`${area} ${base.id}: ${paths[0].join('→')} is fixed`);}
          else{random++;assert.equal(display.name,base.name,'a remaining or uncertain fork retains its warning');}
          assert.equal(JSON.stringify({route,base}),before);cases++;
        }
      }
    }
  }
  assert(presets>=13&&cases>=168&&fixed>0&&random>0);
});
