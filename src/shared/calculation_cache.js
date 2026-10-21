'use strict';
// Pure calculation tables, scoped to one synchronous immutable-snapshot job.
// The backing store persists values across workers; live callers have no scope
// and always evaluate again. No inventory allocations or execution plans here.
let active=null;
class CalculationCache {
  constructor(storage){this.storage=storage;this.tables=new Map();this.contexts=new Map();this.stats={};}
  table(namespace,dependencies,maxEntries=32768){
    const key=this.storage.key('calculation:'+namespace,dependencies,{});
    if(this.tables.has(key))return this.tables.get(key);
    const saved=this.storage.read(key)?.result;
    const entries=saved?.entries instanceof Map?saved.entries:new Map();
    const tokens=saved?.tokens instanceof Map?saved.tokens:new Map();
    const stats=this.stats[namespace]||(this.stats[namespace]={hits:0,misses:0,loaded:0});
    stats.loaded+=entries.size;
    const table={namespace,maxEntries,dirty:false,entries,tokens,delta:new Map(),token:descriptor=>{
      if(!tokens.has(descriptor)){tokens.set(descriptor,tokens.size);table.dirty=true;}
      return tokens.get(descriptor);
    },memo:(input,calculate)=>{
      if(entries.has(input)){stats.hits++;return entries.get(input);}
      stats.misses++;const result=calculate();
      if(entries.size>=maxEntries){const oldest=entries.keys().next().value;entries.delete(oldest);table.delta.delete(oldest);}
      entries.set(input,result);if(namespace==='hullFeasibility')table.delta.set(input,result);table.dirty=true;return result;
    }};
    this.tables.set(key,table);return table;
  }
  flush(){for(const [key,table] of this.tables)if(table.dirty)this.storage.write(key,{entries:table.entries,tokens:table.tokens});}
  // Hull keys use worker-local tokens. Transfer only newly calculated facts,
  // and translate the full descriptor dictionary before joining any entries.
  hullEntries(){return [...this.tables].filter(([,t])=>t.namespace==='hullFeasibility'&&t.delta.size)
    .map(([key,t])=>[key,{tokens:t.tokens,entries:t.delta}]);}
  mergeHullEntries(records){
    for(const [key,remote] of records){
      const table=this.tables.get(key);
      if(!table||table.namespace!=='hullFeasibility')continue;
      const ids=new Map([...remote.tokens].map(([descriptor,id])=>[id,table.token(descriptor)]));
      for(const [input,result] of remote.entries){
        const [flagship,escorts]=input.split(':');
        const first=ids.get(Number(flagship)),rest=escorts?escorts.split(',').map(id=>ids.get(Number(id))):[];
        if(first===undefined||rest.some(id=>id===undefined))continue;
        const translated=first+':'+rest.sort((a,b)=>a-b).join(',');
        if(table.entries.has(translated))continue;
        if(table.entries.size>=table.maxEntries)table.entries.delete(table.entries.keys().next().value);
        table.entries.set(translated,result);table.dirty=true;
      }
    }
  }
  // Equipment facts already have portable descriptor keys.
  equipmentEntries(){return [...this.tables].filter(([,table])=>table.namespace==='equipmentEligibility'&&table.dirty&&!table.tokens.size)
    .map(([key,table])=>[key,table.entries]);}
  mergeEquipmentEntries(records){
    for(const [key,entries] of records){
      const table=this.tables.get(key);
      if(!table||table.namespace!=='equipmentEligibility'||table.tokens.size)continue;
      for(const [input,result] of entries)if(!table.entries.has(input)){
        if(table.entries.size>=table.maxEntries)table.entries.delete(table.entries.keys().next().value);
        table.entries.set(input,result);table.dirty=true;
      }
    }
  }
}
function withCalculationCache(cache,calculate,{flush=true}={}){
  const previous=active;active=cache;
  try{const result=calculate();if(flush)cache.flush();return result;}
  finally{active=previous;}
}
function calculationTable(namespace,dependencies,maxEntries){return active?.table(namespace,dependencies,maxEntries);}
function calculationContext(namespace,identity,create){
  if(!active)return null;
  let contexts=active.contexts.get(namespace);
  if(!contexts){contexts=new WeakMap();active.contexts.set(namespace,contexts);}
  if(!contexts.has(identity))contexts.set(identity,create());
  return contexts.get(identity);
}
module.exports={CalculationCache,withCalculationCache,calculationTable,calculationContext};
