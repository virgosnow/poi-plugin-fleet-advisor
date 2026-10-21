'use strict';

// Authored character equivalences, not translations or equipment aliases.
// First character is the canonical simplified form. Keep groups disjoint;
// add new variants here instead of rewriting the game's master names.
const VARIANT_GROUPS=Object.freeze([
  '两両兩','佛仏','仓倉','侦偵','备備','仪儀','别別','刚剛','动動','势勢',
  '单単單','丛叢','吕呂','员員','喷噴','团団團','压圧壓','场場','增増',
  '坏壊壞','奥奧','实実實','对対對','导導','层層','峡峽','峰峯','岛島',
  '岚嵐','卷巻','弥彌','张張','强強','弹弾彈','后後','复復複','彻徹',
  '应応應','爱愛','战戦戰','户戸戶','择択擇','扬揚','挥揮','击撃擊',
  '搁擱','时時','晓暁曉','胧朧','条條','来來','东東','枢樞','样様樣',
  '标標','横橫','槛檻','桥橋','机機','欧歐','步歩','岁歳歲','毗毘',
  '气気氣','泛汎','冲沖','滨浜濱','凉涼','济済濟','温溫','测測',
  '湾灣','满満滿','准準','涟漣','潜潛','乌烏','无無','烟煙','独獨',
  '狭狹','狱獄','现現','环環','产産產','发発發','炮砲','矶磯','祯禎',
  '稻稲','穗穂','积積','笼籠','粮糧','约約','级級','络絡','给給',
  '绫綾','练練','聪聡聰','听聴聽','舣艤舾','舰艦','荚莢','叶葉',
  '苍蒼','藏蔵','兰蘭','虫蟲','卫衛','装裝','补補','制製','袭襲','栖棲',
  '极極','规規','㭴樫',
  '见見','亲親','观観觀','计計','设設','试試','诘詰','诱誘','调調',
  '护護','雠讐讎','贺賀','贼賊','车車','军軍','转転轉','轻軽輕',
  '载載','轮輪','输輸','连連','进進','游遊','远遠','还還','钏釧',
  '铃鈴','银銀','铳銃','锐鋭銳','镜鏡','长長','门門','间間','关関關',
  '斗闘鬥','阵陣','陆陸','阳陽','队隊','离離','云雲','电電','雾霧',
  '响響','风風','飞飛','马馬','驮駄馱','驱駆驅','骑騎','验験驗',
  '骧驤','鱼魚','鲛鮫','鲸鯨','䲠鰆','鸟鳥','凤鳳','鸥鴎鷗','鹈鵜',
  '鹤鶴','鹰鷹','黑黒','龙龍竜','异異','属屬','药薬藥','灯燈','皋皐'
]);
const variants=new Map();
for(const group of VARIANT_GROUPS)for(const character of group)variants.set(character,[...group][0]);

function normalizeName(name) {
  return [...name.normalize('NFKC').trim()].map(c=>variants.get(c)||c).join('');
}

function matchingNames(entries,query,nameOf=entry=>entry.name) {
  if(typeof query!=='string'||!query.trim())throw new Error('名称不能为空');
  // Preserve the existing raw-prefix candidate set and its instance ordering.
  const direct=entries.filter(entry=>nameOf(entry).startsWith(query));
  if(direct.length)return direct;
  const prefix=normalizeName(query),spellings=new Map();
  const matches=entries.filter(entry=>{
    const original=nameOf(entry),normalized=normalizeName(original);
    if(!normalized.startsWith(prefix))return false;
    if(!spellings.has(normalized))spellings.set(normalized,new Set());
    spellings.get(normalized).add(original);
    return true;
  });
  // Ordinary prefix families still use the existing selection rules. Only
  // distinct complete names collapsed by conversion require disambiguation.
  for(const names of spellings.values())if(names.size>1)
    throw new Error('字形转换后名称重合，请使用日文原名或实例 ID: '+[...names].join(' / '));
  return matches;
}

const matchesName=(original,query)=>matchingNames([original],query,name=>name).length>0;
module.exports={normalizeName,matchingNames,matchesName,VARIANT_GROUPS};
