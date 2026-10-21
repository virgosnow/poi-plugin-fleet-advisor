(async()=>{
 // Zoom-compatibility capture tour v4: pure webview-tag APIs.
 //   await window.__zoomTourV4(label)
 // Screenshots via capturePage (device resolution of the game viewport),
 // mouse via sendInputEvent. Blind navigation; tolerant of failures.
 // Run once per window size; label the captures with the size you set.
 window.__zoomTourV4=async function(label){
  const fs=require('fs');
  const dir='D:/Game/KancolleAI/tmp/zoom-'+label+'/';
  fs.mkdirSync(dir,{recursive:true});
  const ref=window.getStore('layout.webview.ref');
  const log={label,shots:{},errors:[]};
  const shot=async name=>{
    try{
      const img=await ref.capturePage();
      const b=img.toPNG();
      fs.writeFileSync(dir+name+'.png',b);
      log.shots[name]={w:b.readUInt32BE(16),h:b.readUInt32BE(20)};
    }catch(e){log.errors.push('shot '+name+': '+e.message.slice(0,80));}
  };
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const click=async(x,y,ms,kind)=>{
    try{
      ref.sendInputEvent({type:'mouseMove',x,y});
      if(kind!=='hover'){
        ref.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
        ref.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
      }
    }catch(e){log.errors.push('click '+x+','+y+': '+e.message.slice(0,70));}
    await pause(ms);
  };
  try{
    for(let i=0;i<3;i++){await click(107,355,1500);}
    await shot('z1-home');
    await click(477,339,900);
    await click(477,339,1500);
    await shot('z2-remodel');
    await click(310,255,900);
    await click(485,495,700,'hover');
    await shot('z3-clearhover5');
    await click(750,271,1500);
    await shot('z4-picker');
    await click(1150,145,700);
    await click(107,355,1800);
    await click(292,202,1600);
    await shot('z5-orgoverview');
    await click(625,178,700,'hover');
    await shot('z5b-orgclear');
    await click(247,178,900);
    await click(612,324,1500);
    await shot('z6-orglist');
    const rect=ref.getBoundingClientRect();
    log.viewport={w:Math.round(rect.width),h:Math.round(rect.height)};
  }catch(e){log.errors.push('fatal: '+e.message.slice(0,120));}
  fs.writeFileSync(dir+'log.json',JSON.stringify(log,null,1));
  return JSON.stringify(log);
 };
 return 'zoomTour v4 installed (webview tag APIs)';
})()
