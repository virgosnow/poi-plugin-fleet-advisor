'use strict';
// Derived from https://en.kancollewiki.net/Level#Exercises and
// https://wikiwiki.jp/kancolle/演習#v657609b (accessed 2026-11-03).
// Level tables are cumulative XP; the unexplained 0–3 variation and approximate
// training bonuses remain visible as ranges/notes, not exact observations.
const RANK={SS:120,S:120,A:100,B:100,C:64,D:56,E:40};
const TRAINING={escort:[1030,1050,1070,1100,1150],twoEscorts:[1040,1060,1080,1120,1175],
 flagship:[1050,1080,1120,1150,1200],flagshipAndEscort:[1100,1130,1160,1200,1250]};
const cap=x=>x<=500?x:Math.floor(500+Math.sqrt(x-500));
const levelOk=n=>Number.isInteger(n)&&n>=1&&n<=188;
function cumulative(level){
 if(!levelOk(level))return null;
 if(level<=51)return 50*level*(level-1);
 let total=127500;
 const add=(lo,hi,start,step)=>{for(let n=lo;n<=Math.min(hi,level);n++)total+=start+(n-lo)*step;};
 add(52,61,5200,200);add(62,71,7300,300);add(72,81,10400,400);add(82,91,14500,500);
 for(const [i,n] of [20000,22000,25000,30000,40000,60000,90000,148500].entries())if(level>=92+i)total+=n;
 if(level<100)return total;
 if(level>=101)total+=10000;
 add(102,111,1000,1000);add(112,116,12000,2000);add(117,121,23000,3000);add(122,131,39000,4000);
 add(132,140,80000,5000);add(141,145,127000,7000);add(146,150,163000,8000);add(151,155,204000,9000);
 const late=[250000,60000,80000,110000,150000,200000,260000,330000,410000,500000,100000,113000,139000,178000,230000,295000,373000,457000,561000,684000,150000,200000,300000,500000,900000,200000,400000,600000,800000,1000000,1200000,1400000,1600000];
 late.forEach((n,i)=>{if(level>=156+i)total+=n;});return total;
}
const tier=level=>level<10?0:level<30?1:level<60?2:level<100?3:4;
function training(store,entries){
 const trainers=[];
 for(let i=0;i<entries.length;i++){
  const ship=store.info?.ships?.[entries[i].id],master=store.const?.$ships?.[ship?.api_ship_id];
  if(!ship||!master)return {error:'己方舰娘资料不足'};
  if(Number(master.api_stype)!==21)continue;
  const name=String(master.api_name||'').normalize('NFKC').replace(/\s/g,'');
  const type=/^(香取|鹿島)(改)?$/.test(name)?'katori':name==='朝日'?'asahi':null;
  if(!type||!levelOk(Number(ship.api_lv)))return {error:'练巡加成资料不足'};
  trainers.push({index:i,type,level:Number(ship.api_lv)});
 }
 const ks=trainers.filter(x=>x.type==='katori'),asahi=trainers.filter(x=>x.type==='asahi');
 if(ks.length>2||asahi.length>1)return {error:'练巡组合加成待确认'};
 const flag=trainers.find(x=>x.index===0),t=tier(flag?.level||Math.max(1,...ks.map(x=>x.level)));
 let base=1000;
 if(!flag)base=ks.length===1?TRAINING.escort[t]:ks.length===2?TRAINING.twoEscorts[t]:1000;
 else if(flag.type==='katori')base=asahi.length?TRAINING.flagship[t]:ks.length===2?TRAINING.flagshipAndEscort[t]:TRAINING.flagship[t];
 else if(flag.type==='asahi')base=ks.length===2?TRAINING.flagshipAndEscort[t]:TRAINING.flagship[t];
 const asahiFlag=!!asahi.length&&!!flag;
 const surfaceFactor=asahiFlag?(flag.type==='asahi'&&ks.length===0?600:1050):1000;
 const submarineFactor=asahiFlag?(flag.type==='asahi'&&ks.length===0?1300:1450):1000;
 return {surface:base*surfaceFactor/1000,submarine:base*submarineFactor/1000,
  notes:trainers.length?['练巡与朝日加成按公开资料估算，部分组合尚未完全验证。']:[]};
}
function admiralXP(ownLevel,enemyLevel,rank){
 if(!levelOk(ownLevel)||!levelOk(enemyLevel))return null;
 const diff=enemyLevel-ownLevel,band=diff>=5?0:diff>=3?1:diff>=1?2:diff===0?3:diff>=-2?4:diff>=-4?5:6;
 const table=[[160,120,96,80],[120,80,64,60],[80,60,48,40],[60,40,32,30],[40,30,24,20],[30,20,16,15],[20,15,12,10]];
 return table[band][rank==='S'||rank==='SS'?0:rank==='A'?1:rank==='B'?2:3];
}
function estimate(store,scheme,opponent,{rank='S'}={}){
 if(!RANK[rank])return {status:'unknown',reason:'战果等级无效'};
 if(!Array.isArray(opponent?.ships)||!opponent.ships.length)return {status:'unknown',reason:'对手舰队资料待同步'};
 const first=Number(opponent.ships[0]?.level),second=opponent.ships.length===1?1:Number(opponent.ships[1]?.level);
 if(!levelOk(first)||!levelOk(second))return {status:'unknown',reason:'对手前两舰等级待同步'};
 const entries=scheme?.ships||[],bonus=training(store,entries);if(bonus.error)return {status:'unknown',reason:bonus.error};
 // Sources disagree on whether the unexplained 0–3 variation is applied
 // before or after the soft cap. Enclose both interpretations, rather than
 // suppressing almost all variation in high-level fleets after the square root.
 const pre=Math.floor(cumulative(first)/100+cumulative(second)/300),baseValues=[
  ...Array.from({length:4},(_,i)=>cap(pre+i)),...Array.from({length:4},(_,i)=>cap(pre)+i)];
 const rated=baseValues.map(value=>Math.floor(value*RANK[rank]/100));
 const range=values=>({min:Math.min(...values),max:Math.max(...values)});
 const ships=entries.map((entry,index)=>{
  const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id],sub=[13,14].includes(Number(master.api_stype));
  const multiplier=sub?bonus.submarine:bonus.surface,flagship=index===0;
  // English documentation floors after the combined multipliers; Japanese
  // training guidance describes flooring the bonus before adding it. Include
  // both when they differ, instead of claiming an unverified rounding order.
  const experience=mvp=>range(rated.flatMap(base=>{
   const plain=base*(flagship?3:2)*(mvp?2:1)/2,combined=Math.floor(plain*multiplier/1000+1e-9);
   return multiplier>=1000?[combined,Math.floor(plain)+Math.floor(plain*(multiplier-1000)/1000+1e-9)]:[combined];
  }));
  return {id:entry.id,flagship,normal:experience(false),mvp:rank==='E'?null:experience(true),trainingMultiplier:multiplier/1000};
 });
 return {status:'estimated',rank,base:range(rated),rawBase:range(baseValues),ships,
  admiral:admiralXP(Number(store.info?.basic?.api_level),Number(opponent.level),rank),
  notes:['根据对手前两舰当前等级估算，基础经验可能有约 0–3 点的未明变动；MVP 与战果需以实际为准。','演习中受到击沉判定的舰娘无法获得经验。',...bonus.notes]};
}
// The battle simulation reports sampled rank counts, including rare outcomes
// whose displayed percentage may round to zero. Keep those outcomes in the
// experience interval; this is a conditional simulation, not a guarantee.
function estimateForecast(store,scheme,opponent,forecast){
 if(forecast?.status!=='estimated'||!Array.isArray(forecast.rows)||!Number.isSafeInteger(forecast.samples)||forecast.samples<=0)
  return {status:'unknown',reason:'战况预测待确认'};
 const counts=forecast.rows.map(row=>({rank:row.label,count:row.count}));
 if(!counts.length||counts.some(row=>!RANK[row.rank]||!Number.isSafeInteger(row.count)||row.count<=0)||
    counts.reduce((sum,row)=>sum+row.count,0)!==forecast.samples)
  return {status:'unknown',reason:'战果分布资料不足'};
 const results=counts.map(row=>estimate(store,scheme,opponent,{rank:row.rank}));
 const failed=results.find(result=>result.status!=='estimated');if(failed)return failed;
 const range=values=>{const known=values.filter(Boolean);return known.length?{min:Math.min(...known.map(v=>v.min)),max:Math.max(...known.map(v=>v.max))}:null;};
 const sOnly=counts.every(row=>row.rank==='S'||row.rank==='SS');
 const ships=results[0].ships.map((ship,index)=>{
  const normal=range(results.map(result=>result.ships[index].normal));
  const mvp=range(results.map(result=>result.ships[index].mvp));
  return {...ship,normal,mvp,representativeNormal:sOnly&&normal?Math.round((normal.min+normal.max)/2):null};
 });
 return {status:'estimated',ranks:counts,sOnly,ships,
  base:range(results.map(result=>result.base)),rawBase:range(results.map(result=>result.rawBase)),
  notes:[...results[0].notes,'战果范围来自参考模拟，仅纳入模拟中出现的结果；普通经验不含 MVP 或被击沉。',
   ...(sOnly?['单一数值为 S 胜普通经验范围的中间参考值，实际经验仍可能波动。']:[])]};
}
module.exports={estimate,estimateForecast,cumulative,training,admiralXP};
