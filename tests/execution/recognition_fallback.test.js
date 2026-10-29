'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Session}=require('../../src/execution/session');
const {simulateChange}=require('../../src/execution/organize');
const {fleets}=require('../../src/domain/fleet/organize_planner');
const {createEquipmentPlanner}=require('../../src/domain/fleet/equipment_planner');
const {controlUnavailable,canFallback}=require('../../src/execution/recognition_fallback');
const {Observer}=require('../../src/vision/observers');

// Exercise the real controller, planners, organization and equipment executors.
// Only the game host/observations and clock are simulated: no Electron or game.
function harness(options={}){
  const data={info:{ships:{},equips:{},fleets:[{api_ship:[1,2],api_mission:[0]}],repairs:[],airbase:[]},
    const:{$ships:{},$shipTypes:{2:{api_equip_type:{1:1}}},$equips:{1:{api_name:'gun',api_type:[0,0,1,1]}},$exslotEquips:[],$exslotEquipShips:{},$exslotEquipLimits:{}}};
  for(let id=1;id<=4;id++){
    data.info.ships[id]={api_id:id,api_ship_id:id,api_lv:20,api_slot:[100*id+1,100*id+2],api_slot_ex:-1};
    data.const.$ships[id]={api_name:'ship'+id,api_stype:2,api_slot_num:2};
    for(const item of data.info.ships[id].api_slot)data.info.equips[item]={api_slotitem_id:1,api_level:0,api_alv:0};
  }
  for(const item of [501,502])data.info.equips[item]={api_slotitem_id:1,api_level:0,api_alv:0};
  const planner=createEquipmentPlanner(()=>data),events=[],inputs=[],created=[];
  const ui={screen:'home',picker:false,detail:false,borrow:false,ship:1,slot:0,source:'stock',category:0};
  let host,failed=false,timingOut=false,orgChanges=0,eqChanges=0,imageStarted=false,releaseImage;
  const count=()=>({orgChanges,eqChanges});
  function trip(kind){
    if(failed)return;
    const hit=options.failAt==='organization'&&orgChanges===1&&kind==='screen'||
      options.failAt==='equipment'&&eqChanges===1&&kind==='equipTabs'||options.failAt==='borrow'&&ui.borrow&&kind==='borrowconfirm';
    if(hit){
      failed=true;if(options.drift)data.info.ships[2].api_slot[1]=-1;
      if(options.observationTimeout){timingOut=true;return;}
      throw controlUnavailable('Test control layout unavailable');
    }
  }
  function view(kind,arg={},native=false){
    if(kind==='recognitionRecovery'){
      if(options.unknownRecovery)return {valid:false};
      return ui.borrow?{valid:true,mode:'borrow-cancel',cancel:{x:727,y:481}}:{valid:true,mode:ui.screen};
    }
    if(kind==='screen')return {valid:true,mode:ui.screen,...(arg.includeFleet&&ui.screen==='equipment'?{fleet:1}:{})};
    if(kind==='navigation')return {valid:true,point:{x:100,y:100}};
    if(kind==='orgtab'||kind==='equipTabs')return {valid:true,selected:[1]};
    if(kind==='picker')return {valid:true,tab:{valid:true},sort:{valid:true,mode:'new',direction:'desc'},
      filter:{valid:true,states:[0,0,0,0,1,0,0,0]},page:{valid:true,activePage:1,labels:[1],centers:[760]}};
    if(kind==='cardidentity')return {valid:true,commit:{x:1032,y:669}};
    if(kind==='equipship')return {valid:ui.ship===arg.shipId};
    if(kind==='equipmode')return {valid:true,mode:ui.source};
    if(kind==='cells')return {valid:true,categories:[0],primaries:[0],centers:[{x:811,y:197}]};
    const list=()=>{
      const xs=(ui.source==='others'?planner.otherPickerList:planner.freePickerList)(0,ui.ship,ui.slot);
      return native?xs.slice().reverse():xs;
    };
    if(kind==='equippicker'||kind==='pageread'){
      const xs=list(),page={valid:true,activePage:1,labels:[1],centers:[739],...(native?{itemIds:xs.map(x=>x.id)}:{})};
      return kind==='pageread'?page:{valid:true,category:0,primary:0,page};
    }
    if(kind==='rowicon')return {valid:list()[arg.row]?.id===arg.itemId,actualType:1,expectedType:1};
    if(kind==='pix')return {valid:ui.item===arg.itemId};
    if(kind==='borrowconfirm')return {valid:ui.borrow,commit:{x:470,y:480}};
    if(kind==='batch'){const results=arg.checks.map(c=>view(c.kind,c.arg,native));return {valid:results.every(x=>x.valid),results};}
    throw Error('Unexpected observation '+kind);
  }
  class FastSession extends Session{
    constructor(h,o,opts){let time=performance.now();super(h,o,{...opts,now:()=>time});this.advance=ms=>{time+=ms;};}
    async wait(ms){this.check(false);this.advance(ms);this.metrics.waitMs+=ms;this.check(false);}
  }
  const entry=path.resolve(__dirname,'../../src/application/controller.js'),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(entry,'utf8'),{module:mod,performance,require(name){
    if(name==='../execution/session')return {Session:FastSession};
    return require(path.resolve(path.dirname(entry),name));
  }});
  const controller=new mod.exports.Controller({getStore:()=>data,onProgress:e=>events.push(e),createHost(){
    host={monitor:{expected:null,closed:false},check(){if(this.closed)throw Error('Host closed');},
      getStore:()=>data,start:async()=>{},dispose:async function(){this.disposed=true;},cancel(){this.closed=true;},
      capture:async()=>Buffer.from('mock-frame'),async input(i){
        this.check();inputs.push(i);
        if(i.mutation){
          if(options.uncertain)throw Error('No matching request; submission will not be retried');
          const m=i.mutation;
          if(m.path==='api_req_hensei/change'){
            const next=simulateChange(fleets(data),m.fleet,m.j,m.ship);next.forEach((f,j)=>{data.info.fleets[j].api_ship=f.ships;});orgChanges++;ui.screen='organization';
          }else{
            const dest=data.info.ships[m.ship];
            if(m.path.endsWith('slot_deprive')){
              const donor=data.info.ships[m.sourceShip],item=donor.api_slot[m.sourceJ];
              assert.equal(item,ui.item);donor.api_slot.splice(m.sourceJ,1);donor.api_slot.push(-1);dest.api_slot[m.j]=item;
            }else dest.api_slot[m.j]=m.item;
            eqChanges++;ui.screen='equipment';ui.borrow=false;ui.picker=false;ui.detail=false;
          }
          return;
        }
        const {x,y}=i;
        if(x===107&&y===355||x===62&&y===58){ui.screen='home';ui.picker=false;ui.detail=false;ui.borrow=false;return;}
        if(x===292&&y===202){ui.screen='organization';return;}
        if(x===477&&y===339||x===30&&y===390){ui.screen='equipment';return;}
        if(x===727&&y===481){assert(ui.borrow);ui.borrow=false;ui.detail=false;return;}
        if(ui.screen==='organization')return;
        if(x===310){ui.ship=data.info.fleets[0].api_ship[(y-255)/75];return;}
        if(x===1135&&y===168){ui.source=ui.source==='stock'?'others':'stock';return;}
        if(x===1075&&y===659){ui.borrow=true;return;}
        if(x===750){
          if(!ui.picker){ui.slot=[271,321,366,412,457].indexOf(y);ui.picker=true;return;}
          const xs=(ui.source==='others'?planner.otherPickerList:planner.freePickerList)(0,ui.ship,ui.slot);
          if(controller.session.controlMode)xs.reverse();
          const row=Array.from({length:10},(_,r)=>Math.round(218+44.75*r)).indexOf(y);
          assert(row>=0);ui.item=xs[row]?.id;ui.detail=true;return;
        }
      }};return host;
    },createObserver(h,mode){
      created.push(mode);
      const observer={closed:false,async start(){
        if(mode==='controls'&&options.startFailure)throw controlUnavailable('Game control access unavailable');
        if(mode==='image'){imageStarted=true;if(options.pauseImage)await new Promise(r=>{releaseImage=r;});}
      },releaseFrame(){},async dispose(){this.closed=true;}};
      if(mode==='controls'){
        observer.read=async(kind,arg)=>{trip(kind);return timingOut?{valid:false}:view(kind,arg,true);};
        observer.prepareInput=async i=>{
          if(options.ambiguous&&i.mutation)throw Error('Unique enabled control not confirmed before input (two matches)');
          if(options.preflightFailure&&!failed&&i.mutation?.path==='api_req_kaisou/slot_deprive'){
            failed=true;throw controlUnavailable('Control unavailable before submission');
          }
          return {x:i.x,y:i.y};
        };
      }else observer.observe=async(kind,frame,arg)=>{
        if(options.imageFailure&&kind!=='recognitionRecovery'&&ui.screen==='equipment')throw Error('Image recognition failed');
        return view(kind,arg,false);
      };
      return observer;
    }});
  const scheme={fleet:1,ships:[{id:3,slots:[101,501]},{id:4,slots:[201,502]}]};
  return {controller,data,events,inputs,created,count,scheme,host:()=>host,imageStarted:()=>imageStarted,releaseImage:()=>releaseImage?.()};
}

for(const failAt of ['organization','equipment','borrow'])test('image fallback resumes '+failAt+' without replaying verified changes',async()=>{
  const h=harness({failAt}),result=await h.controller.run('fleet',h.scheme);
  assert.deepEqual(h.created,['controls','image']);
  assert.deepEqual(h.data.info.fleets[0].api_ship,[3,4]);
  assert.deepEqual(h.data.info.ships[3].api_slot,[101,501]);assert.deepEqual(h.data.info.ships[4].api_slot,[201,502]);
  assert.deepEqual(h.data.info.ships[1].api_slot,[102,-1]);assert.deepEqual(h.data.info.ships[2].api_slot,[202,-1]);
  assert.equal(result.changed,6);assert.equal(result.metrics.confirmedMutations,6);
  assert.equal(result.metrics.finalRecognitionMode,'image');assert.equal(result.metrics.recognitionFallbacks.length,1);
  assert.equal(h.inputs.filter(x=>x.mutation).length,6);assert.equal(h.events.filter(x=>x.phase==='recognition-fallback').length,1);
  assert.equal(h.inputs.filter(x=>x.x===824&&x.y===168).length,1,'clear retained native filters once before image list projection');
  assert.equal(h.inputs.filter(x=>x.x===727&&x.y===481).length,failAt==='borrow'?1:0);
});

test('controls remain screenshot-free and explicit image mode remains available',async()=>{
  for(const recognitionMode of ['controls','image']){
    const h=harness(),r=await h.controller.run('fleet',h.scheme,{recognitionMode});
    assert.deepEqual(h.created,[recognitionMode]);assert.equal(r.metrics.recognitionFallbacks.length,0);
    assert.equal(r.metrics.captures===0,recognitionMode==='controls');assert.equal(r.changed,6);
  }
});
test('all three extra waits persist through the entire organization, refit and image recovery sequence',async()=>{
  let baseline;
  for(const operationWaitMs of [0,300,800]){
    const h=harness({failAt:'borrow'}),r=await h.controller.run('fleet',h.scheme,{operationWaitMs});
    assert.equal(r.changed,6);assert.equal(r.metrics.recognitionFallbacks.length,1);
    if(!baseline)baseline={inputs:r.metrics.inputs,waitMs:r.metrics.waitMs};
    assert.equal(r.metrics.inputs,baseline.inputs);
    assert(Math.abs(r.metrics.waitMs-baseline.waitMs-baseline.inputs*operationWaitMs)<0.01);
  }
});
test('unavailable control startup uses image once',async()=>{
  const h=harness({startFailure:true}),r=await h.controller.run('fleet',h.scheme);
  assert.deepEqual(h.created,['controls','image']);assert.equal(r.metrics.recognitionFallbacks[0].phase,'startup');assert.equal(r.changed,6);
});
test('control observation timeout and rejected input preflight resume without an unverified submission',async()=>{
  for(const options of [{failAt:'equipment',observationTimeout:true},{preflightFailure:true}]){
    const h=harness(options),r=await h.controller.run('fleet',h.scheme);
    assert.equal(r.changed,6);assert.equal(h.inputs.filter(x=>x.mutation).length,6);
    assert.equal(r.metrics.recognitionFallbacks[0].code,options.observationTimeout?'OBSERVATION_TIMEOUT':'CONTROL_RECOGNITION_UNAVAILABLE');
  }
});
test('standalone equipment recovery keeps the original exact target instances',async()=>{
  const h=harness({failAt:'equipment'});h.data.info.fleets[0].api_ship=[3,4];
  const r=await h.controller.run('equipment',h.scheme);
  assert.equal(r.changed,4);assert.deepEqual(h.data.info.ships[3].api_slot,[101,501]);
  assert.deepEqual(h.data.info.ships[4].api_slot,[201,502]);assert.equal(h.inputs.filter(x=>x.mutation).length,4);
});
for(const options of [{drift:true,failAt:'equipment'},{uncertain:true},{ambiguous:true}])test('state drift, ambiguity or uncertain submission prohibits fallback '+JSON.stringify(options),async()=>{
  const h=harness(options);await assert.rejects(h.controller.run('fleet',h.scheme));assert.deepEqual(h.created,['controls']);
});
test('unrecognized recovery UI and failed image recognition stop without another fallback',async()=>{
  for(const options of [{unknownRecovery:true},{imageFailure:true}]){
    const h=harness({failAt:'equipment',...options});await assert.rejects(h.controller.run('fleet',h.scheme));
    assert.deepEqual(h.created,['controls','image']);assert.equal(h.count().eqChanges,1);
  }
});
test('stop during image startup cannot resume inputs',async()=>{
  const h=harness({failAt:'equipment',pauseImage:true}),pending=h.controller.run('fleet',h.scheme);
  let finished=false;void pending.finally(()=>{finished=true;}).catch(()=>{});
  while(!h.imageStarted()&&!finished)await new Promise(r=>setImmediate(r));
  if(!h.imageStarted())await pending;
  const before=h.inputs.length;h.controller.stop();h.releaseImage();await assert.rejects(pending,/stopped|closed|unavailable/i);
  assert.equal(h.inputs.length,before);assert.equal(h.count().eqChanges,1);
});
test('session handoff preserves the deadline, sequence and counters, and requires a verified mutation boundary',async()=>{
  const host={check(){},cancel(){},input:async()=>{}},s=new Session(host,{read:async()=>({valid:true})},{allowControlFallback:true});
  const deadline=s.deadline;s.actionId=9;s.metrics.inputs=9;
  await s.input(1,1,{path:'api_req_kaisou/slotset'},'click',{settleMs:0});
  assert(!canFallback(s,controlUnavailable('missing')));assert.throws(()=>s.useImageObserver({observe(){}}),/boundary/);
  s.confirmMutation();s.useImageObserver({observe(){}});
  assert.equal(s.deadline,deadline);assert.equal(s.actionId,10);assert.equal(s.metrics.inputs,10);assert.equal(s.metrics.confirmedMutations,1);
});
test('image recovery confirms the cancel button and excludes unknown/hidden home controls',async()=>{
  const o=new Observer(),fixture=name=>fs.readFileSync(path.resolve(__dirname,'../fixtures/'+name+'.png'));
  const cancel=await o.observe('recognitionRecovery',fixture('borrow/confirm'),{});
  assert.deepEqual(cancel,{valid:true,mode:'borrow-cancel',cancel:{x:727,y:481}});
  assert.equal((await o.observe('recognitionRecovery',fixture('equip/return-button'),{})).mode,'port-return');
  assert.equal((await o.observe('recognitionRecovery',fixture('equip/home-toggle'),{})).valid,false);
});
