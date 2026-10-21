(async()=>{
  // Category-title variant calibration. Inject in poi's main renderer:
  //   python .agents/skills/poi-self-assistant/scripts/cdp_eval.py --file tools/vision/collect-category-variants.js
  //   __categoryVariants({tag:'1.5'})
  // Walks all 15 picker categories at the CURRENT render scale, saving the
  // resampled selected-title crop of each. The clicked menu row is the ground
  // truth; the (possibly unreadable) category observer is never trusted.
  // Restores 全装備 and verifies it against the freshly built variant.
  const fs=require('fs'),crypto=require('crypto');
  const root='D:/Game/KancolleAI/poi-plugin-fleet-advisor';
  const entry=window.getStore().plugins.find(p=>p.id==='poi-plugin-fleet-advisor');
  if(!entry?.enabled||entry.isBroken)throw Error('Formal plugin unavailable');
  const {PNG}=require(root+'/node_modules/pngjs');
  const remote=require('@electron/remote');
  const ref=window.getStore('layout.webview.ref');
  const wc=remote.webContents.fromId(ref.getWebContentsId());
  if(wc.debugger.isAttached())throw Error('Game debugger is occupied; wait for active work');
  const {PoiHost}=require(root+'/src/host/poi_host');
  const {Observer}=require(root+'/src/vision/observers');
  const {Pixels}=require(root+'/src/vision/pixels');
  const {resampleArea}=require(root+'/tools/vision/resample');
  const {Session}=require(root+'/src/execution/session');
  const {enterScreen}=require(root+'/src/execution/navigation');
  const cat=JSON.parse(fs.readFileSync(root+'/data/equip_categories.json','utf8'));
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const maskOf=im=>{
    const tile=im.crop(cat.selectedBox),rows=[];
    for(let y=0;y<tile.height;y++){let row='';for(let x=0;x<tile.width;x++)row+=Math.min(...tile.rgb(x,y))>200?'1':'0';rows.push(row);}
    return rows;
  };
  const iou=(a,b)=>{let i=0,u=0;for(let k=0;k<a.length;k++){const w=b[k]==='1',v=a[k]==='1';if(v&&w)i++;if(v||w)u++;}return i/Math.max(1,u);};
  window.__categoryVariants=async({tag='unknown'}={})=>{
    if(window.__catCalBusy)throw Error('Calibration already running');
    const panel=document.querySelector('.paa');
    if(panel?.querySelector('textarea')?.disabled)throw Error('Assistant is busy');
    window.__catCalBusy=true;
    const dir='D:/Game/KancolleAI/tmp/category-variants-'+tag;
    const host=new PoiHost({window,remote}),observer=new Observer({});
    const out={tag,entries:[],sources:{},ok:false};
    try{
      await host.start();
      const driver=Object.create(host);
      driver.capture=async()=>{
        const raw=Pixels.decode(await host.capture());
        return PNG.sync.write({width:1200,height:720,data:resampleArea(raw,1200,720).data});
      };
      const session=new Session(driver,observer,{timeoutMs:120000});
      const rsFrame=async()=>Pixels.decode(await driver.capture());
      const store=window.getStore();
      const shipId=store.info.fleets[0].api_ship.find(id=>id>0);
      const ship=store.info.ships[shipId],lv=ship.api_lv;
      await enterScreen(session,'home');
      await enterScreen(session,'equipment');
      await session.input(Math.round(222),175);await pause(700);
      await session.input(310,255);await pause(900);
      await session.until('equipship',{fleet:1,expectedLevel:lv});
      await session.input(750,271);await pause(900);
      await session.until('equippicker',{total:999},r=>r.valid);
      // Resume support: keep variants.json current after every category.
      const persist=()=>fs.writeFileSync(dir+'/variants.json',JSON.stringify({tag,entries:out.entries,sources:out.sources},null,1));
      fs.mkdirSync(dir,{recursive:true});
      // The menu occasionally needs a second opening attempt (animation);
      // retry the open+read up to three times before giving up.
      const openMenu=async()=>{
        for(let a=0;a<3;a++){
          await session.input(824,168);await pause(500);
          try{return await session.until('cells',{});}catch(e){if(!/timed out/.test(e.message))throw e;}
        }
        throw Error('cells unreadable after 3 menu attempts');
      };
      const done=new Set();
      try{for(const e of JSON.parse(fs.readFileSync(dir+'/variants.json','utf8')).entries)done.add(e.category);out.entries=JSON.parse(fs.readFileSync(dir+'/variants.json','utf8')).entries;for(const [k,v] of Object.entries(JSON.parse(fs.readFileSync(dir+'/variants.json','utf8')).sources))out.sources[k]=v;}catch(e){/* fresh run */}
      // Open the menu; the pointer stays on the header so it remains open.
      if(out.entries.length===0){await session.input(824,168);await pause(500);}
      for(let i=0;i<15;i++){
        const c=await openMenu();
        const remaining=[...c.categories].filter(id=>!done.has(id));
        if(!remaining.length)break;
        const id=remaining[0],idx=c.categories.indexOf(id);
        await session.input(Math.round(c.centers[idx].x),Math.round(c.centers[idx].y));
        await pause(600);
        const im=await rsFrame();
        const rows=maskOf(im);
        const png=PNG.sync.write({width:1200,height:720,data:im.data});
        fs.writeFileSync(dir+'/cat'+id+'.png',png);
        out.entries.push({category:id,mask:rows});
        out.sources['cat'+id]=crypto.createHash('sha256').update(png).digest('hex');
        done.add(id);
        persist();
      }
      if(!out.entries.length)throw Error('no categories captured');
      // Restore 全装備 and verify against the variant just built for it.
      await session.input(824,168);await pause(300);
      const c2=await openMenu();
      const gi=c2.categories.indexOf(0);if(gi<0)throw Error('全装備 missing from menu');
      await session.input(Math.round(c2.centers[gi].x),Math.round(c2.centers[gi].y));
      await pause(600);
      const zero=out.entries.find(e=>e.category===0);
      if(iou(maskOf(await rsFrame()).join(''),zero.mask.join(''))<.9)throw Error('全装備 restore mismatch');
      await session.input(107,355);
      await session.until('screen',{},r=>r.valid&&r.mode==='home');
      fs.writeFileSync(dir+'/variants.json',JSON.stringify({tag,entries:out.entries,sources:out.sources},null,1));
      out.ok=true;
      return {ok:true,tag,count:out.entries.length,categories:out.entries.map(e=>e.category)};
    }catch(error){
      out.error=error.message;
      try{
        const raw=Pixels.decode(await host.capture());
        fs.mkdirSync(dir,{recursive:true});
        fs.writeFileSync(dir+'/failure-rs.png',resampleArea(raw,1200,720).png());
      }catch(e){out.failureCaptureError=e.message;}
      return out;
    }finally{
      await host.dispose();
      window.__catCalBusy=false;
    }
  };
  return 'Ready: __categoryVariants({tag:"1.5"})';
})()
