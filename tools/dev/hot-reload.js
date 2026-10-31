(async()=>{
  // Evaluate in poi's MAIN renderer. Merely evaluating installs the helper.
  // __hotReload({dryRun:true,sourceRoot:'D:/Game/KancolleAI/poi-plugin-fleet-advisor'})
  // __hotReload({sourceRoot:'D:/Game/KancolleAI/poi-plugin-fleet-advisor'})
  // Omit sourceRoot to reload installed files only. Never call pluginDidLoad
  // manually: the host enable path already calls it exactly once.
  const fs=require('fs'),path=require('path'),crypto=require('crypto');
  const hostRoot=path.dirname(require('url').fileURLToPath(location.href));
  const id='poi-plugin-fleet-advisor';
  const manager=require(path.join(hostRoot,'views/services/plugin-manager/index.js')).default;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function hostFiber(test) {
    const el=document.querySelector('.poi-tabs-container');
    let root=el?.[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
    while(root?.return)root=root.return;
    const walk=fiber=>{
      if(!fiber)return null;
      return test(fiber)?fiber:walk(fiber.child)||walk(fiber.sibling);
    };
    return walk(root?.stateNode?.current||root);
  }
  const panel=()=>document.querySelector('.paa')||hostFiber(f=>f.tag===4&&f.stateNode?.containerInfo?.querySelector?.('.paa'))?.stateNode.containerInfo.querySelector('.paa');
  async function reopenNativeWindow() {
    await pause(100);
    const host=hostFiber(f=>typeof f.memoizedProps?.onOpenWindow==='function');
    const plugin=find();
    if(plugin&&host?.memoizedProps.isWindowMode?.(plugin))host.memoizedProps.onOpenWindow(plugin);
  }
  const find=()=>window.getStore().plugins.find(p=>p.id===id);
  const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const gameState=()=>{
    const info=window.getStore().info;
    return digest({fleets:info.fleets,ships:Object.entries(info.ships).map(([id,s])=>[id,s.api_slot,s.api_slot_ex])});
  };
  async function until(check,message) {
    const end=Date.now()+8000;
    while(Date.now()<end){const result=check();if(result)return result;await pause(50);}
    throw Error(message);
  }
  function mountedType() {
    const el=panel();if(!el)return null;
    let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
    while(fiber){if(fiber.type?.name==='FleetAdvisorPanel')return fiber.type;fiber=fiber.return;}
    return null;
  }
  function setValue(el,value,prototype,event) {
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);
    el.dispatchEvent(new Event(event,{bubbles:true}));
  }
  // Development-only reload preservation. Resolve the committed tree, then map
  // this source's leading useState hooks by name, never by hard-coded indices.
  const statusFields=['sourceFleet','shipDetails','sourcePreset','presetsOpen'];
  // Capture only live fields, including when reloading an older mounted version
  // that still has the retired JSON editor and local-library state hooks.
  const draftFields=['slots','fleet','area','purpose','target','phase','missionId','goal','incomeUnit','style','choices','excluded','sourceFleet','shipType','draftContext','pathIndex','nodeId','mapRoute','routeDrafts','routeRulesOpen','combatDeferredPhase','routePhaseAnchor','shipDetails','sourcePreset','presetsOpen','selectedQuests'];
  function workbenchHooks() {
    const el=panel();let root=el?.[Object.keys(el||{}).find(k=>k.startsWith('__reactFiber$'))];
    if(!root)return [];
    while(root.return)root=root.return;
    const found=[];
    const walk=fiber=>{
      if(!fiber)return;
      if(['Workbench','CurrentFleet'].includes(fiber.type?.name)){
        const source=String(fiber.type).split('React.useRef')[0];
        const names=[...source.matchAll(/\[\s*(\w+)\s*,\s*\w+\s*\]\s*=\s*React\.useState\(/g)].map(m=>m[1]);
        const hooks={};let hook=fiber.memoizedState;
        for(const name of names){
          if(!hook?.queue?.dispatch)throw Error('Workbench state layout changed; reload cancelled to preserve drafts');
          hooks[name]={value:hook.memoizedState,dispatch:hook.queue.dispatch};hook=hook.next;
        }
        if(fiber.type.name==='CurrentFleet'?!hooks.sourceFleet:!Array.isArray(hooks.slots?.value)||!hooks.fleet)throw Error('Cannot identify workbench draft');
        found.push({kind:fiber.memoizedProps.kind,hooks});
      }
      walk(fiber.child);walk(fiber.sibling);
    };
    walk(root.stateNode?.current||root);return found;
  }
  function captureWorkbenches() {
    return workbenchHooks().map(({kind,hooks})=>{
      if(hooks.working?.value)throw Error('Workbench is calculating; wait before updating');
      // These preferences belong to CurrentFleet; older editable workbenches
      // still carried unused copies before the retired editor was removed.
      return {kind,values:JSON.parse(JSON.stringify(Object.fromEntries(draftFields.filter(name=>hooks[name]&&(kind==='manual'||!statusFields.includes(name))).map(name=>[name,hooks[name].value]))))};
    });
  }
  function workbenchesRestored(saved){
    const current=captureWorkbenches();
    return saved.every(before=>{
      const after=current.find(w=>w.kind===before.kind);
      if(after?.kind==='manual'&&!Object.hasOwn(after.values,'slots'))return after.values.sourceFleet===(before.values.sourceFleet||1)&&statusFields.filter(name=>Object.hasOwn(before.values,name)).every(name=>JSON.stringify(after.values[name])===JSON.stringify(before.values[name]));
      return after&&Object.entries(before.values).every(([name,value])=>JSON.stringify(after.values[name])===JSON.stringify(value));
    })&&current.length===saved.length;
  }
  async function restoreDraft(draft) {
    await until(()=>panel(),'Updated panel did not mount');
    if(draft?.workbenches?.length){
      const current=workbenchHooks();
      for(const saved of draft.workbenches){
        const target=current.find(w=>w.kind===saved.kind);
        if(!target)throw Error('Updated workbench missing: '+saved.kind);
        for(const [name,value] of Object.entries(saved.values)){
          // The current-fleet page deliberately has no editable draft anymore.
          // Preserve its selection and disclosures while retaining both real drafts.
          if(saved.kind==='manual'&&!target.hooks.slots){
            if(statusFields.includes(name)&&target.hooks[name])target.hooks[name].dispatch(name==='sourceFleet'?value||1:value);
            continue;
          }
          if(!target.hooks[name])throw Error('Updated draft field missing: '+name);
          target.hooks[name].dispatch(value);
        }
        // First deployment of independent map preview: migrate only the
        // visible route selection; never regenerate or replace a fleet draft.
        if(saved.kind==='normal'&&!Object.hasOwn(saved.values,'mapRoute')&&target.hooks.mapRoute){
          const v=saved.values,context=v.draftContext?JSON.parse(v.draftContext):null;
          const choice=(v.choices||[]).find(c=>JSON.stringify(c.row?.scheme?.ships?.map(s=>s.id))===JSON.stringify(v.slots?.filter(Boolean).map(s=>s.id)));
          const route=context?.[1]===v.area?(v.area==='3-5'&&v.target==='boss'?v.style:choice?.row?.profile?.examples?.[0]?.join('>')||''):'';
          target.hooks.mapRoute.dispatch(route);
        }
      }
      const mode=['自定义 JSON','编成方案'].includes(draft.mode)?'当前舰队':draft.mode;
      const tab=[...panel().querySelectorAll('.paa-tabs button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===mode);
      if(tab)tab.click();
      await until(()=>workbenchesRestored(draft.workbenches),'Workbench drafts were not fully restored');
      return;
    }
    // Nothing captured (user sat on a recommendation tab) — leave the fresh
    // panel on its default tab instead of forcing the editor open.
    if(!draft||!draft.text){
      const tab=[...panel().querySelectorAll('.paa-tabs button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===draft?.mode);
      if(tab)tab.click();
      return;
    }
    // The guided UI keeps the JSON editor on the 手动方案 tab; switch there
    // before restoring the draft (legacy single-editor panels skip this).
    const manual=[...panel().querySelectorAll('.paa-tabs button')]
      .find(b=>['手动方案','自定义 JSON','编成方案','当前舰队'].includes(b.textContent.trim()));
    if(manual)manual.click();
    await until(()=>panel()?.querySelector('textarea'),'Updated panel did not mount');
    const select=panel().querySelector('.paa-workbench:not([hidden]) .paa-wb-apply-controls select')||panel().querySelector('select');
    if(select&&draft.fleet!==undefined)setValue(select,draft.fleet,HTMLSelectElement.prototype,'change');
    await pause(50);
    setValue(panel().querySelector('textarea'),draft.text,HTMLTextAreaElement.prototype,'input');
    await pause(100);
  }
  async function previewSmoke() {
    const state=window.getStore(),index=state.info.fleets.findIndex(f=>f.api_ship.some(id=>id>0)&&f.api_mission[0]===0);
    if(index<0)throw Error('No idle fleet available for read-only preview');
    const scheme={fleet:index+1,ships:state.info.fleets[index].api_ship.filter(id=>id>0)};
    if(panel().querySelector('.paa-current-status')){
      const root=find().pluginPath,observed=require(path.join(root,'src/host/store')).readStore(window);
      const plan=new (require(path.join(root,'src/application/controller')).Controller)({getStore:()=>observed}).preview('fleet',scheme);
      if(plan.organization.targets.join(',')!==scheme.ships.join(','))throw Error('Read-only fleet preview mismatch');
      const current=workbenchHooks().find(w=>w.kind==='manual'),fleet=current?.hooks.sourceFleet?.value||1;
      const preset=current?.hooks.sourcePreset?.value,ids=(preset!=null?state.info.presets?.api_deck?.[preset]?.api_ship||[]:state.info.fleets[fleet-1]?.api_ship||[]).filter(id=>id>0).slice(0,6);
      await until(()=>panel().querySelectorAll('.paa-current-status .paa-wb-ship').length===ids.length,'Current fleet status did not render');
      return;
    }
    const manual=[...panel().querySelectorAll('.paa-tabs button')]
      .find(b=>['手动方案','自定义 JSON','编成方案','当前舰队'].includes(b.textContent.trim()));
    if(manual)manual.click();
    await until(()=>panel()?.querySelector('textarea'),'Manual JSON editor did not mount for preview smoke');
    const destination=panel().querySelector('.paa-workbench:not([hidden]) .paa-wb-apply-controls select');
    if(destination)setValue(destination,String(index+1),HTMLSelectElement.prototype,'change');
    await pause(50);
    setValue(panel().querySelector('textarea'),JSON.stringify(scheme),HTMLTextAreaElement.prototype,'input');
    await pause(100);
    const workbench=panel().querySelector('.paa-workbench:not([hidden])');
    if(workbench){
      await until(()=>workbench.querySelectorAll('.paa-wb-ship').length===scheme.ships.length&&
        !workbench.querySelector('.paa-wb-apply')?.disabled,'Continuous JSON preview did not complete');
      return;
    }
    const button=[...panel().querySelectorAll('button')].find(b=>b.textContent.trim()==='预览变更');
    if(!button||button.disabled)throw Error('Unified preview button unavailable');
    button.click();
    await until(()=>panel()?.querySelector('.paa-status')?.dataset.state==='preview','Preview did not complete');
  }

  window.__hotReload=async function({sourceRoot,dryRun=false}={}) {
    if(window.__fleetAdvisorUpdateBusy)throw Error('An update is already running');
    window.__fleetAdvisorUpdateBusy=true;
    let old,snapshot,fileTools,draft,backup,disabled=false,writeStarted=false;
    const report={ok:false};
    try {
      old=find();const el=panel(),textarea=el?.querySelector('.paa-workbench:not([hidden]) textarea')||(!el?.querySelector('.paa-workbench')?el?.querySelector('textarea'):null)||null;
      // The guided UI may sit on a recommendation tab without a JSON editor;
      // restoreDraft switches to 手动方案 as needed, so only require a panel.
      if(!old?.enabled||!old.isRead||old.isBroken||!el)throw Error('Open the enabled assistant panel before updating');
      if(textarea?.disabled||el.querySelector('.paa-workspace[aria-busy=true]')||['running','stopping'].includes(el.querySelector('.paa-status')?.dataset.state))throw Error('Assistant is running; wait for it to finish');
      const remote=require('@electron/remote'),ref=window.getStore('layout.webview.ref');
      const wc=remote.webContents.fromId(ref.getWebContentsId());
      if(wc.debugger.isAttached())throw Error('Game debugger is occupied; wait for active work to finish');
      const before={id:wc.id,process:wc.getOSProcessId(),url:wc.getURL(),state:gameState()};
      const original=require(old.pluginPath),oldType=mountedType();
      if(old.reactClass!==original.reactClass||oldType!==old.reactClass)throw Error('Registered module and mounted panel already differ; diagnose before updating');
      if(sourceRoot) {
        const helper=require.resolve(path.join(path.resolve(sourceRoot),'tools/dev/live-update-files.js'));
        delete require.cache[helper];fileTools=require(helper);
        snapshot=fileTools.prepare(sourceRoot,old.pluginPath);
        report.files=snapshot.files.length;
        report.changedFiles=snapshot.files.filter(f=>f.sha256!==f.beforeHash).map(f=>f.name);
      }
      const workbenches=captureWorkbenches();
      report.id=id;report.installed=old.pluginPath;report.workbenchDrafts=workbenches.length;
      if(dryRun)return {...report,ok:true,dryRun:true};
      let draftFleet=el.querySelector('.paa-workbench:not([hidden]) .paa-wb-apply-controls select')?.value;
      if(draftFleet===undefined&&textarea){try{draftFleet=JSON.parse(textarea.value).fleet;}catch(_){}}
      draft={mode:(el.querySelector('.paa-tabs button[aria-pressed=true]')?.getAttribute('aria-label')||el.querySelector('.paa-tabs button[aria-pressed=true]')?.textContent?.trim()),text:textarea?textarea.value:'',fleet:draftFleet,status:el.querySelector('.paa-status')?.innerText,details:[...el.querySelectorAll('pre')].map(p=>p.textContent)};
      draft.workbenches=workbenches;
      backup=fs.mkdtempSync(path.join(require('os').tmpdir(),'poi-fleet-advisor-update-'));
      fs.writeFileSync(path.join(backup,'draft.json'),JSON.stringify(draft,null,2));
      if(snapshot)fs.writeFileSync(path.join(backup,'files.json'),JSON.stringify(snapshot));
      report.backup=backup;
      disabled=true;await manager.disablePlugin(old);
      await until(()=>!panel(),'Old panel did not unmount; no files copied');
      if(snapshot){writeStarted=true;fileTools.apply(snapshot);}
      await manager.enablePlugin({...old,isBroken:false});
      await reopenNativeWindow();
      await until(()=>panel(),'New panel did not mount');
      const fresh=find(),mod=require(fresh.pluginPath);
      if(!fresh.enabled||fresh.isBroken||!fresh.isRead||fresh.reactClass!==mod.reactClass||mountedType()!==mod.reactClass||mod.reactClass===oldType)
        throw Error('Fresh module/registry/mounted component verification failed');
      await previewSmoke();
      await restoreDraft(draft);
      report.probe=mod.HOT_PROBE;report.freshComponent=true;report.preview=true;
      report.draftPreserved=draft.workbenches.length?workbenchesRestored(draft.workbenches):!draft.text||panel().querySelector('textarea')?.value===draft.text;
      report.gameUnchanged=wc.id===before.id&&wc.getOSProcessId()===before.process&&wc.getURL()===before.url&&gameState()===before.state;
      report.debuggerDetached=!wc.debugger.isAttached();
      if(!report.draftPreserved||!report.gameUnchanged||!report.debuggerDetached)throw Error('Post-update state changed; inspect the audit');
      report.ok=true;
      return report;
    } catch(error) {
      report.error=error.message;
      if(disabled) {
        try {
          const current=find();if(current?.enabled)await manager.disablePlugin(current);
          await until(()=>!panel(),'Rollback could not unmount panel');
          if(writeStarted)fileTools.restore(snapshot);
          await manager.enablePlugin({...old,isBroken:false});
          await reopenNativeWindow();
          await restoreDraft(draft);
          const restored=find(),mod=require(restored.pluginPath);
          report.rollback=restored.enabled&&!restored.isBroken&&restored.reactClass===mod.reactClass&&mountedType()===mod.reactClass;
        } catch(rollbackError){report.rollback=false;report.rollbackError=rollbackError.message;}
      }
      return report;
    } finally {
      try {if(backup){
        if(snapshot)fs.writeFileSync(path.join(backup,'files.json'),JSON.stringify(snapshot));
        fs.writeFileSync(path.join(backup,'result.json'),JSON.stringify(report,null,2));
      }}
      finally {window.__fleetAdvisorUpdateBusy=false;}
    }
  };
  return 'Updater ready. Call __hotReload({dryRun:true,sourceRoot:"D:/Game/KancolleAI/poi-plugin-fleet-advisor"}) to inspect.';
})()
