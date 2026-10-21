'use strict';

// 出击前、普通水面目标的夜战参考值。不是实战伤害模拟。
// Checked 2026-10-16: 夜戦#nightcutin1/#h3b8bdeb,
// 試製 夜間瑞雲(攻撃装備)#nightZuiunCutin; 改修工廠.
const compact=name=>String(name||'').replace(/\s/g,'').replace(/＋/g,'+');
const value=raw=>raw==null||raw===''?null:Number.isFinite(Number(raw))?Number(raw):null;
const first=raw=>value(Array.isArray(raw)?raw[0]:raw);
const stat=(e,key)=>Number(e.master?.[key]||0);
const pct=n=>(n*100).toFixed(1)+'%';
const surfaceRadar=e=>[12,13,93].includes(e.type)&&stat(e,'api_saku')>=5;
const cap=n=>Math.floor(n>360?360+Math.sqrt(n-360):n);
const {combatBonuses,nightFit}=require('./equipment_bonuses');
const tooltip=require('../../shared/mechanism_text');

function fixedTerm(target,flagship,{zuiun=false}={}){
  const luck=first(target.ship.api_lucky),level=value(target.ship.api_lv),bonuses=[];
  if(flagship)bonuses.push({label:'旗舰',value:15});
  if(target.items.some(e=>compact(e.master?.api_name)==='熟練見張員'))bonuses.push({label:'熟练见张员',value:5});
  if(!zuiun&&[2,3,4].includes(Number(target.master.api_stype))&&
    target.items.some(e=>compact(e.master?.api_name)==='水雷戦隊熟練見張員'))bonuses.push({label:'水雷见张员',value:8});
  const known=luck!==null&&luck>=0&&level!==null&&level>=1;
  const base=!known?null:luck<50?15+luck+Math.floor(.75*Math.sqrt(level)):
    65+Math.floor(Math.sqrt(luck-50))+Math.floor(.8*Math.sqrt(level));
  return {luck,level,flagship,bonuses,term:base===null?null:base+bonuses.reduce((n,b)=>n+b.value,0)};
}

// Prefer actual intrinsic stats (initial + modernization). Removing worn raw
// stats from a live panel would incorrectly retain the old loadout's blue bonus.
function hullStat(target,key,index){
  const initial=first(target.master[key]),modern=value(target.ship.api_kyouka?.[index]);
  return initial!==null&&modern!==null&&initial>=0&&modern>=0?initial+modern:null;
}
function nightImprovement(e){
  const star=value(e.instance?.api_level);if(star===null||star<0)return null;
  if(e.type===32)return .2*star;
  if(e.type===4){
    const name=compact(e.master?.api_name);
    if(['12.7cm連装高角砲','8cm高角砲','8cm高角砲改+増設機銃','10cm連装高角砲改+増設機銃','10cm連装高角砲群集中配備'].includes(name))return .2*star;
    if(['15.5cm三連装副砲','15.5cm三連装副砲改','15.2cm三連装砲','5inch連装砲(副砲配置)集中配備'].includes(name))return .3*star;
    return Math.sqrt(star);
  }
  if([1,2,3,5,18,19,22,23,24,29,34,35,36,37,38,39,42,46,54].includes(e.type))return Math.sqrt(star);
  // Machine guns, sonar and depth charges have no night power improvement.
  // Other equipment-specific improvement effects are outside this reference.
  return 0;
}
function surfacePower(target,store){
  const fire=hullStat(target,'api_houg',0),torpedo=hullStat(target,'api_raig',1);
  const improvements=target.items.map(nightImprovement);
  const blue=combatBonuses(store,target),fit=nightFit(target);
  const ids=state=>(state?.slots||[]).concat(state?.ex).filter(id=>id>0).sort((a,b)=>a-b).join(',');
  const observedFire=first(target.ship.api_karyoku),observedTorpedo=first(target.ship.api_raisou);
  const same=ids(target.before)===ids(target.after),observed=same&&observedFire!==null&&observedTorpedo!==null;
  const addition=improvements.includes(null)?null:improvements.reduce((a,b)=>a+b,0);
  if(addition===null||!observed&&(fire===null||torpedo===null||!blue.known))
    return {basePower:null,blue,fit,reasons:blue.reasons};
  const raw=target.items.reduce((n,e)=>n+stat(e,'api_houg')+stat(e,'api_raig'),0);
  const permanent=(target.ship.api_sp_effect_items||[]).reduce((n,e)=>n+Number(e.api_houg||0)+Number(e.api_raig||0),0);
  const panel=observed?observedFire+observedTorpedo:fire+torpedo+raw+blue.firePower+blue.torpedo+permanent;
  return {basePower:panel+addition,blue,fit,source:observed?'observed':'calculated'};
}

function aviationPower(target,slots,store){
  const blue=combatBonuses(store,target),fire=hullStat(target,'api_houg',0);
  if(fire===null||slots.some(s=>s.planes===null)||!blue.known)return {basePower:null,blue,fit:0,reasons:blue.reasons};
  const permanentFire=(target.ship.api_sp_effect_items||[]).reduce((n,e)=>n+Number(e.api_houg||0),0);
  let power=fire+blue.nightAviation+permanentFire;
  for(const {equipment:e,planes,kind}of slots){
    if(planes<=0)continue;
    const star=value(e.instance?.api_level);if(star===null||star<0)return {basePower:null,blue,fit:0};
    const fp=stat(e,'api_houg'),torpedo=stat(e,'api_raig'),bomb=stat(e,'api_baku');
    // TBM-3W+3S uses torpedo, not torpedo+bomb, in its direct stat term.
    const direct=fp+torpedo+(compact(e.master?.api_name)==='TBM-3W+3S'?0:bomb);
    const regular=['fighter','attacker','bomber'].includes(kind);
    power+=direct+(regular?3*planes:0)+(regular?.45:.3)*(fp+torpedo+bomb+stat(e,'api_tais'))*Math.sqrt(planes)+Math.sqrt(star);
  }
  return {basePower:power,blue,fit:0,source:'calculated'};
}

function surfaceModes(target){
  const items=target.items,type=Number(target.master.api_stype),level=Number(target.ship.api_lv);
  const main=items.filter(e=>[1,2,3,38].includes(e.type)).length,secondary=items.filter(e=>e.type===4).length;
  const torpedo=items.filter(e=>[5,32].includes(e.type)).length,modes=[];
  const mode=(label,multiplier,hits,coefficient)=>({label,multiplier,hits,coefficient});
  let generic;
  const late=items.filter(e=>e.type===32&&/後期型/.test(e.master?.api_name)).length;
  if([13,14].includes(type)&&late&&items.some(e=>e.type===51))generic=mode('后期鱼雷＋潜水电探',1.75,2,105);
  else if([13,14].includes(type)&&late>=2)generic=mode('后期鱼雷×2',1.6,2,110);
  else if(main>=3)generic=mode('主炮×3',2,1,140);
  else if(main>=2&&secondary)generic=mode('主炮×2＋副炮',1.75,1,130);
  else if(torpedo>=2)generic=mode('鱼雷×2',1.5,2,122);
  else if(main&&torpedo)generic=mode('主炮＋鱼雷',1.3,2,115);
  else if(main+secondary>=2)generic=mode('双炮连击',1.2,2,null);
  if(type===2&&!secondary){
    const radar=items.some(surfaceRadar),lookout=items.some(e=>['熟練見張員','水雷戦隊熟練見張員'].includes(compact(e.master?.api_name)));
    const skilled=items.some(e=>compact(e.master?.api_name)==='水雷戦隊熟練見張員');
    const d2=items.filter(e=>compact(e.master?.api_name)==='12.7cm連装砲D型改二').length;
    const d3=items.filter(e=>compact(e.master?.api_name)==='12.7cm連装砲D型改三').length;
    const dBonus=(d2+d3>=2?1.4:d2+d3?1.25:1)*(1+.05*Math.min(d3,2));
    const hits=Number.isFinite(level)&&level>=1?(level>=80?'1–2':1):'1–2（等级待确认）';
    if(main&&torpedo&&radar)modes.push(mode('主鱼电',1.3*dBonus,hits,115));
    if(torpedo&&lookout&&radar)modes.push(mode(skilled?'鱼水电':'鱼见电',1.2*dBonus,hits,140));
    if(!main&&torpedo>=2&&skilled)modes.push(mode('鱼水鱼',1.5,hits,126));
    if(!main&&torpedo&&skilled&&items.some(e=>e.type===30))modes.push(mode('鱼桶水',1.3,hits,122));
  }
  if(generic)modes.push(generic);
  return modes;
}

function zuiunModes(target,planes){
  const count=planes.filter(p=>p.planes>0).length,radar=target.items.some(surfaceRadar),modes=[];
  for(const [needed,hasRadar,multiplier]of [[2,true,1.36],[2,false,1.32],[1,true,1.28],[1,false,1.24]])
    if(count>=needed&&(!hasRadar||radar))modes.push({label:`夜瑞×${needed}${hasRadar?'＋水上电探':''}`,multiplier,hits:2,coefficient:135});
  return modes;
}

function reading(target,flagship,modes,power,{zuiun=false,available=true,aviation=false}={}){
  const basePower=typeof power==='object'&&power!==null?power.basePower:power;
  const fit=power?.fit||0;
  const fixed=fixedTerm(target,flagship,{zuiun});let remaining=1;
  const rows=modes.map(mode=>{
    const rate=available&&fixed.term!==null&&mode.coefficient?Math.min(1,Math.max(0,fixed.term/mode.coefficient)):null;
    const occurrence=rate===null?null:remaining*rate;if(rate!==null)remaining*=1-rate;
    return {...mode,rate,occurrence,power:basePower===null?null:cap(basePower*mode.multiplier+fit)};
  });
  const ciRows=rows.filter(m=>m.coefficient),total=ciRows.length&&ciRows.every(m=>m.rate!==null)?1-remaining:null;
  const attack=m=>`攻击力：${m.power??'待确认'} × ${String(m.hits).replace('（等级待确认）','')}击${String(m.hits).includes('待确认')?'（次数待确认）':''}`;
  const activation=ciRows.length?[
    `发动率：${total===null?'待确认':pct(total)}`,
    ...(rows.length>1?ciRows.map(m=>`${m.label}：${m.occurrence===null?'待确认':pct(m.occurrence)}`):[])
  ]:'发动率：待确认（高概率连击）';
  const blocks=rows.map(m=>`${m.label}\n${attack(m)}`);
  const powerNote=basePower===null?`攻击力待确认：${power?.reasons?.join('；')||'属性或改修资料不完整'}。`:'';
  const detail=tooltip(activation,blocks,powerNote);
  return {total,rows,fixed,basePower,fit,blue:power?.blue,powerSource:power?.source,detail};
}

module.exports={surfaceModes,zuiunModes,surfacePower,aviationPower,reading,hullStat,nightImprovement};
