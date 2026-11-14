'use strict';
// Localize cached metric *presentation* at render time. Numeric values and
// route/combat decisions never pass through these functions.
const {t,registerCatalog,getLocale}=require('../../shared/i18n');
const mechanismDisplay=require('./mechanism_display');
require('./workbench_catalog');
registerCatalog('ja',{
  'tooltip.equipmentSlot':'{n} スロット','tooltip.proficiency':'熟練度 {n}',
  '{node}（第 {round} 轮）':'{node}（第{round}回）',
  '无属性加成':'能力補正なし','装备属性资料待同步':'装備の能力情報は同期待ち',
  '制空按当前搭载':'制空値は現在の搭載数で計算','制空按出击前满载':'制空値は出撃前の満載で計算',
  '适重预估':'フィット補正は推定','适重待确认':'フィット補正は要確認',
  '括号内为昼战适重':'括弧内は昼戦フィット補正','括号内为昼战适重（预估）':'括弧内は昼戦フィット補正（推定）',
  '门槛 ≥ {required} · {edge}{extra}':'閾値 ≥ {required} · {edge}{extra}',
  ' · 共 {count} 处':' · 全 {count} 箇所',
  '装备资料缺失，无法确认速力':'装備情報が不足し速力を確認できません',
  '新型缶改修资料缺失，无法确认速力档位':'新型缶の改修情報が不足し速力を確認できません',
  '至少一舰的速力无法判定':'少なくとも1隻の速力を判定できません',
  '缺少司令部等级':'司令部レベルが不足',
  '缺少航空槽位计算资料':'航空スロットの計算情報が不足',
  '敌方防空资料缺失':'敵対空情報が不足',
  '敌方防空数值缺失':'敵対空値が不足',
  '敌方特殊对空迎击尚未定量':'敵の特殊対空迎撃は未定量',
  '基地航空逐槽资料待确认':'基地航空隊のスロット情報は要確認',
  '选择路线后显示制空门槛':'ルート選択後に制空閾値を表示',
  '该海域缺少逐点敌情':'この海域の各マス敵情報が不足',
  '喷气或特殊机种的额外航空阶段尚未支持':'噴式機・特殊機の追加航空戦は未対応',
  '特殊机种的航空阶段未确认':'特殊機の航空戦は未確認',
  '当前钢材资料缺失，喷式强袭时机待确认':'鋼材情報が不足し噴式強襲の時機は要確認',
  '敌方喷气机的喷气阶段比例击坠规则未确认':'敵噴式機の噴式強襲における割合撃墜は未確認',
  '部分航空槽位缺少搭载数或熟练度':'一部の航空スロットの搭載数または熟練度が不足',
  '喷式舰攻的制空与损耗规则未确认':'噴式艦攻の制空と損耗のルールは未確認',
  '路线制空资料不足':'ルートの制空情報が不足'
});
registerCatalog('zh-TW',{
  'tooltip.equipmentSlot':'第 {n} 格','tooltip.proficiency':'熟練度 {n}',
  '{node}（第 {round} 轮）':'{node}（第 {round} 輪）',
  '无属性加成':'無屬性加成','装备属性资料待同步':'裝備屬性資料待同步',
  '制空按当前搭载':'制空按目前搭載計算','制空按出击前满载':'制空按出擊前滿載計算',
  '适重预估':'適重為預估','适重待确认':'適重待確認',
  '括号内为昼战适重':'括號內為晝戰適重','括号内为昼战适重（预估）':'括號內為晝戰適重（預估）',
  '门槛 ≥ {required} · {edge}{extra}':'門檻 ≥ {required} · {edge}{extra}',
  ' · 共 {count} 处':' · 共 {count} 處',
  '装备资料缺失，无法确认速力':'裝備資料不足，無法確認速力',
  '新型缶改修资料缺失，无法确认速力档位':'新型鍋爐改修資料不足，無法確認速力',
  '至少一舰的速力无法判定':'至少一艘艦娘的速力無法判定',
  '缺少司令部等级':'缺少司令部等級',
  '缺少航空槽位计算资料':'缺少航空格位計算資料',
  '敌方防空资料缺失':'敵方防空資料不足','敌方防空数值缺失':'敵方防空數值不足',
  '敌方特殊对空迎击尚未定量':'敵方特殊對空迎擊尚未定量',
  '基地航空逐槽资料待确认':'基地航空隊各格資料待確認',
  '选择路线后显示制空门槛':'選擇路線後顯示制空門檻',
  '该海域缺少逐点敌情':'該海域缺少各點敵情',
  '喷气或特殊机种的额外航空阶段尚未支持':'噴式機或特殊機種的額外航空階段尚未支援',
  '特殊机种的航空阶段未确认':'特殊機種的航空階段未確認',
  '当前钢材资料缺失，喷式强袭时机待确认':'鋼材資料不足，噴式強襲時機待確認',
  '敌方喷气机的喷气阶段比例击坠规则未确认':'敵方噴式機噴式強襲的比例擊墜規則未確認',
  '部分航空槽位缺少搭载数或熟练度':'部分航空格位缺少搭載數或熟練度',
  '喷式舰攻的制空与损耗规则未确认':'噴式艦攻的制空與損耗規則未確認',
  '路线制空资料不足':'路線制空資料不足'
});
function title(content){
  const data=content.titleData||{};
  if(content.kind==='equipment'&&content.equipmentTitle){
    const item=content.equipmentTitle,position=item.extra?t('增设'):Number.isInteger(item.slot)?
      (getLocale()==='zh-CN'?`${item.slot+1} 槽`:t('tooltip.equipmentSlot',{n:item.slot+1})):'';
    const level=item.proficiency>0?' · '+(getLocale()==='zh-CN'?`熟练度 ${item.proficiency}`:t('tooltip.proficiency',{n:item.proficiency})):'';
    return (position?position+' · ':'')+item.name+(item.improvement>0?` ★${item.improvement}`:'')+level;
  }
  if(content.displayKind==='fleet-speed')return t('舰队速力：{value}',{value:t(data.value||'—')});
  if(content.displayKind==='fleet-air')return t('综合制空：{value}',{value:data.value||'—'})+(data.state?`（${t(data.state)}）`:'');
  if(content.displayKind==='fleet-los')return t(data.value||'舰队索敌');
  return content.title;
}
const enumKeys=new Set(['speed','outcome','position']);
const numericKeys=new Set(['friendlyAir','enemyAir','current']);
function cell(content,section,index,value){
  if(!content.displayKind||typeof value!=='string')return value;
  const key=section.columnKeys?.[index];
  if(enumKeys.has(key))return value.split(/( → |～)/).map(part=>part===' → '||part==='～'?part:t(part)).join('');
  if(key==='node')return value.replace(/^(.+?)（第 (\d+) 轮）$/,(_,node,round)=>t('{node}（第 {round} 轮）',{node,round}));
  if(key==='branch')return value.replace(/^(.+) 点$/,(_,nodes)=>t('{nodes} 点',{nodes}));
  if(numericKeys.has(key)){
    if(['待确认','待估算','待计算'].includes(value))return t(value);
    return value.replace(/（上限）$/,t('（上限）'));
  }
  return value;
}
function notes(content){
  if(!Array.isArray(content.noteData))return (content.notes||[]).map(note=>mechanismDisplay.text(note));
  return content.noteData.map(note=>note.kind==='message'?t(note.value):
    note.kind==='ship-reason'?`${note.name}：${source(note.reason)}`:source(note.value));
}
function source(raw){
  if(typeof raw!=='string')return raw;
  return raw.split('\n').map(line=>{
    const threshold=line.match(/^门槛 ≥ (.+?) · (.+?)(?: · 共 (\d+) 处)?$/);
    if(threshold)return t('门槛 ≥ {required} · {edge}{extra}',{required:threshold[1],edge:threshold[2].replace(/(.+) 点$/,(_,nodes)=>t('{nodes} 点',{nodes})),extra:threshold[3]?t(' · 共 {count} 处',{count:threshold[3]}):''});
    return line.split('；').map(part=>{
      const node=part.match(/^(.+?) 点：(.+)$/);
      if(node)return t('{nodes} 点',{nodes:node[1]})+'：'+node[2].split('、').map(text=>mechanismDisplay.text(text)).join('、');
      return mechanismDisplay.text(compactHint(part));
    }).join('；');
  }).join('\n');
}
// These hints are generated by the calculation model. Translate their display
// templates without changing route conditions or calculated values.
function compactHint(value){
  if(!value)return value;
  return String(value).split('；').map(part=>{
    let m=part.match(/^(.+?) 点 · (低速|高速\+?|最速)(以上)?$/);
    if(m)return t('{nodes} 点 · {speed}',{nodes:m[1].split('/').map(n=>n==='出发'?t(n):n).join('/'),speed:t(m[2])+(m[3]||'')});
    m=part.match(/^所选流派 · (低速|高速\+?|最速)统一$/);
    if(m)return t('所选流派 · {speed}统一',{speed:t(m[1])});
    m=part.match(/^(.+?) 点 · 空优 (.+?) · 空确 (.+?)(（参考）)?$/);
    if(m)return t('{nodes} 点 · 空优 {superiority} · 空确 {supremacy}{reference}',{nodes:m[1],superiority:m[2],supremacy:m[3],reference:m[4]?t('（参考）'):''});
    m=part.match(/^(.+?) · 门槛 ≥ (.+?) · 系数 (\d+)$/);
    if(m){const edge=m[1].replace(/(.+) 点$/,(_,nodes)=>t('{nodes} 点',{nodes}));
      return t('{edge} · 门槛 ≥ {required} · 系数 {coefficient}',{edge,required:m[2],coefficient:m[3]});}
    m=part.match(/^(.+) · 门槛待确认$/);
    if(m)return t('{edges} · 门槛待确认',{edges:m[1].split(' · ').map(edge=>edge.replace(/(.+) 点$/,(_,nodes)=>t('{nodes} 点',{nodes}))).join(' · ')});
    return t(part);
  }).join('；');
}
module.exports={title,cell,notes,compactHint};
