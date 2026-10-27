'use strict';
const {Pixels} = require('./pixels');
const variants=require('../../data/resample_variants.json');
const digits = require('../../data/page_digits_v2.json').glyphs.concat(variants.pageDigits);
const shipSort = require('../../data/org_sort_ship.json');
const newSort = require('../../data/org_sort_new.json');
const levelSort = require('../../data/org_sort_level.json');
const clearEscorts = require('../../data/org_clear_escorts.json');
const clearEquipment = require('../../data/equip_clear_all.json');
const equipCategories = require('../../data/equip_categories.json');
const borrowTemplates = require('../../data/equip_borrow.json');
const {readNumber}=require('./numbers');
const CX=[760,813,867,920,973], FX=[632,697,761,825,889,953,1017,1081];
const cyan=([r,g,b])=>g>150&&g-r>50&&b>120;
// Page digits are grey/cyan in the organize layout but GREEN in the
// equipment picker, so green counts as glyph ink as well.
const ink=p=>Math.max(...p)<165||cyan(p)||(p[1]>140&&p[1]-p[0]>40&&p[1]-p[2]>40);
const clean=t=>String(t).normalize('NFKC').replace(/\s+/g,'').replace(/改ニ/g,'改二');

function filterstate(im) {
  const states=FX.map(x=>{
    const strip=im.samples([x-18,155,x+18,162]).map(p=>(p[0]+p[1]+p[2])/3).sort((a,b)=>a-b);
    const median=(strip[125]+strip[126])/2;
    // Area-resampled frames (measured 1.25x) thin the icon strokes to ~83-96
  // dark pixels vs 299+ native; the median bands below still gate on/off.
  if(im.samples([x-27,151,x+27,185]).filter(p=>Math.max(...p)<120).length<70)return null;
    return median>=210?1:median>=145&&median<=195?0:null;
  });
  return {valid:states.every(s=>s!==null)&&states.includes(1),states,centers:FX,y:166};
}
function orgtab(im,fleet) {
  const selected=[];
  [202,247,292,337].forEach((x,i)=>{
    const ps=im.samples([x-22,158,x+14,190]);
    const fraction=ps.filter(([r,g,b])=>g>80&&g-r>15&&b-r>10).length/ps.length;
    const sats=ps.map(p=>Math.max(...p)-Math.min(...p)), mean=sats.reduce((a,b)=>a+b,0)/sats.length;
    const sd=Math.sqrt(sats.reduce((a,b)=>a+(b-mean)**2,0)/sats.length);
    if(fraction>.08&&fraction<.65&&sd>8)selected.push(i+1);
  });
  return {valid:selected.length===1&&selected[0]===fleet,selected};
}
function glyphs(im,cx) {
  const region=im.crop([cx-24,660,cx+24,695]);
  const groups=[];
  for(let x=0;x<48;x++) {
    if(!Array.from({length:35},(_,y)=>ink(region.rgb(x,y))).some(Boolean))continue;
    if(!groups.length||x>groups[groups.length-1].at(-1)+1)groups.push([]);
    groups.at(-1).push(x);
  }
  return groups.map(xs=>{
    const ys=[];for(let y=0;y<35;y++)if(xs.some(x=>ink(region.rgb(x,y))))ys.push(y);
    const w=xs.length,h=ys.at(-1)-ys[0]+1;
    if(w<3||w>19||h<14||h>29)return null;
    return Array.from({length:448},(_,i)=>ink(region.rgb(xs[0]+Math.min(w-1,Math.floor((i%16+.5)*w/16)),ys[0]+Math.min(h-1,Math.floor((Math.floor(i/16)+.5)*h/28)))));
  });
}
function pageread(im,{total=999,layout}={}) {
  const bad={valid:false,labels:[],activePage:null}, centers=(layout==='equip'?[739,793,847,901,955]:CX).slice(0,Math.min(5,total));
  if(!Number.isInteger(total)||total<1)return bad;
  const labels=[],active=[];
  for(const cx of centers) {
    const gs=glyphs(im,cx);
    if(!gs.length&&layout==='equip'&&labels.length&&im.samples([cx-24,660,cx+24,695]).filter(ink).length<8)break;
    if(gs.length<1||gs.length>3||gs.includes(null))return bad;
    const ds=[];
    for(const g of gs) {
      const scores=Array.from({length:10},(_,d)=>({d,score:Math.min(...digits.filter(r=>Number(r.digit)===d).map(r=>g.reduce((n,v,i)=>n+(v!==!!r.mask[i]),0)/448))})).sort((a,b)=>a.score-b.score);
      if(scores[0].score>.18||scores[1].score-scores[0].score<.035)return bad;
      ds.push(scores[0].d);
    }
    if(ds[0]===0)return bad;
    labels.push(Number(ds.join('')));
    const ps=im.samples([cx-24,660,cx+24,695]), fraction=ps.filter(cyan).length/Math.max(1,ps.filter(ink).length);
    if(fraction>.8)active.push(labels.length-1);else if(fraction>.04)return bad;
  }
  if(active.length!==1||labels.at(-1)>total||labels.some((v,i)=>i&&v!==labels[i-1]+1))return bad;
  return {valid:true,labels,activePage:labels[active[0]],centers,y:677};
}
function equipmentCategory(im) {
  const box=equipCategories.selectedBox,tile=im.crop(box),mask=[];
  for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++)mask.push(Math.min(...tile.rgb(x,y))>200);
  const iou=expected=>{let intersection=0,union=0;
    for(let k=0;k<mask.length;k++){const wanted=expected[k]==='1';if(mask[k]&&wanted)intersection++;if(mask[k]||wanted)union++;}
    return intersection/Math.max(1,union);};
  // Native 1:1 masks first, then per-scale resampled variants; the category
  // counts only when exactly one id matches across the whole set.
  const candidates=[
    ...equipCategories.templates.filter(t=>t.selectedMask).map(t=>({id:t.id,expected:t.selectedMask.join('')})),
    ...(variants.categories||[]).map(v=>({id:v.category,expected:v.mask.join('')})),
  ];
  const ids=[...new Set(candidates.filter(t=>iou(t.expected)>=.80).map(t=>t.id))];
  return ids.length===1?ids[0]:null;
}
function arrow(im) {
  const rows=[];
  for(let y=190;y<211;y++) {
    let n=0;for(let x=1123;x<1150;x++)if(Math.min(...im.rgb(x,y))>210)n++;
    if(n)rows.push(n);
  }
  if(rows.length<4||rows.length>14||Math.max(...rows)<7)return null;
  const split=Math.floor(rows.length/2), top=rows.slice(0,split).reduce((a,b)=>a+b,0)/split;
  const bottom=rows.slice(-split).reduce((a,b)=>a+b,0)/split;
  return top>bottom*1.6?'desc':bottom>top*1.6?'asc':null;
}
async function sortread(im) {
  const tile=im.crop(shipSort.box,...shipSort.size), mask=[];
  for(let y=0;y<shipSort.mask.length;y++)for(let x=0;x<tile.width;x++)mask.push(Math.min(...tile.rgb(x,y))>180);
  const ref=shipSort.mask.join('').split('').map(c=>c==='1');
  const ps=tile.samples([0,0,tile.width,shipSort.mask.length]);
  const bg=ps.filter(([r,g,b])=>g>90&&g-r>25&&b-r>20).length/ps.length;
  const fg=mask.filter(Boolean).length/mask.length,direction=arrow(im);
  if(bg<.15||fg<.03||fg>.65||!direction)return {valid:false,mode:'unknown',direction:null};
  const overlap=mask.filter((v,i)=>v&&ref[i]).length/Math.max(1,mask.filter((v,i)=>v||ref[i]).length);
  if(overlap>=.75)return {valid:true,mode:'type',direction};
  for(const [mode,template] of [['new',newSort],['level',levelSort]]) {
    const label=im.crop(template.box,...template.size),expected=template.mask.join('');
    let intersection=0,union=0;
    for(let y=0;y<label.height;y++)for(let x=0;x<label.width;x++) {
      const actual=Math.min(...label.rgb(x,y))>190, wanted=expected[y*label.width+x]==='1';
      if(actual&&wanted)intersection++;
      if(actual||wanted)union++;
    }
    if(intersection/Math.max(1,union)>=.70)return {valid:true,mode,direction};
  }
  const matches=variants.sort.filter(t=>{
    const label=im.crop(t.box,...t.size),expected=t.mask.join('');let intersection=0,union=0;
    for(let y=0;y<label.height;y++)for(let x=0;x<label.width;x++){
      const actual=Math.min(...label.rgb(x,y))>t.threshold,wanted=expected[y*label.width+x]==='1';
      if(actual&&wanted)intersection++;if(actual||wanted)union++;
    }
    return intersection/Math.max(1,union)>=(t.mode==='type'?.75:.70);
  });
  if(matches.length===1)return {valid:true,mode:matches[0].mode,direction};
  // No OCR fallback: the three masks cover new/level/type and anything
  // else (e.g. registration order) refuses as unknown by design.
  return {valid:false,mode:'unknown',direction:null};
}
class Observer {
  constructor() {}
  async observe(kind,frame,arg={}) {
    const im=(frame instanceof Pixels?frame:Pixels.decode(frame)).normalize();
    if(kind==='batch') {
      if(!Array.isArray(arg.checks)||!arg.checks.length||arg.checks.length>8||arg.checks.some(c=>!c||typeof c.kind!=='string'||c.kind==='batch'))throw new Error('Invalid observation batch');
      const results=[];
      for(const check of arg.checks)results.push(await this.observe(check.kind,im,check.arg));
      return {valid:results.every(r=>r.valid),results};
    }
    if(kind==='orgtab')return orgtab(im,arg.fleet);
    if(kind==='pageread')return pageread(im,arg);
    if(kind==='equipmode'||kind==='borrowconfirm') {
      const error=name=>Math.min(...[borrowTemplates[name],...(variants.borrow[name]||[])].map(t=>{
        const tile=im.crop(t.box,...t.size);
        const rgb=Array.from(tile.data).filter((_,i)=>i%4!==3);
        return rgb.reduce((n,v,i)=>n+Math.abs(v-t.rgb[i]),0)/rgb.length;
      }));
      if(kind==='equipmode') {
        const stock=error('stock'),others=error('others'),sort=error('sort');
        const mode=stock<12&&others-stock>5?'stock':others<12&&stock-others>5?'others':null;
        return {valid:mode!==null&&sort<12,mode};
      }
      const border=[[229,194],[965,194],[229,531],[965,531]].every(([x,y])=>{
        const [r,g,b]=im.rgb(x,y);return g>70&&g-r>8&&b-r>5;
      });
      return {valid:border&&error('borrowYes')<14&&error('borrowNo')<14,commit:{x:470,y:480}};
    }
    if(kind==='equippicker') {
      const page=pageread(im,{...arg,layout:'equip'});
      const category=equipmentCategory(im),primary=equipCategories.templates.find(t=>t.id===category)?.primary??null;
      return {valid:page.valid,category:page.valid?category:null,primary:page.valid?primary:null,page};
    }
    if(kind==='filterstate')return filterstate(im);
    if(kind==='pix')return {valid:arg.pts.every(([x,y],i)=>im.rgb(x,y).every((v,k)=>Math.abs(v-arg.exp[i][k])<=(arg.tol||45)))};
    if(kind==='equipTabs') {
      const selected=[];
      for(let i=0;i<4;i++) {
        const x=Math.round(222+i*45.7);
        const ps=im.samples([x-18,155,x+16,188]);
        const fraction=ps.filter(([r,g,b])=>g>140&&g-r>35&&b-r>30).length/ps.length;
        if(fraction>.08&&fraction<.65)selected.push(i+1);
      }
      return {valid:selected.length===1&&(!arg.fleet||selected[0]===arg.fleet),selected};
    }
    if(kind==='equipship') {
      const tab=await this.observe('equipTabs',im,{fleet:arg.fleet});
      if(!tab.valid)return {valid:false,reason:'equipment fleet tab missing'};
      const level=readNumber(im,[744,160,790,195]);
      if(!level.valid||Number(level.value)!==Number(arg.expectedLevel))
        return {valid:false,reason:'level mismatch',level:level.valid?level.value:null};
      return {valid:true,level:level.value};
    }
    if(kind==='equipclear') {
      const tab=await this.observe('equipTabs',im,{fleet:arg.fleet});
      if(!Number.isInteger(arg.fleet)||arg.fleet<1||arg.fleet>4||!tab.valid||!Number.isInteger(arg.slots)||arg.slots<1||arg.slots>5)return {valid:false};
      const x=485,y=245+50*arg.slots,offset=clearEquipment.offset;
      const expected=clearEquipment.mask.join('');
      let score=0;
      // Fractional zoom shifts the same tooltip by one normalized pixel as
      // its height changes. Keep the match threshold and search only ±1 px.
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        const label=im.crop([x+offset[0]+dx,y+offset[1]+dy,x+offset[2]+dx,y+offset[3]+dy],...clearEquipment.size);
        let intersection=0,union=0;
        for(let row=0;row<label.height;row++)for(let col=0;col<label.width;col++) {
          const actual=cyan(label.rgb(col,row)),wanted=expected[row*label.width+col]==='1';
          if(actual&&wanted)intersection++;
          if(actual||wanted)union++;
        }
        score=Math.max(score,intersection/Math.max(1,union));
      }
      if(score<.80)return {valid:false,reason:'all-equipment removal tooltip missing'};
      return {valid:true,tab,commit:{x,y}};
    }
    if(kind==='cells') {
      const centers=Array.from({length:15},(_,i)=>({x:811,y:Math.round(197+28.6*i)}));
      const categories=centers.map(({y})=>{
        const cell=im.crop([780,y-13,842,y+13],...equipCategories.size),rgb=Array.from(cell.data).filter((_,i)=>i%4!==3);
        const ranked=equipCategories.templates.map(t=>({id:t.id,error:rgb.reduce((n,v,i)=>n+Math.abs(v-t.rgb[i]),0)/rgb.length})).sort((a,b)=>a.error-b.error);
        return ranked[0]&&ranked[0].error<12&&(!ranked[1]||ranked[1].error-ranked[0].error>5)?ranked[0].id:null;
      });
      return {valid:categories.filter(v=>v!==null).length>=10,categories,primaries:categories.map(id=>equipCategories.templates.find(t=>t.id===id)?.primary??null),centers};
    }
    if(kind==='rowicon') {
      const {classify}=require('./equipment_icons');
      return {valid:classify(im,arg.box)===arg.t3};
    }
    if(kind==='sortread')return sortread(im);
    if(kind==='picker') {
      const sort=await sortread(im),filter=filterstate(im),page=pageread(im,arg),tab=orgtab(im,arg.fleet);
      return {valid:sort.valid&&filter.valid&&tab.valid,sort,filter,page,tab};
    }
    if(kind==='orgclear') {
      const tab=orgtab(im,arg.fleet);
      if(!tab.valid||(await this.observe('screen',im)).mode!=='organization')return {valid:false};
      // Hover must show the verified "remove everyone except flagship" tooltip.
      const label=im.crop(clearEscorts.box,...clearEscorts.size),expected=clearEscorts.mask.join('');
      let intersection=0,union=0;
      for(let y=0;y<label.height;y++)for(let x=0;x<label.width;x++) {
        const actual=Math.max(...label.rgb(x,y))<130,wanted=expected[y*label.width+x]==='1';
        if(actual&&wanted)intersection++;
        if(actual||wanted)union++;
      }
      const button=im.samples([576,166,680,188]);
      if(intersection/Math.max(1,union)<.80||button.filter(cyan).length/button.length<.04)return {valid:false,reason:'clear-escorts tooltip or button missing'};
      return {valid:true,tab,commit:{x:625,y:178}};
    }
    if(kind==='screen') {
      const b=im.rgb(59,62), warm=[[40,690],[90,695],[35,708],[130,690],[60,700]].filter(([x,y])=>{const p=im.rgb(x,y);return p[0]>105&&p[0]-p[2]>25;}).length;
      if(b[1]>140&&b[1]-b[0]>40&&warm>=3)return {valid:true,mode:'home'};
      const pts=[[560,113],[450,110],[790,153],[1080,153],[780,190],[1000,190]],exp=[[52,54,55],[56,58,59],[226,236,235],[227,236,235],[36,161,163],[36,161,163]];
      if(pts.every(([x,y],i)=>im.rgb(x,y).every((v,k)=>Math.abs(v-exp[i][k])<=35))&&[1,2,3,4].some(f=>orgtab(im,f).valid)&&!filterstate(im).valid)return {valid:true,mode:'organization'};
      // The tab alone is not proof of a base remodel screen. Also require
      // its header, fleet divider, status panel and portrait frame; picker
      // and confirmation overlays move or dim these anchors.
      const remodelPts=[[470,120],[840,160],[455,210],[460,690],[505,450],[820,450],[935,150],[475,150]];
      const remodelRGB=[[60,59,57],[238,230,220],[123,96,55],[165,129,74],[240,229,218],[243,235,226],[236,224,213],[43,38,21]];
      if(remodelPts.every(([x,y],i)=>im.rgb(x,y).every((v,k)=>Math.abs(v-remodelRGB[i][k])<=25))){
        const tab=await this.observe('equipTabs',im);
        if(tab.valid)return {valid:true,mode:'equipment',...(arg.includeFleet?{fleet:tab.selected[0]}:{})};
      }
      return {valid:false,mode:'unknown'};
    }
    if(kind==='rowidentity'||kind==='cardidentity') {
      const card=kind==='cardidentity';
      if(!card) {
        if(!Number.isInteger(arg.row)||arg.row<0||arg.row>9)throw new Error('Row outside list');
        const picker=await this.observe('picker',im,arg);
        if(!picker.valid||picker.sort.mode!=='new'||picker.sort.direction!=='desc'||!picker.page.valid||picker.page.activePage!==arg.page||JSON.stringify(picker.filter.states)!==JSON.stringify(arg.mask))return {valid:false,reason:'list changed'};
      }
      // Organization explicitly skips level text (compact five-slot headers
      // differ). Keep the optional diagnostic level read for existing tools;
      // it is no longer a prerequisite in the organization executor.
      const result={valid:true};
      if(arg.checkLevel!==false){
        const levelBox=card?[1120,160,1195,199]:[823,225+43*arg.row,884,259+43*arg.row];
        const level=readNumber(im,levelBox);
        if(!level.valid||Number(level.value)!==Number(arg.expectedLevel))
          return {valid:false,reason:'level mismatch',level:level.valid?level.value:null};
        result.level=level.value;
      }
      if(card) {
        // The 変更 button is teal while the change is available and turns
        // grey when this row cannot actually be re-organized into the slot.
        // Cyan ratio (native cards ~0.13, grey button and list bg ~0.03)
        // gates the commit: a grey button refuses instead of submitting a
        // change the game would not perform.
        const tile=im.crop([1020,646,1103,690]);
        let cy=0,total=0;
        for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++){if(cyan(tile.rgb(x,y)))cy++;total++;}
        if(cy/total<0.10)return {valid:false,reason:'confirmation button not available (grey)'};
        result.commit={x:1032,y:669};
      }
      return result;
    }
    throw new Error('Unsupported observation: '+kind);
  }
}
module.exports={Observer,filterstate,orgtab,pageread,sortread,arrow};
