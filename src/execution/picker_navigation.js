'use strict';
const imageCategoryIds=new Set(require('../../data/equip_categories.json').templates.map(c=>c.id));

const windowAt=(page,total)=>{
  const count=Math.min(5,total),first=Math.max(1,Math.min(page-2,total-count+1));
  return Array.from({length:count},(_,i)=>first+i);
};
function pageCost(read,target,total){
  if(read.activePage===target)return 0;
  if(read.labels.includes(target))return 1;
  const forward=(from,to)=>{
    if(from===to)return 0;
    if(windowAt(from,total).includes(to))return 1;
    const diff=to-from,steps=Math.floor(diff/5),rest=diff%5;
    return steps+(rest===0?0:rest<=2?1:2);
  };
  return target>read.activePage?forward(read.activePage,target)
    :Math.min(Math.ceil((read.activePage-target)/2),1+forward(1,target));
}
function validPage(read,total){
  return read?.valid&&Number.isInteger(read.activePage)&&read.activePage>=1&&read.activePage<=total&&
    Array.isArray(read.labels)&&read.labels.length>0&&read.labels.length<=5&&read.labels.includes(read.activePage)&&
    read.labels.every((p,i)=>Number.isInteger(p)&&p>=1&&p<=total&&(!i||p===read.labels[i-1]+1))&&
    Array.isArray(read.centers)&&read.labels.every((_,i)=>Number.isFinite(read.centers[i]));
}
async function navigatePages(session,initial,target,{total,read,first,forward}){
  if(!Number.isInteger(total)||total<1||!Number.isInteger(target)||target<1||target>total)throw new Error('Invalid picker target page');
  let current=initial,clicks=0,forwardVerified=false,batching=true;
  const seen=new Set(),budget=Math.ceil(total/5)+5;
  const key=(page,labels)=>page+':'+labels.join(',');
  for(;;){
    if(!validPage(current,total))throw new Error('Picker page does not match the current filtered inventory');
    if(current.activePage===target)return current;
    if(clicks>=budget)throw new Error('Picker navigation exceeded its filtered-list budget');
    if(seen.has(key(current.activePage,current.labels)))throw new Error('Picker navigation repeated a page window; stopping without retry');
    seen.add(key(current.activePage,current.labels));
    const index=current.labels.indexOf(target),before=current.activePage;
    let point,expected,kind='number',count=1;
    if(index>=0){point=[current.centers[index],current.y??677];expected=target;}
    else if(target>before){
      point=forward;kind='forward';
      // Calibrate this list's right control once before batching: some game
      // layouts use an endpoint instead of +5. Batch only fixed-position
      // arrows, never speculative page-number coordinates.
      if(forwardVerified&&batching)count=Math.min(4,budget-clicks,Math.max(1,Math.floor((target-before)/5)));
      expected=Math.min(total,before+5*count);
    }
    else {
      const edge=current.labels[0],edgeCost=edge<before?1+pageCost({activePage:edge,labels:windowAt(edge,total)},target,total):Infinity;
      const resetCost=1+pageCost({activePage:1,labels:windowAt(1,total)},target,total);
      if(edge<before&&!seen.has(key(edge,current.labels))&&edgeCost<=resetCost){point=[current.centers[0],current.y??677];expected=edge;}
      else {point=first;expected=1;kind='first';}
    }
    const expectedLabels=kind==='number'?current.labels:windowAt(expected,total);
    if(!Array.isArray(point)||!point.every(Number.isFinite)||expected===before||seen.has(key(expected,expectedLabels)))throw new Error('No useful picker page move remains');
    for(let i=0;i<count;i++){
      await session.input(...point);clicks++;
    }
    const next=await read(r=>r.activePage!==before);
    if(!validPage(next,total))throw new Error('Picker page became inconsistent after navigation');
    // Accept a right-arrow endpoint only when it exposes the target. Never
    // turn an unexpected first/last jump into a long alternating loop.
    const visible=next.labels.includes(target);
    const shortBatch=kind==='forward'&&count>1&&next.activePage>before&&next.activePage<expected&&
      (next.activePage-before)%5===0;
    if(next.activePage!==expected&&!shortBatch&&!(kind==='forward'&&next.activePage===total&&visible))throw new Error('Unexpected picker page movement; stopping without retry');
    if(kind==='forward'&&next.activePage===before+5)forwardVerified=true;
    // Correct missed clicks from the observed page, using individually
    // verified moves for the remainder. Never replay the whole batch.
    if(shortBatch)batching=false;
    if(seen.has(key(next.activePage,next.labels)))throw new Error('Picker navigation repeated a page window; stopping without retry');
    if(kind!=='first'&&!visible&&Math.abs(target-next.activePage)>=Math.abs(target-before))throw new Error('Picker navigation made no progress toward the target');
    current=next;
  }
}

// A category switch costs two clicks. Keep an immediately usable category;
// At equal cost retain the current category to avoid unnecessary menu work.
// Rank exact instances in the live list; no name-based substitution or cache.
function chooseEquipmentCategory(planner,{category,read,item,ship,slot,borrow=false}){
  const build=borrow?planner.otherPickerList:planner.freePickerList;
  const preferred=planner.categoryFor(item),candidates=[],native=Object.hasOwn(read,'itemIds');
  let current;
  if(native){
    const ids=read.itemIds,total=Math.max(1,Math.ceil(ids?.length/10));
    if(!Array.isArray(ids)||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length||!validPage(read,total))
      throw Error('Invalid native equipment list');
    current=ids.map(id=>({id}));
  }
  // Only control mode has a verified native order, including subcategories.
  // Use it for the retained category, and compare other compatible categories
  // by estimated switch cost. The destination list is read again after input.
  const ids=[category,preferred.id,0,...(planner.groupDefs||[]).map(d=>d.id)];
  for(const id of new Set(ids)){
    if(!Number.isInteger(id)||!native&&!imageCategoryIds.has(id)||!planner.categoryAccepts(id,item))continue;
    const list=native&&id===category?current:build(id,ship,slot),rank=list.findIndex(e=>e.id===item);
    if(rank<0)continue;
    const total=Math.max(1,Math.ceil(list.length/10)),page=Math.floor(rank/10)+1,retained=id===category;
    const start=retained?read:{activePage:1,labels:windowAt(1,total)};
    const clicks=retained&&read.activePage>total?Infinity:(retained?0:2)+pageCost(start,page,total);
    candidates.push({id,list,page,total,clicks,retained});
  }
  candidates.sort((a,b)=>a.clicks-b.clicks||Number(b.retained)-Number(a.retained)||a.total-b.total
    ||(!native?Number(a.id===0)-Number(b.id===0):0)||a.id-b.id);
  if(!candidates.length||!Number.isFinite(candidates[0].clicks))throw new Error('Equipment missing from current picker categories');
  return candidates[0];
}
module.exports={navigatePages,chooseEquipmentCategory,pageCost};
