'use strict';

// Normal-fleet draft capabilities, checked 2026-10-14 against wikiwiki.jp/kancolle:
// 大和改二#SpecialAttack, 長門改二#isseisya, Nelson#NelsonTouch,
// Colorado#ColoTouch, Warspite改#SpecialAttack, 金剛改二丙#KongouClassTouch.
// Formation, remaining activations and damage incurred in battle are not observed here.
const compact=value=>String(value||'').replace(/\s/g,'');
const attack=require('./attack_power'),nightPower=require('./night_cutin');
const tooltip=require('../../shared/mechanism_text');
const name=target=>compact(target?.master.api_name);
const matches=(target,names)=>names.split('|').some(n=>name(target)===compact(n));
const type=target=>Number(target?.master.api_stype);
const surface=target=>!target?false:!Number.isFinite(type(target))||type(target)<=0?null:![13,14].includes(type(target));
const battleship=target=>!target?false:!Number.isFinite(type(target))||type(target)<=0?null:[8,9,10].includes(type(target));
const submarine=target=>!target?false:!Number.isFinite(type(target))||type(target)<=0?null:[13,14].includes(type(target));
const FRENCH_RICHELIEU='Richelieu改|Richelieu Deux';
const frenchPartner=flag=>matches(flag,FRENCH_RICHELIEU)?'Jean Bart改':FRENCH_RICHELIEU;
const yamato=target=>matches(target,'大和改二|大和改二重');
const YAMATO_SOLO='武蔵改二|Iowa改|Bismarck drei|Richelieu改|Richelieu Deux|Jean Bart改';
const YAMATO_PAIRS=[
  ['長門改二','陸奥改二'],['伊勢改二','日向改二'],['扶桑改二','山城改二'],
  ['金剛改二丙','比叡改二丙|榛名改二乙|榛名改二丙|霧島改二丙'],['比叡改二丙','霧島改二丙'],
  ['Italia','Roma改'],['Warspite改','Nelson改|Valiant改'],['Nelson改','Rodney改'],
  ['Washington改','South Dakota改'],['Colorado改','Maryland改'],['Richelieu改|Richelieu Deux','Jean Bart改']
];
const KONGOU_PARTNERS={
  '金剛改二丙':'比叡改二丙|霧島改二丙|榛名改二|榛名改二乙|榛名改二丙|Warspite|Warspite改|Valiant|Valiant改',
  '比叡改二丙':'金剛改二丙|榛名改二乙|榛名改二丙|霧島改二|霧島改二丙',
  '榛名改二乙':'金剛改二丙|比叡改二丙|霧島改二丙',
  '榛名改二丙':'金剛改二丙|比叡改二丙|霧島改二丙',
  '霧島改二丙':'金剛改二丙|比叡改二丙|榛名改二乙|榛名改二丙|South Dakota改'
};
const yamatoTriple=(second,third)=>
  matches(second,'武蔵改二')&&matches(third,'長門改二|陸奥改二')||
  YAMATO_PAIRS.some(([a,b])=>matches(second,a)&&matches(third,b)||matches(second,b)&&matches(third,a));

// Per-ship equipment multipliers, checked 2026-10-16 against the Wiki
// SpecialAttack/isseisya/ColoTouch sections. No shared equipment multiplier.
function specialMultipliers(label,slots){
  const [flag,second,third]=slots;
  const gear=(target,{range=false,sg=false}={})=>{
    const items=target?.items||[],radar=items.some(e=>[12,13,93].includes(e.type)&&Number(e.master.api_saku)>=5);
    return (items.some(e=>e.type===19)?1.35:1)*(radar?1.15:1)*
      (radar&&range&&items.some(e=>/^15m二重測距儀(?:改)?[＋+]/.test(compact(e.master.api_name)))?1.1:1)*
      (radar&&sg&&items.some(e=>compact(e.master.api_name)==='SGレーダー(後期型)')?1.15:1);
  };
  let positions,hits,bases,references,formation=.75;
  if(/^(Nelson|Rodney) Touch$/.test(label)){
    positions=[0,2,4];hits=[1,1,1];formation=.8;
    const partner=name(flag).startsWith('Nelson')?'Rodney':'Nelson';
    const together=positions.slice(1).some(p=>name(slots[p]).replace(/改$/,'')===partner);
    bases=positions.map(p=>2*(together?(p===0?1.15:name(slots[p]).replace(/改$/,'')===partner?1.2:1):1));
    return {positions,hits,multipliers:bases,formation};
  }
  if(label==='大和三舰齐射'){
    positions=[0,1,2];hits=[1,1,1];
    bases=matches(second,'武蔵改二')?[1.65,1.8,1.65]:
      matches(second,'長門改二|陸奥改二')&&matches(third,'長門改二|陸奥改二')?[1.65,1.65,1.65]:
      matches(second,'伊勢改二|日向改二')&&matches(third,'伊勢改二|日向改二')?
        [1.65,1.575,1.65]:[1.5,1.5,1.65];
  }else if(label==='大和型齐射'||label==='大和双舰齐射'){
    positions=[0,1];hits=[2,1];bases=label==='大和型齐射'?[1.54,matches(second,'大和改二重')?1.9375:1.86]:[1.4,1.55];
  }else if(label==='长门型齐射'){
    positions=[0,1];hits=[2,1];bases=[1.4,1.2];
    const partner=matches(flag,'長門改二')?'陸奥':'長門';
    if(matches(second,partner+'改二'))bases=[1.68,1.68];
    else if(matches(flag,'長門改二')&&matches(second,'陸奥改'))bases=[1.61,1.62];
    else if(matches(flag,'長門改二')&&matches(second,'Nelson改'))bases=[1.54,1.5];
    else if(matches(flag,'陸奥改二')&&matches(second,'Nelson|Nelson改')){
      bases=[1.54,1.5];references=[true,true];
    }
  }else if(label==='Colorado级齐射'){
    positions=[0,1,2];hits=[1,1,1];
    const big7=t=>matches(t,'長門改|長門改二|陸奥改|陸奥改二|Nelson改|Colorado|Colorado改|Maryland|Maryland改');
    bases=[1.5,1.3*(big7(second)?1.15:1),1.3*(big7(third)?1.17:1)];
  }else if(label==='Queen Elizabeth级齐射'){
    positions=[0,1];hits=[2,1];bases=[matches(flag,'Warspite改')?1.24:1.2,1.24];
  }else if(label==='Richelieu级齐射'){
    positions=[0,1];hits=[2,1];formation=.8;
    // Deux uses Kai's same-position multiplier as a reference. Jean Bart's
    // confirmed lack of Richelieu's flagship-only 1.05 remains unchanged.
    bases=[matches(flag,FRENCH_RICHELIEU)?1.24*1.05:1.24,1.24];
    references=positions.map(p=>matches(slots[p],'Richelieu Deux'));
  }else if(label==='金刚型夜战突击'){
    positions=[0,1];hits=[1,1];formation=1;
    bases=positions.map(p=>{
      const names=(slots[p]?.items||[]).map(e=>compact(e.master.api_name));
      const a=names.filter(n=>['35.6cm連装砲改二','35.6cm連装砲改三(ダズル迷彩仕様)'].includes(n)).length;
      const b=names.filter(n=>['35.6cm連装砲改四','35.6cm連装砲改三丙'].includes(n)).length;
      // 2026-04-24 base powers; A-family coefficients use the Wiki references.
      return (p===0?2.6:2.7)*(a>=2?1.08:a?1.05:1)*(b>=2?1.15:b?1.11:1);
    });
    return {positions,hits,multipliers:bases,formation};
  }else return null;
  return {positions,hits,formation,references,multipliers:positions.map((p,i)=>bases[i]===null?null:bases[i]*gear(slots[p],{
    range:label.startsWith('大和')&&(label!=='大和三舰齐射'||p<2),sg:label==='Colorado级齐射'}))};
}
function specialAttackPower(label,slots,store){
  const spec=specialMultipliers(label,slots);if(!spec)return [];
  return spec.positions.flatMap((p,i)=>{
    const target=slots[p];if(!target)return [];
    const multiplier=spec.multipliers[i],day=attack.fireBase(target,store);
    const night=target.ship?nightPower.surfacePower(target,store):{basePower:null,fit:0};
    return [{id:target.id,position:p+1,name:target.master.api_name,hits:spec.hits[i],multiplier,
      day:label==='金刚型夜战突击'||multiplier===null?null:day.value===null?null:Math.floor(attack.cap((day.value+5)*spec.formation+day.fit,220)*multiplier),
      night:night.basePower===null||multiplier===null?null:attack.cap(night.basePower*multiplier+night.fit,360),
      ...spec.references?.[i]?{reference:true}:{}}];
  });
}

// AS commands; only SS(V) in positions 2/3 (or 2/4 when a third SS is present)
// fire. Damage is guidance, consistent with all other departure-only badges.
function submarineAttack(slots,store){
  const errors=[],unknown=[],flag=slots[0];
  const check=(value,message)=>{if(value===null)unknown.push(message);else if(!value)errors.push(message);};
  check(new Set(slots.filter(Boolean).map(t=>t.id)).size===slots.filter(Boolean).length,'舰娘不能重复编入');
  for(const p of [1,2])check(submarine(slots[p]),`第 ${p+1} 位需潜水舰／潜水空母`);
  const level=flag.ship?.api_lv;
  check(typeof level==='number'&&Number.isFinite(level)&&level>=1?level>=30:null,'旗舰等级需 ≥ 30');
  const fourth=submarine(slots[3]);
  if(fourth===null)unknown.push('第 4 位舰种不明，参与舰待确认');
  const positions=fourth===null?[]:fourth?[1,3]:[1,2],participants=positions.filter(p=>submarine(slots[p])===true)
    .map(p=>({id:slots[p].id,position:p+1,name:slots[p].master.api_name}));
  const raw=store?.info?.useitems?.[95]?.api_count;
  const supplies=typeof raw==='number'&&Number.isInteger(raw)&&raw>=0?raw:null;
  if(supplies===0)errors.push('缺少潜水舰补给物资');
  const attacks=store&&fourth!==null?positions.flatMap(p=>{
    const t=slots[p];if(submarine(t)!==true)return [];
    const level=t.ship?.api_lv,knownLevel=typeof level==='number'&&Number.isFinite(level)&&level>=1;
    const radar=(t.items||[]).some(e=>e.type===51),unknownGear=(t.items||[]).some(e=>!Number.isInteger(e.type)||e.type<=0);
    const hits=!knownLevel?'待确认':level<75?1:radar?2:unknownGear?'待确认':'1–2';
    const multiplier=knownLevel?1.2+.04*Math.sqrt(level):null;
    const fire=attack.firePanel(t,store),torpedo=attack.torpedoPanel(t,store);
    // This reference is panel based, independent of engagement and formation;
    // do not reuse shelling's +5, AP/radar damage multipliers or night CI.
    return [{id:t.id,position:p+1,name:t.master.api_name,hits,multiplier,
      day:multiplier===null||torpedo.value===null?null:Math.floor(torpedo.value*multiplier),
      night:multiplier===null||fire.value===null||torpedo.value===null?null:Math.floor((fire.value+torpedo.value)*multiplier)}];
  }):[];
  const state=errors.length?'blocked':unknown.length?'unknown':'conditional';
  const badge={key:'special-submarine',label:'潜水舰队攻击',state,participants,attacks,formation:'梯形阵／单横阵',
    detail:[...errors,...unknown,
      `持有物资：${supplies===null?'待确认':supplies+' 件'}；每节点消耗 1 件。`,
      '同一战斗昼／夜各 1 次；出击内可多次发动。',
      '旗舰需未大破；至少两艘潜艇需未中破。',
      fourth===null?'参与舰：待确认':fourth?'参与舰中破时由第 3 位替补。':''].filter(Boolean).join('\n')};
  badge.activation=specialActivationRate(badge,slots);
  return badge;
}

// Fixed, single-check rates. User-selected night reference equals the day rate,
// never the cumulative chance over multiple turns. Sources: docs/ui.md.
function specialActivationRate(badge,slots){
  const triple=badge.label==='大和三舰齐射';
  const tentative=['Colorado级齐射','潜水舰队攻击'].includes(badge.label);
  const reference=triple||tentative||['金刚型夜战突击','Richelieu级齐射'].includes(badge.label),context=reference?{reference:true,...tentative?{tentative:true}:{}}:{};
  if(badge.state==='blocked')return {...context,percent:0,phase:null,reason:badge.key==='special-submarine'?'编成或物资条件未满足':'编成条件未满足'};
  if(badge.state==='unknown')return {...context,percent:null,phase:null,reason:'编成资料不完整'};
  const {label}=badge,[flag,second]=slots;
  const missing=[];
  const root=(position,field)=>{
    const ship=slots[position]?.ship,value=field==='level'?ship?.api_lv:ship?.api_lucky?.[0];
    if(typeof value!=='number'||!Number.isFinite(value)||value<(field==='level'?1:0)){
      missing.push(`第 ${position+1} 位${field==='level'?'等级':'运'}`);return 0;
    }
    return Math.sqrt(value);
  };
  let percent,model,phase='day-night';
  if(/^(Nelson|Rodney) Touch$/.test(label)){
    // Divinity_123, 2024-08-04; only the flagship's luck contributes.
    // User confirmed on 2026-10-16 that Rodney shares Nelson's rate formula.
    percent=1.1*root(0,'level')+root(2,'level')+root(4,'level')+1.4*root(0,'luck')+25;
    model='nelson-202408';
  }else if(label==='Colorado级齐射'){
    // English Wiki's framework, fitted to the user's six unmodified-gear samples.
    // Simplified coefficients, not a verified game formula; see docs/ui.md.
    // SG Late: +5 points per participating ship, duplicates on one ship count once.
    const positions=[0,1,2];
    const sg=target=>(target.items||[]).some(e=>Number(e.master.api_id)===456||compact(e.master.api_name)==='SGレーダー(後期型)');
    for(const p of positions)if((slots[p].items||[]).some(e=>!Number(e.master.api_id)&&!compact(e.master.api_name))){
      missing.push(`第 ${p+1} 位装备资料`);
    }
    percent=Math.floor(.5*positions.reduce((sum,p)=>sum+root(p,'level'),0)+
      positions.reduce((sum,p)=>sum+root(p,'luck'),0)+30+5*positions.filter(p=>sg(slots[p])).length);
    model='colorado-csv-20261019-tentative';
  }else if(label==='潜水舰队攻击'){
    // Eight sheet records, four of them aggregated: a fitted reference only.
    // Normalize the 2/3 submarines to two equivalent ships; do not change the
    // actual 2/3 or 2/4 firing positions. Radar presence is once per submarine,
    // capped at +20 points. Both averaging and the cap are unverified hypotheses.
    const positions=submarine(slots[3])===true?[1,2,3]:[1,2];
    const equivalent=field=>root(0,field)+2*positions.reduce((sum,p)=>sum+root(p,field),0)/positions.length;
    const radars=positions.filter(p=>(slots[p].items||[]).some(e=>e.type===51)).length;
    if(radars<2)for(const p of positions){
      const items=slots[p].items||[];
      if(!items.some(e=>e.type===51)&&items.some(e=>!Number.isInteger(e.type)||e.type<=0))missing.push(`第 ${p+1} 位装备资料`);
    }
    percent=Math.floor(.25*(equivalent('level')+equivalent('luck'))+54+10*Math.min(2,radars));
    model='submarine-sheet-20261019-tentative';
  }else if(label==='长门型齐射'){
    // Current KC3 implementation cites Divinity_123, 2024-08-04, replacing
    // the older +30 / 1.2*sqrt(luck) approximation still present on the Wiki.
    percent=25+Math.floor(root(0,'level')+root(1,'level')+1.5*(root(0,'luck')+root(1,'luck')));
    model='nagato-202408';
  }else if(label==='大和型齐射'||label==='大和双舰齐射'||triple){
    // KC3 / Divinity_123, 2024-08-04: each qualifying radar contributes;
    // this differs from the per-ship damage multiplier in specialMultipliers.
    for(const p of [0,1])if((slots[p].items||[]).some(e=>!Number.isInteger(e.type)||e.type<=0||
      p===1&&[12,13,93].includes(e.type)&&(typeof e.master.api_houm!=='number'||!Number.isFinite(e.master.api_houm)))){
      missing.push(`第 ${p+1} 位装备资料`);
    }
    const radars=(flag.items||[]).filter(e=>[12,13].includes(e.type)).length;
    const accurate=(second.items||[]).filter(e=>[12,13,93].includes(e.type)&&Number(e.master.api_houm)>=8).length;
    const partner=matches(second,'武蔵改二')?7:yamato(second)?4:0;
    percent=33+Math.floor(root(0,'level')+root(1,'level')+1.25*(root(0,'luck')+root(1,'luck')))+10*(radars+accurate)+partner;
    // User-selected reference for the triple: use only the first two ships.
    // The third still participates in eligibility and her own attack power.
    model=triple?'yamato-triple-front-two-reference':'yamato-pair-202408';
  }else if(label==='Queen Elizabeth级齐射'){
    // CC_jabberwock, 2026-02-21: independent QE investigation supports this
    // reference formula and finds no established equipment-rate bonus.
    percent=root(0,'level')+root(1,'level')+1.2*(root(0,'luck')+root(1,'luck'))+30;
    model='qe-202602';
  }else if(label==='Richelieu级齐射'){
    // User-selected English Wiki French Touch reference, not a confirmed rate.
    // Only the two participants' current level/luck; no unverified gun bonus.
    percent=Math.floor(root(0,'level')+root(1,'level')+1.2*(root(0,'luck')+root(1,'luck'))+30);
    model='french-enwiki-reference';
  }else if(label==='金刚型夜战突击'){
    // User-selected reference: NGA 41784769, post 26 corrects the Haruna
    // coefficients in post 4. Gear presence uses flagship base stats only;
    // a searchlight's random in-battle effect is not a second rate bonus.
    phase='night';model='kongou-nga-41784769-post26';
    // Current Japanese Wiki's Kongou-class summary lists Kirishima +20/+20.
    const bonuses={金剛改二丙:[30,10],比叡改二丙:[10,30],榛名改二乙:[15,0],榛名改二丙:[20,0],霧島改二丙:[20,20]}[name(flag)];
    if(!bonuses)return {...context,percent:null,phase,model,reason:'该舰的发动率补正待确认'};
    const items=flag.items||[];
    const radar=items.some(e=>[12,13,93].includes(e.type)&&Number(e.master.api_saku)>=8);
    const light=items.some(e=>e.type===42);
    const unknownGear=items.some(e=>{
      if(!Number.isInteger(e.type)||e.type<=0)return !radar||bonuses[1]>0&&!light;
      return !radar&&[12,13,93].includes(e.type)&&(typeof e.master.api_saku!=='number'||!Number.isFinite(e.master.api_saku));
    });
    if(unknownGear){
      missing.push('第 1 位装备资料');
    }
    percent=Math.floor(3.5*(root(0,'level')+root(1,'level'))+1.1*(root(0,'luck')+root(1,'luck'))+
      (radar?bonuses[0]:0)+(light?bonuses[1]:0)-33);
  }else{
    return {percent:null,phase:null,formulaUnknown:true,reason:''};
  }
  const nightContext=phase==='day-night'?{nightAssumedSameAsDay:true}:{};
  if(missing.length)return {...context,...nightContext,percent:null,phase,model,reason:'缺少'+missing.join('、')};
  return {...context,...nightContext,percent:Math.max(0,Math.min(100,percent)),phase,model,reason:''};
}
function specialRateText(activation,formation){
  if(!activation)return `要求阵型：${formation}`;
  const value=activation.percent===null?(activation.formulaUnknown?'未知':'待确认'):activation.percent.toFixed(1)+'%';
  return `${activation.reference?'参考发动率':'发动率'}：${value}`+
    (activation.tentative&&activation.percent!==null&&!activation.reason?'（待验证）':'')+
    `\n要求阵型：${formation}`+
    (activation.reason&&!['编成条件未满足','编成或物资条件未满足','编成资料不完整'].includes(activation.reason)?'\n'+activation.reason:'');
}
function fleetSpecialAttacks(targets,entries,{store}={}){
  const output=new Map(),byId=new Map(targets.map(t=>[t.id,t]));
  // Keep holes: the third card must never silently become the second ship.
  const slots=(entries||[]).map(e=>e?byId.get(e.id):null);
  if(slots.length>6||!slots[0])return output;
  const [flag,second,third]=slots,candidates=[];
  if(type(flag)===20){
    // Consumable-based attacks are displayed, never promoted by ordinary
    // candidate ranking without inventory observations or a spending policy.
    if(!store)return output;
    const badge=submarineAttack(slots,store),powerText=specialPowerText(badge.attacks);
    badge.detail=tooltip(specialRateText(badge.activation,badge.formation),powerText,badge.detail);
    output.set(flag.id,badge);return output;
  }
  const evaluate=({label,positions,damage,formation='梯形阵',minimum=6,night=false,composition=true,requirement=''})=>{
    const errors=[],unknown=[];
    const check=(value,message)=>{if(value===null)unknown.push(message);else if(!value)errors.push(message);};
    const surfaces=slots.map(surface),count=surfaces.filter(s=>s===true).length;
    check(count>=minimum?true:count+surfaces.filter(s=>s===null).length>=minimum?null:false,`需至少 ${minimum} 艘水上舰`);
    check(new Set(slots.filter(Boolean).map(t=>t.id)).size===slots.filter(Boolean).length,'舰娘不能重复编入');
    check(composition,requirement);
    // User chooses to check the departure composition only. Damage limits are
    // tooltip guidance, never a blocker (including missing HP observations).
    const damageHint=[.5,.25].flatMap(limit=>{
      const positions=damage.filter(([,value])=>value===limit).map(([p])=>p+1);
      return positions.length?[`第 ${positions.join('、')} 位需${limit===.5?'未中破':'未大破'}`]:[];
    }).join('；');
    const state=errors.length?'blocked':unknown.length?'unknown':'conditional';
    const participants=positions.filter(p=>slots[p]).map(p=>({id:slots[p].id,position:p+1,name:slots[p].master.api_name}));
    const context=`每次出击${night?'最多 3 次':' 1 次'}；${damageHint}。`;
    const detail=[...errors,...unknown.map(s=>'待确认：'+s),context].filter(Boolean).join('\n');
    candidates.push({key:night?'special-night':'special-shelling',label,state,detail,participants,composition,formation});
  };
  if(yamato(flag)){
    if(yamatoTriple(second,third))evaluate({label:'大和三舰齐射',positions:[0,1,2],damage:[[0,.5],[1,.5],[2,.5]]});
    if(matches(second,YAMATO_SOLO))evaluate({label:matches(second,'武蔵改二')?'大和型齐射':'大和双舰齐射',positions:[0,1],damage:[[0,.5],[1,.5]]});
    if(!candidates.length)evaluate({label:'大和特殊炮击',positions:[0],damage:[[0,.5]],composition:false,
      requirement:'第 2 位需指定战舰（如武藏改二、Iowa改），或第 2、3 位组成指定战舰组合'});
  }else if(matches(flag,'武蔵改二')){
    evaluate({label:'大和型齐射',positions:[0,1],damage:[[0,.5],[1,.5]],composition:yamato(second),requirement:'第 2 位需大和改二／改二重'});
  }else if(matches(flag,'長門改二|陸奥改二')){
    evaluate({label:'长门型齐射',positions:[0,1],damage:[[0,.5],[1,.25]],composition:battleship(second),requirement:'第 2 位需战舰／航战'});
  }else if(matches(flag,'Nelson|Nelson改|Rodney|Rodney改')){
    const allowed=p=>!slots[p]?false:surface(slots[p])===null?null:surface(slots[p])&&![7,11,18].includes(type(slots[p]));
    const checks=[allowed(2),allowed(4)];
    evaluate({label:matches(flag,'Nelson|Nelson改')?'Nelson Touch':'Rodney Touch',positions:[0,2,4],damage:[[0,.5]],formation:'复纵阵',
      composition:checks.includes(false)?false:checks.includes(null)?null:true,requirement:'第 3、5 位需非空母的水上舰'});
  }else if(matches(flag,'Colorado|Colorado改|Maryland|Maryland改')){
    const checks=[battleship(second),battleship(third)];
    evaluate({label:'Colorado级齐射',positions:[0,1,2],damage:[[0,.5],[1,.25],[2,.25]],
      composition:checks.includes(false)?false:checks.includes(null)?null:true,requirement:'第 2、3 位需战舰／航战'});
  }else if(matches(flag,'Warspite改|Valiant改')){
    evaluate({label:'Queen Elizabeth级齐射',positions:[0,1],damage:[[0,.5],[1,.25]],
      composition:matches(second,name(flag)==='Warspite改'?'Valiant改':'Warspite改'),requirement:'第 1、2 位需 Warspite改与 Valiant改'});
  }else if(matches(flag,FRENCH_RICHELIEU+'|Jean Bart改')){
    evaluate({label:'Richelieu级齐射',positions:[0,1],damage:[[0,.5],[1,.25]],formation:'复纵阵',
      composition:matches(second,frenchPartner(flag)),requirement:'第 1、2 位需 Richelieu改／Deux与Jean Bart改'});
  }else if(KONGOU_PARTNERS[name(flag)]){
    evaluate({label:'金刚型夜战突击',positions:[0,1],damage:[[0,.25],[1,.25]],minimum:5,night:true,formation:'单纵阵／梯形阵',
      composition:matches(second,KONGOU_PARTNERS[name(flag)]),requirement:'第 2 位需 '+KONGOU_PARTNERS[name(flag)].split('|').join('／')});
  }
  // Prefer a matching three-ship combination, then the matching two-ship one.
  const order={conditional:0,unknown:1,blocked:2};
  candidates.sort((a,b)=>order[a.state]-order[b.state]);
  const best=candidates[0];if(!best)return output;
  const {composition,...badge}=best;
  // Ranking only needs eligibility; power and rate are UI-draft calculations.
  let attacks=store&&composition===true?specialAttackPower(badge.label,slots,store):[];
  if(store&&composition===true&&!attacks.length)attacks=badge.participants.map(p=>({...p,hits:p.position===1?2:1,day:null,night:null}));
  const powerText=specialPowerText(attacks,{nightOnly:badge.key==='special-night'});
  const activation=store?specialActivationRate(badge,slots):null;
  const rateText=specialRateText(activation,badge.formation);
  output.set(flag.id,{...badge,...store?{attacks,activation}:{},detail:tooltip(rateText,powerText,best.detail)});
  return output;
}

function specialPowerText(attacks,{nightOnly=false}={}){
  return attacks.map(r=>`第 ${r.position} 位 ${r.name}\n`+
    (nightOnly?'':`昼战${r.reference?'参考':''}攻击力：${r.day??'待确认'} × ${r.hits}击\n`)+
    `夜战${r.reference?'参考':''}攻击力：${r.night??'待确认'} × ${r.hits}击`+(r.reason?'\n'+r.reason:'')).join('\n\n');
}

// A small set of owned cores for the ordinary fleet search. Keep exact remodel
// names shared with the display validator; this is not another eligibility rule.
function specialAttackCores(roster,{night=true}={}){
  const ranked=roster.slice().sort((a,b)=>(b.power||0)-(a.power||0)||a.id-b.id);
  const pick=names=>ranked.find(row=>matches(row,names));
  const output=[],seen=new Set();
  const add=(...rows)=>{
    if(rows.some(r=>!r)||new Set(rows.map(r=>r.id)).size!==rows.length)return;
    const key=rows.map(r=>r.id).join(',');if(seen.has(key))return;seen.add(key);output.push(rows);
  };
  for(const names of ['Nelson|Nelson改','Rodney|Rodney改'])add(pick(names));
  const y=pick('大和改二|大和改二重'),m=pick('武蔵改二');
  for(const names of YAMATO_SOLO.split('|'))add(y,pick(names));
  add(m,y);
  for(const [a,b] of YAMATO_PAIRS)add(y,pick(a),pick(b));
  add(y,m,pick('長門改二|陸奥改二'));
  for(const names of ['長門改二','陸奥改二']){
    const flag=pick(names);
    for(const other of ranked.filter(r=>battleship(r)&&r!==flag).slice(0,2))add(flag,other);
  }
  for(const names of ['Colorado|Colorado改','Maryland|Maryland改']){
    const flag=pick(names),others=ranked.filter(r=>battleship(r)&&r!==flag);
    add(flag,others[0],others[1]);
  }
  add(pick('Warspite改'),pick('Valiant改'));add(pick('Valiant改'),pick('Warspite改'));
  add(pick(FRENCH_RICHELIEU),pick('Jean Bart改'));add(pick('Jean Bart改'),pick(FRENCH_RICHELIEU));
  if(night)for(const [flag,partners] of Object.entries(KONGOU_PARTNERS)){
    for(const other of ranked.filter(r=>matches(r,partners)).slice(0,2))add(pick(flag),other);
  }
  return output;
}

// Place only free ships. Locked positions include manually selected hulls and
// equipment holds, even when their placement prevents a special attack.
function arrangeSpecialAttack(rows,core,{locked=new Map(),power=row=>row.power||0}={}){
  const slots=Array(rows.length).fill(null),byId=new Map(rows.map(r=>[r.id,r]));
  const place=(position,row)=>{
    if(!row||position>=slots.length||!byId.has(row.id)||slots[position]&&slots[position].id!==row.id)return false;
    if(slots.some((r,i)=>r?.id===row.id&&i!==position))return false;
    slots[position]=row;return true;
  };
  for(const [position,id] of locked)if(!place(position,byId.get(id)))return null;
  for(let i=0;i<core.length;i++)if(!place(i,core[i]))return null;
  if(matches(core[0],'Nelson|Nelson改|Rodney|Rodney改')){
    const allowed=row=>surface(row)===true&&![7,11,18].includes(type(row));
    for(const position of [2,4]){
      if(slots[position]){if(!allowed(slots[position]))return null;continue;}
      const next=rows.filter(r=>allowed(r)&&!slots.some(s=>s?.id===r.id))
        .sort((a,b)=>power(b)-power(a)||a.id-b.id)[0];
      if(!place(position,next))return null;
    }
  }
  const rest=rows.filter(r=>!slots.some(s=>s?.id===r.id));
  for(let i=0;i<slots.length;i++)if(!slots[i])slots[i]=rest.shift();
  const attack=fleetSpecialAttacks(slots,slots).get(slots[0]?.id);
  return attack?.state==='conditional'?slots:null;
}

module.exports={fleetSpecialAttacks,specialAttackCores,arrangeSpecialAttack};
