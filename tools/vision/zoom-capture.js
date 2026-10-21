(async()=>{
  // Inject in poi's main renderer. No clicks until __zoomCapture is invoked.
  // __zoomCapture({inspectOnly:true}) saves the current frame without input.
  // Full legs start at home; never guess a way out of an unknown screen.
  const root='D:/Game/KancolleAI/poi-plugin-fleet-advisor';
  window.__zoomCapture=async({inspectOnly=false,returnHomeOnly=false,organizationOnly=false}={})=>{
    if(window.__zoomCaptureBusy)throw Error('Capture already running');
    const panel=document.querySelector('.paa');
    if(panel?.querySelector('textarea')?.disabled)throw Error('Assistant is busy');
    window.__zoomCaptureBusy=true;
    const fs=require('fs'),path=require('path'),crypto=require('crypto');
    // Reload only source-tree vision/tool modules. The installed Controller
    // and its lifecycle are not replaced by this development collector.
    for(const key of Object.keys(require.cache))if(key.startsWith(path.join(root,'src/vision'))||key.startsWith(path.join(root,'tools/vision/resample')))delete require.cache[key];
    const {PoiHost}=require(root+'/src/host/poi_host'),{Session}=require(root+'/src/execution/session');
    const {Pixels}=require(root+'/src/vision/pixels'),V=require(root+'/src/vision/observers');
    const {resampleArea}=require(root+'/tools/vision/resample'),{enterScreen}=require(root+'/src/execution/navigation');
    const remote=require('@electron/remote'),host=new PoiHost({window,remote}),observer=new V.Observer();
    const dir=fs.mkdtempSync('D:/Game/KancolleAI/tmp/zoom-v3-');
    const audit={version:3,inspectOnly,captures:{},requests:[],commands:[],restoration:{},ok:false};
    const state=()=>{const s=host.getStore().info;return {fleets:s.fleets,ships:Object.entries(s.ships).map(([id,v])=>[id,v.api_slot,v.api_slot_ex]),equips:s.equips};};
    const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const before=state(),beforeHash=digest(before);fs.writeFileSync(path.join(dir,'baseline.json'),JSON.stringify(before));
    const command=host.command.bind(host);host.command=async(method,params)=>{audit.commands.push(method);return command(method,params);};
    const request=(event,method,p)=>{if(method==='Network.requestWillBeSent'){const u=new URL(p.request.url);if(u.pathname.startsWith('/kcsapi/'))audit.requests.push(u.pathname);}};
    let session;
    try{
      await host.start();host.wc.debugger.on('message',request);
      const raw=Pixels.decode(await host.capture()),rect=window.getStore('layout.webview.ref').getBoundingClientRect();
      audit.env={cssW:rect.width,cssH:rect.height,capW:raw.width,capH:raw.height,gameZoom:host.wc.getZoomFactor(),effectiveScale:raw.width/rect.width,savedAt:new Date().toISOString(),resample:'area'};
      const frame=async()=>{const raw=Pixels.decode(await host.capture());if(raw.width!==audit.env.capW||raw.height!==audit.env.capH)throw Error('Capture dimensions changed during leg');return {raw,im:resampleArea(raw,1200,720)};};
      // Keep input bounds and passive monitoring in the same owned host.
      const driver=Object.create(host);driver.capture=async()=>(await frame()).im.png();
      session=new Session(driver,observer,{timeoutMs:180000});session.validate=()=>{if(digest(state())!==beforeHash)throw Error('Fleet/equipment state changed during capture');};
      const save=async(name,checks=[])=>{
        const f=await frame();fs.writeFileSync(path.join(dir,'raw-'+name+'.png'),f.raw.png());fs.writeFileSync(path.join(dir,'rs-'+name+'.png'),f.im.png());
        audit.captures[name]={raw:'raw-'+name+'.png',rs:'rs-'+name+'.png',checks};return f.im;
      };
      const check=(kind,expected,arg={})=>({kind,arg,expected});
      const click=async(x,y,park=true)=>{await session.input(x,y);if(park)await session.input(5,5,undefined,'hover');};
      const initial=await save('initial');audit.initialScreen=await observer.observe('screen',initial);
      if(inspectOnly){audit.ok=true;}else if(returnHomeOnly){
        if(audit.initialScreen.valid)await enterScreen(session,'home');
        else {
          const mode=await session.until('equipmode',{});
          await session.until('equippicker',{total:999});
          audit.recovery={recognizedEquipmentPicker:mode.mode};
          await click(107,355);await session.until('screen',{},r=>r.valid&&r.mode==='home');
        }
        await save('final-home',[check('screen',{valid:true,mode:'home'})]);audit.ok=true;
      }else{
      if(!audit.initialScreen.valid||audit.initialScreen.mode!=='home')throw Error('Full capture starts at a verified home screen; no escape clicks were attempted');
      audit.captures.initial.checks=[check('screen',{valid:true,mode:'home'})];
      const store=host.getStore(),ships=store.info.fleets[0].api_ship.filter(id=>id>0);
      if(!ships.length||store.info.fleets[0].api_mission[0]!==0)throw Error('Fleet 1 must be available');
      await enterScreen(session,'organization');
      const originalTab=(await session.until('screen',{},r=>r.valid&&r.mode==='organization'),await frame()).im;
      const oldTab=[1,2,3,4].find(f=>V.orgtab(originalTab,f).valid);
      if(!oldTab)throw Error('Organization tab unknown');
      if(oldTab!==1){await click(202,178);await session.until('orgtab',{fleet:1});}
      await save('org',[check('screen',{valid:true,mode:'organization'}),check('orgtab',{valid:true},{fleet:1})]);
      if(ships.length>1){await session.input(625,178,undefined,'hover');await session.until('orgclear',{fleet:1});await save('org-hover',[check('orgclear',{valid:true},{fleet:1})]);await session.input(5,5,undefined,'hover');}
      await click(612,324);
      const picker=await session.until('filterstate',{});
      const roster=require(root+'/src/domain/fleet/organize_planner').rosterFromStore(host.getStore());
      const count=roster.filter(s=>s.group>=0&&picker.states[s.group]).length;
      if(roster.some(s=>s.group<0)||!count)throw Error('Cannot establish filtered page count');
      const total=Math.ceil(count/10),p0=await session.until('pageread',{total}),s0=await V.sortread((await frame()).im);
      const orgChecks=[check('filterstate',{valid:true,states:picker.states}),check('pageread',{valid:true,activePage:p0.activePage},{total})];
      if(s0.valid)orgChecks.push(check('sortread',{valid:true,mode:s0.mode,direction:s0.direction}));
      audit.originalOrganization={filter:picker.states,page:p0.activePage,sort:s0};
      await save('picker-initial',orgChecks);
      // Do not cycle unsupported sort icons or change persisted filters.
      const next=[...p0.labels].reverse().find(p=>p!==p0.activePage);
      if(next){await click(p0.centers[p0.labels.indexOf(next)],p0.y);await session.until('pageread',{total},r=>r.valid&&r.activePage===next);await save('picker-other-page',[check('pageread',{valid:true,activePage:next},{total})]);await click(p0.centers[p0.labels.indexOf(p0.activePage)],p0.y);await session.until('pageread',{total},r=>r.valid&&r.activePage===p0.activePage);}
      const f1=await session.until('filterstate',{});if(JSON.stringify(f1.states)!==JSON.stringify(picker.states))throw Error('Filter changed');
      if(JSON.stringify(await V.sortread((await frame()).im))!==JSON.stringify(s0))throw Error('Sort changed');
      audit.restoration.organization=true;
      // Known org picker + known unchanged filter/page authorizes the
      // existing left-side home control. No close-X or menu candidates.
      await click(107,355);await session.until('screen',{},r=>r.valid&&r.mode==='home');
      if(oldTab!==1){await enterScreen(session,'organization');await click(202+(oldTab-1)*45,178);await session.until('orgtab',{fleet:oldTab});await enterScreen(session,'home');}
      if(!organizationOnly){
      await enterScreen(session,'equipment');
      const oldEquipTab=(await session.until('equipTabs',{})).selected[0];
      if(oldEquipTab!==1){await click(222,175);await session.until('equipTabs',{fleet:1});}
      await click(310,255);const ship=store.info.ships[ships[0]],slots=store.const.$ships[ship.api_ship_id].api_slot_num;
      await session.until('equipship',{fleet:1,expectedLevel:ship.api_lv});
      await save('remodel-ship',[check('screen',{valid:true,mode:'equipment'}),check('equipship',{valid:true,level:ship.api_lv},{fleet:1,expectedLevel:ship.api_lv})]);
      if(ship.api_slot.some(id=>id>0)){
        await session.input(485,245+50*slots,undefined,'hover');await session.until('equipclear',{fleet:1,slots});await save('equip-hover',[check('equipclear',{valid:true},{fleet:1,slots})]);await session.input(5,5,undefined,'hover');
      }
      await click(750,271);const mode0=await session.until('equipmode',{});
      const e0=await session.until('equippicker',{total:999});
      audit.originalEquipment={mode:mode0.mode,category:e0.category,page:e0.page.activePage};
      if(e0.category===null)audit.categoryUnknown=true;
      // At scales where the selected-category title is unreadable, record the
      // page/mode without category and skip category-dependent navigation
      // instead of aborting: these frames are the training data for the
      // missing variants.
      await save('equipment-initial',[check('equipmode',{valid:true,mode:mode0.mode}),check('equippicker',e0.category===null?{valid:true,page:{activePage:e0.page.activePage}}:{valid:true,category:e0.category,page:{activePage:e0.page.activePage}},{total:999})]);
      await click(1135,168);const other=mode0.mode==='stock'?'others':'stock';await session.until('equipmode',{},r=>r.valid&&r.mode===other);
      await save('equipment-toggled',[check('equipmode',{valid:true,mode:other})]);
      await click(1135,168);await session.until('equipmode',{},r=>r.valid&&r.mode===mode0.mode);
      if(e0.category!==null){
      // This menu depends on the pointer remaining over its header. Parking
      // immediately after opening dismisses it before it can be observed.
      await click(824,168,false);const cells=await session.until('cells',{});await save('category-menu',[check('cells',{valid:true,categories:cells.categories})]);
      const selected=cells.categories.indexOf(e0.category);if(selected<0)throw Error('Original category missing from menu');
      await click(Math.round(cells.centers[selected].x),Math.round(cells.centers[selected].y));
      let current=await session.until('equippicker',{total:999},r=>r.valid&&r.category===e0.category);
      // Only visit/restore page labels that are visible in the same group.
      if(!current.page.labels.includes(e0.page.activePage))throw Error('Original equipment page is outside current group; no guessed navigation');
      const p=e0.page.activePage,alternate=current.page.labels.find(n=>n!==p);
      if(alternate){await click(current.page.centers[current.page.labels.indexOf(alternate)],677);await session.until('pageread',{total:999,layout:'equip'},r=>r.valid&&r.activePage===alternate);await save('equipment-other-page',[check('pageread',{valid:true,activePage:alternate},{total:999,layout:'equip'})]);}
      current=await session.until('equippicker',{total:999});
      await click(current.page.centers[current.page.labels.indexOf(p)],677);
      await session.until('equippicker',{total:999},r=>r.valid&&r.category===e0.category&&r.page.activePage===p);
      await session.until('equipmode',{},r=>r.valid&&r.mode===mode0.mode);audit.restoration.equipment=true;
      } else {
        // Capture the open menu without requiring a readable cells read, then
        // dismiss by toggling the pulldown header; verified before continuing.
        await click(824,168,false);
        let cells=null;
        try{cells=await session.until('cells',{});}catch(e){if(!/timed out/.test(e.message))throw e;}
        await save('category-menu',[check('cells',cells?{valid:true,categories:cells.categories}:{valid:false})]);
        await click(824,168,false);
        await session.until('equippicker',{total:999},r=>r.valid);
      }
      await click(107,355);await session.until('screen',{},r=>r.valid&&r.mode==='home');
      if(oldEquipTab!==1){await enterScreen(session,'equipment');await click(Math.round(222+(oldEquipTab-1)*45.7),175);await session.until('equipTabs',{fleet:oldEquipTab});await enterScreen(session,'home');}
      }
      await save('final-home',[check('screen',{valid:true,mode:'home'})]);audit.ok=true;
      }
    }catch(error){
      audit.error=error.message;
      try{const raw=Pixels.decode(await host.capture());fs.writeFileSync(path.join(dir,'failure-raw.png'),raw.png());fs.writeFileSync(path.join(dir,'failure-rs.png'),resampleArea(raw,1200,720).png());}catch(captureError){audit.failureCaptureError=captureError.message;}
    }
    finally{
      host.wc?.debugger.removeListener('message',request);await host.dispose();
      audit.gameUnchanged=digest(state())===beforeHash;audit.debuggerDetached=!host.wc?.debugger.isAttached();
      audit.ok=audit.ok&&audit.gameUnchanged&&audit.debuggerDetached;
      fs.writeFileSync(path.join(dir,'env.json'),JSON.stringify(audit,null,2));window.__zoomCaptureBusy=false;
    }
    return {...audit,dir};
  };
  return 'Ready: __zoomCapture({inspectOnly:true}) or __zoomCapture()';
})()
