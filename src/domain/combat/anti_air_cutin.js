'use strict';
// https://wikiwiki.jp/kancolle/対空砲火/対空カットイン一覧表
// Checked 2026-10-15. Fixed-shot multiplier and guaranteed-shot addition;
// eligible recipes are alternatives, never multiplied or added together.
const bonuses={1:[7,1.7],2:[6,1.7],3:[4,1.6],4:[6,1.5],5:[4,1.5],6:[4,1.45],7:[3,1.35],8:[4,1.4],9:[2,1.3],10:[8,1.65],11:[6,1.5],12:[3,1.25],13:[4,1.35],14:[4,1.45],15:[3,1.3],16:[4,1.4],17:[2,1.25],18:[2,1.2],19:[5,1.45],20:[3,1.25],21:[5,1.45],22:[2,1.2],23:[1,1.05],24:[3,1.25],25:[7,1.55],26:[6,1.4],27:[5,1.55],28:[4,1.4],29:[5,1.55],30:[3,1.3],31:[2,1.25],32:[3,1.2],33:[3,1.35],34:[7,1.6],35:[6,1.55],36:[6,1.55],37:[4,1.45],38:[10,1.85],39:[10,1.7],40:[10,1.7],41:[9,1.65],42:[10,1.65],43:[8,1.6],44:[6,1.6],45:[5,1.55],46:[8,1.55],47:[2,1.3],48:[8,1.75],49:[5,1.5],50:[7,1.5],51:[5,1.35],52:[4,1.4]};
const compact=s=>String(s||'').replace(/\s/g,'').replace(/＋/g,'+');
// Reference rolls and priority from the simulator's numerical data, checked
// 2026-10-20, commit 8ec02047a963f6d92cce40f4143848dee0151b33:
// https://github.com/noro6/kc-web/blob/8ec02047a963f6d92cce40f4143848dee0151b33/src/classes/constants/battle.ts
// antiAirCutInRules.ts uses rate / 101. Since 2023-05 each recipe rolls
// independently, including recipes on the same ship; only one wins per battle.
const rolls=[0,65,55,50,52,50,40,45,50,40,60,55,45,35,63,54,62,57,59,60,65,60,65,80,62,60,60,55,56,60,50,50,60,42,56,55,50,44,60,60,60,60,65,60,55,50,50,70,65,50,50,50,50,60];
const priorities=[38,39,40,42,41,10,43,46,11,25,48,1,34,44,26,4,2,35,36,27,45,50,49,51,52,19,21,29,53,16,14,3,5,6,28,37,33,30,8,13,15,7,20,24,32,12,31,47,17,18,22,9,23];
const pct=n=>(n*100).toFixed(1)+'%';
const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const first=v=>number(Array.isArray(v)?v[0]:v);
function antiAirCutins(target){
  const name=compact(target.master.api_name),items=target.items;
  const named=(s,list)=>list.split('|').some(n=>compact(s)===compact(n));
  const count=fn=>items.filter(fn).length,has=fn=>items.some(fn);
  const eq=names=>count(e=>named(e.master?.api_name,names));
  const high=e=>Number(e.master?.api_type?.[3])===16,aa=e=>Number(e.master?.api_tyku||0);
  const gun=count(high),special=count(e=>high(e)&&aa(e)>=8);
  const radar=has(e=>[12,13,93].includes(e.type)),airRadar=has(e=>[12,13,93].includes(e.type)&&aa(e)>0);
  const radar4=has(e=>[12,13,93].includes(e.type)&&aa(e)>=4);
  const mg=count(e=>e.type===21),mg3=count(e=>e.type===21&&aa(e)>=3),mg6=count(e=>e.type===21&&aa(e)>=6);
  const specialMG=has(e=>e.type===21&&aa(e)>=9),director=has(e=>e.type===36);
  const akizuki=Number(target.master.api_ctype)===54||/^(秋月|照月|初月|涼月|冬月|若月|新月)/.test(name);
  const fletcher=Number(target.master.api_ctype)===91||/^(Fletcher|Johnston|HeywoodL\.E\.|RichardP\.Leary)/.test(name);
  const guard=name==='吹雪改三護(六式)',matches=[];
  const add=(condition,id,recipe)=>{if(condition){const b=bonuses[id];matches.push({id,recipe,fixed:b?.[0]??null,multiplier:b?.[1]??null});}};
  add(akizuki&&gun>=2&&radar,1,'秋月型·双高角炮＋电探');
  add((akizuki||guard)&&special&&airRadar,2,'特殊高角炮＋对空电探');
  add(akizuki&&gun>=2,3,'秋月型·双高角炮');
  add((akizuki&&/改/.test(name)||guard)&&eq('10cm連装高角砲改＋高射装置改')>=2&&radar4,48,'改高角炮＋高射装置改×2＋电探');
  const maya=named(name,'摩耶改二|飛龍改三');
  add((maya||name==='北上改三')&&gun&&specialMG&&airRadar,10,'高角炮＋特殊机枪＋电探');
  add(maya&&gun&&specialMG,11,'高角炮＋特殊机枪');
  add(named(name,'五十鈴改二|北上改三')&&gun&&mg&&airRadar,14,'高角炮＋机枪＋电探');
  add(named(name,'五十鈴改二|吹雪改三')&&gun&&mg,15,'高角炮＋机枪');
  add(named(name,'霞改二乙|夕張改二|吹雪改三')&&gun&&mg&&airRadar,16,'高角炮＋机枪＋电探');
  add(named(name,'霞改二乙|稲木改二')&&gun&&mg,17,'高角炮＋机枪');
  add(named(name,'皐月改二|稲木改二')&&specialMG,18,'特殊机枪');
  add(name==='鬼怒改二'&&has(e=>high(e)&&aa(e)<=7)&&specialMG,19,'普通高角炮＋特殊机枪');
  add(name==='鬼怒改二'&&specialMG,20,'特殊机枪');
  add(named(name,'由良改二|吹雪改三|吹雪改三護(六式)|北上改三')&&gun&&airRadar,21,'高角炮＋电探');
  add(name==='文月改二'&&specialMG,22,'特殊机枪');
  add(named(name,'UIT-25|伊504')&&has(e=>e.type===21&&aa(e)>=3&&aa(e)<=8),23,'潜水舰机枪');
  add(named(name,'天龍改二|龍田改二|吹雪改三')&&gun&&has(e=>e.type===21&&aa(e)>=3&&aa(e)<=8),24,'高角炮＋普通机枪');
  const rocket=eq('12cm30連装噴進砲改二'),shell=has(e=>e.type===18),ise=named(name,'伊勢改|伊勢改二|日向改|日向改二');
  add(ise&&rocket&&airRadar&&shell,25,'喷进炮＋电探＋三式弹');
  add((ise||named(name,'武蔵改|武蔵改二'))&&rocket&&airRadar,28,'喷进炮＋电探');
  const yamato=named(name,'大和改二|大和改二重|武蔵改二');
  add(yamato&&eq('10cm連装高角砲改＋増設機銃')&&airRadar,26,'改高角炮＋增设机枪＋电探');
  add(named(name,'大淀改|飛龍改三')&&eq('10cm連装高角砲(砲架)|8cm高角砲改＋増設機銃|10cm連装高角砲改＋増設機銃')&&rocket&&airRadar,27,'高角炮＋喷进炮＋电探');
  add(named(name,'磯風乙改|浜風乙改')&&gun&&airRadar,29,'高角炮＋电探');
  add(named(name,'天龍改二|Gotland改|Gotlandandra')&&gun>=3,30,'三高角炮');
  add(named(name,'天龍改二|稲木改二')&&gun>=2,31,'双高角炮');
  const british=/^(Warspite|Valiant|Nelson|Rodney|Jervis|Janus|Javelin|ArkRoyal|Victorious|Sheffield|Glorious)/.test(name),kongo=/^(金剛|比叡|榛名|霧島)改二/.test(name);
  const pom=eq('QF2ポンド8連装ポンポン砲'),up=eq('20連装7inchUPRocketLaunchers');
  add((british||kongo)&&(up>=2||up&&pom||[8,9,10].includes(Number(target.master.api_stype))&&eq('16inchMk.I三連装砲改＋FCRtype284')&&pom),32,'英国装备组合');
  add(named(name,'Gotland改|Gotlandandra')&&gun&&has(e=>e.type===21&&aa(e)>=4),33,'高角炮＋机枪');
  const usGF=eq('5inch単装砲Mk.30改＋GFCSMk.37'),us=eq('5inch単装砲Mk.30|5inch単装砲Mk.30改');
  add((fletcher||guard)&&usGF>=2,34,'GFCS Mk.30×2');add((fletcher||guard)&&usGF&&us,35,'GFCS Mk.30＋Mk.30');
  add((fletcher||guard)&&us>=2&&eq('GFCSMk.37'),36,'Mk.30×2＋GFCS');add(fletcher&&eq('5inch単装砲Mk.30改')>=2,37,'Mk.30改×2');
  const atGF=eq('GFCSMk.37＋5inch連装両用砲(集中配備)'),at=eq('5inch連装両用砲(集中配備)');
  if(Number(target.master.api_ctype)===99||/^Atlanta/.test(name)){
    add(atGF>=2,38,'GFCS 集中炮×2');add(atGF&&at,39,'GFCS 集中炮＋集中炮');
    add(atGF+at>=2&&eq('GFCSMk.37'),40,'集中炮×2＋GFCS');add(atGF+at>=2,41,'集中炮×2');
  }
  const yamatoGun=eq('10cm連装高角砲群集中配備'),yamatoRadar=eq('15m二重測距儀＋21号電探改二|15m二重測距儀改＋21号電探改二＋熟練射撃指揮所');
  add(yamato&&yamatoGun>=2&&yamatoRadar&&mg6,42,'集中高角炮×2＋测距仪＋机枪');add(yamato&&yamatoGun>=2&&yamatoRadar,43,'集中高角炮×2＋测距仪');
  add(yamato&&yamatoGun&&yamatoRadar&&mg6,44,'集中高角炮＋测距仪＋机枪');add(yamato&&yamatoGun&&yamatoRadar,45,'集中高角炮＋测距仪');
  add(name==='榛名改二乙'&&eq('35.6cm連装砲改四|35.6cm連装砲改三(ダズル迷彩仕様)')&&specialMG&&airRadar,46,'榛名专用炮＋特殊机枪＋电探');
  const c=eq('12.7cm連装砲C型改三H');add(named(name,'白露改二|時雨改二|時雨改三|村雨改二|春雨改二')&&c&&(c>=2||eq('25mm対空機銃増備')||radar4),47,'C型改三H组合');
  const dd=/^(吹雪改二|吹雪改三(?:護\(六式\))?|白雪改二|初雪改二|藤波改二|浜波改二|早波改二|玉波改二|涼波改二(?:補)?)$/.test(name);
  const newGun=eq('10cm連装高角砲改|10cm連装高角砲改＋高射装置改');
  add((dd||name==='北上改三')&&special>=2&&radar4,49,'特殊高角炮×2＋电探');
  add((dd||akizuki)&&newGun>=2&&radar4&&eq('94式高射装置'),50,'改高角炮×2＋电探＋高射装置');
  add(dd&&newGun&&radar4&&has(e=>e.type===21&&aa(e)>=5),51,'改高角炮＋电探＋机枪');
  add(dd&&newGun>=2&&eq('94式高射装置'),52,'改高角炮×2＋高射装置');
  add(named(name,'飛龍改三|北上改三')&&has(e=>high(e)&&aa(e)>=9)&&radar4,53,'新专用组合（倍率待确认）');
  add(!akizuki&&special>=2&&airRadar,5,'特殊高角炮×2＋电探');add(!akizuki&&special&&airRadar,8,'特殊高角炮＋电探');
  add(!akizuki&&gun&&director&&airRadar,7,'高角炮＋高射装置＋电探');add(gun&&director,9,'高角炮＋高射装置');
  add(specialMG&&mg3>=2&&airRadar,12,'特殊机枪＋机枪＋电探');add(name!=='摩耶改二'&&special&&specialMG&&airRadar,13,'特殊高角炮＋特殊机枪＋电探');
  const bb=[8,9,10].includes(Number(target.master.api_stype))&&has(e=>[3,38].includes(e.type))&&shell&&director;
  add(bb&&airRadar,4,'主炮＋三式弹＋高射装置＋电探');add(bb,6,'主炮＋三式弹＋高射装置');
  return matches.sort((a,b)=>(b.fixed??0)-(a.fixed??0)||(b.multiplier??0)-(a.multiplier??0)||a.id-b.id);
}
function fleetAntiAir(targets,cutinsFor=antiAirCutins){
  const ships=new Map(targets.map(t=>[t.id,{cutins:cutinsFor(t),rate:0}]));
  const rows=targets.flatMap((t,position)=>ships.get(t.id).cutins.map(c=>({...c,shipId:t.id,position,
    roll:rolls[c.id]===undefined?null:rolls[c.id]/101})));
  const known=rows.every(c=>c.roll!==null&&priorities.includes(c.id));
  rows.sort((a,b)=>priorities.indexOf(a.id)-priorities.indexOf(b.id)||a.position-b.position);
  let remaining=1;
  for(const row of rows){
    row.rate=known?remaining*row.roll:null;
    if(known){remaining-=row.rate;ships.get(row.shipId).rate+=row.rate;}
  }
  return {known,total:known?1-remaining:null,ships,rows,active:targets.filter(t=>ships.get(t.id).cutins.length).length};
}
function antiAirBadge(target,context=fleetAntiAir([target])){
  const rates=new Map(context.rows.filter(c=>c.shipId===target.id).map(c=>[c.id,c.rate]));
  const cutins=(context.ships.get(target.id)?.cutins||[]).map(c=>({...c,rate:context.known?rates.get(c.id)??null:null}));
  if(!cutins.length)return null;
  const rate=context.known?context.ships.get(target.id)?.rate:null;
  const lines=cutins.map(c=>`${c.id}型：${c.rate===null?'待确认':pct(c.rate)}，${c.multiplier===null?'击落加成待确认':`固定击坠×${c.multiplier}，保底+${c.fixed}机`}`);
  return {key:'aaci',label:'对空特攻',state:cutins.some(c=>c.multiplier!==null)?'ready':'unknown',cutins,
    rate:rate??null,fleetRate:context.total,
    detail:require('../../shared/mechanism_text')([`参考发动率：${rate==null?'待确认':pct(rate)}${context.active>1?'（本舰）':''}`,
      context.active>1?`全队参考发动率：${context.total==null?'待确认':pct(context.total)}`:''],lines,'提升全队击落，每战择一。')};
}

// https://wikiwiki.jp/kancolle/対空砲火#AntiAircraft
// https://wikiwiki.jp/kancolle/12cm30連装噴進砲改二#SpecialAttack-2
// Reference, not a guaranteed immunity. Blue AA contributes at 0.75 weight.
function weightedAntiAir(store,target){
  const {combatBonuses}=require('./equipment_bonuses'),blue=combatBonuses(store,target);
  const initial=first(target.master.api_tyku),modern=number(target.ship.api_kyouka?.[2]);
  let hull=initial!==null&&modern!==null?initial+modern:null;
  if(hull===null){
    const panel=first(target.ship.api_taiku),before=target.before;
    const ids=before?(before.slots||[]).concat(before.ex).filter(id=>id>0):null;
    const worn=ids?.map(id=>{const instance=store?.info?.equips?.[id],master=store?.const?.$equips?.[instance?.api_slotitem_id];
      return {id,instance,master,type:Number(master?.api_type?.[2])};});
    if(panel!==null&&worn?.every(e=>e.master)){
      const old=combatBonuses(store,{...target,items:worn});
      if(old.known)hull=panel-worn.reduce((sum,e)=>sum+Number(e.master.api_tyku||0),0)-old.antiAir;
    }
  }
  if(hull===null||hull<0||!blue.known)return null;
  let weighted=hull+.75*blue.antiAir;
  for(const e of target.items){
    if(!e.master)return null;
    const aa=number(e.master.api_tyku??0),star=number(e.instance?.api_level);
    if(aa===null||aa<0||star===null||star<0)return null;
    const high=Number(e.master.api_type?.[3])===16;
    const factor=e.type===21?6:high||e.type===36?4:[12,13,93].includes(e.type)?3:0;
    const improvement=e.type===21?(aa>=8?6:4):high?(aa>=8?3:2):e.type===36?2:0;
    weighted+=factor*aa+improvement*Math.sqrt(star);
  }
  const step=target.items.length?2:1;return step*Math.floor(weighted/step);
}
function rocketBarrage(target,store){
  if(![6,7,10,11,16,18].includes(Number(target.master.api_stype)))return null;
  const count=target.items.filter(e=>compact(e.master?.api_name)==='12cm30連装噴進砲改二').length;
  if(!count)return null;
  const weighted=weightedAntiAir(store,target),luck=first(target.ship.api_lucky);
  const ise=Number(target.master.api_ctype)===2||/^(伊勢|日向)/.test(target.master.api_name||'');
  // 2 launchers: +15 points; 3 or more: reference +30 points, not unbounded.
  const rate=weighted===null||luck===null||luck<0?null:Math.max(0,Math.min(1,(weighted+.9*luck)/281+
    (count>=3?.3:count===2?.15:0)+(ise?.25:0)));
  return {key:'barrage',label:'对空喷进弹幕',state:'ready',rate,weightedAntiAir:weighted,
    detail:require('../../shared/mechanism_text')(`参考发动率：${rate===null?'待确认':pct(rate)}`,'免疫本舰航空攻击，不保护其他舰。')};
}
module.exports={antiAirBadge,antiAirCutins,fleetAntiAir,rocketBarrage,weightedAntiAir};
