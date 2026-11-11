'use strict';
// Only call goal() for labels produced by our quest definitions. Unknown
// api_detail and all player/game names must bypass these formatters.
const {t,registerCatalog,getLocale}=require('../../shared/i18n');
const rows={
 'quest.other':['その他：{value}','其他：{value}'],
 'quest.expeditionNumber':['遠征 {id}','{id} 號遠征'],
 'quest.anyExpedition':['任意の遠征','任意遠征'],
 'quest.anyMap':['任意の海域','任意海域'],
 'quest.practice':['演習','演習'],
 'quest.afterPractice':['演習達成後：','演習完成後：'],
 'quest.practiceCount':['{when}演習{rank} {count}回','{when}演習{rank} {count}次'],
 'quest.today':['本日','本日'], 'quest.week':['今週','本週'],
 'quest.win':['勝利','勝利'], 'quest.rank':['{rank}勝以上','{rank}勝以上'], 'quest.sRank':['S勝利','S勝'],
 'quest.expGoal':['{mission}{action} {count}回','{mission}{action} {count}次'],
 'quest.expeditionSum':['遠征 {ids} の合計','{ids} 號遠征合計'],
 'quest.depart':['出発','出發'], 'quest.success':['成功','成功'], 'quest.great':['大成功','大成功'],
 'quest.mapGoal':['{place}{action} {count}回','{place}{action} {count}次'],
 'quest.node':['{map} {node}マス','{map} {node}點'], 'quest.phase':['{map} 第{phase}段階','{map} 第{phase}階段'],
 'quest.bossWin':[' ボス {rank}',' Boss {rank}'], 'quest.battleWin':[' {rank}',' {rank}'],
 'quest.battle':['で戦闘','交戰'], 'quest.bossBattle':[' ボスで戦闘',' Boss交戰'],
 'quest.allowDefeat':['（敗北可）','（可敗北）'], 'quest.bossReach':['でボス到達','抵達Boss'],
 'quest.reachGoal':['で終点到達','抵達終點'], 'quest.reachNode':['到達','抵達'],
 'quest.clear':['のゲージを破壊','擊破血條'], 'quest.sortie':['に出撃','出擊'],
 'quest.equipped':['戦闘糧食 {count}個を装備（達成時に消費）','裝備戰鬥糧食 {count}個（領取時消耗）'],
 'quest.fleetSize':['艦数{sign}{count}','艦數{sign}{count}'], 'quest.fleetIndex':['第{n}艦隊','第{n}艦隊'],
 'quest.count':['{name} {quantity}','{name} {quantity}'], 'quest.shipCount':['{n}隻','{n}艘'],
 'quest.flagship':['旗艦：','旗艦：'], 'quest.escort':['随伴艦：','僚艦：'], 'quest.position':['{n}番艦：','第{n}艦：'],
 'quest.noEquip':['編成不可','不得編入'], 'quest.minShips':['≥{n}隻','≥{n}艘'], 'quest.rangeShips':['{min}–{max}隻','{min}–{max}艘'],
 'quest.noExact':['{name}をちょうど{n}隻にできない','{name}不得剛好{n}艘'],
 'quest.resource':['{name}≥{n}（達成時に消費）','{name}≥{n}（領取時消耗）'],
 'quest.unknownEnemy':['この海域の対象敵艦は未確認','本海域目標敵艦資料待確認'],
 'quest.noRetreat':['目標到達時に必要な艦娘が退避していない','抵達目標時所需艦娘均未退避'],
 'quest.recheck':['目標到達時も指定編成を維持','抵達目標時仍須保持指定編成'],
 'quest.selectShip':['艦娘を選択してください','請先選擇艦娘'],
 'quest.sameShip':['同じ艦娘の別個体／形態を重複して数えられません','同艦娘的不同個體／型態不能重複計入'],
 'quest.distinct':['各艦娘が別々の指定艦位／編成条件を満たす','每艘艦娘分別符合一個指定艦位／編成角色'],
 'quest.missingFleet':['任務の編成条件は未収録','任務編成資料尚未收錄'],
 'quest.sink':['{enemy}を{count}隻撃沈','擊沉{enemy} {count}艘'],
 'quest.exclude':['（{names}を除く）','（不含{names}）'],
 'quest.transport':['輸送艦','運輸艦'],
 'quest.mapTotal':['{maps}のボスで{rank}合計 {count}回','{maps} Boss合計{rank} {count}次'],
 'quest.choose':['いずれか：{options}','任選：{options}'],
 'quest.or':[' または ',' 或 '],
 'quest.fixedNot':['{name}をちょうど{n}隻にできない','{name}不得剛好{n}艘'],
 'quest.and':['かつ','且'],
 'quest.not':['{name}以外','非{name}'],
 'quest.level':['レベル≥{n}','等級≥{n}'],
 'quest.speed':['速力≥{value}','速力≥{value}'],
 'quest.shipTypeNumber':['艦種{n}','艦種{n}'],
 'quest.countryUS':['米国艦','美國艦'],
 'quest.countryGB':['英国艦','英國艦'],
 'quest.countryDE':['ドイツ艦','德國艦'],
 'quest.countryIT':['イタリア艦','義大利艦'],
 'quest.countryFR':['フランス艦','法國艦'],
 'quest.countryRU':['ソ連艦','蘇聯艦'],
 'quest.countrySE':['スウェーデン艦','瑞典艦'],
 'quest.countryAU':['豪州艦','澳洲艦'],
 'quest.countryNL':['オランダ艦','荷蘭艦'],
 'quest.item.buckets':['高速修復材','高速修復材'],
 'quest.item.build':['高速建造材','高速建造材'],
 'quest.item.dev':['開発資材','開發資材'],
 'quest.item.screw':['改修資材','改修資材'],
 'quest.item.boxSmall':['家具箱（小）','家具箱（小）'],
 'quest.item.boxMedium':['家具箱（中）','家具箱（中）'],
 'quest.item.boxLarge':['家具箱（大）','家具箱（大）'],
 'quest.item.ranking':['戦果','戰果']
};
for(const [key,[ja,tw]] of Object.entries(rows)){registerCatalog('ja',{[key]:ja});registerCatalog('zh-TW',{[key]:tw});}
// Stable IDs describe task rules; translated words are presentation only.
const structured={
  'quest.type.escort':['海防','海防艦','海防艦'],'quest.type.destroyer':['驱逐','駆逐艦','驅逐艦'],
  'quest.type.lightCruiser':['轻巡','軽巡','輕巡'],'quest.type.torpedoCruiser':['雷巡','雷巡','雷巡'],
  'quest.type.heavyCruiser':['重巡','重巡','重巡'],'quest.type.aviationCruiser':['航巡','航巡','航巡'],
  'quest.type.lightCarrier':['轻空母','軽空母','輕空母'],'quest.type.fastBattleship':['高速战舰','高速戦艦','高速戰艦'],
  'quest.type.battleship':['战舰','戦艦','戰艦'],'quest.type.aviationBattleship':['航战','航空戦艦','航空戰艦'],
  'quest.type.carrier':['正规空母','正規空母','正規空母'],'quest.type.submarine':['潜水舰','潜水艦','潛水艦'],
  'quest.type.submarineCarrier':['潜水空母','潜水空母','潛水空母'],'quest.type.seaplaneTender':['水母','水母','水母'],
  'quest.type.landingShip':['扬陆舰','揚陸艦','登陸艦'],'quest.type.armoredCarrier':['装甲空母','装甲空母','裝甲空母'],
  'quest.type.repairShip':['工作舰','工作艦','工作艦'],'quest.type.submarineTender':['潜水母舰','潜水母艦','潛水母艦'],
  'quest.type.trainingCruiser':['练巡','練巡','練巡'],'quest.type.oiler':['补给舰','補給艦','補給艦'],
  'quest.class.kageroYugumo':['阳炎型／夕云型','陽炎型／夕雲型','陽炎型／夕雲型'],
  'quest.class.fletcherButler':['Fletcher级／John C.Butler级','Fletcher級／John C.Butler級','Fletcher級／John C.Butler級'],
  'quest.class.french':['法国舰','フランス艦','法國艦'],
  'quest.selector.unknown':['指定舰娘','指定艦娘','指定艦娘'],
  'quest.rule.unknown':['条件待确认','条件は要確認','條件待確認'],
  'quest.rule.free':['自由舰位','自由枠','自由艦位'],
  'quest.join.and':['且','かつ','且'],'quest.join.or':[' 或 ',' または ',' 或 '],
  'quest.rule.choose':['任选：{options}','いずれか：{options}','任選：{options}'],
  'quest.rule.not':['非{name}','{name}以外','非{name}'],
  'quest.rule.level':['等级≥{n}','レベル≥{n}','等級≥{n}'],
  'quest.rule.speed':['速力≥{value}','速力≥{value}','速力≥{value}'],
  'quest.rule.fleetSize':['舰数{sign}{count}','艦数{sign}{count}','艦數{sign}{count}'],
  'quest.rule.fleetIndex':['第{n}舰队','第{n}艦隊','第{n}艦隊'],
  'quest.rule.flagship':['旗舰：','旗艦：','旗艦：'],'quest.rule.escort':['随伴：','随伴艦：','僚艦：'],
  'quest.rule.position':['第{n}舰：','{n}番艦：','第{n}艦：'],
  'quest.rule.forbidden':['不得编入','編成不可','不得編入'],
  'quest.rule.quantity':['{n}艘','{n}隻','{n}艘'],
  'quest.rule.min':['≥{n}艘','≥{n}隻','≥{n}艘'],
  'quest.rule.range':['{min}–{max}艘','{min}–{max}隻','{min}–{max}艘'],
  'quest.rule.forbiddenCount':['{name}不得恰好{n}艘','{name}をちょうど{n}隻にできない','{name}不得剛好{n}艘'],
  'quest.rule.unknownType':['舰种{n}','艦種{n}','艦種{n}']
};
for(const [key,[cn,ja,tw]] of Object.entries(structured)){registerCatalog('zh-CN',{[key]:cn});registerCatalog('ja',{[key]:ja});registerCatalog('zh-TW',{[key]:tw});}
const shipTypes={1:'escort',2:'destroyer',3:'lightCruiser',4:'torpedoCruiser',5:'heavyCruiser',6:'aviationCruiser',7:'lightCarrier',8:'fastBattleship',9:'battleship',10:'aviationBattleship',11:'carrier',13:'submarine',14:'submarineCarrier',16:'seaplaneTender',17:'landingShip',18:'armoredCarrier',19:'repairShip',20:'submarineTender',21:'trainingCruiser',22:'oiler'};
const countries={US:'quest.countryUS',GB:'quest.countryGB',UK:'quest.countryGB',DE:'quest.countryDE',IT:'quest.countryIT',FR:'quest.countryFR',RU:'quest.countryRU',SE:'quest.countrySE',AU:'quest.countryAU',NL:'quest.countryNL'};
// Some selectors describe several classes with a source-language label rather
// than a game master name. Match their numeric IDs, never the displayed label.
const classGroups={'30,38':'kageroYugumo','87,91':'fletcherButler','70,79,128,129':'french'};
const countryCN={US:'美国舰',GB:'英国舰',UK:'英国舰',DE:'德国舰',IT:'意大利舰',FR:'法国舰',RU:'苏联舰',SE:'瑞典舰',AU:'澳大利亚舰',NL:'荷兰舰'};
function structuredSelector(selector={}){
  if(selector.not)return t('quest.rule.not',{name:structuredSelector(selector.not)});
  if(selector.anyOf)return selector.anyOf.map(structuredSelector).join('／');
  if(selector.allOf)return selector.allOf.filter(s=>s.kind!=='shipType'||s.stypeIds?.length<20).map(structuredSelector).join(t('quest.join.and'));
  const type=id=>shipTypes[id]?t(`quest.type.${shipTypes[id]}`):t('quest.rule.unknownType',{n:id});
  switch(selector.kind){
    case 'ship':return selector.name||t('quest.selector.unknown');
    case 'shipClass':{const key=(selector.ctypeIds||[]).slice().sort((a,b)=>a-b).join(',');
      return classGroups[key]?t(`quest.class.${classGroups[key]}`):selector.name||t('quest.selector.unknown');}
    case 'shipType':return (selector.stypeIds||[]).map(type).join('／');
    case 'shipTypeExclusion':return t('quest.rule.not',{name:(selector.stypeIds||[]).map(type).join('／')});
    case 'country':return getLocale()==='zh-CN'?(countryCN[selector.code]||`${selector.code}舰`):countries[selector.code]?t(countries[selector.code]):`${selector.code}艦`;
    case 'level':return t('quest.rule.level',{n:selector.min});
    case 'speed':return t('quest.rule.speed',{value:t(({5:'低速',10:'高速',15:'高速强化',20:'最速'})[selector.min]||String(selector.min))});
    case 'remodelName':return selector.contains;
    default:return t('quest.rule.unknown');
  }
}
function fleetRule(rule={}){
  if(rule.anyOf)return t('quest.rule.choose',{options:rule.anyOf.map(fleetRule).join(t('quest.join.or'))});
  if(rule.allOf)return rule.allOf.filter(r=>r.kind!=='freeSlots').map(fleetRule).join('，');
  if(rule.kind==='count'){
    const position=rule.positions?.length===1?(rule.positions[0]===1?t('quest.rule.flagship'):t('quest.rule.position',{n:rule.positions[0]})):rule.positions?.length?t('quest.rule.escort'):'';
    const quantity=rule.max===0?t('quest.rule.forbidden'):rule.min===rule.max?t('quest.rule.quantity',{n:rule.min}):rule.max===undefined?t('quest.rule.min',{n:rule.min||0}):t('quest.rule.range',{min:rule.min||0,max:rule.max});
    return `${position}${structuredSelector(rule.selector)} ${quantity}`;
  }
  if(rule.kind==='fleetSize')return t('quest.rule.fleetSize',{sign:rule.exact!==undefined?'＝':rule.max!==undefined?'≤':'≥',count:rule.exact??rule.max??rule.min});
  if(rule.kind==='fleetIndex')return t('quest.rule.fleetIndex',{n:rule.index});
  if(rule.kind==='forbiddenCount')return t('quest.rule.forbiddenCount',{name:structuredSelector(rule.selector),n:rule.equal});
  return t(rule.kind==='freeSlots'?'quest.rule.free':'quest.rule.unknown');
}
const rank=raw=>raw==='胜利'?t('quest.win'):raw==='S胜'?t('quest.sRank'):raw&&/^([A-Z])胜以上$/.test(raw)?t('quest.rank',{rank:raw[0]}):raw||'';
// Task goals are game-independent data. Format them from their kind and fields
// so punctuation or wording changes cannot change the translated result.
function structuredGoal(goal,period){
  if(!goal?.kind||getLocale()==='zh-CN')return goal?.label||'';
  const count=Number(goal.count||1),rankText=goal.rankMin==='win'?t('quest.win'):goal.rankMin==='S'?t('quest.sRank'):
    goal.rankMin&&goal.rankMin!=='any'?t('quest.rank',{rank:goal.rankMin}):'';
  const {missionNumber}=require('../../domain/quests/quest_requirements');
  let place=goal.map==='any'?t('quest.anyMap'):goal.map||'';
  if(goal.node)place=t('quest.node',{map:place,node:goal.node});
  else if(goal.phase)place=t('quest.phase',{map:place,phase:goal.phase});
  let result;
  switch(goal.kind){
    case 'practice':case 'practiceWin':result=t('quest.practiceCount',{when:goal.withinDay||goal.within==='sameDay'?t('quest.today'):period==='weekly'?t('quest.week'):'',rank:rankText,count});break;
    case 'equippedItems':result=t('quest.equipped',{count});break;
    case 'bossWin':result=t('quest.mapGoal',{place,action:t('quest.bossWin',{rank:rankText}),count});break;
    case 'battleWin':result=t('quest.mapGoal',{place,action:t('quest.battleWin',{rank:rankText}),count});break;
    case 'battle':result=t('quest.mapGoal',{place,action:t(goal.bossOnly?'quest.bossBattle':'quest.battle'),count})+(goal.defeatAllowed?t('quest.allowDefeat'):'');break;
    case 'departSortie':result=t('quest.mapGoal',{place:place||t('quest.anyMap'),action:t('quest.sortie'),count});break;
    case 'bossReach':case 'reachGoal':case 'reachNode':case 'mapGaugeClear':result=t('quest.mapGoal',{place,action:t(({bossReach:'quest.bossReach',reachGoal:'quest.reachGoal',reachNode:'quest.reachNode',mapGaugeClear:'quest.clear'})[goal.kind]),count});break;
    case 'sinkEnemy':result=t('quest.sink',{enemy:t(({carrier:'空母',submarine:'潜水舰',transport:'quest.transport'})[goal.enemyGroup]||goal.enemyGroup),count})+(goal.excludedNames?.length?t('quest.exclude',{names:goal.excludedNames.join('／')}):'');break;
    case 'sortie':result=t('quest.mapTotal',{maps:(goal.anyTargets||[]).map(target=>target.map).join('／'),rank:rankText,count});break;
    case 'expeditionDepart':case 'expeditionReturn':{
      const mission=goal.anyMissionIds?t('quest.expeditionSum',{ids:goal.anyMissionIds.join('／')}):goal.missionId==='any'?t('quest.anyExpedition'):t('quest.expeditionNumber',{id:missionNumber(goal.missionId)});
      result=t('quest.expGoal',{mission,action:t(goal.kind==='expeditionDepart'?'quest.depart':goal.resultMin==='greatSuccess'?'quest.great':'quest.success'),count});break;
    }
    case 'noRetreatedShips':result=t('quest.noRetreat');break;
    case 'recheckFleetAtGoal':result=t('quest.recheck');break;
    default:return goal.label||'';
  }
  return goal.afterPractice?t('quest.afterPractice')+result:result;
}
function destination(row){
  if(!row||typeof row.label!=='string'||getLocale()==='zh-CN')return row?.label||'';
  if(row.kind==='practice')return t('quest.practice');
  if(row.kind==='expedition'&&Object.hasOwn(row,'missionId'))return row.missionId===null?t('quest.anyExpedition'):
    t('quest.expeditionNumber',{id:require('../../domain/quests/quest_requirements').missionNumber(row.missionId)});
  if(row.kind==='normal'&&Object.hasOwn(row,'area')&&row.area===null)return t('quest.anyMap');
  return row.label;
}
function goal(raw,known){
  if(!known||typeof raw!=='string'||getLocale()==='zh-CN')return raw;
  if(raw.startsWith('演习完成后：'))return t('quest.afterPractice')+goal(raw.slice('演习完成后：'.length),true);
  const exact={'到达目标时所需舰娘均未退避':'quest.noRetreat','到达目标时仍须保持指定编成':'quest.recheck'};
  if(exact[raw])return t(exact[raw]);
  let m=raw.match(/^(本日|本周)?演习(胜利|[A-Z]胜以上|S胜)? (\d+)次$/);
  if(m)return t('quest.practiceCount',{when:m[1]?t(m[1]==='本日'?'quest.today':'quest.week'):'',rank:rank(m[2]),count:m[3]});
  m=raw.match(/^装备战斗粮食 (\d+)件（领取时消耗）$/);if(m)return t('quest.equipped',{count:m[1]});
  m=raw.match(/^击沉(空母|运输舰|潜水舰) (\d+)艘(?:（不含(.+)）)?$/);
  if(m)return t('quest.sink',{enemy:m[1]==='运输舰'?t('quest.transport'):t(m[1]),count:m[2]})+(m[3]?t('quest.exclude',{names:m[3]}):'');
  m=raw.match(/^([\d\-／]+) Boss合计(胜利|[A-Z]胜以上|S胜) (\d+)次$/);
  if(m)return t('quest.mapTotal',{maps:m[1],rank:rank(m[2]),count:m[3]});
  m=raw.match(/^(任意远征|[A-Z]?\d+号远征|[A-Z\d／]+号远征合计)(出发|成功|大成功) (\d+)次$/i);
  if(m){const mission=m[1]==='任意远征'?t('quest.anyExpedition'):m[1].endsWith('合计')?t('quest.expeditionSum',{ids:m[1].replace(/号远征合计$/,'')}):t('quest.expeditionNumber',{id:m[1].replace(/号远征$/,'')});return t('quest.expGoal',{mission,action:t(m[2]==='出发'?'quest.depart':m[2]==='大成功'?'quest.great':'quest.success'),count:m[3]});}
  m=raw.match(/^(任意海域|\d+-\d+)(?: ([A-Z])点| 第(\d+)阶段)?( Boss (胜利|[A-Z]胜以上|S胜)| (胜利|[A-Z]胜以上|S胜)|( Boss)?交战|抵达Boss|抵达终点|抵达|击破血条|出击) (\d+)次(（败北也可）)?$/);
  if(m){let place=m[1]==='任意海域'?t('quest.anyMap'):m[1];if(m[2])place=t('quest.node',{map:place,node:m[2]});if(m[3])place=t('quest.phase',{map:place,phase:m[3]});
    const action=m[5]?t('quest.bossWin',{rank:rank(m[5])}):m[6]?t('quest.battleWin',{rank:rank(m[6])}):t({'交战':'quest.battle',' Boss交战':'quest.bossBattle','抵达Boss':'quest.bossReach','抵达终点':'quest.reachGoal','抵达':'quest.reachNode','击破血条':'quest.clear','出击':'quest.sortie'}[m[4]]||'quest.battle');
    return t('quest.mapGoal',{place,action,count:m[8]})+(m[9]?t('quest.allowDefeat'):'');}
  return raw;
}
function selectorName(raw){
  const countries={'美国舰':'quest.countryUS','英国舰':'quest.countryGB','德国舰':'quest.countryDE','意大利舰':'quest.countryIT','法国舰':'quest.countryFR','苏联舰':'quest.countryRU','瑞典舰':'quest.countrySE','澳大利亚舰':'quest.countryAU','荷兰舰':'quest.countryNL'};
  const names={'阳炎型':'陽炎型','夕云型':'夕雲型'};
  return raw.split(/([／且])/).map(part=>{
    if(part==='／')return part;if(part==='且')return t('quest.and');
    if(part.startsWith('非'))return t('quest.not',{name:selectorName(part.slice(1))});
    if(countries[part])return t(countries[part]);if(names[part])return names[part];
    const lv=part.match(/^等级≥(\d+)$/);if(lv)return t('quest.level',{n:lv[1]});
    const speed=part.match(/^速力≥(.+)$/);if(speed)return t('quest.speed',{value:t(speed[1])});
    const shipType=part.match(/^舰种(\d+)$/);if(shipType)return t('quest.shipTypeNumber',{n:shipType[1]});
    if(/^(海防|驱逐|轻巡|雷巡|重巡|航巡|轻空母|高速战舰|战舰|航战|正规空母|潜水舰|潜水空母|水母|扬陆舰|装甲空母|工作舰|潜水母舰|练巡|补给舰)$/.test(part))return t(part);
    return part.endsWith('级')?part.slice(0,-1)+'級':part;
  }).join('');
}
function check(raw){
  if(typeof raw!=='string'||getLocale()==='zh-CN')return raw;
  if(raw.startsWith('任选：'))return t('quest.choose',{options:raw.slice(3).split(' 或 ').map(group=>group.split('，').map(check).join('，')).join(t('quest.or'))});
  const exact={'本海域目标敌舰资料待确认':'quest.unknownEnemy','请先选择舰娘':'quest.selectShip','同舰娘的不同实例／形态不能重复计入':'quest.sameShip','每艘舰娘分别满足一个指定舰位／编成角色':'quest.distinct','任务编成资料尚未收录':'quest.missingFleet'};
  if(exact[raw])return t(exact[raw]);
  let m=raw.match(/^舰数([≥≤＝])(\d+)$/);if(m)return t('quest.fleetSize',{sign:m[1],count:m[2]});
  m=raw.match(/^(.+?)不得恰好(\d+)艘$/);if(m)return t('quest.fixedNot',{name:selectorName(m[1]),n:m[2]});
  m=raw.match(/^第(\d+)舰队$/);if(m)return t('quest.fleetIndex',{n:m[1]});
  m=raw.match(/^(燃料|弹药|钢材|铝土)≥(\d+)（领取消耗）$/);if(m)return t('quest.resource',{name:t(m[1]),n:m[2]});
  m=raw.match(/^(旗舰：|随伴：|第\d+舰：)?(.+?) (不得编入|≥\d+艘|\d+–\d+艘|\d+艘)$/);
  if(m){const p=m[1]?(m[1]==='旗舰：'?t('quest.flagship'):m[1]==='随伴：'?t('quest.escort'):t('quest.position',{n:m[1].match(/\d+/)[0]})):'';
    // Translate complete known ship-type tokens only; ship names remain intact.
    const name=selectorName(m[2]);
    const q=m[3]==='不得编入'?t('quest.noEquip'):/^≥/.test(m[3])?t('quest.minShips',{n:m[3].match(/\d+/)[0]}):m[3].includes('–')?t('quest.rangeShips',{min:m[3].match(/\d+/g)[0],max:m[3].match(/\d+/g)[1]}):t('quest.shipCount',{n:m[3].match(/\d+/)[0]});return p+t('quest.count',{name,quantity:q});}
  return raw;
}
function reward(item){
  const name=item?.name||'',key={'高速修复材':'quest.item.buckets','高速建造材':'quest.item.build','开发资材':'quest.item.dev','改修资材':'quest.item.screw','家具箱（小）':'quest.item.boxSmall','家具箱（中）':'quest.item.boxMedium','家具箱（大）':'quest.item.boxLarge','战果':'quest.item.ranking'}[name];
  return key&&getLocale()!=='zh-CN'?t(key):name;
}
module.exports={goal,structuredGoal,destination,check,reward,fleetRule};
