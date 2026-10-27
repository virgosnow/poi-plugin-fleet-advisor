'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../../src/domain/fleet/organize_planner');
const {resolvePlan,simulateChange,restoreOrganization}=require('../../src/execution/organize');
function fixture() {
  const ships={},masters={};
  for(let id=1;id<=35;id++){ships[id]={api_id:id,api_ship_id:1000+id,api_lv:10};masters[1000+id]={api_stype:2,api_name:'ship'+id};}
  return {info:{ships,fleets:[{api_ship:[1,2,3,4],api_mission:[0]},{api_ship:[5,6],api_mission:[0]}],repairs:[]},const:{$ships:masters}};
}
test('organization refuses an unknown initial screen before any fleet input',async()=>{
  const data=fixture(),before=JSON.stringify(data);let inputs=0;
  const session={host:{getStore:()=>data},check(){},until:async kind=>{assert.equal(kind,'screen');throw Error('Observation timed out: screen');},input:async()=>inputs++};
  await assert.rejects(restoreOrganization(session,{fleet:1,ships:[35]}),/无法识别当前画面/);
  assert.equal(inputs,0);assert.equal(JSON.stringify(data),before);
});
test('numeric NEW uses instance IDs and retains disabled rows',()=>{
  const s=fixture();s.info.ships[35].api_situation=2;s.const.$ships[1034].api_name='new name';
  const roster=P.rosterFromStore(s),pos=P.locate(roster,'9',[1,1,1,1,1,1,1,1]);
  assert.deepEqual(pos.ids.slice(0,3),[35,34,33]);assert.equal(pos.page,3);assert.equal(pos.row,6);
});
test('known stypes classify by live master; new ship needs no static table',()=>{
  const s=fixture();s.info.ships[100]={api_ship_id:9999,api_lv:1};s.const.$ships[9999]={api_stype:18,api_name:'future carrier'};
  const roster=P.rosterFromStore(s);assert.equal(roster[0].group,1);assert.equal(P.desiredMask(roster,[100]).fallback,false);
  assert.deepEqual([P.STYPE_GROUP[4],P.STYPE_GROUP[6],P.STYPE_GROUP[14],P.STYPE_GROUP[21],P.STYPE_GROUP[19]],[3,2,6,3,7]);
});
test('unknown unrelated stype forces full list and cannot be dropped',()=>{
  const s=fixture();s.const.$ships[1035].api_stype=999;
  const roster=P.rosterFromStore(s);assert(P.desiredMask(roster,[2]).fallback);
  assert.throws(()=>P.locate(roster,2,[0,0,0,0,1,0,0,0]));
  assert.equal(P.locate(roster,2,[1,1,1,1,1,1,1,1]).ids.length,35);
});
test('missing master also falls back and invalid instance IDs stop',()=>{
  const s=fixture();delete s.const.$ships[1035];assert(P.desiredMask(P.rosterFromStore(s),[2]).fallback);
  for(const id of ['foo',0,-1,1.5,'9007199254740993'])assert.throws(()=>P.instanceId(id));
});
test('filter enables destination before disabling existing group',()=>{
  assert.equal(P.nextFilter([1,0,0,0,0,0,0,0],[0,0,0,0,1,0,0,0]),4);
  assert.equal(P.nextFilter([1,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,0]),0);
  assert.equal(P.nextFilter([0,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,0]),-1);
  assert.throws(()=>P.nextFilter([1],[1]));
});

test('scheme filter unions target groups rather than every owned ship type',()=>{
  const s=fixture();s.const.$ships[1035].api_stype=9;s.const.$ships[1034].api_stype=10;s.const.$ships[1033].api_stype=7;
  const roster=P.rosterFromStore(s);
  assert.deepEqual(P.desiredMask(roster,[35,34,1]),{fallback:false,mask:[1,0,0,0,1,0,0,0]});
  assert.deepEqual(P.desiredMask(roster,[33,35]),{fallback:false,mask:[1,1,0,0,0,0,0,0]});
  for(const targets of [[],[999],undefined])assert.throws(()=>P.desiredMask(roster,targets));
});

test('preview includes an unchanged flagship in the union after name resolution',()=>{
  const s=fixture();s.const.$ships[1001].api_stype=10;
  const plan=resolvePlan(s,{fleet:1,ships:['ship1',{name:'ship35'}]});
  assert.deepEqual(plan.filter.mask,[1,0,0,0,1,0,0,0]);
});
test('plan validates fleet, duplicate IDs, repair and expeditions',()=>{
  const s=fixture();assert(resolvePlan(s,{fleet:1,ships:[1,2,3,4]}).done);
  assert(!resolvePlan(s,{fleet:1,ships:[1,2]}).done);
  s.info.fleets[0].api_ship.push(-1,-1);assert(resolvePlan(s,{fleet:1,ships:[1,2,3,4]}).done);
  for(const scheme of [{fleet:8,ships:[1]},{fleet:1,ships:[2,2]},{fleet:1,ships:[]}])assert.throws(()=>resolvePlan(s,scheme));
  s.info.fleets[1].api_mission=[1];assert.throws(()=>resolvePlan(s,{fleet:1,ships:[5]}));
  s.info.repairs=[{api_ship_id:35}];assert.throws(()=>resolvePlan(s,{fleet:1,ships:[35]}),/repair/);
});
test('portable ship names select highest numeric level and keep explicit IDs authoritative',()=>{
  const s=fixture();
  s.const.$ships[1034].api_name=s.const.$ships[1035].api_name='扶桑改二';
  s.info.ships[34].api_lv='100';s.info.ships[35].api_lv='99';
  for(const entry of ['扶桑改二',{name:'扶桑改二'}]) {
    assert.deepEqual(resolvePlan(s,{fleet:1,ships:[entry]}).targets,[34]);
  }
  assert.deepEqual(resolvePlan(s,{fleet:1,ships:[{id:35,name:'扶桑改二'}]}).targets,[35]);
  // id + shortened name stays valid: the name only has to be consistent
  // (exact or prefix) with the id's instance, not a second lock.
  assert.deepEqual(resolvePlan(s,{fleet:1,ships:[{id:35,name:'扶桑改'}]}).targets,[35]);
  // Prefix resolution: a prefix resolves to the highest-level matching ship — '扶桑改' hits the 扶桑改二 family and
  // picks Lv.100; adding a shorter '扶桑' ship still picks Lv.100.
  assert.deepEqual(resolvePlan(s,{fleet:1,ships:['扶桑改']}).targets,[34]);
  s.const.$ships[1033].api_name='扶桑';
  assert.deepEqual(resolvePlan(s,{fleet:1,ships:['扶桑']}).targets,[34]);
  assert.throws(()=>resolvePlan(s,{fleet:1,ships:[{id:35,name:'完全不同名'}]}),/mismatch/);
  assert.throws(()=>resolvePlan(s,{fleet:1,ships:['扶桑改二','扶桑改二']}),/Duplicate/);
});
test('name selection ties are deterministic and incomplete levels cannot choose a lower ship',()=>{
  const s=fixture();
  s.const.$ships[1034].api_name=s.const.$ships[1035].api_name='扶桑改二';
  s.info.ships[34].api_lv=99;s.info.ships[35].api_lv=99;
  assert.deepEqual(resolvePlan(s,{fleet:1,ships:['扶桑改二']}).targets,[34]);
  for(const level of [undefined,null,0,NaN,'unknown',99.5]) {
    s.info.ships[35].api_lv=level;
    assert.throws(()=>resolvePlan(s,{fleet:1,ships:['扶桑改二']}),/等级数据不完整/);
  }
});
test('highest-level named ship in repair or expedition is not replaced with a lower-level copy',()=>{
  const s=fixture();
  s.const.$ships[1034].api_name=s.const.$ships[1035].api_name='扶桑改二';
  s.info.ships[34].api_lv=100;s.info.ships[35].api_lv=99;
  s.info.repairs=[{api_ship_id:34}];
  assert.throws(()=>resolvePlan(s,{fleet:1,ships:['扶桑改二']}),/repair/);
  s.info.repairs=[];s.info.fleets[1]={api_ship:[34],api_mission:[1]};
  assert.throws(()=>resolvePlan(s,{fleet:1,ships:['扶桑改二']}),/expedition/);
});
test('swap simulation handles intra-fleet, cross-fleet and appending',()=>{
  const f=resolvePlan(fixture(),{fleet:1,ships:[35]}).current;
  assert.deepEqual(simulateChange(f,1,0,2)[0].ships,[2,1,3,4]);
  const cross=simulateChange(f,1,1,5);assert.deepEqual(cross.map(f=>f.ships),[[1,5,3,4],[2,6]]);
  assert.deepEqual(simulateChange(f,1,4,5).map(f=>f.ships),[[1,2,3,4,5],[6]]);
});
test('bulk-clear simulation preserves the flagship and every other fleet',()=>{
  const f=resolvePlan(fixture(),{fleet:1,ships:[1]}).current;
  assert.deepEqual(simulateChange(f,1,0,-2).map(f=>f.ships),[[1],[5,6]]);
  assert.deepEqual(f.map(f=>f.ships),[[1,2,3,4],[5,6]]);
  for(const slot of [1,4,-1,1.5,6])assert.throws(()=>simulateChange(f,1,slot,-2));
  for(const ships of [[],[1]])assert.throws(()=>simulateChange([{ships,mission:0}],1,0,-2));
  assert.throws(()=>simulateChange(f,1,1,-1));
});
function fakeSession(options={}) {
  const state=fixture(),inputs=[],snapshots=[],observations=[];let mask=options.mask||[1,1,1,1,1,1,1,1],page=options.page||1,clock=0,sortIndex=0;
  if(options.fleets)options.fleets.forEach((ships,i)=>state.info.fleets[i].api_ship=ships.slice());
  const session={host:{getStore:()=>state},now:()=>++clock,onProgress(){},check(){if(this.validate)this.validate();},
    async wait(){clock+=10000;this.check();},
    async observe(kind,arg){this.check();if(kind==='orgtab')return {valid:true};return this.until(kind,arg);},
    async until(kind,arg={},predicate=r=>r.valid){
      this.check();observations.push({kind,arg,inputCount:inputs.length});let result;
      if(kind==='screen')result={valid:true,mode:'organization'};
      if(kind==='orgtab')result={valid:true};
      if(kind==='picker')result={valid:true,sort:{valid:true,mode:options.sortCycle?.[sortIndex]||options.sort||'new',direction:options.direction||'desc'},filter:{states:mask},tab:{valid:true},page:{valid:true,activePage:page,labels:[1,2,3,4].slice(0,arg.total),centers:[760,813,867,920]}};
      if(kind==='rowidentity')result=options.wrongRow&&arg.checkLevel!==false?{valid:false,reason:'level mismatch',level:options.wrongRow}:{valid:true,level:arg.expectedLevel};
      if(kind==='cardidentity')result={valid:true,level:arg.expectedLevel,commit:{x:1032,y:669}};
      if(kind==='orgclear')result={valid:!options.missingClear,tab:{valid:!options.wrongClearTab},commit:options.missingCommit?null:{x:625,y:178}};
      if(options.observe)options.observe(result,kind,arg,{mask,page});
      if(!predicate(result))throw new Error('Observation timed out: '+kind);
      return result;
    },
    async input(x,y,mutation,kind='click'){
      this.check();inputs.push({x,y,mutation,kind});
      if(x===1160&&y===199)sortIndex++;
      if(y===166){const i=[632,697,761,825,889,953,1017,1081].indexOf(x);mask=mask.slice();mask[i]^=1;}
      if(y===677&&!options.swallowPage)page=x===663?1:[760,813,867,920].indexOf(x)+1;
      if(mutation&&!options.noStore){
        // Model the server independently of the executor's prediction.
        const {fleet,j,ship}=mutation,dest=state.info.fleets[fleet-1].api_ship;
        if(ship===-2)dest.splice(1);
        else {
          const source=state.info.fleets.find(f=>f.api_ship.includes(ship));
          if(source){const at=source.api_ship.indexOf(ship);if(dest[j]>0)source.api_ship[at]=dest[j];else source.api_ship.splice(at,1);}
          dest[j]=ship;
        }
        if(options.afterMutation)options.afterMutation(state,mutation);
        if(mutation.ship>0&&options.resetFilter)mask=options.resetFilter.slice();
        snapshots.push(state.info.fleets.map(f=>f.api_ship.slice()));
      }
    }};
  return {session,inputs,state,snapshots,observations};
}
test('full restoration uses differential filters without resetting page one',async()=>{
  const f=fakeSession({page:2,fleets:[[1],[5,6]]});
  const out=await restoreOrganization(f.session,{fleet:1,ships:[35]});
  assert.equal(out.changed,1);assert.equal(f.state.info.fleets[0].api_ship[0],35);
  assert.equal(f.inputs.filter(i=>i.y===166).length,7);
  assert(!f.inputs.some(i=>i.x===663));assert.equal(f.inputs.filter(i=>i.mutation).length,1);
});

test('organization completes five-slot confirmation without requiring level text',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]]});
  f.state.const.$ships[1035].api_slot_num=5;f.state.info.ships[35].api_lv=97;
  const {Observer}=require('../../src/vision/observers'),observer=new Observer();
  const frame=require('node:fs').readFileSync(require('node:path').join(__dirname,'../fixtures/identity/musashi-five-slot-card.png'));
  const until=f.session.until.bind(f.session);
  f.session.until=async(kind,arg,predicate)=>{
    const result=await until(kind,arg,predicate);
    if(kind!=='cardidentity')return result;
    const card=await observer.observe(kind,frame,arg);
    assert(card.valid,'executor must not require a level read');
    return card;
  };
  await restoreOrganization(f.session,{fleet:1,ships:[35]});
  assert.equal(f.observations.find(o=>o.kind==='cardidentity').arg.checkLevel,false);
  assert.equal(f.inputs.filter(i=>i.mutation?.ship===35).length,1);
});
test('same-group next slot needs no filter clicks',async()=>{
  const f=fakeSession({mask:[0,0,0,0,1,0,0,0]});
  await restoreOrganization(f.session,{fleet:1,ships:[35,34]});
  assert(!f.inputs.some(i=>i.y===166));assert.deepEqual(f.state.info.fleets[0].api_ship,[35,34]);
});

test('alternating ship types share one filter setup and one merged read per unchanged picker',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]]});
  for(const m of Object.values(f.state.const.$ships))m.api_stype=3;
  for(const id of [35,33])f.state.const.$ships[1000+id].api_stype=9;
  for(const id of [34,32])f.state.const.$ships[1000+id].api_stype=2;
  const targets=[35,34,33,32],mask=[1,0,0,0,1,0,0,0];
  await restoreOrganization(f.session,{fleet:1,ships:targets});
  assert.deepEqual(f.state.info.fleets[0].api_ship,targets);
  assert.equal(f.inputs.filter(i=>i.y===166).length,6);
  assert(!f.inputs.slice(f.inputs.findIndex(i=>i.mutation)+1).some(i=>i.y===166||i.y===199));
  const reads=f.observations.filter(o=>o.kind==='picker'),rows=f.observations.filter(o=>o.kind==='cardidentity');
  assert.equal(reads.length,6+targets.length); // setup confirmations plus one opening read per ship
  assert.equal(new Set(reads.map(o=>o.inputCount)).size,reads.length);
  assert(reads.every(o=>o.arg.total===1));
  assert.deepEqual(rows.map(o=>o.arg.row),[0,1,2,3]);
  assert(rows.every(o=>o.arg.checkLevel===false));
  assert(rows.every(o=>JSON.stringify(o.arg.mask)===JSON.stringify(mask)));
  assert(!f.observations.some(o=>o.kind==='rowidentity'));
});

test('matching union and current page require no filter, sort or page clicks',async()=>{
  const f=fakeSession({fleets:[[35],[5,6]],mask:[1,0,0,0,1,0,0,0],page:1});
  f.state.const.$ships[1035].api_stype=9;
  await restoreOrganization(f.session,{fleet:1,ships:[35,34,33]});
  assert(!f.inputs.some(i=>[166,199,677].includes(i.y)));
  assert.equal(f.observations.filter(o=>o.kind==='picker').length,2);
  assert(f.observations.filter(o=>o.kind==='cardidentity').every(o=>o.arg.mask[0]===1));
});

test('a reset between ships restores the same union rather than the next ship type',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]],mask:[1,0,0,0,1,0,0,0],resetFilter:[0,0,0,0,1,0,0,0]});
  f.state.const.$ships[1035].api_stype=9;
  await restoreOrganization(f.session,{fleet:1,ships:[35,34]});
  assert.deepEqual(f.inputs.filter(i=>i.y===166).map(i=>i.x),[632]);
  assert.deepEqual(f.state.info.fleets[0].api_ship,[35,34]);
});

test('unknown unrelated type keeps the full roster for all targets',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]],mask:[0,0,0,0,1,0,0,0]});
  f.state.const.$ships[1035].api_stype=999;f.state.const.$ships[1033].api_stype=9;
  await restoreOrganization(f.session,{fleet:1,ships:[34,33]});
  assert.equal(f.inputs.filter(i=>i.y===166).length,7);
  const rows=f.observations.filter(o=>o.kind==='cardidentity');
  assert(rows.every(o=>o.arg.mask.every(v=>v===1)));
  assert.deepEqual(rows.map(o=>o.arg.row),[1,2]);
});

test('unreadable pages stop during the initial or final-filter observation',async()=>{
  for(const mask of [[0,0,0,0,1,0,0,0],[1,1,1,1,1,1,1,1]]) {
    const f=fakeSession({fleets:[[1],[5,6]],mask,observe(r,kind){if(kind==='picker')r.page.valid=false;}});
    await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[35]}),/Observation timed out/);
    assert(!f.inputs.some(i=>i.x===870||i.mutation));
  }
});

test('merged page observation still waits for navigation and never repeats swallowed clicks',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]],mask:[0,0,0,0,1,0,0,0],page:2,swallowPage:true});
  await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[35]}),/Observation timed out/);
  assert.equal(f.inputs.filter(i=>i.y===677).length,1);assert(!f.inputs.some(i=>i.mutation));
});

test('recognized Lv sort reaches NEW through type sort before selecting a ship',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]],sortCycle:['level','type','new']});
  await restoreOrganization(f.session,{fleet:1,ships:[35]});
  assert.deepEqual(f.state.info.fleets[0].api_ship,[35]);
  assert.equal(f.inputs.filter(i=>i.x===1160&&i.y===199).length,2);
});
test('repeated ship sorting states stop before another cycle or any mutation',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]],sortCycle:['type','level','type']});
  await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[35]}),/sorting repeated/);
  assert.equal(f.inputs.filter(i=>i.x===1160&&i.y===199).length,2);
  assert(!f.inputs.some(i=>i.mutation));
});
test('a differing level does not block the organization executor',async()=>{
  const f=fakeSession({wrongRow:13,fleets:[[1],[5,6]]});
  await restoreOrganization(f.session,{fleet:1,ships:[35]});
  assert.equal(f.inputs.filter(i=>i.mutation).length,1);
  assert.deepEqual(f.state.info.fleets[0].api_ship,[35]);
});

test('changed list context still stops before opening confirmation',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]],mask:[0,0,0,0,1,0,0,0],observe:(result,kind)=>{if(kind==='picker')result.page.valid=false;}});
  await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[35]}),/Observation timed out: picker/);
  assert(!f.inputs.some(i=>i.mutation));assert(!f.inputs.some(i=>i.x===870));
});
test('removing the repeated list read does not bypass the fresh confirmation card',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]],observe:(result,kind)=>{
    assert.notEqual(kind,'rowidentity');if(kind==='cardidentity')result.valid=false;
  }});
  await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[35]}),/Observation timed out: cardidentity/);
  assert(!f.inputs.some(i=>i.mutation));
});
test('reversed NEW direction cannot enter row selection',async()=>{
  const f=fakeSession({direction:'asc',fleets:[[1],[5,6]]});await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[35]}));
  assert(!f.inputs.some(i=>i.x===870||i.mutation));
});
test('unconfirmed mutation is sent only once',async()=>{
  const f=fakeSession({noStore:true,fleets:[[1],[5,6]]});await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[35]}),/not be repeated/);
  assert.equal(f.inputs.filter(i=>i.mutation).length,1);
});
test('no-op completes without screenshots or input',async()=>{
  const f=fakeSession();f.session.until=()=>{throw new Error('Should not observe');};
  assert((await restoreOrganization(f.session,{fleet:1,ships:[1,2,3,4]})).done);assert.equal(f.inputs.length,0);
});

test('six to four starts with one bulk clear even when the target prefix matches',async()=>{
  const f=fakeSession({fleets:[[1,2,3,4,7,8],[5,6]]});
  const result=await restoreOrganization(f.session,{fleet:1,ships:[1,2,3,4]});
  assert.equal(result.changed,4);
  assert.deepEqual(f.state.info.fleets.map(f=>f.api_ship),[[1,2,3,4],[5,6]]);
  assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>i.mutation),[
    {path:'api_req_hensei/change',fleet:1,j:0,ship:-2},
    {path:'api_req_hensei/change',fleet:1,j:1,ship:2},
    {path:'api_req_hensei/change',fleet:1,j:2,ship:3},
    {path:'api_req_hensei/change',fleet:1,j:3,ship:4}
  ]);
  assert.deepEqual(f.snapshots.map(s=>s[0]),[[1],[1,2],[1,2,3],[1,2,3,4]]);
  assert(f.inputs.some(i=>i.kind==='hover'&&i.x===625&&i.y===178));
});

test('target ships initially in the tail are freed then added in JSON order',async()=>{
  const f=fakeSession({fleets:[[1,2,3,4,7,8],[5,6]]});
  await restoreOrganization(f.session,{fleet:1,ships:[7,8,3,4]});
  assert.deepEqual(f.state.info.fleets.map(f=>f.api_ship),[[7,8,3,4],[5,6]]);
  assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>i.mutation.ship),[-2,7,8,3,4]);
  assert.deepEqual(f.snapshots.map(s=>s[0]),[[1],[7],[7,8],[7,8,3],[7,8,3,4]]);
});

test('cross-fleet flagship exchange retains exact source fleet effects after clearing',async()=>{
  const f=fakeSession({fleets:[[1,2,3,4,7,8],[5,6]]});
  await restoreOrganization(f.session,{fleet:1,ships:[5,8,3,4]});
  assert.deepEqual(f.state.info.fleets.map(f=>f.api_ship),[[5,8,3,4],[1,6]]);
});

test('one target leaves only its flagship with one bulk clear and no sorting',async()=>{
  const f=fakeSession({fleets:[[1,2,3,4],[5,6,7,8,9,10]],sort:'unknown'});
  const result=await restoreOrganization(f.session,{fleet:2,ships:[5]});
  assert.equal(result.changed,1);
  assert.deepEqual(f.state.info.fleets.map(f=>f.api_ship),[[1,2,3,4],[5]]);
  assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>[i.mutation.fleet,i.mutation.j,i.mutation.ship]),[[2,0,-2]]);
  assert(!f.inputs.some(i=>i.y===166||i.y===199));
});

test('short fleets grow to the full target without issuing removals',async()=>{
  const f=fakeSession({fleets:[[1],[5,6]]});
  await restoreOrganization(f.session,{fleet:1,ships:[1,2,3,4]});
  assert.deepEqual(f.state.info.fleets.map(f=>f.api_ship),[[1,2,3,4],[5,6]]);
  assert(!f.inputs.some(i=>i.mutation?.ship<0));
});

test('unconfirmed bulk-clear button or fleet tab cannot submit',async()=>{
  for(const option of ['missingClear','wrongClearTab','missingCommit']) {
    const f=fakeSession({[option]:true});
    await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[1,2]}));
    assert(!f.inputs.some(i=>i.mutation));
  }
});

test('bulk-clear confirmation checks every fleet and never retries or starts adding after a mismatch',async()=>{
  for(const options of [
    {noStore:true},
    {afterMutation:s=>s.info.fleets[1].api_ship.reverse()},
    {afterMutation:s=>s.info.fleets[0].api_ship.push(35)},
    {afterMutation:s=>s.info.fleets[0].api_ship[0]=35}
  ]) {
    const f=fakeSession(options);
    await assert.rejects(restoreOrganization(f.session,{fleet:1,ships:[1,2]}),/not be repeated/);
    assert.equal(f.inputs.filter(i=>i.mutation).length,1);
    assert.equal(f.inputs.find(i=>i.mutation).mutation.ship,-2);
    assert(!f.inputs.some(i=>i.x===870));
  }
});

test('invalid plans fail before bulk clearing',async()=>{
  for(const scheme of [{fleet:1,ships:[]},{fleet:1,ships:[2,2]},{fleet:1,ships:['missing ship']}]) {
    const f=fakeSession();await assert.rejects(restoreOrganization(f.session,scheme));assert.equal(f.inputs.length,0);
  }
});

test('cross-fleet escort append compacts the source without replacing its members',async()=>{
  const f=fakeSession({fleets:[[1,2,3,4],[5,6,7,8]]});
  await restoreOrganization(f.session,{fleet:1,ships:[1,6,3]});
  assert.deepEqual(f.state.info.fleets.map(f=>f.api_ship),[[1,6,3],[5,7,8]]);
});

test('the old flagship can return as an escort after selecting the new flagship',async()=>{
  const f=fakeSession();
  await restoreOrganization(f.session,{fleet:1,ships:[3,1,2]});
  assert.deepEqual(f.state.info.fleets.map(f=>f.api_ship),[[3,1,2],[5,6]]);
  assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>i.mutation.ship),[-2,3,1,2]);
});
