'use strict';
const {RequestMonitor}=require('../execution/request_monitor');
const {readStore}=require('./store');
const {Pixels}=require('../vision/pixels');

// Only this module touches poi/Electron. A debugger owned by somebody else is
// never attached to, detached, or reused.
class PoiHost {
  constructor({window, remote, now = () => performance.now()}) {
    this.window=window;this.remote=remote;this.now=now;
    this.wc=null;this.owned=false;this.closed=false;this.error=null;
    this.monitor=new RequestMonitor(now);this.unbind=[];
    this.onMessage=(event,method,params)=>{
      if(method!=='Network.requestWillBeSent')return;
      try {this.monitor.observe(params.request);} catch(error) {this.fail(error.message);}
    };
    this.onDetach=()=>{this.owned=false;this.fail('Game debugger detached');};
  }
  discover() {
    const ref=this.window.getStore('layout.webview.ref');
    const wc=ref && (typeof ref.getWebContentsId==='function'
      ? this.remote.webContents.fromId(ref.getWebContentsId())
      : typeof ref.getWebContents==='function' ? ref.getWebContents() : ref);
    if(!wc || typeof wc.capturePage!=='function' || typeof wc.sendInputEvent!=='function'
      || typeof wc.getURL!=='function' || !/kancolle/i.test(wc.getURL())) throw new Error('Unique game webContents unavailable');
    return wc;
  }
  getStore() {return readStore(this.window);}
  createObserverWorker(filename) {
    // Electron renderers cannot create Node workers. Keep image processing in
    // a main-process worker, with the same message protocol as the Node tests.
    const {Worker}=this.remote.require('worker_threads');
    return new Worker(filename);
  }
  check(full = true) {
    if(this.closed||this.error)throw new Error(this.error||'Host closed');
    if(!this.owned||!this.wc)throw new Error('Game connection unavailable');
    // Detach/navigation/destruction listeners invalidate local flags immediately.
    // Timer and promise bookkeeping need not rediscover remote objects; every
    // observation/input boundary still performs the complete target check.
    if(!full)return;
    if(this.wc.isDestroyed()||!this.wc.debugger.isAttached())throw new Error('Game connection unavailable');
    if(this.discover().id!==this.wc.id)throw new Error('Game target changed');
  }
  fail(message) {this.error=this.error||message;this.monitor.cancel();}
  async command(method,params={}) {
    let timer;
    try {
      return await Promise.race([this.wc.debugger.sendCommand(method,params),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Debugger command timed out')),10000);})]);
    } finally {clearTimeout(timer);}
  }
  async start() {
    if(this.closed||this.owned)throw new Error('Invalid host lifecycle');
    this.wc=this.discover();
    const dbg=this.wc.debugger;
    if(!dbg||dbg.isAttached())throw new Error('Game debugger occupied; close DevTools or conflicting automation');
    try {
      dbg.attach('1.3');this.owned=true;
      dbg.on('message',this.onMessage);dbg.on('detach',this.onDetach);
      for(const event of ['did-start-navigation','render-process-gone','destroyed']) {
        const handler=()=>this.fail('Game target reloaded or closed');
        this.wc.on(event,handler);this.unbind.push(()=>this.wc.removeListener(event,handler));
      }
      // Passive notifications only: all requests and responses remain under
      // the game's control, including unknown endpoints and in-flight work.
      await this.command('Network.enable',{maxPostDataSize:65536});
      const metrics=await this.command('Page.getLayoutMetrics');
      const viewport=metrics.cssVisualViewport;
      if(!viewport||Math.abs(viewport.clientWidth-1200)>2||Math.abs(viewport.clientHeight-720)>2||viewport.pageX!==0||viewport.pageY!==0||viewport.scale!==1)
        throw new Error('Unsupported game viewport; expected unscrolled 1200×720 CSS game area');
      this.check();
    } catch(error) {await this.dispose();throw error;}
  }
  async capture() {
    const started=this.now();
    this.check();
    const checkMs=this.now()-started;
    // Capture the visible viewport. An explicit CSS clip is scaled differently
    // by Electron at fractional zoom and can produce tiled captures. Observers
    // normalize the full viewport pixels to the validated 1200×720 CSS area.
    const commandStarted=this.now();let eventLoopLagMs=0,tickAt=commandStarted;
    const tick=setInterval(()=>{const now=this.now();eventLoopLagMs=Math.max(eventLoopLagMs,now-tickAt-50);tickAt=now;},50);
    tick.unref?.();let result;
    try{
      const params={format:'png',fromSurface:true,captureBeyondViewport:false};
      try{result=await this.command('Page.captureScreenshot',{...params,...(this.fastPngUnsupported?{}:{optimizeForSpeed:true})});}
      catch(error){
        // Only a protocol parameter rejection permits retrying this read-only
        // capture. Timeouts/connection failures must not trigger another call.
        if(this.fastPngUnsupported||!(/invalid parameters|unknown parameter|unrecognized parameter/i.test(error.message)))throw error;
        this.fastPngUnsupported=true;result=await this.command('Page.captureScreenshot',params);
      }
    }finally{eventLoopLagMs=Math.max(eventLoopLagMs,this.now()-tickAt-50);clearInterval(tick);}
    const commandMs=this.now()-commandStarted;
    this.check(false);
    if(!result||typeof result.data!=='string')throw new Error('Screenshot unavailable');
    const decodeStarted=this.now(),buffer=Buffer.from(result.data,'base64');
    const base64Ms=this.now()-decodeStarted;
    // The physical capture size is fixed per run (device scale factor); a
    // mid-run change means the environment moved (different-DPI display,
    // system zoom change) and every template coordinate is now suspect.
    const [w,h]=Pixels.pngSize(buffer);
    if(!this.captureSize)this.captureSize=[w,h];
    else if(w!==this.captureSize[0]||h!==this.captureSize[1]) {
      this.fail(`Capture size changed mid-run (${this.captureSize.join('x')} -> ${w}x${h})`);
      throw new Error(this.error);
    }
    this.lastCaptureMetrics={checkMs,commandMs,base64Ms,eventLoopLagMs:Math.max(0,eventLoopLagMs),
      totalMs:this.now()-started,bytes:buffer.length,width:w,height:h,fastPng:!this.fastPngUnsupported};
    return buffer;
  }
  async readControls(){
    this.check();
    const frames=this.wc.mainFrame.framesInSubtree.filter(f=>String(f.url).includes('/kcs2/index.php'));
    if(frames.length!==1)throw Error('Unique game frame unavailable for control recognition');
    const frame=frames[0],identity=frame.processId+':'+frame.routingId;
    if(this.controlFrame&&this.controlFrame!==identity)throw Error('Game frame changed during control recognition');
    this.controlFrame=identity;
    const read=require('./control_reader').readControlSnapshot;
    const result=await frame.executeJavaScript('('+read.toString()+')()');
    this.check();
    if(!result||!Number.isFinite(result.documentId))throw Error('Game control document unavailable');
    if(this.controlDocument!==undefined&&this.controlDocument!==result.documentId)throw Error('Game document changed during control recognition');
    this.controlDocument=result.documentId;
    return result;
  }
  async input({x,y,kind='click',mutation,actionId}) {
    this.check();
    if(this.inputBusy||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>=1200||y<0||y>=720)throw new Error('Invalid or overlapping input');
    if(kind!=='click'&&kind!=='hover')throw new Error('Unsupported input');
    this.inputBusy=true;
    try {
      if(mutation)this.monitor.expect(mutation,actionId);
      // CDP is local via webContents.debugger, with no TCP listener.
      await this.command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
      if(kind==='click') {
        this.check(false);
        await this.command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
        // Always release a successfully pressed button, including on stop.
        await this.command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
      }
      if(mutation) {
        const deadline=this.now()+10000;
        while(this.monitor.matchedAction!==actionId) {
          this.check(false);
          if(this.now()>=deadline)throw new Error('No matching request; submission will not be retried');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
      }
      this.check(false);
    } catch(error) {this.fail(error.message);throw error;}
    finally {this.inputBusy=false;}
  }
  cancel() {this.fail('Run stopped');}
  async dispose() {
    this.closed=true;this.monitor.cancel();
    if(this.inputBusy) {
      const deadline=this.now()+11000;
      while(this.inputBusy&&this.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    }
    if(this.owned) {
      try {await this.command('Network.disable');} catch(_) {}
      // DevTools can detach us while close is awaiting a protocol reply.
      if(this.owned) {
        this.wc.debugger.removeListener('message',this.onMessage);
        this.wc.debugger.removeListener('detach',this.onDetach);
        try {this.wc.debugger.detach();} catch(_) {}
        this.owned=false;
      }
    }
    // Remove our listeners even after external detach.
    if(this.wc&&this.wc.debugger) {
      this.wc.debugger.removeListener('message',this.onMessage);
      this.wc.debugger.removeListener('detach',this.onDetach);
    }
    for(const off of this.unbind.splice(0))try{off();}catch(_){}
  }
}
module.exports={PoiHost};
