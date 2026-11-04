'use strict';

// Day shelling fit is a ship/loadout modifier, not an equipment panel stat.
// Known large-gun groups and coefficients follow the community measurements:
// https://wikiwiki.jp/kancolle/命中と回避について#BBfit
// Missing combinations use a separately marked estimate, never a verified fit.
const normalize=name=>String(name||'').normalize('NFKC').replace(/\s/g,'');
const names={
  '35.6':['35.6cm連装砲','試製35.6cm三連装砲','35.6cm連装砲(ダズル迷彩)','35.6cm三連装砲改(ダズル迷彩仕様)','35.6cm連装砲改','35.6cm連装砲改二','35.6cm連装砲改三(ダズル迷彩仕様)','35.6cm連装砲改四','35.6cm連装砲改三丙','38cm連装砲','38cm連装砲改'],
  '381':['381mm/50 三連装砲','381mm/50 三連装砲改'],
  '41':['41cm連装砲','試製41cm三連装砲','41cm三連装砲改','41cm三連装砲改二','41cm連装砲改二','16inch Mk.I三連装砲','16inch Mk.I三連装砲+AFCT改','16inch Mk.I三連装砲改+FCR type284','16inch Mk.I連装砲','16inch Mk.V連装砲','16inch Mk.VIII連装砲改','16inch三連装砲 Mk.6','16inch三連装砲 Mk.6 mod.2','16inch三連装砲 Mk.6+GFCS'],
  'mk7':['16inch三連装砲 Mk.7','16inch三連装砲 Mk.7+GFCS'],
  '46proto':['試製46cm連装砲'],'46':['46cm三連装砲'],'46kai':['46cm三連装砲改'],
  '51':['試製51cm連装砲','51cm連装砲','試製51cm三連装砲']
};
const groups=new Map(Object.entries(names).flatMap(([group,list])=>list.map(name=>[normalize(name),group])));
const stock41=normalize('41cm連装砲');
const mediumNames={
 A:['14cm単装砲','14cm連装砲','14cm連装砲改','14cm連装砲改二'],
 B:['15.2cm連装砲','15.2cm連装砲改','15.2cm連装砲改二','Bofors15.2cm連装砲 Model1930','Bofors 15cm連装速射砲 Mk.9 Model 1938','Bofors 15cm連装速射砲 Mk.9改+単装速射砲 Mk.10改 Model 1938','6inch 連装速射砲 Mk.XXI'],
 C:['15.5cm三連装砲','15.5cm三連装砲改'],
 D:['6inch三連装速射砲 Mk.16','6inch三連装速射砲 Mk.16 mod.2','6inch Mk.XXIII三連装砲','152mm/55 三連装速射砲','152mm/55 三連装速射砲改'],
 E:['5inch連装両用砲(集中配備)','GFCS Mk.37+5inch連装両用砲(集中配備)'],
 F:['20.3cm連装砲','20.3cm(2号)連装砲','20.3cm(3号)連装砲','試製20.3cm(4号)連装砲','SKC34 20.3cm連装砲','203mm/53 連装砲','18cm/57 三連装主砲'],
 G:['8inch三連装砲 Mk.9','8inch三連装砲 Mk.9 mod.2']
};
const mediumGroups=new Map(Object.entries(mediumNames).flatMap(([group,list])=>list.map(name=>[normalize(name),group])));
function mediumFit(master,ship,items){
  const type=Number(master.api_stype),guns=items.filter(item=>Number(item.api_type?.[2])===2);
  if(!guns.length)return {known:true,value:0,applicable:false};
  const who=normalize(master.api_name),ctype=Number(master.api_ctype);
  if([5,6].includes(type)){
    const japanese=new Set(['20.3cm連装砲','20.3cm(2号)連装砲','20.3cm(3号)連装砲','試製20.3cm(4号)連装砲'].map(normalize));
    if(guns.every(g=>japanese.has(normalize(g.api_name))))return {known:true,value:0,applicable:true};
    if((ctype===9||/^(最上|三隈|鈴谷|熊野)/.test(who))&&guns.every(g=>mediumGroups.get(normalize(g.api_name))==='C'))
      return {known:true,value:guns.length*(who.includes('改二')?5:2),applicable:true,estimated:true,reason:'按最上级同改造阶段的昼战实测推定'};
    return {known:false,value:null,applicable:true,reason:'该重巡主炮组合的昼战适重尚未确认'};
  }
  if(![3,4,16,21,22].includes(type)||type===22&&!/^神威改母/.test(who))return {known:false,value:null,applicable:true,reason:'该舰种的中口径炮适重尚未确认'};
  // The 2025 measurements cover the original French triple, not its Kai
  // variant, married ships, mixed guns or three-gun loadouts.
  if([3,4].includes(type)&&guns.every(g=>normalize(g.api_name)===normalize('15.2cm三連装主砲'))){
    const level=Number(ship.api_lv),standard=/^(天龍|龍田|球磨|多摩|北上|大井|木曾|長良|五十鈴|名取|由良|鬼怒|阿武隈|川内|神通|那珂|夕張|L\.d\.S\.D\.d\.Abruzzi|G\.Garibaldi|Helena|Sheffield|Gotland|DeRuyter|Perth)/i.test(who);
    if(level>0&&level<=99&&guns.length<=2&&(standard||/^Gloire/i.test(who))){
      const direct=/^Gloire/i.test(who);
      return {known:true,value:(direct?-1:-3)*guns.length,applicable:true,estimated:!direct,reason:direct?'':'15.2cm三连装主炮采用标准轻巡数据'};
    }
    return {known:false,value:null,applicable:true,reason:'15.2cm三连装主炮在该舰或该组合下尚无充分实测'};
  }
  const group=guns.map(gun=>mediumGroups.get(normalize(gun.api_name)));
  if(group.some(g=>!g))return {known:false,value:null,applicable:true,reason:'部分中口径炮的适重分类尚未确认'};
  const level=Number(ship.api_lv);if(!Number.isFinite(level)||level<1)return {known:false,value:null,applicable:true,reason:'缺少舰娘等级'};
  const married=level>99,same=group.length===2&&group[0]===group[1];
  if(type===16||type===22){
    // This rule only covers the measured Japanese 14/15.2 and 20.3 families;
    // other guns can share CL group names without sharing AV measurements.
    const light=new Set(['14cm単装砲','14cm連装砲','14cm連装砲改','14cm連装砲改二','15.2cm連装砲','15.2cm連装砲改','15.2cm連装砲改二'].map(normalize));
    const heavy=new Set(['20.3cm連装砲','20.3cm(2号)連装砲','20.3cm(3号)連装砲','8inch三連装砲 Mk.9','8inch三連装砲 Mk.9 mod.2'].map(normalize));
    const l=guns.filter(g=>light.has(normalize(g.api_name))).length,h=guns.filter(g=>heavy.has(normalize(g.api_name))).length;
    if(l+h!==guns.length||/^三隈改二特/.test(who))return {known:false,value:null,applicable:true,reason:'该水母主炮组合尚未确认'};
    return {known:true,applicable:true,value:-6*l-10*h-(h&&!l?(married?4.8:8):0)};
  }
  if(guns.some(g=>normalize(g.api_name)===normalize('14cm連装砲改二')))return {known:false,value:null,applicable:true,reason:'14cm连装炮改二的适重分类尚未确认'};
  if(guns.length>2)return {known:false,value:null,applicable:true,reason:'三门以上中口径炮的适重未确认'};
  const agano=ctype===41||/^(阿賀野|能代|矢矧|酒匂)/.test(who),ooyodo=/^大淀/.test(who),atlanta=ctype===99||/^(Atlanta|SanDiego)/i.test(who);
  let value=null;
  if(agano&&group.every(g=>g==='B'))value=(guns.length===1?5:6)+(married?2:0);
  else if(agano&&same&&group[0]==='F')value=married?-6:-8;
  else if(ooyodo&&same&&group[0]==='C')value=married?-1.2:-2;
  else if(ooyodo&&same&&group[0]==='F')value=married?-8:-10;
  else if(atlanta&&same&&group[0]==='E')value=married?3:0;
  else if(guns.length===2&&group.every(g=>g==='A'||g==='B'))value=married?2:0;
  else if(same&&['D','E','F'].includes(group[0]))value=married?-3.6:-6;
  else if(same&&group[0]==='G')value=married?-17.6:-22;
  else if(guns.length===1&&group[0]==='F'&&!agano&&!ooyodo)value=married?-1.8:-3;
  return value===null?{known:false,value:null,applicable:true,reason:'该轻巡主炮组合的适重尚未确认'}:{known:true,value,applicable:true};
}
function destroyerFit(master,items){
  const who=normalize(master.api_name),ctype=Number(master.api_ctype),guns=items.filter(item=>Number(item.api_type?.[2])===1);
  if(!guns.length)return {known:true,value:0,applicable:false};
  let targets=[],coefficient=0;
  if(/^(Ташкент|Верный)/i.test(who)){targets=['130mm B-13連装砲'];coefficient=5;}
  else if(ctype===82||/^(Jervis|Janus|Javelin|Jupiter)/i.test(who)){targets=['QF 4.7inch砲 Mk.XII改'];coefficient=3;}
  else if(/^(睦月|如月|弥生|卯月|皐月|文月|長月|菊月|三日月|望月|水無月|夕月)/.test(who)){targets=['12cm単装砲改二'];coefficient=5;}
  else if(ctype===91||/^(Fletcher|Johnston|HeywoodL\.Edwards|SamuelB\.Roberts)/i.test(who)){
    targets=['5inch単装砲 Mk.30','5inch単装砲 Mk.30改','5inch単装砲 Mk.30改+GFCS Mk.37'];coefficient=4;
    const base=guns.filter(g=>normalize(g.api_name)===normalize('5inch単装砲 Mk.30')).length;
    if(base>1||base&&/^SamuelB\.Roberts/i.test(who))return {known:false,value:null,applicable:true,reason:'该美制主炮组合的适重仍有异常报告'};
  }
  if(!targets.length)return {known:false,value:null,applicable:false,reason:'该驱逐舰主炮适重资料尚未接入'};
  const set=new Set(targets.map(normalize)),n=guns.filter(g=>set.has(normalize(g.api_name))).length;
  if(!n)return {known:false,value:null,applicable:false,reason:'该主炮适重资料尚未确认'};
  if(guns.length!==n)return {known:false,value:null,applicable:true,reason:'混装小口径炮的适重尚未确认'};
  return {known:true,value:coefficient*Math.sqrt(n),applicable:true};
}
function measuredFitForLoadout(store,shipId,entry){
  const ship=store.info?.ships?.[shipId],master=store.const?.$ships?.[ship?.api_ship_id];
  if(!ship||!master)return {known:false,value:null,reason:'舰娘资料不足'};
  const ids=[...(entry?.slots||ship.api_slot||[]),entry?.ex??ship.api_slot_ex].filter(id=>id>0);
  const items=ids.map(id=>store.const?.$equips?.[store.info?.equips?.[id]?.api_slotitem_id]);
  if(items.some(item=>!item))return {known:false,value:null,reason:'装备资料不足'};
  const type=Number(master.api_stype),shipName=normalize(master.api_name),ctype=Number(master.api_ctype),isYamatoHeavy=/^大和改二重/.test(shipName);
  const isYamatoKai2=/^大和改二(?!重)/.test(shipName);
  if([1,2].includes(type))return destroyerFit(master,items);
  if(![8,9,10].includes(type)){
    if(items.some(item=>Number(item.api_type?.[2])===3))return {known:false,value:null,applicable:true,reason:'该舰种的大口径炮适重尚未确认'};
    return mediumFit(master,ship,items);
  }
  const guns=items.filter(item=>Number(item.api_type?.[2])===3);
  if(!guns.length)return {known:true,value:0,applicable:false};
  if(guns.some(gun=>!groups.has(normalize(gun.api_name))))return {known:false,value:null,applicable:true,reason:'部分主炮的适重分类尚未确认'};
  const highHp=Number(master.api_taik?.[0]);
  if(type===9&&!isYamatoKai2&&(!Number.isFinite(highHp)||highHp<=0))return {known:false,value:null,applicable:true,reason:'缺少舰娘初始耐久，无法确认适重类别'};
  const level=Number(ship.api_lv);
  if(!Number.isFinite(level)||level<1)return {known:false,value:null,applicable:true,reason:'缺少舰娘等级，无法确认婚舰修正'};
  if(ids.some(id=>[33,34,87].includes(Number(store.info?.equips?.[id]?.api_slotitem_id)))){
    const metrics=require('../fleet/fleet_metrics'),target=metrics.projectShip(store,shipId,{slots:entry?.slots||ship.api_slot||[],ex:entry?.ex??ship.api_slot_ex??-1});
    const actual=metrics.speed(store,[target]).fleetSpeedCode,base=Number(master.api_soku);
    if(!actual||![5,10].includes(base)||actual!==base)
      return {known:false,value:null,applicable:true,reason:'提速状态下的适重修正尚未确认'};
  }
  const married=level>99,marriage=married?.6:1,fast=type===8||isYamatoKai2,large=type===9&&!fast&&highHp>92,aviation=type===10;
  const count=Object.fromEntries(Object.keys(names).map(key=>[key,0]));
  for(const gun of guns)count[groups.get(normalize(gun.api_name))]++;
  if(!fast&&count.mk7)return {known:false,value:null,applicable:true,reason:'该舰的 Mk.7 主炮适重尚未确认'};
  let value=0,estimated=false,estimateNotes=[];
  const add=(group,coefficient,marriageAffected=false)=>{value+=coefficient*Math.sqrt(count[group])*(marriageAffected?marriage:1);};
  if(fast){
    add('35.6',4);add('381',-2,true);add('41',-5,true);add('mk7',-5,true);add('46proto',-7,true);add('46',-10,true);add('46kai',-10,true);add('51',-10,true);
    if(ctype===6||/^(金剛|比叡|榛名|霧島)/.test(shipName))add('35.6',3);
    if([47,58].includes(ctype)||/^(Bismarck|Italia|Littorio|Roma)/i.test(shipName))add('381',3,true);
    if((ctype===65||/^Iowa/i.test(shipName))&&count.mk7){
      const regular=guns.filter(g=>normalize(g.api_name)===normalize('16inch三連装砲 Mk.7')).length;
      value+=(6*Math.sqrt(regular)+12*Math.sqrt(count.mk7-regular))*marriage;
      estimated=true;estimateNotes.push('Iowa级 Mk.7 个别系数采用 +6/+12 的参考估计，另有 +7/+14 的研究');
    }
    if(count['41']&&([73,79,113].includes(ctype)||/^(Richelieu|JeanBart|Гангут|Октябрьскаяреволюция|Gangut|ContediCavour)/i.test(shipName))){
      const french=ctype===79||/^(Richelieu|JeanBart)/i.test(shipName);
      add('41',french?-2:-4,true);estimated=true;estimateNotes.push(`${french?'黎塞留级':'甘古特级或加富尔级'} 41cm炮个别补正采用待验证的参考估计`);
    }
  }else if(isYamatoHeavy){
    add('35.6',4);add('381',2,true);add('41',2);
    value+=-8*Math.sqrt(count['46']+count['46kai']+count['51'])*marriage;
    add('46proto',-5,true);
  }else if(!large){
    add('35.6',aviation?4:2);add('381',2,true);add('41',2);add('46proto',-3,true);add('46',-7,true);add('46kai',-7,true);
    if(!aviation&&/^(長門|陸奥)/.test(shipName)){
      const n=guns.filter(g=>normalize(g.api_name)===stock41).length;
      const kai2=/^長門改二/.test(shipName);
      value+=kai2?4*Math.sqrt(n)+3*Math.sqrt(count['41']-n):2*Math.sqrt(count['41']);add('51',-5,true);
    }
  }
  if((large||isYamatoKai2||isYamatoHeavy)&&/^(大和|武蔵)/.test(shipName)){
    add('46proto',3);add('46',3);add('46kai',7);
  }
  return {known:true,value,applicable:true,estimated,reason:estimateNotes.join('；')};
}

// Approximate only combinations without an existing measurement. Keep this
// separate from measured rules, so future evidence can replace each fallback.
function estimateMedium(master,ship,guns){
  const who=normalize(master.api_name),type=Number(master.api_stype),married=Number(ship.api_lv)>99;
  if([5,6].includes(type))return 0;
  if(type===16||type===22&&/^神威改母/.test(who)){
    const heavy=guns.filter(g=>['F','G'].includes(mediumGroups.get(normalize(g.api_name)))).length;
    const light=guns.length-heavy;
    return -6*light-10*heavy-(heavy&&!light?(married?4.8:8):0);
  }
  if(![3,4,21].includes(type))return 0;
  const grouped=new Map();
  for(const gun of guns){
    const name=normalize(gun.api_name);
    let group=mediumGroups.get(name);
    if(/^15\.2cm三連装主砲/.test(name))group='FR';
    if(!group){
      if(/^14cm|^13\.8cm/.test(name))group='A';
      else if(/^15\.2cm|^152mm|^6inch/i.test(name))group=/三連|Triple/i.test(name)?'D':'B';
      else if(/^15\.5cm/.test(name))group='C';
      else if(/^20\.3cm|^203mm|^18cm/.test(name))group='F';
      else if(/^8inch/i.test(name))group='G';
      else group='other';
    }
    const list=grouped.get(group)||[];list.push(gun);grouped.set(group,list);
  }
  let total=0;
  for(const [group,list] of grouped){
    if(group==='FR'){total+=list.length*(/^Gloire/i.test(who)?-1:-3)*(married?.6:1);continue;}
    // Prefer an actual single- or two-gun measurement for each group, then
    // extrapolate its average; mixed groups are summed as a reference only.
    const pair=mediumFit(master,ship,list.slice(0,2));
    if(pair.known){total+=pair.value*list.length/Math.min(list.length,2);continue;}
    const doubled=mediumFit(master,ship,[list[0],list[0]]);
    if(doubled.known){total+=doubled.value*list.length/2;continue;}
    const factor=married?.6:1;
    if(group==='C')total+=list.length*(married?-.5:-2.5);
    else if(['D','E','F'].includes(group))total-=3*factor*list.length;
    else if(group==='G')total-=11*(married?.8:1)*list.length;
    else if(['A','B'].includes(group)&&married)total+=list.length;
  }
  return total;
}
function estimateDestroyer(master,guns){
  // Known gun-specific bonuses remain useful even when other guns are mixed in.
  let matched=0,reference=0;
  for(const gun of guns){const one=destroyerFit(master,[gun]);if(one.known&&one.value>0){matched++;reference=Math.max(reference,one.value);}}
  const base=guns.filter(g=>normalize(g.api_name)===normalize('5inch単装砲 Mk.30')).length;
  if(Number(master.api_ctype)===91&&base>1)return 5*base+reference*Math.sqrt(Math.max(0,matched-base));
  return reference*Math.sqrt(matched);
}
function estimateLarge(store,shipId,entry,ship,master,ids,items){
  // Reuse the measured battleship formulas with similar guns, hull data and
  // unboosted speed; unknown mappings remain explicitly marked as estimates.
  const mapped=Object.create(store.const.$equips||null),equips=store.info.equips||{},missing=[];
  const override=(object,key,value)=>Object.defineProperty(object,key,{value,writable:true,configurable:true,enumerable:true});
  for(let i=0;i<ids.length;i++){
    const item=items[i],masterId=equips[ids[i]]?.api_slotitem_id;
    if(!item){missing.push(ids[i]);continue;}
    if(Number(item.api_type?.[2])!==3||groups.has(normalize(item.api_name)))continue;
    const name=normalize(item.api_name);let substitute='35.6cm連装砲';
    if(/51cm/i.test(name))substitute='試製51cm連装砲';
    else if(/46cm/i.test(name))substitute='46cm三連装砲';
    else if(/41cm|16inch/i.test(name))substitute='41cm連装砲';
    else if(/381mm/i.test(name))substitute='381mm/50 三連装砲';
    override(mapped,masterId,{...item,api_name:substitute});
  }
  const filtered=ids.filter(id=>!missing.includes(id)&&![33,34,87].includes(Number(equips[id]?.api_slotitem_id)));
  const adjustedShip={...ship,api_lv:Number(ship.api_lv)>0?ship.api_lv:90};
  const adjustedMaster={...master,api_taik:master.api_taik?.[0]>0?master.api_taik:[90]};
  const ships=Object.create(store.info.ships||null),masters=Object.create(store.const.$ships||null);
  override(ships,shipId,adjustedShip);override(masters,ship.api_ship_id,adjustedMaster);
  const view={...store,info:{...store.info,ships},const:{...store.const,$ships:masters,$equips:mapped}};
  let result=measuredFitForLoadout(view,shipId,{slots:filtered,ex:-1});
  // For non-fast ships the Mk.7 base grouping is not fully verified; using the
  // 41 cm family is a closer approximation than dropping all known guns.
  if(!result.known&&/Mk\.7/.test(result.reason||'')){
    for(const id of filtered){const m=equips[id]?.api_slotitem_id;if(groups.get(normalize(mapped[m]?.api_name))==='mk7')override(mapped,m,{...mapped[m],api_name:'41cm連装砲'});}
    result=measuredFitForLoadout(view,shipId,{slots:filtered,ex:-1});
  }
  return result.known?result.value:0;
}
function fitForLoadout(store,shipId,entry){
  const exact=measuredFitForLoadout(store,shipId,entry);
  if(exact.known)return exact;
  const ship=store.info?.ships?.[shipId],master=store.const?.$ships?.[ship?.api_ship_id];
  if(!ship||!master)return {known:true,value:0,applicable:true,estimated:true,reason:'舰娘资料缺失，暂按无额外补正估算'};
  const ids=[...(entry?.slots||ship.api_slot||[]),entry?.ex??ship.api_slot_ex].filter(id=>id>0);
  const items=ids.map(id=>store.const?.$equips?.[store.info?.equips?.[id]?.api_slotitem_id]);
  const available=items.filter(Boolean),type=Number(master.api_stype);
  let value=0;
  if([8,9,10].includes(type))value=estimateLarge(store,shipId,entry,ship,master,ids,items);
  else if([1,2].includes(type))value=estimateDestroyer(master,available.filter(item=>Number(item.api_type?.[2])===1));
  else value=estimateMedium(master,ship,available.filter(item=>Number(item.api_type?.[2])===2));
  return {known:true,value:Number.isFinite(value)?value:0,applicable:true,estimated:true,
    reason:`${exact.reason||'缺少完整实测'}；按同舰级、相近炮组或现有装备推算`};
}
function fitChange(store,shipId,entry,slot,equipmentId){
  const slots=(entry?.slots||store.info?.ships?.[shipId]?.api_slot||[]).slice();
  let ex=entry?.ex??store.info?.ships?.[shipId]?.api_slot_ex??-1;
  if(slot==='ex')ex=-1;else slots[slot]=-1;
  const without={slots,ex},before=fitForLoadout(store,shipId,without);
  const after={slots:slots.slice(),ex};if(slot==='ex')after.ex=equipmentId;else after.slots[slot]=equipmentId;
  const withItem=fitForLoadout(store,shipId,after);
  if(!before.known||!withItem.known)return {known:false,applicable:withItem.applicable,reason:withItem.reason||before.reason,
    ...(withItem.known?{totalKnown:true,total:withItem.value,estimated:!!withItem.estimated,estimateReason:withItem.reason}:{})};
  return {known:true,applicable:withItem.applicable,delta:withItem.value-before.value,total:withItem.value,
    estimated:!!(before.estimated||withItem.estimated),reason:withItem.reason||before.reason};
}
module.exports={fitForLoadout,fitChange};
